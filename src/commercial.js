import { fetchProtheusBilling, fetchProtheusSalesOrders } from "./protheus.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

const HIDDEN_FOREST_GROUP_CNPJS = new Set([
  "07155032000105", "43804835000107", "46426147000149", "46427485000103",
  "82221730000187", "55385777000103", "23291273000138",
]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function text(value) {
  return String(value ?? "").trim();
}

function taxId(value) {
  return text(value).replace(/\D/g, "");
}

function header(value) {
  return text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
}

function value(row, aliases) {
  const indexed = Object.fromEntries(Object.entries(row || {}).map(([key, item]) => [header(key), item]));
  for (const alias of aliases) {
    const candidate = indexed[header(alias)];
    if (candidate !== undefined && candidate !== null && text(candidate) !== "") return candidate;
  }
  return "";
}

function numeric(input) {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  const parsed = Number(text(input).replace(/\s/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function date(input) {
  const raw = text(input);
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  return raw.slice(0, 10);
}

function productBase(description) {
  const name = text(description);
  const withoutMeasures = name.replace(/\([^)]*\)/g, " ").replace(/\b\d+(?:[.,]\d+)?\b/g, " ")
    .replace(/[xX]\s*(?=\d)/g, " ").replace(/\s+/g, " ").trim();
  return withoutMeasures || name;
}

function paymentAverage(schedule) {
  const source = text(schedule);
  const first = source.startsWith("[") ? (source.match(/^\[([^\]]+)\]/)?.[1] || "") : source;
  const days = first.split(/[,;/]/).map((part) => Number(part.trim())).filter(Number.isFinite);
  return days.length ? days.reduce((sum, item) => sum + item, 0) / days.length : 0;
}

function freight(valueToMap) {
  const code = text(valueToMap).toUpperCase();
  return ({ C: "CIF", F: "FOB", D: "Destinatario", R: "Remetente", T: "Terceiros", S: "Sem transporte" })[code] || code;
}

function orderFromRow(row) {
  const filial = text(value(row, ["filial", "c5_filial"]));
  const pedido = text(value(row, ["pedido", "c5_num"]));
  const item = text(value(row, ["item", "c6_item"]));
  const codigoProduto = text(value(row, ["codigo produto", "c6_produto"]));
  if (!pedido) return null;
  const produto = text(value(row, ["produto", "b1_desc"]));
  const prazos = text(value(row, ["prazos pagamento", "e4_cond"]));
  const valorMercadoria = numeric(value(row, ["valor total", "c6_valor"]));
  return {
    id: [filial || "sem-filial", pedido, item || codigoProduto || "item"].join("-"),
    filial, pedido, item,
    dataEmissao: date(value(row, ["data emissao", "c5_emissao"])),
    codigoCliente: text(value(row, ["codigo cliente", "c5_cliente"])),
    lojaCliente: text(value(row, ["loja cliente", "c5_lojacli"])),
    cliente: text(value(row, ["cliente", "a1_nome"])),
    cnpjCliente: taxId(value(row, ["cnpj cliente", "a1_cgc"])),
    cidade: text(value(row, ["cidade", "a1_mun"])),
    uf: text(value(row, ["uf", "a1_est"])),
    codigoProduto,
    produto,
    produtoBase: productBase(produto),
    unidade: text(value(row, ["unidade", "c6_unsven"])),
    quantidade: numeric(value(row, ["quantidade", "c6_qtdven"])),
    precoUnitario: numeric(value(row, ["preco unitario", "c6_prcven"])),
    valorTotal: ["010101", "040101"].includes(filial) ? valorMercadoria * 1.0325 : valorMercadoria,
    volume: numeric(value(row, ["volume", "c5_volume1"])),
    dataEmbarque: date(value(row, ["data embarque", "c6_entreg", "c5_fecent"])),
    tipoFrete: freight(value(row, ["tipo frete", "c5_tpfrete"])),
    quantidadeEntregue: numeric(value(row, ["quantidade entregue", "c6_qtdent"])),
    tes: text(value(row, ["tes", "c6_tes"])),
    vendedor: text(value(row, ["codigo vendedor", "c5_vend1"])),
    vendedorNome: text(value(row, ["vendedor", "a3_nome"])),
    condicaoPagamento: text(value(row, ["condicao pagamento", "c5_condpag"])),
    condicaoDescricao: text(value(row, ["descricao condicao", "e4_descri"])),
    prazosPagamento: prazos,
    mediaPagamentoDias: paymentAverage(prazos),
    tipoPedido: text(value(row, ["tipo pedido", "c5_tipo"])),
    notaFiscal: text(value(row, ["nota fiscal", "c5_nota"])),
    serieNota: text(value(row, ["serie nota", "c5_serie"])),
  };
}

function invoiceFromRow(row) {
  const filial = text(value(row, ["filial", "f2_filial", "d2_filial"]));
  const documento = text(value(row, ["documento", "f2_doc", "d2_doc"]));
  const serie = text(value(row, ["serie", "f2_serie", "d2_serie"]));
  const itemNota = text(value(row, ["item nota", "d2_item"]));
  const codigoProduto = text(value(row, ["codigo produto", "d2_cod"]));
  if (!documento) return null;
  const valorItem = numeric(value(row, ["valor item", "d2_total"]));
  const percentualComissao = numeric(value(row, ["percentual comissao", "a3_comis"]));
  const produto = text(value(row, ["produto", "b1_desc"]));
  const prazos = text(value(row, ["prazos pagamento", "e4_cond"]));
  return {
    id: [filial || "sem-filial", documento, serie || "sem-serie", itemNota || codigoProduto || "item"].join("-"),
    filial, documento, serie, itemNota, codigoProduto, produto,
    dataEmissao: date(value(row, ["data emissao", "f2_emissao"])),
    codigoCliente: text(value(row, ["codigo cliente", "f2_cliente"])),
    lojaCliente: text(value(row, ["loja cliente", "f2_loja"])),
    cliente: text(value(row, ["cliente", "a1_nome"])),
    cnpjCliente: taxId(value(row, ["cnpj cliente", "a1_cgc"])),
    cidade: text(value(row, ["cidade", "a1_mun"])),
    uf: text(value(row, ["uf", "a1_est"])),
    codigoVendedor: text(value(row, ["codigo vendedor", "f2_vend1"])),
    vendedor: text(value(row, ["vendedor", "a3_nome"])),
    pedido: text(value(row, ["pedido", "d2_pedido"])),
    itemPedido: text(value(row, ["item pedido", "d2_itempv"])),
    produtoBase: productBase(produto),
    quantidade: numeric(value(row, ["quantidade", "d2_quant"])),
    precoUnitario: numeric(value(row, ["preco unitario", "d2_prcven"])),
    valorItem,
    desconto: numeric(value(row, ["desconto", "d2_descon"])),
    freteNota: numeric(value(row, ["frete", "f2_frete"])),
    seguroNota: numeric(value(row, ["seguro", "f2_seguro"])),
    despesasNota: numeric(value(row, ["despesas", "f2_despesa"])),
    ipiNota: numeric(value(row, ["ipi", "f2_valipi"])),
    icmsNota: numeric(value(row, ["icms", "f2_valicm"])),
    valorBrutoNota: numeric(value(row, ["valor bruto nota", "f2_valbrut"])),
    valorMercadoriaNota: numeric(value(row, ["valor mercadoria nota", "f2_valmerc"])),
    valorFaturadoNota: numeric(value(row, ["valor faturado nota", "f2_valfat"])),
    condicaoPagamento: text(value(row, ["condicao pagamento", "f2_cond"])),
    condicaoDescricao: text(value(row, ["descricao condicao", "e4_descri"])),
    prazosPagamento: prazos,
    mediaPagamentoDias: paymentAverage(prazos),
    tipoNota: text(value(row, ["tipo nota", "f2_tipo"])),
    dataCancelamento: date(value(row, ["data cancelamento", "f2_dtcanc"])),
    tes: text(value(row, ["tes", "d2_tes"])),
    cfop: text(value(row, ["cfop", "d2_cf"])),
    percentualComissao,
    comissaoEstimada: valorItem * percentualComissao / 100,
  };
}

function allocateInvoiceTotals(items) {
  const groups = new Map();
  for (const item of items) {
    const key = `${item.filial}|${item.documento}|${item.serie}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return items.map((item) => {
    const rows = groups.get(`${item.filial}|${item.documento}|${item.serie}`) || [item];
    const itemTotal = rows.reduce((sum, row) => sum + Math.max(0, row.valorItem), 0);
    const billed = Math.max(...rows.map((row) => row.valorFaturadoNota));
    const gross = Math.max(...rows.map((row) => row.valorBrutoNota));
    const freightTotal = Math.max(...rows.map((row) => row.freteNota));
    const invoiceTotal = (billed > 0 ? billed : (gross > 0 ? gross : itemTotal)) + freightTotal;
    const share = itemTotal > 0 ? Math.max(0, item.valorItem) / itemTotal : 1 / rows.length;
    const valorBrutoItem = invoiceTotal * share;
    return { ...item, valorTotalNf: invoiceTotal, valorBrutoItem,
      precoPorTonelada: item.quantidade > 0 ? valorBrutoItem / item.quantidade : 0 };
  });
}

async function upsertOrders(env, orders) {
  const now = new Date().toISOString();
  const unique = [...new Map(orders.map((item) => [item.id, item])).values()];
  let changed = 0;
  for (let offset = 0; offset < unique.length; offset += 60) {
    const statements = unique.slice(offset, offset + 60).map((order) => {
      const erpHash = JSON.stringify(order);
      return env.DB.prepare(`INSERT INTO orders (
        id, filial, pedido, item, data_emissao, codigo_cliente, loja_cliente, cliente, cnpj_cliente,
        cidade, uf, codigo_produto, produto, unidade, quantidade, preco_unitario, valor_total, tes,
        vendedor, condicao_pagamento, tipo_pedido, nota_fiscal, serie_nota, volume, data_embarque,
        tipo_frete, quantidade_entregue, vendedor_nome, produto_base, condicao_descricao,
        prazos_pagamento, media_pagamento_dias, workflow_status, erp_hash, source, source_updated_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Aguardando', ?, 'totvs-protheus', ?, ?)
      ON CONFLICT(id) DO UPDATE SET filial=excluded.filial, pedido=excluded.pedido, item=excluded.item,
        data_emissao=excluded.data_emissao, codigo_cliente=excluded.codigo_cliente, loja_cliente=excluded.loja_cliente,
        cliente=CASE WHEN excluded.cliente<>'' THEN excluded.cliente ELSE orders.cliente END,
        cnpj_cliente=CASE WHEN excluded.cnpj_cliente<>'' THEN excluded.cnpj_cliente ELSE orders.cnpj_cliente END,
        cidade=CASE WHEN excluded.cidade<>'' THEN excluded.cidade ELSE orders.cidade END,
        uf=CASE WHEN excluded.uf<>'' THEN excluded.uf ELSE orders.uf END,
        codigo_produto=excluded.codigo_produto, produto=CASE WHEN excluded.produto<>'' THEN excluded.produto ELSE orders.produto END,
        unidade=excluded.unidade, quantidade=excluded.quantidade, preco_unitario=excluded.preco_unitario,
        valor_total=excluded.valor_total, tes=excluded.tes, vendedor=excluded.vendedor,
        condicao_pagamento=excluded.condicao_pagamento, tipo_pedido=excluded.tipo_pedido,
        nota_fiscal=excluded.nota_fiscal, serie_nota=excluded.serie_nota, volume=excluded.volume,
        data_embarque=excluded.data_embarque, tipo_frete=excluded.tipo_frete,
        quantidade_entregue=excluded.quantidade_entregue,
        vendedor_nome=CASE WHEN excluded.vendedor_nome<>'' THEN excluded.vendedor_nome ELSE orders.vendedor_nome END,
        produto_base=CASE WHEN excluded.produto_base<>'' THEN excluded.produto_base ELSE orders.produto_base END,
        condicao_descricao=CASE WHEN excluded.condicao_descricao<>'' THEN excluded.condicao_descricao ELSE orders.condicao_descricao END,
        prazos_pagamento=CASE WHEN excluded.prazos_pagamento<>'' THEN excluded.prazos_pagamento ELSE orders.prazos_pagamento END,
        media_pagamento_dias=excluded.media_pagamento_dias, erp_hash=excluded.erp_hash,
        source=excluded.source, source_updated_at=excluded.source_updated_at, updated_at=excluded.updated_at
      WHERE orders.erp_hash<>excluded.erp_hash`).bind(
        order.id, order.filial, order.pedido, order.item, order.dataEmissao, order.codigoCliente,
        order.lojaCliente, order.cliente, order.cnpjCliente, order.cidade, order.uf, order.codigoProduto,
        order.produto, order.unidade, order.quantidade, order.precoUnitario, order.valorTotal, order.tes,
        order.vendedor, order.condicaoPagamento, order.tipoPedido, order.notaFiscal, order.serieNota,
        order.volume, order.dataEmbarque, order.tipoFrete, order.quantidadeEntregue, order.vendedorNome,
        order.produtoBase, order.condicaoDescricao, order.prazosPagamento, order.mediaPagamentoDias,
        erpHash, now, now,
      );
    });
    const results = await env.DB.batch(statements);
    changed += results.reduce((sum, result) => sum + Number(result.meta?.changes || 0), 0);
  }
  return { received: orders.length, unique: unique.length, changed };
}

async function upsertInvoices(env, invoices) {
  const now = new Date().toISOString();
  const unique = [...new Map(invoices.map((item) => [item.id, item])).values()];
  let changed = 0;
  for (let offset = 0; offset < unique.length; offset += 50) {
    const statements = unique.slice(offset, offset + 50).map((item) => {
      const erpHash = JSON.stringify(item);
      return env.DB.prepare(`INSERT INTO commercial_invoice_items (
        id, filial, documento, serie, data_emissao, codigo_cliente, loja_cliente, cliente, cnpj_cliente,
        cidade, uf, codigo_vendedor, vendedor, pedido, item_pedido, item_nota, codigo_produto, produto,
        quantidade, preco_unitario, valor_item, desconto, frete_nota, seguro_nota, despesas_nota,
        ipi_nota, icms_nota, valor_bruto_nota, valor_mercadoria_nota, valor_faturado_nota, tipo_nota,
        data_cancelamento, tes, cfop, percentual_comissao, comissao_estimada, erp_hash, source_updated_at,
        updated_at, condicao_pagamento, condicao_descricao, prazos_pagamento, media_pagamento_dias,
        produto_base, valor_total_nf, valor_bruto_item, preco_por_tonelada
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET filial=excluded.filial, documento=excluded.documento, serie=excluded.serie,
        data_emissao=excluded.data_emissao, codigo_cliente=excluded.codigo_cliente, loja_cliente=excluded.loja_cliente,
        cliente=CASE WHEN excluded.cliente<>'' THEN excluded.cliente ELSE commercial_invoice_items.cliente END,
        cnpj_cliente=CASE WHEN excluded.cnpj_cliente<>'' THEN excluded.cnpj_cliente ELSE commercial_invoice_items.cnpj_cliente END,
        cidade=CASE WHEN excluded.cidade<>'' THEN excluded.cidade ELSE commercial_invoice_items.cidade END,
        uf=CASE WHEN excluded.uf<>'' THEN excluded.uf ELSE commercial_invoice_items.uf END,
        codigo_vendedor=excluded.codigo_vendedor,
        vendedor=CASE WHEN excluded.vendedor<>'' THEN excluded.vendedor ELSE commercial_invoice_items.vendedor END,
        pedido=excluded.pedido, item_pedido=excluded.item_pedido, item_nota=excluded.item_nota,
        codigo_produto=excluded.codigo_produto,
        produto=CASE WHEN excluded.produto<>'' THEN excluded.produto ELSE commercial_invoice_items.produto END,
        quantidade=excluded.quantidade, preco_unitario=excluded.preco_unitario, valor_item=excluded.valor_item,
        desconto=excluded.desconto, frete_nota=excluded.frete_nota, seguro_nota=excluded.seguro_nota,
        despesas_nota=excluded.despesas_nota, ipi_nota=excluded.ipi_nota, icms_nota=excluded.icms_nota,
        valor_bruto_nota=excluded.valor_bruto_nota, valor_mercadoria_nota=excluded.valor_mercadoria_nota,
        valor_faturado_nota=excluded.valor_faturado_nota, tipo_nota=excluded.tipo_nota,
        data_cancelamento=excluded.data_cancelamento, tes=excluded.tes, cfop=excluded.cfop,
        percentual_comissao=excluded.percentual_comissao, comissao_estimada=excluded.comissao_estimada,
        erp_hash=excluded.erp_hash, source_updated_at=excluded.source_updated_at, updated_at=excluded.updated_at,
        condicao_pagamento=excluded.condicao_pagamento,
        condicao_descricao=CASE WHEN excluded.condicao_descricao<>'' THEN excluded.condicao_descricao ELSE commercial_invoice_items.condicao_descricao END,
        prazos_pagamento=CASE WHEN excluded.prazos_pagamento<>'' THEN excluded.prazos_pagamento ELSE commercial_invoice_items.prazos_pagamento END,
        media_pagamento_dias=excluded.media_pagamento_dias,
        produto_base=CASE WHEN excluded.produto_base<>'' THEN excluded.produto_base ELSE commercial_invoice_items.produto_base END,
        valor_total_nf=excluded.valor_total_nf, valor_bruto_item=excluded.valor_bruto_item,
        preco_por_tonelada=excluded.preco_por_tonelada
      WHERE commercial_invoice_items.erp_hash<>excluded.erp_hash`).bind(
        item.id, item.filial, item.documento, item.serie, item.dataEmissao, item.codigoCliente,
        item.lojaCliente, item.cliente, item.cnpjCliente, item.cidade, item.uf, item.codigoVendedor,
        item.vendedor, item.pedido, item.itemPedido, item.itemNota, item.codigoProduto, item.produto,
        item.quantidade, item.precoUnitario, item.valorItem, item.desconto, item.freteNota, item.seguroNota,
        item.despesasNota, item.ipiNota, item.icmsNota, item.valorBrutoNota, item.valorMercadoriaNota,
        item.valorFaturadoNota, item.tipoNota, item.dataCancelamento, item.tes, item.cfop,
        item.percentualComissao, item.comissaoEstimada, erpHash, now, now, item.condicaoPagamento,
        item.condicaoDescricao, item.prazosPagamento, item.mediaPagamentoDias, item.produtoBase,
        item.valorTotalNf, item.valorBrutoItem, item.precoPorTonelada,
      );
    });
    const results = await env.DB.batch(statements);
    changed += results.reduce((sum, result) => sum + Number(result.meta?.changes || 0), 0);
  }
  return { received: invoices.length, unique: unique.length, changed };
}

function validMonth(month) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

function validDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const parsed = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}

function monthRange(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return { from: `${month}-01`, to: `${month}-${String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, "0")}` };
}

function allowed(user) {
  return ["admin", "diretoria", "comercial"].includes(user?.role);
}

async function recordSync(env, status, startedAt, rows = 0, changed = 0, message = null) {
  await env.DB.prepare(`INSERT INTO sync_runs
    (source, status, rows_received, rows_changed, error_message, started_at, finished_at)
    VALUES ('totvs-billing', ?, ?, ?, ?, ?, ?)`)
    .bind(status, rows, changed, message, startedAt, new Date().toISOString()).run();
}

export async function syncCommercialBilling(env, actor = null, options = {}) {
  const startedAt = new Date().toISOString();
  const month = text(options.month) || startedAt.slice(0, 7);
  const day = text(options.day);
  if (!validMonth(month)) throw new Error("Mes comercial invalido");
  if (day && (!validDay(day) || !day.startsWith(`${month}-`))) throw new Error("Dia comercial invalido");

  const staleBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const lockToken = crypto.randomUUID();
  const lock = await env.DB.prepare(`INSERT INTO app_state (id, value, updated_at, updated_by)
    VALUES ('forestpaper:commercial-sync-lock', ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by
    WHERE app_state.updated_at < ?`).bind(lockToken, startedAt, actor?.name || "Cloudflare Cron", staleBefore).run();
  if (!Number(lock.meta?.changes || 0)) return { received: 0, changed: 0, inProgress: true, updatedAt: startedAt };

  try {
    const [billingResult, orderResult] = await Promise.all([
      fetchProtheusBilling(env, { month, day }),
      fetchProtheusSalesOrders(env, { month, day, includeInvoiced: true, commercial: true }),
    ]);
    const invoices = allocateInvoiceTotals(billingResult.rows.map(invoiceFromRow).filter((item) => (
      item && !item.dataCancelamento && !["D", "B"].includes(item.tipoNota.toUpperCase())
    )));
    const orders = orderResult.rows.map(orderFromRow).filter(Boolean);
    const range = day ? { from: day, to: day } : monthRange(month);
    await env.DB.prepare("DELETE FROM commercial_invoice_items WHERE data_emissao >= ? AND data_emissao <= ?")
      .bind(range.from, range.to).run();
    const [invoiceWrite, orderWrite] = await Promise.all([upsertInvoices(env, invoices), upsertOrders(env, orders)]);
    const received = invoices.length + orders.length;
    const changed = invoiceWrite.changed + orderWrite.changed;
    const source = {
      name: "TOTVS Protheus · SC5/SC6 e SF2/SD2",
      month, day, checkedAt: new Date().toISOString(),
      billingRows: invoices.length, orderRows: orders.length,
      pages: Number(billingResult.pages || 0) + Number(orderResult.pages || 0),
      warnings: [billingResult.enrichmentWarning, orderResult.enrichmentWarning].filter(Boolean),
    };
    await env.DB.prepare(`INSERT INTO app_state (id, value, updated_at, updated_by)
      VALUES ('forestpaper:commercial-sync-source', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by`)
      .bind(JSON.stringify(source), source.checkedAt, actor?.identityHash || "system").run();
    await recordSync(env, "success", startedAt, received, changed, null);
    return { received, changed, invoices: invoices.length, orders: orders.length, updatedAt: source.checkedAt, source };
  } catch (error) {
    await recordSync(env, "error", startedAt, 0, 0, String(error?.message || error).slice(0, 500));
    throw error;
  } finally {
    await env.DB.prepare("DELETE FROM app_state WHERE id='forestpaper:commercial-sync-lock' AND value=?")
      .bind(lockToken).run();
  }
}

function parseFilter(url, name, maximum = 5000) {
  const raw = text(url.searchParams.get(name) || "all");
  if (raw === "all" || !raw) return { mode: "all", values: [] };
  if (raw === "__none__") return { mode: "none", values: [] };
  const [prefix, payload = ""] = raw.split(":", 2);
  const values = [...new Set(payload.split(",").map(text).filter(Boolean))].slice(0, maximum);
  return { mode: prefix === "exclude" ? "exclude" : "include", values };
}

function expandBranches(filter) {
  if (filter.mode === "all" || filter.mode === "none") return filter;
  const values = new Set(filter.values);
  if (values.has("010101")) values.add("040101");
  return { ...filter, values: [...values] };
}

function addFilter(conditions, bindings, column, filter) {
  if (filter.mode === "none") { conditions.push("1=0"); return; }
  if (filter.mode === "all" || !filter.values.length) return;
  conditions.push(`${column} ${filter.mode === "exclude" ? "NOT IN" : "IN"} (SELECT CAST(value AS TEXT) FROM json_each(?))`);
  bindings.push(JSON.stringify(filter.values));
}

function addCustomerFilter(conditions, bindings, filter) {
  if (filter.mode === "none") { conditions.push("1=0"); return; }
  if (filter.mode === "all" || !filter.values.length) return;
  conditions.push(`(COALESCE(codigo_cliente,'')||'|'||COALESCE(loja_cliente,'')) ${filter.mode === "exclude" ? "NOT IN" : "IN"} (SELECT CAST(value AS TEXT) FROM json_each(?))`);
  bindings.push(JSON.stringify(filter.values));
}

function hiddenCustomer(row) {
  return HIDDEN_FOREST_GROUP_CNPJS.has(taxId(row?.cnpj_cliente)) || text(row?.cliente).toUpperCase().includes("ONZE");
}

function invoiceSummary(items) {
  const invoices = new Map();
  for (const item of items) {
    const key = `${item.filial}|${item.documento}|${item.serie}`;
    invoices.set(key, Math.max(numeric(invoices.get(key)), numeric(item.valor_total_nf || item.valor_faturado_nota || item.valor_bruto_nota)));
  }
  return { count: invoices.size, value: [...invoices.values()].reduce((sum, item) => sum + item, 0) };
}

function firstOrders(rows, limit = 30) {
  const keys = new Set();
  return rows.filter((row) => {
    const key = `${row.filial}|${row.pedido}`;
    if (keys.has(key)) return true;
    if (keys.size >= limit) return false;
    keys.add(key); return true;
  });
}

async function listCommercial(request, env, user) {
  if (!allowed(user)) return json({ error: "commercial_access_required" }, 403);
  const url = new URL(request.url);
  const now = new Date();
  const defaultMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const month = text(url.searchParams.get("month")) || defaultMonth;
  const day = text(url.searchParams.get("day"));
  if (!validMonth(month)) return json({ error: "invalid_month" }, 400);
  if (day && (!validDay(day) || !day.startsWith(`${month}-`))) return json({ error: "invalid_day" }, 400);
  const range = day ? { from: day, to: day } : monthRange(month);
  const branches = expandBranches(parseFilter(url, "branches", 20));
  const payments = parseFilter(url, "payments");
  const customers = parseFilter(url, "customers");
  const search = text(url.searchParams.get("search")).slice(0, 100);

  const base = ["data_emissao>=?", "data_emissao<=?", "COALESCE(TRIM(condicao_pagamento),'')<>'32'"];
  const bindings = [range.from, range.to];
  addFilter(base, bindings, "filial", branches); addFilter(base, bindings, "condicao_pagamento", payments);
  addCustomerFilter(base, bindings, customers);
  if (search) {
    base.push("(documento LIKE ? OR pedido LIKE ? OR codigo_cliente LIKE ? OR cliente LIKE ? OR codigo_produto LIKE ? OR produto LIKE ?)");
    bindings.push(...Array(6).fill(`%${search}%`));
  }
  const invoicesResult = await env.DB.prepare(`SELECT * FROM commercial_invoice_items WHERE ${base.join(" AND ")} ORDER BY data_emissao DESC,documento,serie,item_nota LIMIT 10000`).bind(...bindings).all();
  const allInvoices = invoicesResult.results;
  const regularInvoices = allInvoices.filter((row) => !text(row.cliente).toUpperCase().includes("KLABIN"));
  const industrialInvoices = allInvoices.filter((row) => text(row.cliente).toUpperCase().includes("KLABIN"));
  const visibleInvoices = regularInvoices.filter((row) => !hiddenCustomer(row));
  const hiddenInvoices = regularInvoices.filter(hiddenCustomer);

  const orderBase = ["data_emissao>=?", "data_emissao<=?", "COALESCE(TRIM(condicao_pagamento),'')<>'32'"];
  const orderBindings = [range.from, range.to];
  addFilter(orderBase, orderBindings, "filial", branches); addFilter(orderBase, orderBindings, "condicao_pagamento", payments);
  addCustomerFilter(orderBase, orderBindings, customers);
  if (search) {
    orderBase.push("(pedido LIKE ? OR codigo_cliente LIKE ? OR cliente LIKE ? OR codigo_produto LIKE ? OR produto LIKE ?)");
    orderBindings.push(...Array(5).fill(`%${search}%`));
  }
  const ordersResult = await env.DB.prepare(`SELECT id,filial,pedido,item,data_emissao,codigo_cliente,loja_cliente,cliente,cnpj_cliente,codigo_produto,produto,produto_base,unidade,quantidade,preco_unitario,valor_total,volume,data_embarque,tipo_frete,quantidade_entregue,tes,vendedor AS codigo_vendedor,vendedor_nome,condicao_pagamento,condicao_descricao,prazos_pagamento,media_pagamento_dias,nota_fiscal,serie_nota FROM orders WHERE ${orderBase.join(" AND ")} ORDER BY data_emissao DESC,filial,pedido,item LIMIT 10000`).bind(...orderBindings).all();
  const allOrders = ordersResult.results;
  const regularOrders = allOrders.filter((row) => !text(row.cliente).toUpperCase().includes("KLABIN"));
  const industrialOrders = allOrders.filter((row) => text(row.cliente).toUpperCase().includes("KLABIN"));
  const visibleOrders = regularOrders.filter((row) => !hiddenCustomer(row));
  const hiddenOrders = regularOrders.filter(hiddenCustomer);
  const orderKeys = new Set(visibleOrders.map((row) => `${row.filial}|${row.pedido}`));

  const portfolioResult = await env.DB.prepare(`SELECT id,filial,pedido,item,data_emissao,codigo_cliente,loja_cliente,cliente,cnpj_cliente,codigo_produto,produto,produto_base,unidade,quantidade,quantidade_entregue,valor_total,volume,data_embarque,tipo_frete,tes,vendedor AS codigo_vendedor,vendedor_nome,condicao_pagamento,condicao_descricao FROM orders WHERE quantidade>quantidade_entregue AND COALESCE(TRIM(condicao_pagamento),'')<>'32' ORDER BY data_emissao DESC,filial,pedido DESC,item LIMIT 5000`).all();
  const allPortfolio = portfolioResult.results;
  const portfolio = firstOrders(allPortfolio.filter((row) => !text(row.cliente).toUpperCase().includes("KLABIN") && !hiddenCustomer(row)));

  const optionRows = [...allInvoices, ...allOrders];
  const customerOptions = new Map(); const paymentOptions = new Map();
  for (const row of optionRows) {
    if (hiddenCustomer(row) || text(row.cliente).toUpperCase().includes("KLABIN")) continue;
    const customer = text(row.codigo_cliente); const store = text(row.loja_cliente);
    const payment = text(row.condicao_pagamento);
    if (customer) customerOptions.set(`${customer}|${store}`, text(row.cliente) || customer);
    if (payment && payment !== "32") paymentOptions.set(payment, text(row.condicao_descricao) || payment);
  }
  const industrialSummary = invoiceSummary(industrialInvoices);
  const lastSync = await env.DB.prepare("SELECT status,rows_received,rows_changed,error_message,finished_at FROM sync_runs WHERE source='totvs-billing' AND status<>'running' ORDER BY id DESC LIMIT 1").first();
  const sourceRow = await env.DB.prepare("SELECT value FROM app_state WHERE id='forestpaper:commercial-sync-source'").first();
  let source = null; try { source = JSON.parse(sourceRow?.value || "null"); } catch { source = null; }
  const branchMap = new Map();
  for (const row of visibleOrders) {
    const key = row.filial || ""; const current = branchMap.get(key) || { filial: key, pedidos: new Set(), valor: 0, toneladas: 0 };
    current.pedidos.add(row.pedido); current.valor += numeric(row.valor_total); current.toneladas += numeric(row.quantidade); branchMap.set(key, current);
  }
  return json({
    items: visibleInvoices,
    filters: { month, day, from: range.from, to: range.to, branches, payments, customers, search },
    filterOptions: {
      customers: [...customerOptions].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
      payments: [...paymentOptions].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    },
    salesOrders: {
      count: orderKeys.size,
      value: visibleOrders.reduce((sum, row) => sum + numeric(row.valor_total), 0),
      tonnes: visibleOrders.reduce((sum, row) => sum + numeric(row.quantidade), 0),
    },
    salesOrderItems: visibleOrders,
    portfolioItems: portfolio,
    exportData: { hiddenItems: hiddenInvoices, hiddenSalesOrderItems: hiddenOrders, portfolioItems: allPortfolio },
    branchTotals: [...branchMap.values()].map((row) => ({ ...row, pedidos: row.pedidos.size })),
    industrialization: {
      orders: industrialOrders, invoices: industrialInvoices,
      summary: {
        orders: new Set(industrialOrders.map((row) => `${row.filial}|${row.pedido}`)).size,
        orderValue: industrialOrders.reduce((sum, row) => sum + numeric(row.valor_total), 0),
        tonnes: industrialOrders.reduce((sum, row) => sum + numeric(row.quantidade), 0),
        invoices: industrialSummary.count, billing: industrialSummary.value,
        invoiceTonnes: industrialInvoices.reduce((sum, row) => sum + numeric(row.quantidade), 0),
      },
    },
    updatedAt: lastSync?.finished_at || null, sync: lastSync || null, source,
  });
}

export async function handleCommercialRequest(request, env, user) {
  const url = new URL(request.url);
  if (url.pathname === "/api/commercial" && request.method === "GET") return listCommercial(request, env, user);
  if (url.pathname === "/api/commercial/sync" && request.method === "POST") {
    if (!allowed(user)) return json({ error: "commercial_access_required" }, 403);
    try {
      return json(await syncCommercialBilling(env, user, {
        month: url.searchParams.get("month"), day: url.searchParams.get("day"),
      }));
    } catch (error) {
      return json({ error: "sync_failed", message: String(error?.message || error) }, 502);
    }
  }
  return json({ error: "not_found" }, 404);
}
