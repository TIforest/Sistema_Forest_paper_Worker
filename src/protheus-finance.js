const GENERIC_QUERY_PATH = "/api/framework/v1/genericQuery";

const PAYABLE_FIELDS = [
  "E2_FILIAL", "E2_PREFIXO", "E2_NUM", "E2_PARCELA", "E2_TIPO", "E2_NATUREZ",
  "E2_FORNECE", "E2_LOJA", "E2_EMISSAO", "E2_CONTABIL", "E2_VENCTO", "E2_VENCREA",
  "E2_VALOR", "E2_SALDO", "E2_BAIXA", "A2_NOME", "A2_CGC",
];

const PURCHASE_FIELDS = [
  "C7_FILIAL", "C7_NUM", "C7_ITEM", "C7_EMISSAO", "C7_FORNECE", "C7_LOJA", "C7_COND",
  "C7_MOEDA", "C7_PRODUTO", "C7_QUANT", "C7_QUJE", "C7_PRECO", "C7_TOTAL",
  "A2_NOME", "A2_CGC", "B1_DESC",
];

function text(value) { return String(value ?? "").trim(); }
function number(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = text(value).replace(/\s/g, "");
  const normalized = raw.includes(",")
    ? raw.replaceAll(".", "").replace(",", ".")
    : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}
function field(row, name) {
  const wanted = name.toLowerCase();
  const entry = Object.entries(row || {}).find(([key]) => key.toLowerCase() === wanted);
  return entry?.[1];
}
function date(value) {
  const raw = text(value);
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return "";
}
function taxId(value) { return text(value).replace(/\D/g, "").padStart(14, "0"); }
function positiveInteger(value, fallback, max = 20000) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(Math.trunc(parsed), max)) : fallback;
}
function basicAuthorization(username, password) {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 4096) binary += String.fromCharCode(...bytes.subarray(offset, offset + 4096));
  return `Basic ${btoa(binary)}`;
}
function baseUrl(env) {
  const configured = text(env.TOTVS_BASE_URL).replace(/\/+$/, "");
  if (!configured) throw new Error("TOTVS_BASE_URL nao configurada");
  const parsed = new URL(configured);
  if (parsed.protocol !== "https:") throw new Error("TOTVS_BASE_URL deve usar HTTPS");
  return new URL(`${configured}${GENERIC_QUERY_PATH}`);
}
function queryUrl(env, { tables, fields, where, order, page, pageSize }) {
  const url = baseUrl(env);
  url.searchParams.set("tables", tables);
  url.searchParams.set("fields", fields.join(","));
  url.searchParams.set("where", where);
  url.searchParams.set("order", order);
  url.searchParams.set("filialFilter", "false");
  url.searchParams.set("deletedFilter", "true");
  url.searchParams.set("page", String(page));
  url.searchParams.set("pageSize", String(pageSize));
  return url;
}
async function requestPage(env, url) {
  if (!env.TOTVS_USER || !env.TOTVS_PASSWORD) throw new Error("Secrets TOTVS_USER/TOTVS_PASSWORD ausentes");
  const headers = { accept: "application/json", authorization: basicAuthorization(env.TOTVS_USER, env.TOTVS_PASSWORD) };
  if (env.TOTVS_TENANT_ID) headers.TenantId = text(env.TOTVS_TENANT_ID);
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(25000) });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = text(payload?.errorMessage || payload?.message).replace(/\s+/g, " ").slice(0, 240);
    throw new Error(`TOTVS GenericQuery HTTP ${response.status}${detail ? ` - ${detail}` : ""}`);
  }
  if (!Array.isArray(payload?.items)) throw new Error("TOTVS GenericQuery sem items");
  return payload;
}
async function fetchAll(env, buildUrl) {
  // A pagina maior reduz as chamadas externas e mantém a sincronização dentro
  // do limite de sub-requisições do plano gratuito do Workers.
  const pageSize = positiveInteger(env.FINANCE_PAGE_SIZE, 1000, 1000);
  const maxRows = positiveInteger(env.FINANCE_SYNC_MAX_ROWS, 20000, 50000);
  const rows = [];
  let page = 1;
  let hasNext = true;
  while (hasNext && rows.length < maxRows) {
    const payload = await requestPage(env, buildUrl(page, pageSize));
    rows.push(...payload.items);
    hasNext = payload.hasNext === true;
    page += 1;
  }
  if (hasNext) throw new Error(`Consulta financeira excedeu ${maxRows} registros`);
  return rows;
}

export function buildPayablesUrl(env, page, pageSize, now = new Date()) {
  const year = now.getUTCFullYear();
  const actualDueField = text(env.FINANCE_SE2_ACTUAL_DUE_FIELD || "E2_VENCREA");
  const balanceField = text(env.FINANCE_SE2_BALANCE_FIELD || "E2_SALDO");
  if (!/^E2_[A-Z0-9_]+$/.test(actualDueField) || !/^E2_[A-Z0-9_]+$/.test(balanceField)) {
    throw new Error("Mapeamento SE2 invalido");
  }
  const fields = [...new Set(PAYABLE_FIELDS.map((name) => name === "E2_VENCREA" ? actualDueField : name === "E2_SALDO" ? balanceField : name))];
  return queryUrl(env, {
    tables: "SE2,SA2",
    fields,
    where: `SE2.D_E_L_E_T_ <> '*' AND SA2.D_E_L_E_T_ <> '*' AND SE2.E2_FORNECE = SA2.A2_COD AND SE2.E2_LOJA = SA2.A2_LOJA AND SE2.E2_EMISSAO >= '${year}0101' AND SE2.E2_EMISSAO <= '${year}1231'`,
    order: `${actualDueField},E2_FILIAL,E2_PREFIXO,E2_NUM,E2_PARCELA,E2_TIPO`, page, pageSize,
  });
}

export function buildPurchaseOrdersUrl(env, page, pageSize, now = new Date()) {
  const year = now.getUTCFullYear();
  const receivedField = text(env.FINANCE_SC7_RECEIVED_QTY_FIELD || "C7_QUJE");
  if (!/^C7_[A-Z0-9_]+$/.test(receivedField)) throw new Error("Mapeamento SC7 invalido");
  const fields = [...new Set(PURCHASE_FIELDS.map((name) => name === "C7_QUJE" ? receivedField : name))];
  return queryUrl(env, {
    tables: "SC7,SA2,SB1",
    fields,
    where: `SC7.D_E_L_E_T_ <> '*' AND SA2.D_E_L_E_T_ <> '*' AND SB1.D_E_L_E_T_ <> '*' AND SC7.C7_FORNECE = SA2.A2_COD AND SC7.C7_LOJA = SA2.A2_LOJA AND SC7.C7_PRODUTO = SB1.B1_COD AND SC7.C7_EMISSAO >= '${year}0101' AND SC7.C7_EMISSAO <= '${year}1231' AND SC7.C7_QUANT > SC7.${receivedField}`,
    order: "C7_EMISSAO DESC,C7_FILIAL,C7_NUM,C7_ITEM", page, pageSize,
  });
}

function payableFromRow(env, row) {
  const actualDueField = text(env.FINANCE_SE2_ACTUAL_DUE_FIELD || "E2_VENCREA");
  const balanceField = text(env.FINANCE_SE2_BALANCE_FIELD || "E2_SALDO");
  const branch = text(field(row, "E2_FILIAL"));
  const prefix = text(field(row, "E2_PREFIXO"));
  const titleNumber = text(field(row, "E2_NUM"));
  const installment = text(field(row, "E2_PARCELA"));
  const titleType = text(field(row, "E2_TIPO"));
  return {
    cacheKey: [branch, prefix, titleNumber, installment, titleType].join("|"), branch, titleNumber, titleType, installment,
    nature: text(field(row, "E2_NATUREZ")), supplierCode: text(field(row, "E2_FORNECE")), supplierStore: text(field(row, "E2_LOJA")),
    supplierName: text(field(row, "A2_NOME")), supplierTaxId: taxId(field(row, "A2_CGC")), issueDate: date(field(row, "E2_EMISSAO")),
    accountingDate: date(field(row, "E2_CONTABIL")), dueDate: date(field(row, "E2_VENCTO")), actualDueDate: date(field(row, actualDueField)),
    originalValue: number(field(row, "E2_VALOR")), openBalance: number(field(row, balanceField)), settlementDate: date(field(row, "E2_BAIXA")),
  };
}

function purchaseFromRow(env, row) {
  const receivedField = text(env.FINANCE_SC7_RECEIVED_QTY_FIELD || "C7_QUJE");
  const ordered = number(field(row, "C7_QUANT"));
  const received = number(field(row, receivedField));
  const openQuantity = Math.max(0, ordered - received);
  const unitValue = number(field(row, "C7_PRECO"));
  const total = number(field(row, "C7_TOTAL")) || ordered * unitValue;
  return {
    cacheKey: [text(field(row, "C7_FILIAL")), text(field(row, "C7_NUM")), text(field(row, "C7_ITEM"))].join("|"),
    branch: text(field(row, "C7_FILIAL")), orderNumber: text(field(row, "C7_NUM")), itemNumber: text(field(row, "C7_ITEM")), issueDate: date(field(row, "C7_EMISSAO")),
    supplierCode: text(field(row, "C7_FORNECE")), supplierStore: text(field(row, "C7_LOJA")), supplierName: text(field(row, "A2_NOME")), supplierTaxId: taxId(field(row, "A2_CGC")),
    paymentCondition: text(field(row, "C7_COND")), currency: text(field(row, "C7_MOEDA")), productCode: text(field(row, "C7_PRODUTO")), productDescription: text(field(row, "B1_DESC")),
    orderedQuantity: ordered, receivedQuantity: received, openQuantity, unitValue, totalValue: total, openValue: ordered > 0 ? total * (openQuantity / ordered) : 0,
  };
}

export async function fetchFinanceData(env, now = new Date()) {
  const [payableRows, purchaseRows] = await Promise.all([
    fetchAll(env, (page, pageSize) => buildPayablesUrl(env, page, pageSize, now)),
    fetchAll(env, (page, pageSize) => buildPurchaseOrdersUrl(env, page, pageSize, now)),
  ]);
  return {
    payables: payableRows.map((row) => payableFromRow(env, row)).filter((row) => row.titleNumber && row.issueDate),
    purchases: purchaseRows.map((row) => purchaseFromRow(env, row)).filter((row) => row.orderNumber && row.openQuantity > 0),
  };
}
