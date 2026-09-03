const DEVICE_COOKIE = "fp_device";
const SESSION_COOKIE = "fp_operator";
const SESSION_MAX_AGE = 60 * 60 * 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const OPERATOR_PIN_ITERATIONS = 100000;

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { ...JSON_HEADERS, ...headers } });
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function parseCookies(request) {
  const result = {};
  for (const part of normalizeText(request.headers.get("cookie")).split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    result[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim());
  }
  return result;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomHex(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function pbkdf2Hash(value, saltHex, iterations) {
  const pairs = saltHex.match(/.{2}/g);
  if (!pairs) throw new Error("invalid_pin_salt");
  const salt = new Uint8Array(pairs.map((pair) => parseInt(pair, 16)));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(value),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index % a.length] || 0) ^ (b[index % b.length] || 0);
  }
  return difference === 0;
}

async function hashOperatorPin(env, pin, saltHex, iterations) {
  if (!env.OPERATOR_PIN_PEPPER) throw new Error("pin_pepper_missing");
  return pbkdf2Hash(`${pin}::${env.OPERATOR_PIN_PEPPER}`, saltHex, iterations);
}

function appendCookie(response, value) {
  response.headers.append("set-cookie", value);
  return response;
}

async function audit(env, user, action, entityType, entityId, details = {}) {
  await env.DB.prepare(
    `INSERT INTO audit_log
      (actor_hash, actor_name, actor_role, action, entity_type, entity_id, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    user?.identityHash || "operator-login",
    user?.name || "Operador",
    user?.role || "producao",
    action,
    entityType,
    entityId || "",
    JSON.stringify(details),
    new Date().toISOString(),
  ).run();
}

async function resolveDevice(request, env) {
  const deviceToken = parseCookies(request)[DEVICE_COOKIE];
  if (!deviceToken) return { error: "device_not_authorized" };
  const tokenHash = await sha256(deviceToken);
  const device = await env.DB.prepare(
    `SELECT id, display_name, machine_name, active
       FROM operator_devices
      WHERE token_hash = ?`,
  ).bind(tokenHash).first();
  if (!device || !device.active) return { error: "device_not_authorized" };
  return { device };
}

async function login(request, env) {
  const body = await request.json().catch(() => ({}));
  const email = normalizeText(body.email).toLowerCase();
  const pin = normalizeText(body.pin);
  if (!email || !/^\d{6}$/.test(pin)) return json({ error: "invalid_credentials" }, 401);

  // Rejeita aparelhos desconhecidos antes de consultar a conta ou validar o PIN.
  // Isso impede cadastro automático, enumeração de operadores e bloqueio malicioso de contas.
  const resolved = await resolveDevice(request, env);
  if (resolved.error) return json({ error: resolved.error }, 403);

  const identityHash = await sha256(email);
  const operator = await env.DB.prepare(
    `SELECT identity_hash, display_name, role, machine_name, pin_salt, pin_hash,
            pin_iterations, failed_attempts, locked_until
       FROM user_roles
      WHERE identity_hash = ? AND role = 'producao' AND active = 1`,
  ).bind(identityHash).first();
  if (!operator || !operator.pin_hash || !operator.pin_salt) {
    return json({ error: "invalid_credentials" }, 401);
  }
  if (normalizeText(resolved.device.machine_name) !== normalizeText(operator.machine_name)) {
    return json({ error: "device_machine_mismatch" }, 403);
  }

  const now = new Date();
  if (operator.locked_until && new Date(operator.locked_until) > now) {
    return json({ error: "operator_temporarily_locked" }, 423);
  }

  const candidate = await hashOperatorPin(env, pin, operator.pin_salt, Number(operator.pin_iterations || OPERATOR_PIN_ITERATIONS));
  if (!constantTimeEqual(candidate, operator.pin_hash)) {
    const failures = Number(operator.failed_attempts || 0) + 1;
    const lockedUntil = failures >= MAX_FAILED_ATTEMPTS
      ? new Date(now.getTime() + LOCK_MINUTES * 60 * 1000).toISOString()
      : null;
    await env.DB.prepare(
      `UPDATE user_roles SET failed_attempts = ?, locked_until = ? WHERE identity_hash = ?`,
    ).bind(failures, lockedUntil, identityHash).run();
    return json({ error: lockedUntil ? "operator_temporarily_locked" : "invalid_credentials" }, lockedUntil ? 423 : 401);
  }

  const sessionToken = randomHex(32);
  const sessionHash = await sha256(sessionToken);
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE * 1000).toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO operator_sessions
        (token_hash, identity_hash, device_id, created_at, expires_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(sessionHash, identityHash, resolved.device.id, createdAt, expiresAt, createdAt),
    env.DB.prepare(
      `UPDATE user_roles SET failed_attempts = 0, locked_until = NULL WHERE identity_hash = ?`,
    ).bind(identityHash),
    env.DB.prepare(
      `UPDATE operator_devices SET last_seen_at = ? WHERE id = ?`,
    ).bind(createdAt, resolved.device.id),
  ]);

  const user = {
    identityHash,
    name: operator.display_name,
    role: "producao",
    machine: operator.machine_name,
    isOperator: true,
  };
  await audit(env, user, "operator_login", "operator_device", resolved.device.id, { machine: user.machine });

  let response = json({ name: user.name, role: user.role, machine: user.machine });
  response = appendCookie(
    response,
    `${SESSION_COOKIE}=${sessionToken}; Path=/operador; Max-Age=${SESSION_MAX_AGE}; Secure; HttpOnly; SameSite=Strict`,
  );
  return response;
}

async function logout(request, env) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (token) {
    await env.DB.prepare(`DELETE FROM operator_sessions WHERE token_hash = ?`).bind(await sha256(token)).run();
  }
  return appendCookie(
    json({ ok: true }),
    `${SESSION_COOKIE}=; Path=/operador; Max-Age=0; Secure; HttpOnly; SameSite=Strict`,
  );
}

export async function currentOperator(request, env) {
  const cookies = parseCookies(request);
  if (!cookies[SESSION_COOKIE] || !cookies[DEVICE_COOKIE]) return null;
  const sessionHash = await sha256(cookies[SESSION_COOKIE]);
  const deviceHash = await sha256(cookies[DEVICE_COOKIE]);
  const row = await env.DB.prepare(
    `SELECT s.identity_hash, s.expires_at, u.display_name, u.role, u.machine_name,
            d.id AS device_id, d.machine_name AS device_machine
       FROM operator_sessions s
       JOIN user_roles u ON u.identity_hash = s.identity_hash
       JOIN operator_devices d ON d.id = s.device_id
      WHERE s.token_hash = ? AND d.token_hash = ?
        AND u.active = 1 AND u.role = 'producao' AND d.active = 1`,
  ).bind(sessionHash, deviceHash).first();
  if (!row || new Date(row.expires_at) <= new Date()) return null;
  if (normalizeText(row.machine_name) !== normalizeText(row.device_machine)) return null;
  return {
    identityHash: row.identity_hash,
    name: row.display_name,
    role: "producao",
    machine: row.machine_name,
    deviceId: row.device_id,
    isOperator: true,
  };
}

export async function handleOperatorAuth(request, env, url) {
  if (url.pathname === "/operador/api/login" && request.method === "POST") return login(request, env);
  if (url.pathname === "/operador/api/logout" && request.method === "POST") return logout(request, env);
  return null;
}
