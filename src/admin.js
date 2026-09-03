const USER_ROLES = new Set(["admin", "qualidade", "comercial", "financeiro"]);
const MANAGED_ROLES = new Set(["producao", ...USER_ROLES]);
// A coluna role guarda o papel principal e e ela que autoriza /api/operators
// (user.role !== "admin"). Ordenar com admin na frente evita o meio-termo de um
// usuario com acesso admin que nao consegue administrar.
const ROLE_PRIORITY = ["admin", "qualidade", "comercial", "financeiro"];

function sortedRoles(roles) {
  return [...roles].sort((a, b) => ROLE_PRIORITY.indexOf(a) - ROLE_PRIORITY.indexOf(b));
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEVICE_COOKIE = "fp_device";
const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 5; // 5 anos
const OPERATOR_PIN_ITERATIONS = 100000; // limite aceito pelo WebCrypto do Cloudflare Workers

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomHex(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function pbkdf2Hash(value, saltHex, iterations) {
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map((pair) => parseInt(pair, 16)));
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(value), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, keyMaterial, 256);
  return [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// O PIN nunca e hasheado sozinho: alem do salt por registro, sempre misturamos
// o pepper do servidor (Wrangler Secret OPERATOR_PIN_PEPPER) para que um vazamento
// do D1 isoladamente nao seja suficiente para forcar bruta os PINs de 6 digitos.
async function hashOperatorPin(env, pin, saltHex, iterations) {
  if (!env.OPERATOR_PIN_PEPPER) throw new Error("pin_pepper_missing");
  return pbkdf2Hash(`${pin}::${env.OPERATOR_PIN_PEPPER}`, saltHex, iterations);
}

function auditStatement(env, user, action, entityType, entityId, details = {}) {
  return env.DB.prepare(
    `INSERT INTO audit_log
      (actor_hash, actor_name, actor_role, action, entity_type, entity_id, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    user?.identityHash || "system",
    user?.name || "system",
    user?.role || "sistema",
    action,
    entityType,
    entityId || "",
    JSON.stringify(details),
    new Date().toISOString(),
  );
}

async function audit(env, user, action, entityType, entityId, details = {}) {
  await auditStatement(env, user, action, entityType, entityId, details).run();
}

function operatorFromRow(row) {
  let roles;
  try { roles = JSON.parse(row.access_roles || "[]"); } catch { roles = []; }
  if (!Array.isArray(roles) || !roles.length) roles = [row.role];
  return {
    id: row.identity_hash,
    name: row.display_name,
    role: row.role,
    roles,
    machine: row.machine_name || "",
    pinReady: Boolean(row.pin_hash),
  };
}

async function listOperators(env) {
  const result = await env.DB.prepare(
    `SELECT identity_hash, display_name, role, access_roles, machine_name, pin_hash
       FROM user_roles
      WHERE role IN ('producao', 'qualidade', 'comercial', 'financeiro', 'admin') AND active = 1
      ORDER BY display_name COLLATE NOCASE`,
  ).all();
  return json({ operators: result.results.map(operatorFromRow) });
}

async function createOperator(request, env, user) {
  const body = await request.json().catch(() => ({}));
  const name = normalizeText(body.name);
  const email = normalizeText(body.email).toLowerCase();
  const requestedRoles = Array.isArray(body.roles) ? body.roles.map(normalizeText) : [normalizeText(body.role)];
  const isProduction = requestedRoles.includes("producao");
  const roles = isProduction
    ? ["producao"]
    : sortedRoles([...new Set(requestedRoles.filter(item => USER_ROLES.has(item)))]);
  const role = roles[0] || "";

  if (!name || name.length > 100) return json({ error: "invalid_name" }, 400);
  if (!email || email.length > 180 || !EMAIL_RE.test(email)) return json({ error: "invalid_email" }, 400);
  if (!roles.length || (isProduction && requestedRoles.length !== 1)) return json({ error: "invalid_role" }, 400);
  let machine = "";
  let pinSalt = null;
  let pinHash = null;
  const pinIterations = OPERATOR_PIN_ITERATIONS;

  if (isProduction) {
    machine = normalizeText(body.machine);
    if (!machine) return json({ error: "invalid_machine" }, 400);
    const pin = normalizeText(body.pin);
    if (!pin) return json({ error: "operator_pin_required" }, 400);
    if (!/^\d{6}$/.test(pin)) return json({ error: "invalid_pin" }, 400);
    if (!env.OPERATOR_PIN_PEPPER) {
      return json({ error: "pin_pepper_missing", message: "OPERATOR_PIN_PEPPER nao configurado no Worker." }, 500);
    }
    pinSalt = randomHex(16);
    try {
      pinHash = await hashOperatorPin(env, pin, pinSalt, pinIterations);
    } catch {
      return json({ error: "pin_hash_failed", message: "Nao foi possivel proteger o PIN do operador." }, 500);
    }
  }

  const identityHash = await sha256(email);
  const existing = await env.DB.prepare(
    `SELECT role FROM user_roles WHERE identity_hash = ?`,
  ).bind(identityHash).first();
  if (existing && !MANAGED_ROLES.has(existing.role)) {
    return json({ error: "identity_has_another_role" }, 409);
  }

  const now = new Date().toISOString();
  let save;
  if (isProduction) {
    save = env.DB.prepare(
      `INSERT INTO user_roles
        (identity_hash, display_name, role, active, created_at, machine_name, pin_salt, pin_hash, pin_iterations, pin_updated_at, failed_attempts, locked_until, access_roles)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 0, NULL, ?)
       ON CONFLICT(identity_hash) DO UPDATE SET
         display_name = excluded.display_name, role = excluded.role, active = 1,
         machine_name = excluded.machine_name, pin_salt = excluded.pin_salt, pin_hash = excluded.pin_hash,
         pin_iterations = excluded.pin_iterations, pin_updated_at = excluded.pin_updated_at,
         failed_attempts = 0, locked_until = NULL, access_roles = excluded.access_roles`,
    ).bind(identityHash, name, role, now, machine, pinSalt, pinHash, pinIterations, now, JSON.stringify(roles));
  } else {
    save = env.DB.prepare(
      `INSERT INTO user_roles
        (identity_hash, display_name, role, active, created_at, machine_name, pin_salt, pin_hash, pin_iterations, pin_updated_at, failed_attempts, locked_until, access_roles)
       VALUES (?, ?, ?, 1, ?, '', NULL, NULL, 100000, NULL, 0, NULL, ?)
       ON CONFLICT(identity_hash) DO UPDATE SET
         display_name = excluded.display_name, role = excluded.role, active = 1,
         machine_name = '', pin_salt = NULL, pin_hash = NULL, pin_updated_at = NULL,
         failed_attempts = 0, locked_until = NULL, access_roles = excluded.access_roles`,
    ).bind(identityHash, name, role, now, JSON.stringify(roles));
  }

  await env.DB.batch([
    save,
    auditStatement(env, user, existing ? "operator_update" : "operator_create", "operator", identityHash, { roles, machine }),
  ]);

  // A resposta e montada com o que acabou de ser gravado. Uma releitura aqui so
  // acrescentaria mais uma ida ao D1 capaz de falhar depois de o cadastro ja
  // estar salvo -- e o painel reportaria erro em uma operacao bem-sucedida.
  return json({
    operator: { id: identityHash, name, role, roles, machine, pinReady: Boolean(pinHash) },
  });
}

async function deleteOperator(env, user, identityHash) {
  const row = await env.DB.prepare(
    `SELECT identity_hash, role FROM user_roles WHERE identity_hash = ? AND active = 1`,
  ).bind(identityHash).first();
  if (!row || !MANAGED_ROLES.has(row.role)) return json({ error: "operator_not_found" }, 404);
  // Agora que admin pode ser cadastrado por aqui, ele tambem poderia ser
  // removido por aqui. Sem esta guarda, desativar o ultimo administrador
  // trancaria todo mundo para fora da administracao, sem caminho de volta
  // pela interface.
  if (row.role === "admin") {
    const remaining = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM user_roles WHERE role = 'admin' AND active = 1 AND identity_hash <> ?`,
    ).bind(identityHash).first();
    if (!Number(remaining?.total || 0)) return json({ error: "last_admin_required" }, 409);
  }

  await env.DB.prepare(`UPDATE user_roles SET active = 0 WHERE identity_hash = ?`).bind(identityHash).run();
  await audit(env, user, "operator_delete", "operator", identityHash, {});
  return json({ ok: true });
}

function deviceFromRow(row) {
  return {
    id: row.id,
    name: row.display_name,
    machine: row.machine_name,
    active: Boolean(row.active),
    lastSeenAt: row.last_seen_at || null,
  };
}

async function listOperatorDevices(env) {
  const result = await env.DB.prepare(
    `SELECT id, display_name, machine_name, active, last_seen_at
       FROM operator_devices
      ORDER BY display_name COLLATE NOCASE`,
  ).all();
  return json({ devices: result.results.map(deviceFromRow) });
}

async function createOperatorDevice(request, env, user) {
  const body = await request.json().catch(() => ({}));
  const name = normalizeText(body.name);
  const machine = normalizeText(body.machine);
  if (!name || name.length > 100) return json({ error: "invalid_device_name" }, 400);
  if (!machine) return json({ error: "invalid_machine" }, 400);

  const id = crypto.randomUUID();
  const token = randomHex(32);
  const tokenHash = await sha256(token);
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO operator_devices (id, token_hash, display_name, machine_name, active, created_at, created_by)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
  ).bind(id, tokenHash, name, machine, now, user.identityHash).run();

  await audit(env, user, "operator_device_create", "operator_device", id, { machine });

  const response = json({
    device: { id, name, machine, active: true, lastSeenAt: null },
  });
  response.headers.append(
    "set-cookie",
    `${DEVICE_COOKIE}=${token}; Path=/operador; Max-Age=${DEVICE_COOKIE_MAX_AGE}; Secure; HttpOnly; SameSite=Strict`,
  );
  return response;
}

async function revokeOperatorDevice(env, user, id) {
  const row = await env.DB.prepare(
    `SELECT id FROM operator_devices WHERE id = ? AND active = 1`,
  ).bind(id).first();
  if (!row) return json({ error: "operator_device_not_found" }, 404);

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE operator_devices SET active = 0, revoked_at = ?, revoked_by = ? WHERE id = ?`,
    ).bind(new Date().toISOString(), user.identityHash, id),
    env.DB.prepare(`DELETE FROM operator_sessions WHERE device_id = ?`).bind(id),
  ]);
  await audit(env, user, "operator_device_revoke", "operator_device", id, {});
  return json({ ok: true });
}

export async function handleOperatorsAdminRequest(request, env, user) {
  const url = new URL(request.url);
  if (user.role !== "admin") return json({ error: "forbidden" }, 403);

  try {
    if (url.pathname === "/api/operators" && request.method === "GET") return await listOperators(env);
    if (url.pathname === "/api/operators" && request.method === "POST") return await createOperator(request, env, user);
    if (url.pathname.startsWith("/api/operators/") && request.method === "DELETE") {
      return await deleteOperator(env, user, decodeURIComponent(url.pathname.slice("/api/operators/".length)));
    }
    if (url.pathname === "/api/operator-devices" && request.method === "GET") return await listOperatorDevices(env);
    if (url.pathname === "/api/operator-devices" && request.method === "POST") return await createOperatorDevice(request, env, user);
    if (url.pathname.startsWith("/api/operator-devices/") && request.method === "DELETE") {
      return await revokeOperatorDevice(env, user, decodeURIComponent(url.pathname.slice("/api/operator-devices/".length)));
    }
    return json({ error: "not_found" }, 404);
  } catch (error) {
    const message = String(error?.message || error).slice(0, 240);
    console.error(JSON.stringify({
      event: "operators_admin_error", path: url.pathname, method: request.method, message,
    }));
    return json({ error: "operators_admin_failed", message }, 500);
  }
}

const PAYABLE_ALLOWED_ROLES = new Set(["admin"]);

function payableFromRow(row) {
  return {
    id: row.id,
    supplierName: row.supplier_name,
    description: row.description,
    amount: row.amount,
    dueDate: row.due_date,
    category: row.category,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    createdBy: row.created_by_name,
    paidAt: row.paid_at || null,
  };
}

async function listManualPayables(env) {
  const result = await env.DB.prepare(
    `SELECT id, supplier_name, description, amount, due_date, category, status, notes, created_at, created_by_name, paid_at
       FROM finance_manual_payables
      ORDER BY (status = 'pago') ASC, due_date ASC`,
  ).all();
  return json({ payables: result.results.map(payableFromRow) });
}

async function createManualPayable(request, env, user) {
  const body = await request.json().catch(() => ({}));
  const supplierName = normalizeText(body.supplierName);
  const description = normalizeText(body.description).slice(0, 300);
  const category = normalizeText(body.category).slice(0, 60);
  const notes = normalizeText(body.notes).slice(0, 500);
  const dueDate = normalizeText(body.dueDate);
  const amount = Number(body.amount);

  if (!supplierName || supplierName.length > 150) return json({ error: "invalid_supplier" }, 400);
  if (!Number.isFinite(amount) || amount <= 0) return json({ error: "invalid_amount" }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(new Date(`${dueDate}T00:00:00Z`).getTime())) {
    return json({ error: "invalid_due_date" }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO finance_manual_payables
      (id, supplier_name, description, amount, due_date, category, status, notes, created_at, created_by_hash, created_by_name, paid_at)
     VALUES (?, ?, ?, ?, ?, ?, 'a vencer', ?, ?, ?, ?, NULL)`,
  ).bind(id, supplierName, description, amount, dueDate, category, notes, now, user.identityHash, user.name).run();

  await audit(env, user, "manual_payable_create", "manual_payable", id, { supplierName, amount, dueDate });

  const row = await env.DB.prepare(
    `SELECT id, supplier_name, description, amount, due_date, category, status, notes, created_at, created_by_name, paid_at
       FROM finance_manual_payables WHERE id = ?`,
  ).bind(id).first();
  return json({ payable: payableFromRow(row) });
}

async function updateManualPayableStatus(request, env, user, id) {
  const body = await request.json().catch(() => ({}));
  const status = normalizeText(body.status);
  if (!["a vencer", "pago"].includes(status)) return json({ error: "invalid_status" }, 400);

  const row = await env.DB.prepare(`SELECT id FROM finance_manual_payables WHERE id = ?`).bind(id).first();
  if (!row) return json({ error: "payable_not_found" }, 404);

  const paidAt = status === "pago" ? new Date().toISOString() : null;
  await env.DB.prepare(
    `UPDATE finance_manual_payables SET status = ?, paid_at = ? WHERE id = ?`,
  ).bind(status, paidAt, id).run();
  await audit(env, user, "manual_payable_status", "manual_payable", id, { status });

  const updated = await env.DB.prepare(
    `SELECT id, supplier_name, description, amount, due_date, category, status, notes, created_at, created_by_name, paid_at
       FROM finance_manual_payables WHERE id = ?`,
  ).bind(id).first();
  return json({ payable: payableFromRow(updated) });
}

async function deleteManualPayable(env, user, id) {
  const row = await env.DB.prepare(`SELECT id FROM finance_manual_payables WHERE id = ?`).bind(id).first();
  if (!row) return json({ error: "payable_not_found" }, 404);
  await env.DB.prepare(`DELETE FROM finance_manual_payables WHERE id = ?`).bind(id).run();
  await audit(env, user, "manual_payable_delete", "manual_payable", id, {});
  return json({ ok: true });
}

export async function handleManualPayablesRequest(request, env, user) {
  const url = new URL(request.url);
  if (!PAYABLE_ALLOWED_ROLES.has(user.role)) return json({ error: "forbidden" }, 403);

  if (url.pathname === "/api/manual-payables" && request.method === "GET") return listManualPayables(env);
  if (url.pathname === "/api/manual-payables" && request.method === "POST") return createManualPayable(request, env, user);
  if (url.pathname.startsWith("/api/manual-payables/") && request.method === "PATCH") {
    return updateManualPayableStatus(request, env, user, decodeURIComponent(url.pathname.slice("/api/manual-payables/".length)));
  }
  if (url.pathname.startsWith("/api/manual-payables/") && request.method === "DELETE") {
    return deleteManualPayable(env, user, decodeURIComponent(url.pathname.slice("/api/manual-payables/".length)));
  }
  return json({ error: "not_found" }, 404);
}
