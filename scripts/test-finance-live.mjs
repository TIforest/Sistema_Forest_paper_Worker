import fs from "node:fs";
import { buildPayablesUrl, buildPurchaseOrdersUrl } from "../src/protheus-finance.js";

function loadDevVars() {
  const result = {};
  for (const line of fs.readFileSync(new URL("../.dev.vars", import.meta.url), "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    result[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return result;
}

const env = {
  ...loadDevVars(),
  TOTVS_BASE_URL: "https://forestpaper145392.protheus.cloudtotvs.com.br:1857/rest",
  FINANCE_SE2_ACTUAL_DUE_FIELD: "E2_VENCREA",
  FINANCE_SE2_BALANCE_FIELD: "E2_SALDO",
  FINANCE_SC7_RECEIVED_QTY_FIELD: "C7_QUJE",
};

if (!env.TOTVS_USER || !env.TOTVS_PASSWORD) throw new Error("TOTVS_USER/TOTVS_PASSWORD ausentes em .dev.vars");
const authorization = `Basic ${Buffer.from(`${env.TOTVS_USER}:${env.TOTVS_PASSWORD}`, "utf8").toString("base64")}`;

async function probe(label, url) {
  const response = await fetch(url, { headers: { accept: "application/json", authorization } });
  const body = await response.text();
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status} - ${body.slice(0, 300)}`);
  let payload;
  try { payload = JSON.parse(body); } catch { throw new Error(`${label}: resposta nao JSON`); }
  const rows = Array.isArray(payload.items) ? payload.items.length : Array.isArray(payload) ? payload.length : 0;
  return { label, status: response.status, rows };
}

const probes = await Promise.all([
  probe("SE2/SA2", buildPayablesUrl(env, 1, 1)),
  probe("SC7/SA2/SB1", buildPurchaseOrdersUrl(env, 1, 1)),
]);
console.log(JSON.stringify({ ok: true, probes }, null, 2));
