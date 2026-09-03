import { fetchFinanceData } from "./protheus-finance.js";

const SCREEN_EXCLUDED_TAX_IDS = new Set([
  "07155032000105", "82221730000187", "46426147000149", "43804835000107", "44286984000184",
  "46427485000103", "23291273000138", "46327432000102", "48331905000170", "55385777000103",
]);
const SCREEN_EXCLUDED_TITLE_TYPES = new Set(["PA", "TX", "PIS", "COF", "ISS", "INS"]);
const SCREEN_EXCLUDED_SUPPLIER_NAME_PATTERNS = ["FOREST", "ONZE", "GREENPAR"];
const ALLOWED_ROLES = new Set(["financeiro", "diretoria", "admin"]);

function userHasAnyRole(user, allowed) {
  return (user?.roles || [user?.role]).some(role => allowed.has(role));
}
const MANUAL_STATUSES = new Set(["a vencer", "vencido", "negociado", "pago", "pagar"]);

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
function cleanTaxId(value) { return String(value ?? "").replace(/\D/g, "").padStart(14, "0"); }
function positiveInteger(value, fallback, maximum = 200) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(Math.trunc(parsed), maximum)) : fallback;
}
function isoDate(value) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(new Date(`${raw}T00:00:00Z`).getTime())) return "";
  return raw;
}
// Hash sincrono e barato (FNV-1a) para o payload_hash de cada titulo/pedido.
// payload_hash e apenas informativo (nao decide se a linha e regravada), entao
// nao vale o custo de SHA-256 assincrono por linha em cargas de milhares de
// registros do TOTVS — isso sozinho ja estourava o limite de CPU do Worker.
function fastHash(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
// Filtro aplicado só na tela (dashboard/listagens); o modo de exportação (Excel)
// nunca usa isto e sempre traz o dado completo do cache.
function screenFilter(prefix = "", { titleType = false, purchases = false } = {}) {
  const params = [...SCREEN_EXCLUDED_TAX_IDS];
  const clauses = [`REPLACE(REPLACE(REPLACE(${prefix}supplier_tax_id, '.', ''), '/', ''), '-', '') NOT IN (${SCREEN_EXCLUDED_TAX_IDS.size ? [...SCREEN_EXCLUDED_TAX_IDS].map(() => "?").join(",") : "''"})`];
  for (const pattern of SCREEN_EXCLUDED_SUPPLIER_NAME_PATTERNS) {
    clauses.push(`UPPER(${prefix}supplier_name) NOT LIKE ?`);
    params.push(`%${pattern}%`);
  }
  if (titleType) {
    clauses.push(`${prefix}title_type NOT IN (${[...SCREEN_EXCLUDED_TITLE_TYPES].map(() => "?").join(",")})`);
    params.push(...SCREEN_EXCLUDED_TITLE_TYPES);
  }
  if (purchases) clauses.push(`${prefix}issue_date >= date('now','-30 days')`);
  return { sql: clauses.join(" AND "), params };
}
function screenClause(prefix, exportMode, opts) {
  return exportMode ? { sql: "1=1", params: [] } : screenFilter(prefix, opts);
}
async function enabled(env) {
  const row = await env.DB.prepare("SELECT enabled FROM feature_flags WHERE flag_key = 'finance_payables'").first();
  return row?.enabled === 1;
}
function calculatedStatus(row, today) {
  if (Number(row.open_balance || 0) === 0) return "pago";
  return String(row.actual_due_date || "") < today ? "vencido" : "a vencer";
}
function hashRecord(record) { return fastHash(JSON.stringify(record)); }

async function upsertPayables(env, records, syncAt) {
  let changed = 0;
  // D1.batch representa uma única sub-requisição interna; agrupar mais linhas
  // evita esgotar o limite do Worker durante cargas anuais do Protheus.
  for (let offset = 0; offset < records.length; offset += 500) {
    const statements = [];
    for (const row of records.slice(offset, offset + 500)) {
      const hash = hashRecord(row);
      statements.push(env.DB.prepare(`
        INSERT INTO finance_payables_cache (
          cache_key, branch, title_number, title_type, installment, nature, supplier_code, supplier_store,
          supplier_name, supplier_tax_id, issue_date, accounting_date, due_date, actual_due_date,
          original_value, open_balance, settlement_date, first_seen_at, source_updated_at, payload_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          branch=excluded.branch, title_number=excluded.title_number, title_type=excluded.title_type,
          installment=excluded.installment, nature=excluded.nature, supplier_code=excluded.supplier_code,
          supplier_store=excluded.supplier_store, supplier_name=excluded.supplier_name,
          supplier_tax_id=excluded.supplier_tax_id, issue_date=excluded.issue_date,
          accounting_date=excluded.accounting_date, due_date=excluded.due_date,
          actual_due_date=excluded.actual_due_date, original_value=excluded.original_value,
          open_balance=excluded.open_balance, settlement_date=excluded.settlement_date,
          source_updated_at=excluded.source_updated_at, payload_hash=excluded.payload_hash
      `).bind(row.cacheKey, row.branch, row.titleNumber, row.titleType, row.installment, row.nature,
        row.supplierCode, row.supplierStore, row.supplierName, cleanTaxId(row.supplierTaxId), row.issueDate,
        row.accountingDate, row.dueDate, row.actualDueDate, row.originalValue, row.openBalance,
        row.settlementDate, syncAt, syncAt, hash));
    }
    const results = await env.DB.batch(statements);
    changed += results.reduce((sum, item) => sum + Number(item.meta?.changes || 0), 0);
  }
  await env.DB.prepare("DELETE FROM finance_payables_cache WHERE source_updated_at <> ?").bind(syncAt).run();
  return changed;
}

async function upsertPurchases(env, records, syncAt) {
  let changed = 0;
  for (let offset = 0; offset < records.length; offset += 500) {
    const statements = [];
    for (const row of records.slice(offset, offset + 500)) {
      const hash = hashRecord(row);
      statements.push(env.DB.prepare(`
        INSERT INTO finance_purchase_orders_cache (
          cache_key, branch, order_number, item_number, issue_date, supplier_code, supplier_store,
          supplier_name, supplier_tax_id, payment_condition, currency, product_code, product_description,
          ordered_quantity, received_quantity, open_quantity, unit_value, total_value, open_value,
          first_seen_at, source_updated_at, payload_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          branch=excluded.branch, order_number=excluded.order_number, item_number=excluded.item_number,
          issue_date=excluded.issue_date, supplier_code=excluded.supplier_code,
          supplier_store=excluded.supplier_store, supplier_name=excluded.supplier_name,
          supplier_tax_id=excluded.supplier_tax_id, payment_condition=excluded.payment_condition,
          currency=excluded.currency, product_code=excluded.product_code,
          product_description=excluded.product_description, ordered_quantity=excluded.ordered_quantity,
          received_quantity=excluded.received_quantity, open_quantity=excluded.open_quantity,
          unit_value=excluded.unit_value, total_value=excluded.total_value, open_value=excluded.open_value,
          source_updated_at=excluded.source_updated_at, payload_hash=excluded.payload_hash
      `).bind(row.cacheKey, row.branch, row.orderNumber, row.itemNumber, row.issueDate, row.supplierCode,
        row.supplierStore, row.supplierName, cleanTaxId(row.supplierTaxId), row.paymentCondition, row.currency,
        row.productCode, row.productDescription, row.orderedQuantity, row.receivedQuantity, row.openQuantity,
        row.unitValue, row.totalValue, row.openValue, syncAt, syncAt, hash));
    }
    const results = await env.DB.batch(statements);
    changed += results.reduce((sum, item) => sum + Number(item.meta?.changes || 0), 0);
  }
  await env.DB.prepare("DELETE FROM finance_purchase_orders_cache WHERE source_updated_at <> ?").bind(syncAt).run();
  return changed;
}

export async function syncFinanceCache(env, actor = null) {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  if (!await enabled(env)) {
    await env.DB.prepare("INSERT INTO finance_sync_runs (source,status,started_at,finished_at) VALUES ('totvs-se2-sc7','skipped',?,?)").bind(startedAt, startedAt).run();
    return { skipped: true, reason: "feature_disabled" };
  }
  const run = await env.DB.prepare("INSERT INTO finance_sync_runs (source,status,started_at) VALUES ('totvs-se2-sc7','running',?) RETURNING id").bind(startedAt).first();
  try {
    const data = await fetchFinanceData(env, new Date());
    const syncAt = new Date().toISOString();
    const [payablesChanged, purchasesChanged] = await Promise.all([
      upsertPayables(env, data.payables, syncAt), upsertPurchases(env, data.purchases, syncAt),
    ]);
    const duration = Date.now() - started;
    await env.DB.prepare(`UPDATE finance_sync_runs SET status='success', payables_received=?, purchases_received=?, duration_ms=?, finished_at=? WHERE id=?`)
      .bind(data.payables.length, data.purchases.length, duration, syncAt, run.id).run();
    console.log(JSON.stringify({ event: "finance_sync_success", durationMs: duration, payables: data.payables.length, purchases: data.purchases.length, actor: actor?.name || "cron" }));
    return { ok: true, payables: data.payables.length, purchases: data.purchases.length, payablesChanged, purchasesChanged, durationMs: duration, updatedAt: syncAt };
  } catch (error) {
    const duration = Date.now() - started;
    const finishedAt = new Date().toISOString();
    await env.DB.prepare(`UPDATE finance_sync_runs SET status='error', duration_ms=?, error_message=?, finished_at=? WHERE id=?`)
      .bind(duration, String(error?.message || error).slice(0, 500), finishedAt, run.id).run();
    console.error(JSON.stringify({ event: "finance_sync_error", durationMs: duration, message: String(error?.message || error).slice(0, 240) }));
    throw error;
  }
}

async function dashboard(env) {
  const today = new Date().toISOString().slice(0, 10);
  const plus7 = new Date(`${today}T00:00:00Z`); plus7.setUTCDate(plus7.getUTCDate() + 7);
  const until = plus7.toISOString().slice(0, 10);
  const payablesFilter = screenFilter("", { titleType: true });
  const purchasesFilter = screenFilter("", { purchases: true });
  const payables = await env.DB.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN open_balance <> 0 AND actual_due_date < ? THEN open_balance ELSE 0 END),0) overdue,
      COALESCE(SUM(CASE WHEN open_balance <> 0 AND actual_due_date >= ? AND actual_due_date <= ? THEN open_balance ELSE 0 END),0) due_seven_days,
      COALESCE(SUM(CASE WHEN open_balance <> 0 THEN open_balance ELSE 0 END),0) open_total
    FROM finance_payables_cache WHERE ${payablesFilter.sql}
  `).bind(today, today, until, ...payablesFilter.params).first();
  const purchases = await env.DB.prepare(`SELECT COALESCE(SUM(open_value),0) total FROM finance_purchase_orders_cache WHERE open_quantity > 0 AND ${purchasesFilter.sql}`)
    .bind(...purchasesFilter.params).first();
  const balances = await env.DB.prepare("SELECT COALESCE(SUM(balance_value),0) total FROM finance_account_balances WHERE balance_date = ?").bind(today).first();
  const alertsFilter = screenFilter("", { titleType: true });
  const alerts = await env.DB.prepare(`
    SELECT
      SUM(CASE WHEN first_seen_at >= datetime('now','-48 hours') AND actual_due_date < ? THEN 1 ELSE 0 END) new_near_due,
      SUM(CASE WHEN julianday(actual_due_date)-julianday(issue_date) < 7 THEN 1 ELSE 0 END) short_term
    FROM finance_payables_cache WHERE open_balance <> 0 AND ${alertsFilter.sql}
  `).bind(until, ...alertsFilter.params).first();
  const pagarFilter = screenFilter("p.", { titleType: true });
  const pagarMarked = await env.DB.prepare(`
    SELECT COALESCE(SUM(p.open_balance),0) total FROM finance_payables_cache p
    JOIN finance_status_overrides o ON o.cache_key = p.cache_key AND o.manual_status = 'pagar'
    WHERE p.open_balance <> 0 AND ${pagarFilter.sql}
  `).bind(...pagarFilter.params).first();
  const settledTodayFilter = screenFilter("", { titleType: true });
  const settledToday = await env.DB.prepare(`
    SELECT COALESCE(SUM(original_value),0) total, COUNT(*) count FROM finance_payables_cache
    WHERE settlement_date = date('now') AND ${settledTodayFilter.sql}
  `).bind(...settledTodayFilter.params).first();
  const lastSync = await env.DB.prepare("SELECT status,duration_ms,error_message,finished_at FROM finance_sync_runs ORDER BY id DESC LIMIT 1").first();
  const required = Number(payables?.overdue || 0) + Number(payables?.due_seven_days || 0);
  const available = Number(balances?.total || 0);
  const currentAvailable = available - Number(pagarMarked?.total || 0) - Number(settledToday?.total || 0);
  return { today, until, overdue: Number(payables?.overdue || 0), dueSevenDays: Number(payables?.due_seven_days || 0), openTotal: Number(payables?.open_total || 0), purchaseOpenTotal: Number(purchases?.total || 0), accountBalance: available, required, availabilityGap: available - required, currentAvailable, settledToday: { total: Number(settledToday?.total || 0), count: Number(settledToday?.count || 0) }, alerts: { newNearDue: Number(alerts?.new_near_due || 0), shortTerm: Number(alerts?.short_term || 0) }, lastSync };
}

async function listPayables(env, url, paid = false, exportMode = false) {
  const page = positiveInteger(url.searchParams.get("page"), 1, 100000);
  const pageSize = positiveInteger(url.searchParams.get("pageSize"), 50, 200);
  const allMode = !exportMode && !paid && url.searchParams.get("all") === "true";
  const where = [paid ? "p.open_balance = 0" : "p.open_balance <> 0"];
  const filter = screenClause("p.", exportMode, { titleType: true });
  where.push(filter.sql);
  const binds = [...filter.params];
  if (paid && !exportMode) {
    const day = isoDate(url.searchParams.get("day"));
    const month = /^\d{4}-\d{2}$/.test(url.searchParams.get("month") || "") ? url.searchParams.get("month") : "";
    if (day) { where.push("p.settlement_date = ?"); binds.push(day); }
    else if (month) { where.push("substr(p.settlement_date,1,7) = ?"); binds.push(month); }
    else where.push("p.settlement_date = date('now','-1 day')");
  }
  const whereSql = where.join(" AND ");
  const count = await env.DB.prepare(`SELECT COUNT(*) total FROM finance_payables_cache p WHERE ${whereSql}`).bind(...binds).first();
  const limitSql = exportMode ? "" : allMode ? "LIMIT 5000" : "LIMIT ? OFFSET ?";
  const query = `
    SELECT p.*, c.category supplier_category, o.manual_status, o.updated_at status_updated_at, o.updated_by_name,
      CASE WHEN p.open_balance = 0 THEN 'pago' WHEN p.actual_due_date < date('now') THEN 'vencido' ELSE 'a vencer' END calculated_status
    FROM finance_payables_cache p
    LEFT JOIN finance_status_overrides o ON o.cache_key=p.cache_key
    LEFT JOIN finance_supplier_categories c ON c.supplier_code=p.supplier_code
    WHERE ${whereSql}
    ORDER BY p.actual_due_date, p.branch, p.title_number, p.installment
    ${limitSql}`;
  const queryBinds = exportMode || allMode ? binds : [...binds, pageSize, (page - 1) * pageSize];
  const result = await env.DB.prepare(query).bind(...queryBinds).all();
  return { items: result.results.map((row) => ({ ...row, status: row.manual_status || row.calculated_status })), page, pageSize, total: Number(count?.total || 0), exportMode, allMode };
}

async function listPurchases(env, url, exportMode = false) {
  const page = positiveInteger(url.searchParams.get("page"), 1, 100000);
  const pageSize = positiveInteger(url.searchParams.get("pageSize"), 50, 200);
  const filter = screenClause("", exportMode, { purchases: true });
  const count = await env.DB.prepare(`SELECT COUNT(*) total FROM finance_purchase_orders_cache WHERE open_quantity > 0 AND ${filter.sql}`).bind(...filter.params).first();
  const result = await env.DB.prepare(`SELECT * FROM finance_purchase_orders_cache WHERE open_quantity > 0 AND ${filter.sql} ORDER BY issue_date DESC,branch,order_number,item_number ${exportMode ? "" : "LIMIT ? OFFSET ?"}`)
    .bind(...(exportMode ? filter.params : [...filter.params, pageSize, (page - 1) * pageSize])).all();
  return { items: result.results, page, pageSize, total: Number(count?.total || 0), exportMode };
}

async function listAlerts(env, url) {
  const type = url.searchParams.get("type") === "short" ? "short" : "new";
  const page = positiveInteger(url.searchParams.get("page"), 1, 100000);
  const pageSize = positiveInteger(url.searchParams.get("pageSize"), 25, 100);
  const today = new Date().toISOString().slice(0, 10);
  const plus7 = new Date(`${today}T00:00:00Z`); plus7.setUTCDate(plus7.getUTCDate() + 7);
  const until = plus7.toISOString().slice(0, 10);
  const rule = type === "new"
    ? "p.first_seen_at >= datetime('now','-48 hours') AND p.actual_due_date < ?"
    : "julianday(p.actual_due_date)-julianday(p.issue_date) < 7";
  const ruleBinds = type === "new" ? [until] : [];
  const filter = screenFilter("p.", { titleType: true });
  const total = await env.DB.prepare(`SELECT COUNT(*) total FROM finance_payables_cache p WHERE p.open_balance <> 0 AND ${rule} AND ${filter.sql}`)
    .bind(...ruleBinds, ...filter.params).first();
  const result = await env.DB.prepare(`SELECT p.* FROM finance_payables_cache p WHERE p.open_balance <> 0 AND ${rule} AND ${filter.sql} ORDER BY p.actual_due_date,p.branch,p.title_number LIMIT ? OFFSET ?`)
    .bind(...ruleBinds, ...filter.params, pageSize, (page - 1) * pageSize).all();
  return { type, items: result.results, total: Number(total?.total || 0), page, pageSize };
}

async function saveStatus(request, env, user, cacheKey) {
  const body = await request.json().catch(() => ({}));
  const next = String(body.status || "").trim().toLowerCase();
  if (!MANUAL_STATUSES.has(next)) return json({ error: "invalid_status" }, 400);
  const payable = await env.DB.prepare("SELECT * FROM finance_payables_cache WHERE cache_key=?").bind(cacheKey).first();
  if (!payable) return json({ error: "title_not_found" }, 404);
  const currentOverride = await env.DB.prepare("SELECT manual_status FROM finance_status_overrides WHERE cache_key=?").bind(cacheKey).first();
  const today = new Date().toISOString().slice(0, 10);
  const previous = currentOverride?.manual_status || calculatedStatus(payable, today);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO finance_status_overrides(cache_key,manual_status,updated_at,updated_by_hash,updated_by_name) VALUES(?,?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET manual_status=excluded.manual_status,updated_at=excluded.updated_at,updated_by_hash=excluded.updated_by_hash,updated_by_name=excluded.updated_by_name`).bind(cacheKey, next, now, user.identityHash, user.name),
    env.DB.prepare("INSERT INTO finance_status_history(cache_key,previous_status,new_status,changed_at,changed_by_hash,changed_by_name) VALUES(?,?,?,?,?,?)").bind(cacheKey, previous, next, now, user.identityHash, user.name),
  ]);
  return json({ ok: true, cacheKey, previous, status: next, updatedAt: now });
}

async function balances(request, env, user, url) {
  if (request.method === "GET") {
    const dateFilter = isoDate(url.searchParams.get("date")) || new Date().toISOString().slice(0, 10);
    const result = await env.DB.prepare("SELECT balance_date,account_key,account_name,balance_value,recorded_at,recorded_by_name FROM finance_account_balances WHERE balance_date=? ORDER BY account_name").bind(dateFilter).all();
    return json({ date: dateFilter, items: result.results });
  }
  const body = await request.json().catch(() => ({}));
  const balanceDate = isoDate(body.date) || new Date().toISOString().slice(0, 10);
  const accountKey = String(body.accountKey || "").trim();
  const accountName = String(body.accountName || "").trim();
  const value = Number(body.value);
  if (!accountKey || !accountName || !Number.isFinite(value)) return json({ error: "invalid_balance" }, 400);
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO finance_account_balances(balance_date,account_key,account_name,balance_value,recorded_at,recorded_by_hash,recorded_by_name) VALUES(?,?,?,?,?,?,?) ON CONFLICT(balance_date,account_key) DO UPDATE SET account_name=excluded.account_name,balance_value=excluded.balance_value,recorded_at=excluded.recorded_at,recorded_by_hash=excluded.recorded_by_hash,recorded_by_name=excluded.recorded_by_name`)
    .bind(balanceDate, accountKey, accountName, value, now, user.identityHash, user.name).run();
  return json({ ok: true, date: balanceDate, accountKey, value, recordedAt: now });
}

export async function handleFinanceRequest(request, env, user) {
  const started = Date.now();
  const url = new URL(request.url);
  if (!userHasAnyRole(user, ALLOWED_ROLES)) return json({ error: "forbidden" }, 403);
  if (url.pathname === "/api/finance/feature") {
    if (request.method === "GET") return json({ enabled: await enabled(env) });
    if (request.method === "PUT" && user.role === "admin") {
      const body = await request.json().catch(() => ({}));
      const value = body.enabled === true ? 1 : 0;
      await env.DB.prepare(`INSERT INTO feature_flags(flag_key,enabled,updated_at,updated_by) VALUES('finance_payables',?,?,?) ON CONFLICT(flag_key) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
        .bind(value, new Date().toISOString(), user.name).run();
      return json({ ok: true, enabled: value === 1 });
    }
    return json({ error: "method_not_allowed" }, 405);
  }
  if (!await enabled(env)) return json({ error: "feature_disabled" }, 404);
  try {
    let response;
    if (url.pathname === "/api/finance/dashboard" && request.method === "GET") response = json(await dashboard(env));
    else if (url.pathname === "/api/finance/payables" && request.method === "GET") response = json(await listPayables(env, url, false, false));
    else if (url.pathname === "/api/finance/settled" && request.method === "GET") response = json(await listPayables(env, url, true, false));
    else if (url.pathname === "/api/finance/purchases" && request.method === "GET") response = json(await listPurchases(env, url, false));
    else if (url.pathname === "/api/finance/alerts" && request.method === "GET") response = json(await listAlerts(env, url));
    else if (url.pathname === "/api/finance/status-history" && request.method === "GET") {
      const key = url.searchParams.get("key") || "";
      const result = await env.DB.prepare("SELECT previous_status,new_status,changed_at,changed_by_name FROM finance_status_history WHERE cache_key=? ORDER BY id DESC LIMIT 100").bind(key).all();
      response = json({ cacheKey: key, items: result.results });
    }
    else if (url.pathname === "/api/finance/export" && request.method === "GET") {
      const view = url.searchParams.get("view");
      response = json(view === "settled" ? await listPayables(env, url, true, true) : view === "purchases" ? await listPurchases(env, url, true) : await listPayables(env, url, false, true));
    } else if (url.pathname === "/api/finance/balances" && ["GET", "PUT"].includes(request.method)) response = await balances(request, env, user, url);
    else if (url.pathname.startsWith("/api/finance/status/") && request.method === "PUT") response = await saveStatus(request, env, user, decodeURIComponent(url.pathname.slice("/api/finance/status/".length)));
    else if (url.pathname === "/api/finance/sync" && request.method === "POST") response = user.role === "admin" ? json(await syncFinanceCache(env, user)) : json({ error: "forbidden", message: "Somente administradores podem sincronizar o Protheus." }, 403);
    else response = json({ error: "not_found" }, 404);
    console.log(JSON.stringify({ event: "finance_endpoint", path: url.pathname, method: request.method, status: response.status, durationMs: Date.now() - started }));
    return response;
  } catch (error) {
    console.error(JSON.stringify({ event: "finance_endpoint_error", path: url.pathname, durationMs: Date.now() - started, message: String(error?.message || error).slice(0, 240) }));
    return json({ error: "finance_error", message: error?.message || String(error) }, 500);
  }
}

export { SCREEN_EXCLUDED_TAX_IDS };
