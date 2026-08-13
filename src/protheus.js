const GENERIC_QUERY_PATH = "/api/framework/v1/genericQuery";

const SALES_ORDER_FIELDS = [
  "C5_FILIAL",
  "C5_NUM",
  "C5_EMISSAO",
  "C5_CLIENTE",
  "C5_LOJACLI",
  "C5_NOTA",
  "C5_SERIE",
  "C5_CONDPAG",
  "C5_VEND1",
  "C5_TIPO",
  "C5_VOLUME1",
  "C5_TPFRETE",
  "C5_FECENT",
  "C6_FILIAL",
  "C6_NUM",
  "C6_ITEM",
  "C6_PRODUTO",
  "C6_UNSVEN",
  "C6_QTDVEN",
  "C6_PRCVEN",
  "C6_VALOR",
  "C6_TES",
  "C6_ENTREG",
  "C6_QTDENT",
];

const BILLING_FIELDS = [
  "F2_FILIAL",
  "F2_DOC",
  "F2_SERIE",
  "F2_EMISSAO",
  "F2_CLIENTE",
  "F2_LOJA",
  "F2_VEND1",
  "F2_COND",
  "F2_VALBRUT",
  "F2_VALMERC",
  "F2_VALFAT",
  "F2_FRETE",
  "F2_SEGURO",
  "F2_DESPESA",
  "F2_VALIPI",
  "F2_VALICM",
  "F2_TIPO",
  "F2_DTCANC",
  "D2_ITEM",
  "D2_COD",
  "D2_QUANT",
  "D2_PRCVEN",
  "D2_TOTAL",
  "D2_DESCON",
  "D2_TES",
  "D2_CF",
  "D2_PEDIDO",
  "D2_ITEMPV",
];

function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} nao configurado`);
  return text;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(Math.trunc(parsed), maximum));
}

function basicAuthorization(username, password) {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 4096) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 4096));
  }
  return `Basic ${btoa(binary)}`;
}

function cutoffProtheusDate(now, lookbackDays) {
  const cutoff = new Date(now);
  cutoff.setUTCHours(0, 0, 0, 0);
  cutoff.setUTCDate(cutoff.getUTCDate() - lookbackDays);
  return cutoff.toISOString().slice(0, 10).replaceAll("-", "");
}

function billingDateRange(month, day = "") {
  const value = String(month || "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new Error("Mes comercial invalido");
  }
  const selectedDay = String(day || "").trim();
  if (selectedDay) {
    const parsedDay = new Date(`${selectedDay}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(selectedDay)
      || Number.isNaN(parsedDay.getTime())
      || parsedDay.toISOString().slice(0, 10) !== selectedDay
      || !selectedDay.startsWith(`${value}-`)
    ) {
      throw new Error("Dia comercial invalido");
    }
    const compactDay = selectedDay.replaceAll("-", "");
    return { from: compactDay, to: compactDay };
  }
  const [year, monthNumber] = value.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const compactMonth = value.replace("-", "");
  return {
    from: `${compactMonth}01`,
    to: `${compactMonth}${String(lastDay).padStart(2, "0")}`,
  };
}

function genericQueryUrl(env) {
  const configuredBase = requiredText(env.TOTVS_BASE_URL, "TOTVS_BASE_URL").replace(/\/+$/, "");
  const baseUrl = new URL(configuredBase);
  if (baseUrl.protocol !== "https:") throw new Error("TOTVS_BASE_URL deve usar HTTPS");
  return new URL(`${baseUrl.toString().replace(/\/+$/, "")}${GENERIC_QUERY_PATH}`);
}

function notDeleted(alias) {
  return `${alias}.D_E_L_E_T_ <> '*'`;
}

export function buildGenericQueryUrl(env, page, pageSize, now = new Date(), options = {}) {
  const lookbackDays = boundedInteger(env.SYNC_LOOKBACK_DAYS, 120, 1, 3650);
  const dateRange = options.month ? billingDateRange(options.month, options.day) : null;
  const from = dateRange?.from || cutoffProtheusDate(now, lookbackDays);
  const toClause = dateRange?.to ? ` AND SC5.C5_EMISSAO <= '${dateRange.to}'` : "";
  const pendingClause = options.includeInvoiced
    ? ""
    : " AND (LTRIM(RTRIM(SC5.C5_NOTA)) = '' OR UPPER(LTRIM(RTRIM(SC5.C5_NOTA))) LIKE 'X%')";
  const url = genericQueryUrl(env);
  url.searchParams.set("tables", "SC5,SC6");
  url.searchParams.set("fields", SALES_ORDER_FIELDS.join(","));
  url.searchParams.set(
    "where",
    `${notDeleted("SC5")} AND ${notDeleted("SC6")} AND SC5.C5_FILIAL = SC6.C6_FILIAL AND SC5.C5_NUM = SC6.C6_NUM AND SC5.C5_EMISSAO >= '${from}'${toClause} AND LTRIM(RTRIM(SC5.C5_CONDPAG)) <> '32'${pendingClause}`,
  );
  url.searchParams.set("order", "C5_EMISSAO DESC,C5_NUM,C6_ITEM");
  url.searchParams.set("filialFilter", "false");
  url.searchParams.set("deletedFilter", "true");
  url.searchParams.set("page", String(page));
  url.searchParams.set("pageSize", String(pageSize));
  return url;
}

export function buildBillingQueryUrl(env, page, pageSize, now = new Date(), dateRange = null) {
  const lookbackDays = boundedInteger(env.COMMERCIAL_LOOKBACK_DAYS, 400, 1, 3650);
  const from = dateRange?.from || cutoffProtheusDate(now, lookbackDays);
  const toClause = dateRange?.to ? ` AND SF2.F2_EMISSAO <= '${dateRange.to}'` : "";
  const url = genericQueryUrl(env);
  url.searchParams.set("tables", "SF2,SD2");
  url.searchParams.set("fields", BILLING_FIELDS.join(","));
  url.searchParams.set(
    "where",
    `${notDeleted("SF2")} AND ${notDeleted("SD2")} AND SF2.F2_FILIAL = SD2.D2_FILIAL AND SF2.F2_DOC = SD2.D2_DOC AND SF2.F2_SERIE = SD2.D2_SERIE AND SF2.F2_CLIENTE = SD2.D2_CLIENTE AND SF2.F2_LOJA = SD2.D2_LOJA AND SF2.F2_EMISSAO >= '${from}'${toClause} AND LTRIM(RTRIM(SF2.F2_COND)) <> '32'`,
  );
  url.searchParams.set("order", "F2_EMISSAO DESC,F2_DOC,F2_SERIE,D2_ITEM");
  url.searchParams.set("filialFilter", "false");
  url.searchParams.set("deletedFilter", "true");
  url.searchParams.set("page", String(page));
  url.searchParams.set("pageSize", String(pageSize));
  return url;
}

export function buildLookupQueryUrl(env, { alias, fields, where, order, page, pageSize }) {
  const url = genericQueryUrl(env);
  url.searchParams.set("tables", alias);
  url.searchParams.set("fields", fields.join(","));
  url.searchParams.set("where", `${notDeleted(alias)}${where ? ` AND (${where})` : ""}`);
  url.searchParams.set("order", order);
  url.searchParams.set("filialFilter", "false");
  url.searchParams.set("deletedFilter", "true");
  url.searchParams.set("page", String(page));
  url.searchParams.set("pageSize", String(pageSize));
  return url;
}

async function responseError(response) {
  const payload = await response.json().catch(() => null);
  const detail = String(payload?.errorMessage || payload?.message || "").replace(/\s+/g, " ").slice(0, 300);
  const error = new Error(`TOTVS GenericQuery: HTTP ${response.status}${detail ? ` - ${detail}` : ""}`);
  error.status = response.status;
  return error;
}

async function requestGenericQuery(env, url) {
  const username = requiredText(env.TOTVS_USER, "Secret TOTVS_USER");
  const password = requiredText(env.TOTVS_PASSWORD, "Secret TOTVS_PASSWORD");
  const headers = {
    accept: "application/json",
    authorization: basicAuthorization(username, password),
  };
  if (env.TOTVS_TENANT_ID) headers.TenantId = String(env.TOTVS_TENANT_ID).trim();
  const response = await fetch(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw await responseError(response);
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.items)) {
    throw new Error("TOTVS GenericQuery retornou um JSON sem a lista items");
  }
  return payload;
}

async function fetchPages(env, buildUrl, maxRows) {
  const rows = [];
  const protectedDataFields = new Set();
  const nivelFields = new Set();
  let page = 1;
  let hasNext = true;
  while (hasNext && rows.length < maxRows) {
    const payload = await requestGenericQuery(env, buildUrl(page));
    rows.push(...payload.items);
    for (const field of payload.protectedDataFields || []) protectedDataFields.add(String(field));
    for (const field of payload.nivelFields || []) nivelFields.add(String(field));
    hasNext = payload.hasNext === true;
    page += 1;
  }
  if (hasNext) throw new Error(`TOTVS GenericQuery ultrapassou o limite seguro de ${maxRows} registros`);
  return {
    rows,
    pages: page - 1,
    protectedDataFields: [...protectedDataFields],
    nivelFields: [...nivelFields],
  };
}

function rowValue(row, field) {
  const wanted = field.toLowerCase();
  const entry = Object.entries(row).find(([key]) => key.toLowerCase() === wanted);
  return String(entry?.[1] ?? "").trim();
}

function sqlLiteral(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function batches(values, size) {
  const result = [];
  for (let offset = 0; offset < values.length; offset += size) result.push(values.slice(offset, offset + size));
  return result;
}

async function fetchCustomerLookups(env, orderRows) {
  const keys = [...new Map(orderRows.map((row) => {
    const code = rowValue(row, "c5_cliente");
    const store = rowValue(row, "c5_lojacli");
    return [`${code}\u0000${store}`, { code, store }];
  }).filter(([, value]) => value.code)).values()];
  const combined = { rows: [], pages: 0, protectedDataFields: [], nivelFields: [] };
  for (const group of batches(keys, 60)) {
    const pairFilter = group.map(({ code, store }) => (
      `(SA1.A1_COD = ${sqlLiteral(code)} AND SA1.A1_LOJA = ${sqlLiteral(store)})`
    )).join(" OR ");
    const pageSize = 200;
    const result = await fetchPages(
      env,
      (page) => buildLookupQueryUrl(env, {
        alias: "SA1",
        fields: ["A1_COD", "A1_LOJA", "A1_NOME", "A1_MUN", "A1_EST", "A1_CGC"],
        where: `SA1.A1_FILIAL = '' AND (${pairFilter})`,
        order: "A1_COD,A1_LOJA",
        page,
        pageSize,
      }),
      Math.max(pageSize, group.length * 3),
    );
    combined.rows.push(...result.rows);
    combined.pages += result.pages;
    combined.protectedDataFields.push(...result.protectedDataFields);
    combined.nivelFields.push(...result.nivelFields);
  }
  return combined;
}

async function fetchProductLookups(env, orderRows) {
  const codes = [...new Set(orderRows.map((row) => rowValue(row, "c6_produto")).filter(Boolean))];
  const combined = { rows: [], pages: 0, protectedDataFields: [], nivelFields: [] };
  for (const group of batches(codes, 100)) {
    const pageSize = 200;
    const result = await fetchPages(
      env,
      (page) => buildLookupQueryUrl(env, {
        alias: "SB1",
        fields: ["B1_COD", "B1_DESC"],
        where: `SB1.B1_FILIAL = '' AND SB1.B1_COD IN (${group.map(sqlLiteral).join(",")})`,
        order: "B1_COD",
        page,
        pageSize,
      }),
      Math.max(pageSize, group.length * 3),
    );
    combined.rows.push(...result.rows);
    combined.pages += result.pages;
    combined.protectedDataFields.push(...result.protectedDataFields);
    combined.nivelFields.push(...result.nivelFields);
  }
  return combined;
}

function mergeEnrichment(orderRows, customerRows, productRows, sellerRows, paymentRows) {
  const customers = new Map(customerRows.map((row) => [
    `${rowValue(row, "a1_cod")}\u0000${rowValue(row, "a1_loja")}`,
    row,
  ]));
  const products = new Map(productRows.map((row) => [rowValue(row, "b1_cod"), row]));
  const sellers = new Map(sellerRows.map((row) => [rowValue(row, "a3_cod"), row]));
  const payments = new Map(paymentRows.map((row) => [rowValue(row, "e4_codigo"), row]));
  return orderRows.map((row) => {
    const customer = customers.get(`${rowValue(row, "c5_cliente")}\u0000${rowValue(row, "c5_lojacli")}`);
    const product = products.get(rowValue(row, "c6_produto"));
    const seller = sellers.get(rowValue(row, "c5_vend1"));
    const payment = payments.get(rowValue(row, "c5_condpag"));
    return {
      ...row,
      ...(customer ? {
        a1_nome: rowValue(customer, "a1_nome"),
        a1_mun: rowValue(customer, "a1_mun"),
        a1_est: rowValue(customer, "a1_est"),
        a1_cgc: rowValue(customer, "a1_cgc"),
      } : {}),
      ...(product ? { b1_desc: rowValue(product, "b1_desc") } : {}),
      ...(seller ? {
        a3_nome: rowValue(seller, "a3_nome"),
        a3_comis: rowValue(seller, "a3_comis"),
      } : {}),
      ...(payment ? {
        e4_descri: rowValue(payment, "e4_descri"),
        e4_cond: rowValue(payment, "e4_cond"),
        e4_tipo: rowValue(payment, "e4_tipo"),
      } : {}),
    };
  });
}

async function fetchBillingCustomerLookups(env, billingRows) {
  const keys = [...new Map(billingRows.map((row) => {
    const code = rowValue(row, "f2_cliente");
    const store = rowValue(row, "f2_loja");
    return [`${code}\u0000${store}`, { code, store }];
  }).filter(([, value]) => value.code)).values()];
  const combined = { rows: [], pages: 0, protectedDataFields: [], nivelFields: [] };
  for (const group of batches(keys, 60)) {
    const pairFilter = group.map(({ code, store }) => (
      `(SA1.A1_COD = ${sqlLiteral(code)} AND SA1.A1_LOJA = ${sqlLiteral(store)})`
    )).join(" OR ");
    const pageSize = 200;
    const result = await fetchPages(
      env,
      (page) => buildLookupQueryUrl(env, {
        alias: "SA1",
        fields: ["A1_COD", "A1_LOJA", "A1_NOME", "A1_MUN", "A1_EST", "A1_CGC"],
        where: `SA1.A1_FILIAL = '' AND (${pairFilter})`,
        order: "A1_COD,A1_LOJA",
        page,
        pageSize,
      }),
      Math.max(pageSize, group.length * 3),
    );
    combined.rows.push(...result.rows);
    combined.pages += result.pages;
    combined.protectedDataFields.push(...result.protectedDataFields);
    combined.nivelFields.push(...result.nivelFields);
  }
  return combined;
}

async function fetchBillingProductLookups(env, billingRows) {
  const codes = [...new Set(billingRows.map((row) => rowValue(row, "d2_cod")).filter(Boolean))];
  const combined = { rows: [], pages: 0, protectedDataFields: [], nivelFields: [] };
  for (const group of batches(codes, 100)) {
    const pageSize = 200;
    const result = await fetchPages(
      env,
      (page) => buildLookupQueryUrl(env, {
        alias: "SB1",
        fields: ["B1_COD", "B1_DESC"],
        where: `SB1.B1_FILIAL = '' AND SB1.B1_COD IN (${group.map(sqlLiteral).join(",")})`,
        order: "B1_COD",
        page,
        pageSize,
      }),
      Math.max(pageSize, group.length * 3),
    );
    combined.rows.push(...result.rows);
    combined.pages += result.pages;
    combined.protectedDataFields.push(...result.protectedDataFields);
    combined.nivelFields.push(...result.nivelFields);
  }
  return combined;
}

async function fetchSellerLookups(env, rows, codeField = "f2_vend1") {
  const codes = [...new Set(rows.map((row) => rowValue(row, codeField)).filter(Boolean))];
  const combined = { rows: [], pages: 0, protectedDataFields: [], nivelFields: [] };
  for (const group of batches(codes, 100)) {
    const pageSize = 200;
    const result = await fetchPages(
      env,
      (page) => buildLookupQueryUrl(env, {
        alias: "SA3",
        fields: ["A3_COD", "A3_NOME", "A3_COMIS"],
        where: `SA3.A3_FILIAL = '' AND SA3.A3_COD IN (${group.map(sqlLiteral).join(",")})`,
        order: "A3_COD",
        page,
        pageSize,
      }),
      Math.max(pageSize, group.length * 3),
    );
    combined.rows.push(...result.rows);
    combined.pages += result.pages;
    combined.protectedDataFields.push(...result.protectedDataFields);
    combined.nivelFields.push(...result.nivelFields);
  }
  return combined;
}

async function fetchPaymentLookups(env, rows, codeField) {
  const codes = [...new Set(rows.map((row) => rowValue(row, codeField)).filter(Boolean))];
  const combined = { rows: [], pages: 0, protectedDataFields: [], nivelFields: [] };
  for (const group of batches(codes, 100)) {
    const pageSize = 200;
    const result = await fetchPages(
      env,
      (page) => buildLookupQueryUrl(env, {
        alias: "SE4",
        fields: ["E4_CODIGO", "E4_DESCRI", "E4_COND", "E4_TIPO"],
        where: `SE4.E4_FILIAL = '' AND SE4.E4_CODIGO IN (${group.map(sqlLiteral).join(",")})`,
        order: "E4_CODIGO",
        page,
        pageSize,
      }),
      Math.max(pageSize, group.length * 3),
    );
    combined.rows.push(...result.rows);
    combined.pages += result.pages;
    combined.protectedDataFields.push(...result.protectedDataFields);
    combined.nivelFields.push(...result.nivelFields);
  }
  return combined;
}

function mergeBillingEnrichment(billingRows, customerRows, productRows, sellerRows, paymentRows) {
  const customers = new Map(customerRows.map((row) => [
    `${rowValue(row, "a1_cod")}\u0000${rowValue(row, "a1_loja")}`,
    row,
  ]));
  const products = new Map(productRows.map((row) => [rowValue(row, "b1_cod"), row]));
  const sellers = new Map(sellerRows.map((row) => [rowValue(row, "a3_cod"), row]));
  const payments = new Map(paymentRows.map((row) => [rowValue(row, "e4_codigo"), row]));
  return billingRows.map((row) => {
    const customer = customers.get(`${rowValue(row, "f2_cliente")}\u0000${rowValue(row, "f2_loja")}`);
    const product = products.get(rowValue(row, "d2_cod"));
    const seller = sellers.get(rowValue(row, "f2_vend1"));
    const payment = payments.get(rowValue(row, "f2_cond"));
    return {
      ...row,
      ...(customer ? {
        a1_nome: rowValue(customer, "a1_nome"),
        a1_mun: rowValue(customer, "a1_mun"),
        a1_est: rowValue(customer, "a1_est"),
        a1_cgc: rowValue(customer, "a1_cgc"),
      } : {}),
      ...(product ? { b1_desc: rowValue(product, "b1_desc") } : {}),
      ...(seller ? {
        a3_nome: rowValue(seller, "a3_nome"),
        a3_comis: rowValue(seller, "a3_comis"),
      } : {}),
      ...(payment ? {
        e4_descri: rowValue(payment, "e4_descri"),
        e4_cond: rowValue(payment, "e4_cond"),
        e4_tipo: rowValue(payment, "e4_tipo"),
      } : {}),
    };
  });
}

export async function fetchProtheusSalesOrders(env, options = {}) {
  const pageSize = boundedInteger(env.TOTVS_PAGE_SIZE, 200, 1, 200);
  const maxRows = options.commercial
    ? boundedInteger(env.COMMERCIAL_SYNC_MAX_ROWS, 10000, pageSize, 20000)
    : boundedInteger(env.SYNC_MAX_ROWS, 1500, pageSize, 10000);
  const now = options.now || new Date();
  const orders = await fetchPages(
    env,
    (page) => buildGenericQueryUrl(env, page, pageSize, now, options),
    maxRows,
  );

  const enrichment = await Promise.allSettled([
    fetchCustomerLookups(env, orders.rows),
    fetchProductLookups(env, orders.rows),
    fetchSellerLookups(env, orders.rows, "c5_vend1"),
    fetchPaymentLookups(env, orders.rows, "c5_condpag"),
  ]);
  const customers = enrichment[0].status === "fulfilled" ? enrichment[0].value : null;
  const products = enrichment[1].status === "fulfilled" ? enrichment[1].value : null;
  const sellers = enrichment[2].status === "fulfilled" ? enrichment[2].value : null;
  const payments = enrichment[3].status === "fulfilled" ? enrichment[3].value : null;
  const warnings = [];
  if (!customers) warnings.push("SA1_lookup_unavailable");
  if (!products) warnings.push("SB1_lookup_unavailable");
  if (!sellers) warnings.push("SA3_lookup_unavailable");
  if (!payments) warnings.push("SE4_lookup_unavailable");
  if (enrichment[0].status === "rejected") {
    console.warn("totvs_customer_lookup_unavailable", { message: String(enrichment[0].reason?.message || enrichment[0].reason).slice(0, 180) });
  }
  if (enrichment[1].status === "rejected") {
    console.warn("totvs_product_lookup_unavailable", { message: String(enrichment[1].reason?.message || enrichment[1].reason).slice(0, 180) });
  }
  if (enrichment[2].status === "rejected") {
    console.warn("totvs_seller_lookup_unavailable", { message: String(enrichment[2].reason?.message || enrichment[2].reason).slice(0, 180) });
  }
  if (enrichment[3].status === "rejected") {
    console.warn("totvs_payment_lookup_unavailable", { message: String(enrichment[3].reason?.message || enrichment[3].reason).slice(0, 180) });
  }

  const protectedDataFields = new Set([
    ...orders.protectedDataFields,
    ...(customers?.protectedDataFields || []),
    ...(products?.protectedDataFields || []),
    ...(sellers?.protectedDataFields || []),
    ...(payments?.protectedDataFields || []),
  ]);
  const nivelFields = new Set([
    ...orders.nivelFields,
    ...(customers?.nivelFields || []),
    ...(products?.nivelFields || []),
    ...(sellers?.nivelFields || []),
    ...(payments?.nivelFields || []),
  ]);
  return {
    rows: mergeEnrichment(
      orders.rows,
      customers?.rows || [],
      products?.rows || [],
      sellers?.rows || [],
      payments?.rows || [],
    ),
    pages: orders.pages + Number(customers?.pages || 0) + Number(products?.pages || 0)
      + Number(sellers?.pages || 0) + Number(payments?.pages || 0),
    checkedAt: new Date().toISOString(),
    enriched: Boolean(customers || products),
    enrichedAliases: [customers ? "SA1" : "", products ? "SB1" : "", sellers ? "SA3" : "", payments ? "SE4" : ""].filter(Boolean),
    enrichmentWarning: warnings.join(","),
    protectedDataFields: [...protectedDataFields],
    nivelFields: [...nivelFields],
  };
}

export async function fetchProtheusBilling(env, options = {}) {
  const pageSize = boundedInteger(env.TOTVS_PAGE_SIZE, 200, 1, 200);
  const maxRows = boundedInteger(env.COMMERCIAL_SYNC_MAX_ROWS, 10000, pageSize, 20000);
  const now = options.now || new Date();
  const dateRange = options.month ? billingDateRange(options.month, options.day) : null;
  const billing = await fetchPages(
    env,
    (page) => buildBillingQueryUrl(env, page, pageSize, now, dateRange),
    maxRows,
  );

  const enrichment = await Promise.allSettled([
    fetchBillingCustomerLookups(env, billing.rows),
    fetchBillingProductLookups(env, billing.rows),
    fetchSellerLookups(env, billing.rows),
    fetchPaymentLookups(env, billing.rows, "f2_cond"),
  ]);
  const customers = enrichment[0].status === "fulfilled" ? enrichment[0].value : null;
  const products = enrichment[1].status === "fulfilled" ? enrichment[1].value : null;
  const sellers = enrichment[2].status === "fulfilled" ? enrichment[2].value : null;
  const payments = enrichment[3].status === "fulfilled" ? enrichment[3].value : null;
  const aliases = [customers ? "SA1" : "", products ? "SB1" : "", sellers ? "SA3" : "", payments ? "SE4" : ""].filter(Boolean);
  const warnings = [
    customers ? "" : "SA1_lookup_unavailable",
    products ? "" : "SB1_lookup_unavailable",
    sellers ? "" : "SA3_lookup_unavailable",
    payments ? "" : "SE4_lookup_unavailable",
  ].filter(Boolean);
  enrichment.forEach((result, index) => {
    if (result.status === "rejected") {
      console.warn("totvs_billing_lookup_unavailable", {
        alias: ["SA1", "SB1", "SA3", "SE4"][index],
        message: String(result.reason?.message || result.reason).slice(0, 180),
      });
    }
  });
  return {
    rows: mergeBillingEnrichment(
      billing.rows,
      customers?.rows || [],
      products?.rows || [],
      sellers?.rows || [],
      payments?.rows || [],
    ),
    pages: billing.pages
      + Number(customers?.pages || 0)
      + Number(products?.pages || 0)
      + Number(sellers?.pages || 0)
      + Number(payments?.pages || 0),
    checkedAt: new Date().toISOString(),
    month: options.month || "",
    day: options.day || "",
    enrichedAliases: aliases,
    enrichmentWarning: warnings.join(","),
    protectedDataFields: [...new Set([
      ...billing.protectedDataFields,
      ...(customers?.protectedDataFields || []),
      ...(products?.protectedDataFields || []),
      ...(sellers?.protectedDataFields || []),
      ...(payments?.protectedDataFields || []),
    ])],
    nivelFields: [...new Set([
      ...billing.nivelFields,
      ...(customers?.nivelFields || []),
      ...(products?.nivelFields || []),
      ...(sellers?.nivelFields || []),
      ...(payments?.nivelFields || []),
    ])],
  };
}
