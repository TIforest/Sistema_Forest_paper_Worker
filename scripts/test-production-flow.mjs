import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unstable_startWorker } from "wrangler";
import {
  accessIdentityHasAnyGroup,
  allocateInvoiceTotals,
  billingItemFromRow,
  orderFromRow,
} from "../src/worker.js";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const workerSource = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
const wranglerSource = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const orderWithIpi = orderFromRow({
  c5_filial: "010101", c5_num: "IPI-TEST", c6_item: "01",
  c6_valor: "1000", c6_valipi: "999",
});
const orderWithoutIpi = orderFromRow({
  c5_filial: "020101", c5_num: "NO-IPI-TEST", c6_item: "01", c6_valor: "1000",
});
const invoiceWithFreight = allocateInvoiceTotals([billingItemFromRow({
  f2_filial: "010101", f2_doc: "FRETE-TEST", f2_serie: "1", d2_item: "01",
  d2_total: "1000", d2_quant: "2", f2_valfat: "1000", f2_frete: "125",
})])[0];
const adminEmail = "admin.teste@forest.ind.br";
const operatorEmail = "operador.teste@forest.ind.br";
const externalOperatorEmail = "operador.teste@hotmail.com";
const unknownExternalEmail = "nao.cadastrado@hotmail.com";
const externalOperatorPin = "246810";
const now = new Date().toISOString();
const currentDate = now.slice(0, 10);
const oldDate = new Date(Date.now() - 200 * 86400000).toISOString().slice(0, 10);
const qualityGroupIds = "3a81b71f-fe71-450c-ba06-0794a2f1394a,f36ff687-2999-4989-9d4b-af885c245e17";
const seedSql = `
INSERT INTO app_state (id, value, updated_at, updated_by)
VALUES ('forestpaper:maquinas', '["Cortadeira","Rebobinadeira"]', '${now}', 'test')
ON CONFLICT(id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at;
INSERT INTO user_roles (identity_hash, display_name, role, active, machine_name)
VALUES ('${hash(adminEmail)}', 'Administrador Teste', 'admin', 1, '')
ON CONFLICT(identity_hash) DO UPDATE SET role='admin', active=1, machine_name='';
INSERT INTO user_roles (identity_hash, display_name, role, active, machine_name)
VALUES ('${hash(operatorEmail)}', 'Operador Teste', 'producao', 1, 'Cortadeira')
ON CONFLICT(identity_hash) DO UPDATE SET role='producao', active=1, machine_name='Cortadeira';
INSERT INTO orders (id, pedido, workflow_status, target_machine, erp_hash, source, source_updated_at, updated_at)
VALUES ('TEST-MACHINE-C', 'TEST-C', 'Aguardando', '', 'test-c', 'test', '${now}', '${now}')
ON CONFLICT(id) DO UPDATE SET workflow_status='Aguardando', target_machine='', maquina='', erp_hash='test-c', updated_at='${now}';
INSERT INTO orders (id, pedido, workflow_status, target_machine, erp_hash, source, source_updated_at, updated_at)
VALUES ('TEST-MACHINE-R', 'TEST-R', 'Aguardando', '', 'test-r', 'test', '${now}', '${now}')
ON CONFLICT(id) DO UPDATE SET workflow_status='Aguardando', target_machine='', maquina='', erp_hash='test-r', updated_at='${now}';
INSERT INTO orders (id, pedido, data_emissao, nota_fiscal, workflow_status, target_machine, erp_hash, source, source_updated_at, updated_at)
VALUES ('TEST-GRAPH-CURRENT', 'TEST-GRAPH-CURRENT', '${currentDate}', '', 'Aguardando', 'Cortadeira', 'graph-current', 'microsoft-graph', '${now}', '${now}')
ON CONFLICT(id) DO UPDATE SET data_emissao='${currentDate}', nota_fiscal='', workflow_status='Aguardando', target_machine='Cortadeira', source='microsoft-graph', updated_at='${now}';
INSERT INTO orders (id, pedido, data_emissao, nota_fiscal, workflow_status, target_machine, erp_hash, source, source_updated_at, updated_at)
VALUES ('TEST-GRAPH-OLD', 'TEST-GRAPH-OLD', '${oldDate}', '', 'Aguardando', 'Cortadeira', 'graph-old', 'microsoft-graph', '${now}', '${now}')
ON CONFLICT(id) DO UPDATE SET data_emissao='${oldDate}', nota_fiscal='', workflow_status='Aguardando', target_machine='Cortadeira', source='microsoft-graph', updated_at='${now}';
INSERT INTO commercial_invoice_items (
  id, filial, documento, serie, data_emissao, codigo_cliente, loja_cliente, cliente,
  codigo_vendedor, vendedor, pedido, item_nota, codigo_produto, produto,
  quantidade, preco_unitario, valor_item, percentual_comissao, comissao_estimada,
  erp_hash, source_updated_at, updated_at, condicao_pagamento, condicao_descricao,
  prazos_pagamento, media_pagamento_dias, produto_base, valor_total_nf,
  valor_bruto_item, preco_por_tonelada
) VALUES (
  'TEST-NF-001', '010101', '000123', '1', '${currentDate}', 'C001', '01', 'Cliente Teste',
  'V01', 'Vendedor Teste', 'TEST-GRAPH-CURRENT', '01', 'P001', 'Produto Teste',
  10, 125, 1250, 2.5, 31.25, 'billing-test', '${now}', '${now}', '001', '10/20/30',
  '10,20,30', 20, 'Eukaliner', 1500, 1500, 150
) ON CONFLICT(id) DO UPDATE SET data_emissao='${currentDate}', valor_item=1250, comissao_estimada=31.25,
  loja_cliente='01', condicao_pagamento='001', condicao_descricao='10/20/30',
  prazos_pagamento='10,20,30', media_pagamento_dias=20, produto_base='Eukaliner',
  valor_total_nf=1500, valor_bruto_item=1500, preco_por_tonelada=150, updated_at='${now}';
INSERT INTO commercial_invoice_items (
  id, filial, documento, serie, data_emissao, codigo_cliente, loja_cliente, cliente,
  pedido, item_nota, quantidade, valor_item, valor_total_nf, condicao_pagamento,
  erp_hash, source_updated_at, updated_at
) VALUES (
  'TEST-040-NF', '040101', '000141', '1', '${currentDate}', 'C040', '01', 'Cliente Espírito Santo',
  'ORDER-040', '01', 2, 2000, 2000, '001', 'test-040-nf', '${now}', '${now}'
) ON CONFLICT(id) DO UPDATE SET data_emissao='${currentDate}', filial='040101', quantidade=2,
  valor_item=2000, valor_total_nf=2000, condicao_pagamento='001', updated_at='${now}';
INSERT INTO orders (id, filial, pedido, item, data_emissao, codigo_cliente, loja_cliente, cliente,
  quantidade, quantidade_entregue, valor_total, condicao_pagamento,
  workflow_status, erp_hash, source, source_updated_at, updated_at)
VALUES ('TEST-040-ORDER', '040101', 'ORDER-040', '01', '${currentDate}', 'C040', '01', 'Cliente Espírito Santo',
  2, 0, 3000, '001', 'Aguardando', 'test-040-order', 'test', '${now}', '${now}')
ON CONFLICT(id) DO UPDATE SET data_emissao='${currentDate}', filial='040101', quantidade=2,
  quantidade_entregue=0, valor_total=3000, condicao_pagamento='001', updated_at='${now}';
INSERT INTO commercial_invoice_items (
  id, filial, documento, serie, data_emissao, codigo_cliente, loja_cliente, cliente,
  pedido, item_nota, quantidade, valor_item, valor_total_nf, condicao_pagamento,
  erp_hash, source_updated_at, updated_at
) VALUES (
  'TEST-ONZE-NF', '020101', '000142', '1', '${currentDate}', 'ONZE1', '01', 'ONZE INDUSTRIA E COMERCIO',
  'ONZE-001', '01', 4, 8000, 8000, '001', 'test-onze-nf', '${now}', '${now}'
) ON CONFLICT(id) DO UPDATE SET data_emissao='${currentDate}', cliente='ONZE INDUSTRIA E COMERCIO',
  valor_item=8000, valor_total_nf=8000, condicao_pagamento='001', updated_at='${now}';
INSERT INTO orders (id, filial, pedido, item, data_emissao, codigo_cliente, loja_cliente, cliente,
  quantidade, quantidade_entregue, valor_total, condicao_pagamento,
  workflow_status, erp_hash, source, source_updated_at, updated_at)
VALUES ('TEST-ONZE-ORDER', '020101', 'ONZE-001', '01', '${currentDate}', 'ONZE1', '01', 'ONZE INDUSTRIA E COMERCIO',
  4, 0, 8000, '001', 'Aguardando', 'test-onze-order', 'test', '${now}', '${now}')
ON CONFLICT(id) DO UPDATE SET data_emissao='${currentDate}', cliente='ONZE INDUSTRIA E COMERCIO',
  quantidade=4, quantidade_entregue=0, valor_total=8000, condicao_pagamento='001', updated_at='${now}';
INSERT INTO orders (id, filial, pedido, item, data_emissao, codigo_cliente, loja_cliente, cliente,
  codigo_produto, produto, produto_base, quantidade, valor_total, vendedor, vendedor_nome,
  condicao_pagamento, condicao_descricao, workflow_status, erp_hash, source, source_updated_at, updated_at)
VALUES ('TEST-KLABIN-ORDER', '010101', 'KLABIN-001', '01', '${currentDate}', 'K001', '01', 'Klabin S.A.',
  'P-KLABIN', 'EUKALINER KLABIN', 'Eukaliner', 5, 7500, 'V01', 'Vendedor Teste',
  '001', '10/20/30', 'Aguardando', 'test-klabin-order', 'test', '${now}', '${now}')
ON CONFLICT(id) DO UPDATE SET cliente='Klabin S.A.', condicao_pagamento='001', quantidade=5,
  valor_total=7500, data_emissao='${currentDate}', updated_at='${now}';
INSERT INTO orders (id, filial, pedido, item, data_emissao, codigo_cliente, loja_cliente, cliente,
  quantidade, valor_total, condicao_pagamento, workflow_status, erp_hash, source, source_updated_at, updated_at)
VALUES ('TEST-COND32-ORDER', '010101', 'COND32-001', '01', '${currentDate}', 'C032', '01', 'Cliente Condição 32',
  99, 99000, '32', 'Aguardando', 'test-cond32-order', 'test', '${now}', '${now}')
ON CONFLICT(id) DO UPDATE SET condicao_pagamento='32', data_emissao='${currentDate}', updated_at='${now}';
INSERT INTO commercial_invoice_items (
  id, filial, documento, serie, data_emissao, codigo_cliente, loja_cliente, cliente, cnpj_cliente,
  pedido, item_nota, quantidade, valor_item, valor_total_nf, condicao_pagamento,
  erp_hash, source_updated_at, updated_at
) VALUES (
  'TEST-GROUP-NF', '010101', '000140', '1', '${currentDate}', 'G001', '01', 'Empresa do Grupo Forest', '07155032000105',
  'GROUP-001', '01', 7, 14000, 14000, '001', 'test-group-nf', '${now}', '${now}'
) ON CONFLICT(id) DO UPDATE SET data_emissao='${currentDate}', cnpj_cliente='07155032000105',
  valor_item=14000, valor_total_nf=14000, condicao_pagamento='001', updated_at='${now}';
INSERT INTO orders (id, filial, pedido, item, data_emissao, codigo_cliente, loja_cliente, cliente,
  cnpj_cliente, quantidade, quantidade_entregue, valor_total, condicao_pagamento,
  workflow_status, erp_hash, source, source_updated_at, updated_at)
VALUES ('TEST-GROUP-ORDER', '010101', 'GROUP-001', '01', '${currentDate}', 'G001', '01', 'Empresa do Grupo Forest',
  '07155032000105', 7, 0, 14000, '001', 'Aguardando', 'test-group-order', 'test', '${now}', '${now}')
ON CONFLICT(id) DO UPDATE SET data_emissao='${currentDate}', cnpj_cliente='07155032000105',
  quantidade=7, quantidade_entregue=0, valor_total=14000, condicao_pagamento='001', updated_at='${now}';
INSERT INTO orders (id, filial, pedido, item, data_emissao, codigo_cliente, loja_cliente, cliente,
  quantidade, quantidade_entregue, valor_total, condicao_pagamento,
  workflow_status, erp_hash, source, source_updated_at, updated_at)
VALUES ('TEST-PORTFOLIO-OLD', '010101', 'PORTFOLIO-OLD', '01', '${oldDate}', 'COLD', '01', 'Cliente Antigo',
  1, 0, 1000, '001', 'Aguardando', 'test-portfolio-old', 'test', '${now}', '${now}')
ON CONFLICT(id) DO UPDATE SET data_emissao='${oldDate}', quantidade=1, quantidade_entregue=0,
  valor_total=1000, condicao_pagamento='001', updated_at='${now}';
INSERT INTO commercial_invoice_items (
  id, filial, documento, serie, data_emissao, codigo_cliente, loja_cliente, cliente,
  codigo_vendedor, vendedor, pedido, item_nota, codigo_produto, produto, produto_base,
  quantidade, valor_item, valor_total_nf, valor_bruto_item, preco_por_tonelada,
  condicao_pagamento, condicao_descricao, erp_hash, source_updated_at, updated_at
) VALUES (
  'TEST-KLABIN-NF', '010101', '000124', '1', '${currentDate}', 'K001', '01', 'Klabin S.A.',
  'V01', 'Vendedor Teste', 'KLABIN-001', '01', 'P-KLABIN', 'EUKALINER KLABIN', 'Eukaliner',
  5, 7500, 7500, 7500, 1500, '001', '10/20/30', 'test-klabin-nf', '${now}', '${now}'
) ON CONFLICT(id) DO UPDATE SET cliente='Klabin S.A.', condicao_pagamento='001',
  valor_total_nf=7500, data_emissao='${currentDate}', updated_at='${now}';
INSERT INTO commercial_invoice_items (
  id, filial, documento, serie, data_emissao, codigo_cliente, loja_cliente, cliente,
  pedido, item_nota, quantidade, valor_item, valor_total_nf, condicao_pagamento,
  erp_hash, source_updated_at, updated_at
) VALUES (
  'TEST-COND32-NF', '010101', '000132', '1', '${currentDate}', 'C032', '01', 'Cliente Condição 32',
  'COND32-001', '01', 99, 99000, 99000, '32', 'test-cond32-nf', '${now}', '${now}'
) ON CONFLICT(id) DO UPDATE SET condicao_pagamento='32', data_emissao='${currentDate}', updated_at='${now}';
`;

const seedFile = join(tmpdir(), "forest-paper-production-test.sql");
writeFileSync(seedFile, seedSql, "utf8");
execFileSync(
  process.execPath,
  [
    join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js"),
    "d1", "migrations", "apply", "forest-paper-producao", "--local",
  ],
  { stdio: "ignore" },
);
execFileSync(
  process.execPath,
  [
    join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js"),
    "d1", "execute", "forest-paper-producao", "--local", "--file", seedFile,
  ],
  { stdio: "ignore" },
);

const worker = await unstable_startWorker({
  config: "wrangler.jsonc",
  dev: {
    remote: false,
    server: { port: 0 },
    inspector: false,
    logLevel: "none",
  },
});

const authHeaders = (email) => ({
  "Cf-Access-Authenticated-User-Email": email,
  Accept: "application/json",
});

async function request(path, email, init = {}) {
  const response = await worker.fetch(`http://local${path}`, {
    ...init,
    headers: {
      ...authHeaders(email),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  return { response, payload: await response.json() };
}

const cookiePair = (response, name) => {
  const value = response.headers.get("set-cookie") || "";
  return value.split(/,(?=[^;]+?=)/).find((item) => item.trim().startsWith(`${name}=`))?.trim().split(";")[0] || "";
};

async function operatorRequest(path, cookie = "", init = {}) {
  const response = await worker.fetch(`http://local${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Origin: "http://local",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  return { response, payload: await response.json() };
}

try {
  await worker.ready;

  const adminMe = await request("/api/me", adminEmail);
  const operatorMe = await request("/api/me", operatorEmail);
  const externalOperatorCreate = await request("/api/operators", adminEmail, {
    method: "POST",
    body: JSON.stringify({
      name: "Operador Externo Teste",
      email: externalOperatorEmail,
      pin: externalOperatorPin,
      machine: "Cortadeira",
    }),
  });
  const externalOperatorMe = await request("/api/me", externalOperatorEmail);
  const unknownExternalMe = await request("/api/me", unknownExternalEmail);
  const operators = await request("/api/operators", adminEmail);
  const commercialOrderImport = await request("/api/orders", adminEmail, {
    method: "PUT",
    body: JSON.stringify({ orders: [{
      id: "TEST-COMMERCIAL-IMPORT",
      pedido: "TEST-COMMERCIAL-IMPORT",
      filial: "010101",
      item: "01",
      dataEmissao: currentDate,
      codigoCliente: "C001",
      lojaCliente: "01",
      cliente: "Cliente Teste",
      cnpjCliente: "12345678000190",
      codigoProduto: "P-EUK",
      produto: "EUKALINER 250 1200X1400",
      produtoBase: "Eukaliner",
      quantidade: 12.5,
      quantidadeEntregue: 2.5,
      valorTotal: 25000,
      volume: 3,
      dataEmbarque: currentDate,
      tipoFrete: "CIF",
      vendedor: "V01",
      vendedorNome: "Vendedor Teste",
      condicaoPagamento: "001",
      condicaoDescricao: "10/20/30",
      prazosPagamento: "10,20,30",
      mediaPagamentoDias: 20,
      tes: "501",
    }] }),
  });
  const commercialMonth = currentDate.slice(0, 7);
  const commercial = await request(`/api/commercial?month=${commercialMonth}&branches=all`, adminEmail);
  const commercialMatriz = await request(`/api/commercial?month=${commercialMonth}&branches=include:010101`, adminEmail);
  const commercialFiltered = await request(`/api/commercial?month=${commercialMonth}&payments=001&customers=${encodeURIComponent("C001|01")}`, adminEmail);
  const commercialNoBranch = await request(`/api/commercial?month=${commercialMonth}&branches=__none__`, adminEmail);
  const commercialDay = await request(`/api/commercial?month=${commercialMonth}&day=${currentDate}`, adminEmail);
  const commercialInvalidMonth = await request("/api/commercial?month=2026-13", adminEmail);
  const commercialInvalidDay = await request(`/api/commercial?month=${commercialMonth}&day=2026-02-31`, adminEmail);
  const commercialForbidden = await request(`/api/commercial?month=${commercialMonth}`, operatorEmail);
  const authorizeDevice = await request("/api/operator-devices", adminEmail, {
    method: "POST",
    body: JSON.stringify({ name: "Tablet Cortadeira Teste", machine: "Cortadeira" }),
  });
  const deviceCookie = cookiePair(authorizeDevice.response, "fp_operator_device");
  const wrongPin = await operatorRequest("/operator-api/login", deviceCookie, {
    method: "POST",
    body: JSON.stringify({ email: externalOperatorEmail, pin: "000000" }),
  });
  const operatorLogin = await operatorRequest("/operator-api/login", deviceCookie, {
    method: "POST",
    body: JSON.stringify({ email: externalOperatorEmail, pin: externalOperatorPin }),
  });
  const sessionCookie = cookiePair(operatorLogin.response, "fp_operator_session");
  const operatorCookie = `${deviceCookie}; ${sessionCookie}`;
  const operatorSessionMe = await operatorRequest("/operator-api/me", operatorCookie);
  const operatorSessionOrders = await operatorRequest("/operator-api/orders", operatorCookie);
  const unauthorizedTablet = await operatorRequest("/operator-api/login", "", {
    method: "POST",
    body: JSON.stringify({ email: externalOperatorEmail, pin: externalOperatorPin }),
  });

  const assignC = await request("/api/orders/TEST-MACHINE-C", adminEmail, {
    method: "PATCH",
    body: JSON.stringify({ targetMachine: "Cortadeira" }),
  });
  const assignR = await request("/api/orders/TEST-MACHINE-R", adminEmail, {
    method: "PATCH",
    body: JSON.stringify({ targetMachine: "Rebobinadeira" }),
  });

  const visibleOrders = await request("/api/orders", operatorEmail);
  const visibleIds = visibleOrders.payload.orders.map((order) => order.id);

  const forbiddenStart = await request("/api/orders/TEST-MACHINE-R", operatorEmail, {
    method: "PATCH",
    body: JSON.stringify({
      status: "Em produção",
      maquina: "Rebobinadeira",
      productionShift: "2º Turno",
    }),
  });
  const adminStart = await request("/api/orders/TEST-MACHINE-C", adminEmail, {
    method: "PATCH",
    body: JSON.stringify({
      status: "Em produção",
      maquina: "Cortadeira",
      productionShift: "2º Turno",
    }),
  });
  const start = await request("/api/orders/TEST-MACHINE-C", operatorEmail, {
    method: "PATCH",
    body: JSON.stringify({
      status: "Em produção",
      maquina: "Cortadeira",
      productionShift: "2º Turno",
    }),
  });
  const finish = await request("/api/orders/TEST-MACHINE-C", operatorEmail, {
    method: "PATCH",
    body: JSON.stringify({
      status: "Aguardando qualidade",
      shiftFinished: false,
    }),
  });
  const adminInspection = await request("/api/orders/TEST-MACHINE-C", adminEmail, {
    method: "PATCH",
    body: JSON.stringify({
      status: "Em inspeção",
      qualidadeIniciadaEm: new Date().toISOString(),
    }),
  });

  const finalOrders = await request("/api/orders", operatorEmail);
  const order = finalOrders.payload.orders.find((item) => item.id === "TEST-MACHINE-C");
  const pageResponse = await worker.fetch("http://local/");
  const page = await pageResponse.text();
  const operatorPageResponse = await worker.fetch("http://local/operador");
  const operatorPage = await operatorPageResponse.text();
  const result = {
    admin: { status: adminMe.response.status, role: adminMe.payload.role, machine: adminMe.payload.machine },
    operator: { status: operatorMe.response.status, role: operatorMe.payload.role, machine: operatorMe.payload.machine },
    externalOperator: {
      createStatus: externalOperatorCreate.response.status,
      status: externalOperatorMe.response.status,
      role: externalOperatorMe.payload.role,
      machine: externalOperatorMe.payload.machine,
    },
    unknownExternalStatus: unknownExternalMe.response.status,
    operatorsStatus: operators.response.status,
    commercialOrderImportStatus: commercialOrderImport.response.status,
    commercial: {
      status: commercial.response.status,
      items: commercial.payload.items?.length || 0,
      billing: Number(commercial.payload.items?.find((item)=>item.id==="TEST-NF-001")?.valor_item || 0),
      orders: Number(commercial.payload.salesOrders?.count || 0),
      filteredItems: commercialFiltered.payload.items?.length || 0,
      tonnes: Number(commercial.payload.salesOrders?.tonnes || 0),
      excludesCondition32: !(commercial.payload.items||[]).some((item)=>item.condicao_pagamento==="32")
        && !(commercial.payload.salesOrderItems||[]).some((item)=>item.condicao_pagamento==="32"),
      emptyBranchItems: commercialNoBranch.payload.items?.length || 0,
      industrialOrders: commercial.payload.industrialization?.summary?.orders || 0,
      industrialInvoices: commercial.payload.industrialization?.summary?.invoices || 0,
      industrialOnlyKlabin: [...(commercial.payload.industrialization?.orders||[]),...(commercial.payload.industrialization?.invoices||[])]
        .every((item)=>String(item.cliente||"").toUpperCase().includes("KLABIN") && item.condicao_pagamento!=="32"),
      regularExcludesKlabin: [
        ...(commercial.payload.items||[]),
        ...(commercial.payload.salesOrderItems||[]),
        ...(commercial.payload.portfolioItems||[]),
      ].every((item)=>!String(item.cliente||"").toUpperCase().includes("KLABIN")),
      customerOptionsExcludeKlabin: !(commercial.payload.filterOptions?.customers||[])
        .some((item)=>String(item.label||"").toUpperCase().includes("KLABIN")),
      branchTonnes: (commercial.payload.branchTotals||[])
        .reduce((sum,item)=>sum+Number(item.toneladas||0),0),
      industrialTonnes: Number(commercial.payload.industrialization?.summary?.tonnes || 0),
      industrialInvoiceTonnes: Number(commercial.payload.industrialization?.summary?.invoiceTonnes || 0),
      forestGroupHiddenFromDisplay: !(commercial.payload.items||[]).some((item)=>item.id==="TEST-GROUP-NF")
        && !(commercial.payload.salesOrderItems||[]).some((item)=>item.id==="TEST-GROUP-ORDER")
        && !(commercial.payload.portfolioItems||[]).some((item)=>item.id==="TEST-GROUP-ORDER"),
      forestGroupKeptForExport: (commercial.payload.exportData?.hiddenItems||[]).some((item)=>item.id==="TEST-GROUP-NF")
        && (commercial.payload.exportData?.hiddenSalesOrderItems||[]).some((item)=>item.id==="TEST-GROUP-ORDER")
        && (commercial.payload.exportData?.portfolioItems||[]).some((item)=>item.id==="TEST-GROUP-ORDER"),
      onzeHiddenFromDisplay: !(commercial.payload.items||[]).some((item)=>item.id==="TEST-ONZE-NF")
        && !(commercial.payload.salesOrderItems||[]).some((item)=>item.id==="TEST-ONZE-ORDER"),
      onzeKeptForExport: (commercial.payload.exportData?.hiddenItems||[]).some((item)=>item.id==="TEST-ONZE-NF")
        && (commercial.payload.exportData?.hiddenSalesOrderItems||[]).some((item)=>item.id==="TEST-ONZE-ORDER"),
      matrizIncludes040101: (commercialMatriz.payload.items||[]).some((item)=>item.id==="TEST-NF-001")
        && (commercialMatriz.payload.items||[]).some((item)=>item.id==="TEST-040-NF")
        && (commercialMatriz.payload.salesOrderItems||[]).some((item)=>item.id==="TEST-040-ORDER"),
      portfolioNewestFirst: (commercial.payload.portfolioItems||[]).every((item,index,rows)=>(
        index===0 || String(rows[index-1].data_emissao||"")>=String(item.data_emissao||"")
      )),
      portfolioOrderCount: new Set((commercial.payload.portfolioItems||[])
        .map((item)=>`${item.filial||""}|${item.pedido||""}`)).size,
      paymentOptionsExclude32: !(commercial.payload.filterOptions?.payments||[]).some((item)=>item.value==="32"),
      dailyStatus: commercialDay.response.status,
      dailyItems: commercialDay.payload.items?.length || 0,
      invalidMonthStatus: commercialInvalidMonth.response.status,
      invalidDayStatus: commercialInvalidDay.response.status,
      forbiddenOperatorStatus: commercialForbidden.response.status,
    },
    tablet: {
      authorizeStatus: authorizeDevice.response.status,
      hasDeviceCookie: Boolean(deviceCookie),
      wrongPinStatus: wrongPin.response.status,
      loginStatus: operatorLogin.response.status,
      hasSessionCookie: Boolean(sessionCookie),
      meStatus: operatorSessionMe.response.status,
      name: operatorSessionMe.payload.name,
      machine: operatorSessionMe.payload.machine,
      visibleIds: (operatorSessionOrders.payload.orders || []).map((item) => item.id),
      unauthorizedStatus: unauthorizedTablet.response.status,
    },
    assignments: [assignC.response.status, assignR.response.status],
    visibleIds,
    forbiddenOtherMachineStatus: forbiddenStart.response.status,
    adminCannotOperateStatus: adminStart.response.status,
    startStatus: start.response.status,
    finishStatus: finish.response.status,
    adminInspectionStatus: adminInspection.response.status,
    finalOrder: order && {
      status: order.status,
      targetMachine: order.targetMachine,
      machine: order.maquina,
      shift: order.productionShift,
      operator: order.productionOperator,
    },
    hasOperatorsTab: page.includes('id="tab-operadores"'),
    hasOperatorForm: page.includes('id="operatorForm"'),
    hasOperatorPinForm: page.includes('id="operatorPin"'),
    hasDeviceForm: page.includes('id="deviceForm"'),
    hasOperatorLogin: operatorPage.includes('id="operatorLoginForm"'),
    hasAccessLogout: page.includes("location.href = '/cdn-cgi/access/logout'"),
    hasLiveMachineMetrics: page.includes("Quantidade concluída"),
    hasDirectorBranchFilter: page.includes('id="directorBranchFilter"'),
    hasCommercialTab: page.includes('id="tab-comercial"'),
    commercialRoleLoadsData: page.includes("['admin','diretoria','comercial'].includes(loggedUser.role)"),
    convertsKgOnlyForPanel: page.includes('function commercialOrderTonnes(item)') && page.includes('quantity/1000'),
    keepsExcelOriginalQuantity: page.includes("'Toneladas':Number(item.quantidade||0)"),
    hasGroupTotalLabel: page.includes('<h3>Total do Grupo</h3>'),
    hasCommercialLineDetails: page.includes('id="commercialLineDetailsBody"') && page.includes('Preço de venda / t'),
    hasCommercialAutoRefresh: page.includes('},30*60*1000)'),
    hasCommercialFilters: page.includes('id="commercialMonth"')
      && page.includes('id="commercialDay"')
      && page.includes('data-filter-master="branch"')
      && page.includes('data-filter-master="customer"')
      && page.includes('data-filter-master="payment"')
      && !page.includes('data-filter-master="seller"')
      && page.includes('Selecionar todas')
      && !page.includes('id="commercialFrom"')
      && !page.includes('id="commercialTo"'),
    hasCommercialExcelExport: page.includes('id="commercialExportBtn"')
      && page.includes("XLSX.utils.book_append_sheet(workbook"),
    syncsCommercialByMonth: page.includes("new URLSearchParams({month})")
      && workerSource.includes('fetchProtheusBilling(env, { month, day })')
      && workerSource.includes('syncCommercialBilling(env, null, { month: currentMonth })'),
    filtersCommercialByDay: page.includes("function commercialPeriodSelection")
      && page.includes("day:period.day")
      && workerSource.includes('day ? { from: day, to: day } : monthDateRange(month)'),
    hasManagerialCommercialView: page.includes('id="commercialBillingTonnesKpi"')
      && page.includes('<h2>Gestão Comercial</h2>')
      && page.includes('class="commercial-layout"')
      && page.includes('class="commercial-sidebar"')
      && page.includes('aria-label="Navegação da Gestão Comercial"')
      && page.includes('<h3>Unidade de Negócios</h3>')
      && page.indexOf('<h3>Unidade de Negócios</h3>') < page.indexOf('<h3>Pedidos a faturar</h3>')
      && page.includes('id="commercialTotalOrderTonnesKpi"')
      && page.includes('id="commercialTotalBillingTonnesKpi"')
      && page.includes('id="commercialTotalOrdersKpi"')
      && page.includes('id="commercialTotalBillingKpi"')
      && page.includes('id="commercialManagerBranches"')
      && page.includes('function commercialManagerialBranchCode')
      && !page.includes('id="commercialOrdersKpi"')
      && !page.includes('id="commercialInvoicesKpi"')
      && !page.includes('id="industrialOrdersKpi"')
      && !page.includes('id="industrialInvoicesKpi"')
      && !page.includes('id="commercialOrdersTableBody"')
      && !page.includes('id="commercialBranchTotalsBody"')
      && !page.includes('id="commercialTableBody"')
      && !page.includes('id="commercialPortfolioBody"')
      && !page.includes('id="commercialTicketKpi"')
      && !page.includes('id="commercialDailyChart"')
      && !page.includes('id="commercialBranchChart"')
      && !page.includes('id="commercialClientChart"'),
    hasIndustrializationPanel: page.includes('id="commercialIndustrializationPanel"')
      && page.includes('id="industrialOrderValueKpi"')
      && page.includes('id="industrialInvoiceTonnesKpi"')
      && !page.includes('id="industrialOrdersBody"')
      && !page.includes('id="industrialInvoicesBody"')
      && page.includes("'Industrialização Pedidos'"),
    excludesCondition32AtSource: workerSource.includes("COALESCE(TRIM(condicao_pagamento), '') <> '32'"),
    hasNoCommercialTargetUi: !page.includes('commercialTarget')
      && !workerSource.includes('/api/commercial/targets'),
    hasNoSellerUi: !page.includes('id="commercialSellerFilter"')
      && !page.includes('id="commercialSellerChart"')
      && !page.includes('<th>Executivo</th>')
      && !page.includes('<th>Comissão est.</th>'),
    keepsSellerInExcel: page.includes("'Código vendedor':item.codigo_vendedor")
      && page.includes("'Executivo':item.vendedor"),
    separatesKlabinAtSource: workerSource.includes("UPPER(COALESCE(cliente, '')) NOT LIKE '%KLABIN%'")
      && workerSource.includes("UPPER(COALESCE(cliente, '')) LIKE '%KLABIN%'"),
    hidesForestGroupByCnpj: workerSource.includes('HIDDEN_FOREST_GROUP_CNPJS')
      && workerSource.includes('isHiddenForestGroupCustomer'),
    exportsCompleteCommercialData: page.includes('commercialData.exportData')
      && page.includes("'CNPJ':item.cnpj_cliente"),
    exportsManagerialPortfolio: workerSource.includes('firstCommercialOrders(')
      && workerSource.includes('ORDER BY data_emissao DESC, filial, pedido DESC, item')
      && page.includes("'Carteira por pedido'")
      && page.includes("'Carteira detalhada'")
      && page.includes("'Pedidos a faturar':item.valor"),
    includesIpiInOrderValue: orderWithIpi?.valorTotal === 1032.5
      && orderWithoutIpi?.valorTotal === 1000
      && workerSource.includes('["010101", "040101"].includes(filial) ? valorMercadoria * 1.0325 : valorMercadoria')
      && page.includes('IPI 3,25% somente nas filiais 010101 e 040101'),
    excludesCancelledAndReturns: workerSource.includes("COALESCE(TRIM(data_cancelamento), '') = ''")
      && workerSource.includes("UPPER(COALESCE(TRIM(tipo_nota), '')) <> 'D'")
      && workerSource.includes('dataCancelamento: dateValue')
      && workerSource.includes('data_cancelamento = excluded.data_cancelamento'),
    includesFreightInBilling: invoiceWithFreight?.valorTotalNf === 1125
      && invoiceWithFreight?.valorBrutoItem === 1125
      && workerSource.includes('const headerTotal = valorDocumento + freteNota'),
    hidesOnzeFromDisplay: workerSource.includes('function isOnzeCustomer')
      && workerSource.includes('isHiddenCommercialDisplayCustomer'),
    merges040101IntoMatrizView: workerSource.includes('expandCommercialBranchFilter')
      && page.includes("return code==='040101' ? '010101'")
      && page.includes('Matriz (inclui 040101)'),
    hasDirectorBranches: page.includes("010101 · Forest Paper Matriz")
      && page.includes("020101 · Revita")
      && page.includes("040101 · Forest Espírito Santo"),
    sortsByOrderIssueDate: page.includes("function sortOrdersByIssueDate"),
    hasOrderEntryPeriodFilter: page.includes('id="orderDateFilter"')
      && page.includes('value="today">Hoje')
      && page.includes('value="week">Esta semana')
      && page.includes('value="month">Este mês')
      && page.includes('value="30days">Últimos 30 dias'),
    filtersOrdersByEntryPeriod: page.includes("function orderMatchesEntryPeriod")
      && page.includes("orderMatchesEntryPeriod(p,period) && matchesBranch(p)"),
    persistsOrderEntryPeriod: page.includes("'#orderDateFilter'"),
    hasOrderBranchFilter: page.includes('id="orderBranchFilter"')
      && page.includes('010101 · Forest Paper Matriz')
      && page.includes('020101 · Revita')
      && page.includes('040101 · Forest Espírito Santo'),
    filtersOrdersByBranch: page.includes("const matchesBranch = p=>branch==='all'")
      && page.includes("'#orderBranchFilter'"),
    servesFreshMainAsset: workerSource.includes('url.pathname === "/" || url.pathname === "/operador"')
      && workerSource.includes('indexUrl.searchParams.set("asset-refresh"')
      && wranglerSource.includes('"run_worker_first": true'),
    usesProductDescriptionPlaceholder: page.includes("Descrição do produto indisponível"),
    labelsProductCodeAsErp: page.includes("Cód. ERP"),
    doesNotUseProductCodeAsTitle: !page.includes("`Produto ${codigoProduto}`"),
    qualityGroupMatches: accessIdentityHasAnyGroup({
      groups: [{ id: "f36ff687-2999-4989-9d4b-af885c245e17", name: "Qualidade Conversao TB" }],
    }, qualityGroupIds),
    unrelatedGroupDoesNotMatch: !accessIdentityHasAnyGroup({
      groups: [{ id: "00000000-0000-0000-0000-000000000000", name: "Outro grupo" }],
    }, qualityGroupIds),
  };

  const valid = result.admin.status === 200
    && result.admin.role === "admin"
    && result.admin.machine === ""
    && result.operator.status === 200
    && result.operator.role === "producao"
    && result.operator.machine === "Cortadeira"
    && result.externalOperator.createStatus === 200
    && result.externalOperator.status === 200
    && result.externalOperator.role === "producao"
    && result.externalOperator.machine === "Cortadeira"
    && result.unknownExternalStatus === 403
    && result.operatorsStatus === 200
    && result.commercialOrderImportStatus === 200
    && result.commercial.status === 200
    && result.commercial.items === 2
    && result.commercial.billing === 1250
    && result.commercial.orders >= 1
    && result.commercial.filteredItems === 1
    && result.commercial.tonnes === 14.5
    && result.commercial.excludesCondition32
    && result.commercial.emptyBranchItems === 0
    && result.commercial.industrialOrders === 1
    && result.commercial.industrialInvoices === 1
    && result.commercial.industrialOnlyKlabin
    && result.commercial.regularExcludesKlabin
    && result.commercial.customerOptionsExcludeKlabin
    && result.commercial.branchTonnes === 14.5
    && result.commercial.industrialTonnes === 5
    && result.commercial.industrialInvoiceTonnes === 5
    && result.commercial.forestGroupHiddenFromDisplay
    && result.commercial.forestGroupKeptForExport
    && result.commercial.onzeHiddenFromDisplay
    && result.commercial.onzeKeptForExport
    && result.commercial.matrizIncludes040101
    && result.commercial.portfolioNewestFirst
    && result.commercial.portfolioOrderCount <= 30
    && result.commercial.paymentOptionsExclude32
    && result.commercial.dailyStatus === 200
    && result.commercial.dailyItems === 2
    && result.commercial.invalidMonthStatus === 400
    && result.commercial.invalidDayStatus === 400
    && result.commercial.forbiddenOperatorStatus === 403
    && result.tablet.authorizeStatus === 200
    && result.tablet.hasDeviceCookie
    && result.tablet.wrongPinStatus === 401
    && result.tablet.loginStatus === 200
    && result.tablet.hasSessionCookie
    && result.tablet.meStatus === 200
    && result.tablet.name === "Operador Externo Teste"
    && result.tablet.machine === "Cortadeira"
    && result.tablet.visibleIds.includes("TEST-GRAPH-CURRENT")
    && !result.tablet.visibleIds.includes("TEST-MACHINE-R")
    && result.tablet.unauthorizedStatus === 403
    && result.assignments.every((status) => status === 200)
    && result.visibleIds.includes("TEST-MACHINE-C")
    && result.visibleIds.includes("TEST-GRAPH-CURRENT")
    && !result.visibleIds.includes("TEST-GRAPH-OLD")
    && !result.visibleIds.includes("TEST-MACHINE-R")
    && result.forbiddenOtherMachineStatus === 403
    && result.adminCannotOperateStatus === 403
    && result.startStatus === 200
    && result.finishStatus === 200
    && result.adminInspectionStatus === 200
    && result.finalOrder?.status === "Em inspeção"
    && result.finalOrder?.targetMachine === "Cortadeira"
    && result.finalOrder?.machine === "Cortadeira"
    && result.finalOrder?.shift === "2º Turno"
    && result.finalOrder?.operator === "Operador Teste"
    && result.hasOperatorsTab
    && result.hasOperatorForm
    && result.hasOperatorPinForm
    && result.hasDeviceForm
    && result.hasOperatorLogin
    && result.hasAccessLogout
    && result.hasLiveMachineMetrics
    && result.hasDirectorBranchFilter
    && result.hasCommercialTab
    && result.commercialRoleLoadsData
    && result.convertsKgOnlyForPanel
    && result.keepsExcelOriginalQuantity
    && result.hasGroupTotalLabel
    && result.hasCommercialLineDetails
    && result.hasCommercialAutoRefresh
    && result.hasCommercialFilters
    && result.hasCommercialExcelExport
    && result.syncsCommercialByMonth
    && result.filtersCommercialByDay
    && result.hasManagerialCommercialView
    && result.hasIndustrializationPanel
    && result.excludesCondition32AtSource
    && result.hasNoCommercialTargetUi
    && result.hasNoSellerUi
    && result.keepsSellerInExcel
    && result.separatesKlabinAtSource
    && result.hidesForestGroupByCnpj
    && result.exportsCompleteCommercialData
    && result.exportsManagerialPortfolio
    && result.includesIpiInOrderValue
    && result.includesFreightInBilling
    && result.excludesCancelledAndReturns
    && result.hidesOnzeFromDisplay
    && result.merges040101IntoMatrizView
    && result.hasDirectorBranches
    && result.sortsByOrderIssueDate
    && result.hasOrderEntryPeriodFilter
    && result.filtersOrdersByEntryPeriod
    && result.persistsOrderEntryPeriod
    && result.hasOrderBranchFilter
    && result.filtersOrdersByBranch
    && result.servesFreshMainAsset
    && result.usesProductDescriptionPlaceholder
    && result.labelsProductCodeAsErp
    && result.doesNotUseProductCodeAsTitle
    && result.qualityGroupMatches
    && result.unrelatedGroupDoesNotMatch;

  console.log(JSON.stringify(result, null, 2));
  if (!valid) process.exitCode = 1;
} finally {
  await worker.dispose();
}
