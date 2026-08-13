import assert from "node:assert/strict";
import { buildPayablesUrl, buildPurchaseOrdersUrl } from "../src/protheus-finance.js";
import { SCREEN_EXCLUDED_TAX_IDS } from "../src/finance.js";

const env = {
  TOTVS_BASE_URL: "https://example.invalid/rest",
  FINANCE_SE2_ACTUAL_DUE_FIELD: "E2_VENCREA",
  FINANCE_SE2_BALANCE_FIELD: "E2_SALDO",
  FINANCE_SC7_RECEIVED_QTY_FIELD: "C7_QUJE",
};
const now = new Date("2026-08-13T12:00:00Z");
const payable = buildPayablesUrl(env, 1, 200, now);
const purchase = buildPurchaseOrdersUrl(env, 1, 200, now);

assert.equal(payable.searchParams.get("tables"), "SE2,SA2");
assert.match(payable.searchParams.get("where"), /SE2\.D_E_L_E_T_ <> '\*'/);
assert.match(payable.searchParams.get("where"), /E2_EMISSAO >= '20260101'/);
assert.match(payable.searchParams.get("fields"), /E2_VENCREA/);
assert.match(payable.searchParams.get("fields"), /E2_SALDO/);

assert.equal(purchase.searchParams.get("tables"), "SC7,SA2,SB1");
assert.match(purchase.searchParams.get("where"), /SC7\.D_E_L_E_T_ <> '\*'/);
assert.match(purchase.searchParams.get("where"), /C7_QUANT > SC7\.C7_QUJE/);
assert.match(purchase.searchParams.get("where"), /C7_EMISSAO <= '20261231'/);

assert.equal(SCREEN_EXCLUDED_TAX_IDS.size, 10);
for (const taxId of SCREEN_EXCLUDED_TAX_IDS) assert.match(taxId, /^\d{14}$/);

console.log(JSON.stringify({ ok: true, payablesAlias: "SE2", purchasesAlias: "SC7", excludedScreenTaxIds: SCREEN_EXCLUDED_TAX_IDS.size }));
