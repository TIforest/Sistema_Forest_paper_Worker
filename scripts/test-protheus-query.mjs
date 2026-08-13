import assert from "node:assert/strict";
import {
  buildBillingQueryUrl,
  buildGenericQueryUrl,
  buildLookupQueryUrl,
  fetchProtheusBilling,
  fetchProtheusSalesOrders,
} from "../src/protheus.js";

const env = {
  TOTVS_BASE_URL: "https://example.cloudtotvs.com.br:1857/rest",
  TOTVS_USER: "integration-user",
  TOTVS_PASSWORD: "integration-password",
  TOTVS_PAGE_SIZE: "2",
  SYNC_MAX_ROWS: "10",
  SYNC_LOOKBACK_DAYS: "120",
  COMMERCIAL_LOOKBACK_DAYS: "400",
  COMMERCIAL_SYNC_MAX_ROWS: "10",
};

const url = buildGenericQueryUrl(env, 1, 2, new Date("2026-08-03T12:00:00Z"));
assert.equal(url.pathname, "/rest/api/framework/v1/genericQuery");
assert.equal(url.searchParams.get("tables"), "SC5,SC6");
assert.match(url.searchParams.get("where"), /SC5\.C5_FILIAL = SC6\.C6_FILIAL/);
assert.match(url.searchParams.get("where"), /SC5\.D_E_L_E_T_ <> '\*'/);
assert.match(url.searchParams.get("where"), /SC6\.D_E_L_E_T_ <> '\*'/);
assert.match(url.searchParams.get("where"), /C5_EMISSAO >= '20260405'/);
assert.match(url.searchParams.get("where"), /C5_NOTA/);
assert.match(url.searchParams.get("where"), /C5_CONDPAG\)\) <> '32'/);
assert.match(url.searchParams.get("fields"), /C5_VOLUME1/);
assert.match(url.searchParams.get("fields"), /C6_QTDENT/);
assert.equal(url.searchParams.get("deletedFilter"), "true");
assert.equal(url.searchParams.get("page"), "1");
assert.equal(url.searchParams.get("pageSize"), "2");
assert.ok(!url.toString().includes(env.TOTVS_USER));
assert.ok(!url.toString().includes(env.TOTVS_PASSWORD));

const billingUrl = buildBillingQueryUrl(env, 1, 2, new Date("2026-08-03T12:00:00Z"));
assert.equal(billingUrl.searchParams.get("tables"), "SF2,SD2");
assert.doesNotMatch(billingUrl.searchParams.get("fields"), /F1_/);
assert.match(billingUrl.searchParams.get("fields"), /F2_DOC/);
assert.match(billingUrl.searchParams.get("fields"), /F2_DTCANC/);
assert.match(billingUrl.searchParams.get("fields"), /D2_TOTAL/);
assert.match(billingUrl.searchParams.get("where"), /SF2\.F2_DOC = SD2\.D2_DOC/);
assert.doesNotMatch(billingUrl.searchParams.get("where"), /SF1\./);
assert.match(billingUrl.searchParams.get("where"), /SF2\.D_E_L_E_T_ <> '\*'/);
assert.match(billingUrl.searchParams.get("where"), /SD2\.D_E_L_E_T_ <> '\*'/);
assert.match(billingUrl.searchParams.get("where"), /F2_EMISSAO >= '20250629'/);
assert.match(billingUrl.searchParams.get("where"), /F2_COND\)\) <> '32'/);
assert.ok(!billingUrl.toString().includes(env.TOTVS_PASSWORD));

const monthlyBillingUrl = buildBillingQueryUrl(
  env,
  1,
  2,
  new Date("2026-08-03T12:00:00Z"),
  { from: "20260801", to: "20260831" },
);
assert.match(monthlyBillingUrl.searchParams.get("where"), /F2_EMISSAO >= '20260801'/);
assert.match(monthlyBillingUrl.searchParams.get("where"), /F2_EMISSAO <= '20260831'/);

const lookupUrl = buildLookupQueryUrl(env, {
  alias: "SA1",
  fields: ["A1_COD", "A1_LOJA", "A1_NOME"],
  where: "SA1.A1_FILIAL = '' AND SA1.A1_COD = '000001'",
  order: "A1_COD,A1_LOJA",
  page: 1,
  pageSize: 200,
});
assert.equal(lookupUrl.searchParams.get("tables"), "SA1");
assert.match(lookupUrl.searchParams.get("where"), /SA1\.D_E_L_E_T_ <> '\*'/);
assert.match(lookupUrl.searchParams.get("fields"), /A1_NOME/);
assert.match(lookupUrl.searchParams.get("where"), /A1_FILIAL/);
assert.equal(lookupUrl.searchParams.get("filialFilter"), "false");

const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (requestUrl, init) => {
  const request = new URL(requestUrl);
  calls.push({ url: request, init });
  const tables = request.searchParams.get("tables");
  const page = Number(request.searchParams.get("page"));
  if (tables === "SC5,SC6") {
    return new Response(JSON.stringify({
      items: page === 1
        ? [
          { c5_num: "000001", c5_cliente: "C001", c5_lojacli: "01", c5_vend1: "V01", c5_condpag: "001", c6_produto: "P001" },
          { c5_num: "000002", c5_cliente: "C002", c5_lojacli: "01", c6_produto: "P002" },
        ]
        : [{ c5_num: "000003", c5_cliente: "C003", c5_lojacli: "02", c6_produto: "P003" }],
      hasNext: page === 1,
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (tables === "SA1") {
    return new Response(JSON.stringify({
      items: [
          { a1_cod: "C001", a1_loja: "01", a1_nome: "Cliente A", a1_cgc: "07155032000105" },
        { a1_cod: "C002", a1_loja: "01", a1_nome: "Cliente B" },
        { a1_cod: "C003", a1_loja: "02", a1_nome: "Cliente C" },
      ],
      hasNext: false,
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (tables === "SA3") return new Response(JSON.stringify({ items: [{ a3_cod: "V01", a3_nome: "Vendedor A" }], hasNext: false }), { status: 200 });
  if (tables === "SE4") return new Response(JSON.stringify({ items: [{ e4_codigo: "001", e4_descri: "10/20/30", e4_cond: "10,20,30" }], hasNext: false }), { status: 200 });
  return new Response(JSON.stringify({
    items: [
      { b1_cod: "P001", b1_desc: "Produto A" },
      { b1_cod: "P002", b1_desc: "Produto B" },
      { b1_cod: "P003", b1_desc: "Produto C" },
    ],
    hasNext: false,
  }), { status: 200, headers: { "content-type": "application/json" } });
};

try {
  const result = await fetchProtheusSalesOrders(env, { now: new Date("2026-08-03T12:00:00Z") });
  assert.equal(result.rows.length, 3);
  assert.equal(result.pages, 6);
  assert.equal(result.enriched, true);
  assert.deepEqual(result.enrichedAliases, ["SA1", "SB1", "SA3", "SE4"]);
  assert.equal(result.rows[0].a1_nome, "Cliente A");
  assert.equal(result.rows[0].a1_cgc, "07155032000105");
  assert.equal(result.rows[0].b1_desc, "Produto A");
  assert.equal(calls.length, 6);
  assert.match(calls[0].init.headers.authorization, /^Basic /);
  assert.ok(!calls[0].init.headers.authorization.includes(env.TOTVS_PASSWORD));

  calls.length = 0;
  globalThis.fetch = async (requestUrl, init) => {
    const request = new URL(requestUrl);
    calls.push({ url: request, init });
    const tables = request.searchParams.get("tables");
    const responses = {
      "SF2,SD2": [{ f2_filial: "010101", f2_doc: "000123", f2_serie: "1", f2_emissao: "20260803", f2_cliente: "C001", f2_loja: "01", f2_vend1: "V01", f2_cond: "001", d2_item: "01", d2_cod: "P001", d2_total: 1250 }],
      SA1: [{ a1_cod: "C001", a1_loja: "01", a1_nome: "Cliente A", a1_cgc: "07155032000105" }],
      SB1: [{ b1_cod: "P001", b1_desc: "Produto A" }],
      SA3: [{ a3_cod: "V01", a3_nome: "Vendedor A", a3_comis: 2.5 }],
      SE4: [{ e4_codigo: "001", e4_descri: "10/20/30", e4_cond: "10,20,30" }],
    };
    return new Response(JSON.stringify({ items: responses[tables] || [], hasNext: false }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  const billing = await fetchProtheusBilling(env, {
    now: new Date("2026-08-03T12:00:00Z"),
    month: "2026-08",
    day: "2026-08-03",
  });
  assert.equal(billing.rows.length, 1);
  assert.deepEqual(billing.enrichedAliases, ["SA1", "SB1", "SA3", "SE4"]);
  assert.equal(billing.rows[0].a1_nome, "Cliente A");
  assert.equal(billing.rows[0].a1_cgc, "07155032000105");
  assert.equal(billing.rows[0].b1_desc, "Produto A");
  assert.equal(billing.rows[0].a3_nome, "Vendedor A");
  assert.equal(billing.rows[0].a3_comis, "2.5");
  assert.equal(billing.rows[0].e4_cond, "10,20,30");
  assert.equal(calls.length, 5);
  assert.match(calls[0].url.searchParams.get("where"), /F2_EMISSAO >= '20260803'/);
  assert.match(calls[0].url.searchParams.get("where"), /F2_EMISSAO <= '20260803'/);

  calls.length = 0;
  globalThis.fetch = async (requestUrl, init) => {
    const request = new URL(requestUrl);
    calls.push({ url: request, init });
    if (request.searchParams.get("tables") !== "SC5,SC6") {
      return new Response(JSON.stringify({ errorMessage: "alias sem permissao" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      items: [{ c5_num: "000004", c5_cliente: "C004", c5_lojacli: "01", c6_produto: "P004" }],
      hasNext: false,
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const fallback = await fetchProtheusSalesOrders(env, { now: new Date("2026-08-03T12:00:00Z") });
  assert.equal(fallback.enriched, false);
  assert.equal(fallback.enrichmentWarning, "SA1_lookup_unavailable,SB1_lookup_unavailable");
  assert.equal(fallback.rows[0].c5_num, "000004");
  console.log(JSON.stringify({ ok: true, rows: result.rows.length, pages: result.pages, billingRows: billing.rows.length, fallback: true }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
}
