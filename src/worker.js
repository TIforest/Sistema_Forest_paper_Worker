import * as XLSX from "xlsx";
import { handleCommercialRequest, syncCommercialBilling } from "./commercial.js";
import { handleFinanceRequest, syncFinanceCache } from "./finance.js";
import { fetchProtheusSalesOrders } from "./protheus.js";
import { handleOperatorsAdminRequest, handleManualPayablesRequest } from "./admin.js";
import { handleAnalyticsRequest } from "./analytics.js";
import { handleUsageRequest, recordUsage, purgeOldUsage } from "./usage.js";
import { auditAccess } from "./access-audit.js";
import { dailyDigest, purgeOldAudit } from "./alerts.js";
import { currentOperator, handleOperatorAuth } from "./operator.js";
import { appendQualityRow, qualityWorkbookStatus, GraphError } from "./graph-excel.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

const STATE_KEYS = new Set([
  "forestpaper:apontamentos",
  "forestpaper:maquinas",
]);

const ROLE_TRANSITIONS = {
  producao: new Set(["Em produção", "Aguardando qualidade", "Correção na produção"]),
  qualidade: new Set(["Em inspeção", "Liberado ao cliente", "Correção na produção"]),
  diretoria: new Set(),
};

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

function text(value, status = 200) {
  return new Response(value, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function userHasRole(user, role) {
  return user?.role === role || (Array.isArray(user?.roles) && user.roles.includes(role));
}

/**
 * Papel de producao, incluindo quem e admin.
 *
 * `userHasRole` casa por igualdade exata: uma conta admin nao satisfaz
 * "producao" e recebia 403 ao sincronizar ou gravar pedidos, mesmo tendo
 * acesso a tudo. O guard de /operador/api/state ja tratava admin como
 * acumulativo; isto alinha as rotas de producao ao mesmo criterio.
 */
function canManageProduction(user) {
  return userHasRole(user, "producao") || userHasRole(user, "admin");
}

/** Quem apontar qualidade tambem grava na planilha oficial (admin acumula). */
function canRecordQuality(user) {
  return userHasRole(user, "qualidade") || userHasRole(user, "admin");
}

function normalizeHeader(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function valueByAliases(row, aliases) {
  const indexed = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]),
  );
  for (const alias of aliases) {
    const value = indexed[normalizeHeader(alias)];
    if (value !== undefined && value !== null && normalizeText(value) !== "") return value;
  }
  return "";
}

function numberValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const cleaned = normalizeText(value)
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".")
    .replace(/[^0-9.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateValue(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = normalizeText(value);
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  return raw;
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function currentUser(request, env) {
  let email = normalizeText(request.headers.get("Cf-Access-Authenticated-User-Email")).toLowerCase();
  if (!email && env.ENVIRONMENT !== "production") {
    email = normalizeText(env.DEV_USER_EMAIL).toLowerCase();
  }
  if (!email) return null;
  const identityHash = await sha256(email);
  const profile = await env.DB.prepare(
    `SELECT display_name, role, access_roles
       FROM user_roles
      WHERE identity_hash = ? AND active = 1`,
  ).bind(identityHash).first();
  if (!profile) return null;
  let roles;
  try { roles = JSON.parse(profile.access_roles || "[]"); } catch { roles = []; }
  if (!Array.isArray(roles) || !roles.length) roles = [profile.role];
  return {
    identityHash,
    name: profile.display_name,
    role: profile.role,
    roles,
  };
}

async function requireUser(request, env) {
  const user = await currentUser(request, env);
  if (!user) {
    return { response: json({ error: "access_denied", message: "Perfil corporativo nao cadastrado." }, 403) };
  }
  return { user };
}

async function audit(env, user, action, entityType, entityId, details = {}) {
  await env.DB.prepare(
    `INSERT INTO audit_log
      (actor_hash, actor_name, actor_role, action, entity_type, entity_id, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    user?.identityHash || "system",
    user?.name || "Cloudflare Cron",
    user?.role || "sistema",
    action,
    entityType,
    entityId || "",
    JSON.stringify(details),
    new Date().toISOString(),
  ).run();
}

function orderFromRow(row) {
  const filial = normalizeText(valueByAliases(row, ["filial", "c5_filial"]));
  const pedido = normalizeText(valueByAliases(row, [
    "pedido", "pedido de venda", "numero pedido", "numero pedido venda", "c5_num", "op", "c2_num",
  ]));
  const item = normalizeText(valueByAliases(row, ["item", "c6_item"]));
  const codigoProduto = normalizeText(valueByAliases(row, ["cod produto", "codigo produto", "c6_produto"]));
  if (!pedido) return null;
  return {
    id: [filial || "sem-filial", pedido, item || codigoProduto || "item"].join("-"),
    filial,
    pedido,
    item,
    dataEmissao: dateValue(valueByAliases(row, ["data emissao", "c5_emissao"])),
    codigoCliente: normalizeText(valueByAliases(row, ["cod cliente", "codigo cliente", "c5_cliente"])),
    lojaCliente: normalizeText(valueByAliases(row, ["loja cliente", "c5_lojacli"])),
    cliente: normalizeText(valueByAliases(row, ["cliente", "nome cliente", "razao social", "a1_nome"])),
    cidade: normalizeText(valueByAliases(row, ["cidade", "a1_mun"])),
    uf: normalizeText(valueByAliases(row, ["uf", "a1_est"])),
    codigoProduto,
    produto: normalizeText(valueByAliases(row, ["produto", "descricao produto", "descricao", "b1_desc"])),
    unidade: normalizeText(valueByAliases(row, ["unidade", "c6_unsven"])),
    quantidade: numberValue(valueByAliases(row, ["quantidade", "qtd", "c6_qtdven", "c2_quant"])),
    precoUnitario: numberValue(valueByAliases(row, ["preco unitario", "c6_prcven"])),
    valorTotal: numberValue(valueByAliases(row, ["valor total item", "valor total", "valor", "c6_valor"])),
    tes: normalizeText(valueByAliases(row, ["tes", "c6_tes"])),
    vendedor: normalizeText(valueByAliases(row, ["cod vendedor", "vendedor", "c5_vend1"])),
    condicaoPagamento: normalizeText(valueByAliases(row, ["condicao pagamento", "c5_condpag"])),
    tipoPedido: normalizeText(valueByAliases(row, ["tipo pedido", "c5_tipo"])),
    notaFiscal: normalizeText(valueByAliases(row, ["nota fiscal", "c5_nota"])),
    serieNota: normalizeText(valueByAliases(row, ["serie nota", "c5_serie"])),
  };
}

async function upsertOrders(env, orders, source = "excel") {
  const now = new Date().toISOString();
  let changed = 0;
  for (let offset = 0; offset < orders.length; offset += 80) {
    const statements = [];
    for (const order of orders.slice(offset, offset + 80)) {
      const erpHash = await sha256(JSON.stringify(order));
      statements.push(
        env.DB.prepare(
          `INSERT INTO orders (
            id, filial, pedido, item, data_emissao, codigo_cliente, loja_cliente,
            cliente, cidade, uf, codigo_produto, produto, unidade, quantidade,
            preco_unitario, valor_total, tes, vendedor, condicao_pagamento,
            tipo_pedido, nota_fiscal, serie_nota, workflow_status, erp_hash,
            source, source_updated_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Aguardando', ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            filial = excluded.filial,
            pedido = excluded.pedido,
            item = excluded.item,
            data_emissao = excluded.data_emissao,
            codigo_cliente = excluded.codigo_cliente,
            loja_cliente = excluded.loja_cliente,
            cliente = excluded.cliente,
            cidade = excluded.cidade,
            uf = excluded.uf,
            codigo_produto = excluded.codigo_produto,
            produto = excluded.produto,
            unidade = excluded.unidade,
            quantidade = excluded.quantidade,
            preco_unitario = excluded.preco_unitario,
            valor_total = excluded.valor_total,
            tes = excluded.tes,
            vendedor = excluded.vendedor,
            condicao_pagamento = excluded.condicao_pagamento,
            tipo_pedido = excluded.tipo_pedido,
            nota_fiscal = excluded.nota_fiscal,
            serie_nota = excluded.serie_nota,
            erp_hash = excluded.erp_hash,
            source = excluded.source,
            source_updated_at = excluded.source_updated_at,
            updated_at = excluded.updated_at
          WHERE orders.erp_hash <> excluded.erp_hash`,
        ).bind(
          order.id, order.filial, order.pedido, order.item, order.dataEmissao,
          order.codigoCliente, order.lojaCliente, order.cliente, order.cidade,
          order.uf, order.codigoProduto, order.produto, order.unidade,
          order.quantidade, order.precoUnitario, order.valorTotal, order.tes,
          order.vendedor, order.condicaoPagamento, order.tipoPedido,
          order.notaFiscal, order.serieNota, erpHash, source, now, now,
        ),
      );
    }
    const results = await env.DB.batch(statements);
    changed += results.reduce((sum, result) => sum + Number(result.meta?.changes || 0), 0);
  }
  return { received: orders.length, changed, updatedAt: now };
}

/**
 * Sincroniza os pedidos de producao direto do Protheus (SC5/SC6).
 *
 * Substitui o antigo `syncFromMicrosoft`, que baixava uma planilha do Excel via
 * Microsoft Graph e parou em 03/08/2026, quando o GRAPH_FILE_PATH saiu do ar. A
 * tela sempre anunciou "pedidos pendentes de SC5 e SC6", mas quem consultava o
 * Protheus era so o modulo Comercial - a producao nunca chegava la.
 *
 * `includeInvoiced: false` e o que aplica o filtro de pendentes (C5_NOTA vazio
 * ou iniciando em X), entao o que entra no D1 e exatamente o que a tela promete.
 */
async function syncFromProtheus(env, actor = null) {
  const startedAt = new Date().toISOString();
  const run = await env.DB.prepare(
    `INSERT INTO sync_runs (source, status, started_at) VALUES ('totvs-orders', 'running', ?) RETURNING id`,
  ).bind(startedAt).first();
  try {
    const protheus = await fetchProtheusSalesOrders(env, { includeInvoiced: false });
    // orderFromRow ja aceita os nomes de coluna do Protheus como alias
    // (c5_num, c6_item, a1_nome, b1_desc...), entao as linhas enriquecidas
    // entram sem tradutor proprio.
    const orders = protheus.rows.map(orderFromRow).filter(Boolean);
    // Zero pendentes e estado legitimo (tudo faturado), nao erro. O caminho do
    // Excel lancava excecao aqui porque planilha vazia significava leitura falha.
    const result = await upsertOrders(env, orders, "totvs-protheus");
    await env.DB.prepare(
      `UPDATE sync_runs
          SET status = 'success', rows_received = ?, rows_changed = ?, finished_at = ?
        WHERE id = ?`,
    ).bind(result.received, result.changed, result.updatedAt, run.id).run();
    await audit(env, actor, "sync_success", "protheus", "SC5,SC6", result);
    return {
      ...result,
      eligible: orders.length,
      source: { name: "TOTVS Protheus", tables: "SC5,SC6" },
      enrichedAliases: protheus.enrichedAliases,
      enrichmentWarning: protheus.enrichmentWarning,
    };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE sync_runs SET status = 'error', error_message = ?, finished_at = ? WHERE id = ?`,
    ).bind(String(error.message || error).slice(0, 500), finishedAt, run.id).run();
    await audit(env, actor, "sync_error", "protheus", "SC5,SC6", { message: error.message });
    throw error;
  }
}

// Campos comerciais de /api/orders. `cliente` fica de fora desta lista de
// proposito: producao e qualidade exibem o nome do cliente nas telas de fila
// (pedidosAguardando, filaQualidade) para saber de quem e a carga em maquina.
const COMMERCIAL_ORDER_FIELDS = ["precoUnitario", "valorCarga", "vendedor", "condicaoPagamento"];

// Diretoria e admin entram junto de comercial/financeiro porque o Dashboard da
// Diretoria soma valorCarga para os totais por etapa; sem o campo, os quatro
// cartoes de valor zeram.
const COMMERCIAL_DATA_ROLES = ["comercial", "financeiro", "diretoria", "admin"];

function canSeeCommercialOrderData(user) {
  return COMMERCIAL_DATA_ROLES.some((role) => userHasRole(user, role));
}

/**
 * Remove os campos comerciais para quem nao tem setor que os justifique.
 *
 * Omite a chave em vez de enviar null: o normalizador do front-end coage
 * `Number(valor || 0)`, entao um null viraria "R$ 0,00" na tela — indistinguivel
 * de uma carga sem valor cadastrado.
 */
function projectOrdersForUser(payload, user) {
  if (canSeeCommercialOrderData(user)) return payload;
  return {
    ...payload,
    orders: payload.orders.map((order) => {
      const visible = { ...order };
      for (const field of COMMERCIAL_ORDER_FIELDS) delete visible[field];
      return visible;
    }),
  };
}

async function listOrders(env) {
  const result = await env.DB.prepare(
    `SELECT id, filial, pedido, item, data_emissao, codigo_cliente, loja_cliente,
            cliente, cidade, uf, codigo_produto, produto, unidade, quantidade,
            preco_unitario, valor_total, tes, vendedor, condicao_pagamento,
            tipo_pedido, nota_fiscal, serie_nota, workflow_status, maquina,
            iniciado_em, iniciado_por, producao_concluida_em,
            qualidade_iniciada_em, qualidade_por, liberado_em, liberado_por,
            rejeitado_em, updated_at
       FROM orders
      ORDER BY data_emissao DESC, pedido, item
      LIMIT 5000`,
  ).all();
  const orders = result.results.map((row) => ({
    id: row.id,
    filial: row.filial,
    numeroOP: row.pedido,
    item: row.item,
    dataEmissao: row.data_emissao,
    codigoCliente: row.codigo_cliente,
    lojaCliente: row.loja_cliente,
    cliente: row.cliente,
    cidade: row.cidade,
    uf: row.uf,
    codigoProduto: row.codigo_produto,
    produto: row.produto,
    unidade: row.unidade,
    quantidade: row.quantidade,
    precoUnitario: row.preco_unitario,
    valorCarga: row.valor_total,
    tes: row.tes,
    vendedor: row.vendedor,
    condicaoPagamento: row.condicao_pagamento,
    tipoPedido: row.tipo_pedido,
    notaFiscal: row.nota_fiscal,
    serieNota: row.serie_nota,
    status: row.workflow_status,
    maquina: row.maquina,
    iniciadoEm: row.iniciado_em,
    iniciadoPor: row.iniciado_por,
    producaoConcluidaEm: row.producao_concluida_em,
    qualidadeIniciadaEm: row.qualidade_iniciada_em,
    qualidadePor: row.qualidade_por,
    liberadoEm: row.liberado_em,
    liberadoPor: row.liberado_por,
    qualidadeReprovadaEm: row.rejeitado_em,
    updatedAt: row.updated_at,
  }));
  const lastSync = await env.DB.prepare(
    `SELECT status, rows_received, rows_changed, error_message, finished_at
       FROM sync_runs ORDER BY id DESC LIMIT 1`,
  ).first();
  return { orders, updatedAt: lastSync?.finished_at || null, sync: lastSync || null };
}

async function updateOrder(request, env, user, id) {
  if (userHasRole(user, "diretoria") && user.roles.length === 1) return json({ error: "read_only" }, 403);
  const body = await request.json();
  const requestedStatus = normalizeText(body.status);
  const allowed = new Set((user.roles || [user.role]).flatMap(role => [...(ROLE_TRANSITIONS[role] || [])]));
  const status = [...allowed].find((value) => normalizeHeader(value) === normalizeHeader(requestedStatus));
  if (requestedStatus && !status) return json({ error: "invalid_transition" }, 403);
  const current = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();
  if (!current) return json({ error: "order_not_found" }, 404);
  if (user.isOperator && normalizeText(current.maquina) !== normalizeText(user.machine)) {
    return json({ error: "order_not_assigned_to_operator_machine" }, 403);
  }
  if (user.isOperator && body.maquina !== undefined && normalizeText(body.maquina) !== normalizeText(user.machine)) {
    return json({ error: "order_not_assigned_to_operator_machine" }, 403);
  }
  const now = new Date().toISOString();
  const next = {
    status: status || current.workflow_status,
    maquina: body.maquina !== undefined ? normalizeText(body.maquina) : current.maquina,
    iniciadoEm: body.iniciadoEm !== undefined ? body.iniciadoEm : current.iniciado_em,
    iniciadoPor: body.iniciadoPor !== undefined ? user.name : current.iniciado_por,
    producaoConcluidaEm: body.producaoConcluidaEm !== undefined ? body.producaoConcluidaEm : current.producao_concluida_em,
    qualidadeIniciadaEm: body.qualidadeIniciadaEm !== undefined ? body.qualidadeIniciadaEm : current.qualidade_iniciada_em,
    qualidadePor: body.qualidadePor !== undefined ? user.name : current.qualidade_por,
    liberadoEm: body.liberadoEm !== undefined ? body.liberadoEm : current.liberado_em,
    liberadoPor: body.liberadoPor !== undefined ? user.name : current.liberado_por,
    rejeitadoEm: body.qualidadeReprovadaEm !== undefined ? body.qualidadeReprovadaEm : current.rejeitado_em,
  };
  await env.DB.prepare(
    `UPDATE orders SET
      workflow_status = ?, maquina = ?, iniciado_em = ?, iniciado_por = ?,
      producao_concluida_em = ?, qualidade_iniciada_em = ?, qualidade_por = ?,
      liberado_em = ?, liberado_por = ?, rejeitado_em = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(
    next.status, next.maquina, next.iniciadoEm, next.iniciadoPor,
    next.producaoConcluidaEm, next.qualidadeIniciadaEm, next.qualidadePor,
    next.liberadoEm, next.liberadoPor, next.rejeitadoEm, now, id,
  ).run();
  await audit(env, user, "workflow_update", "order", id, { from: current.workflow_status, to: next.status });
  return json({ ok: true, id, status: next.status, updatedAt: now });
}

async function operatorApi(request, env, ctx) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  // Login e logout decidem acesso por conta propria (tablet e PIN) e nao passam
  // pelo guard de sessao abaixo, entao sao auditados aqui.
  const authResponse = await handleOperatorAuth(request, env, url);
  if (authResponse) {
    auditAccess(ctx, env, request, authResponse);
    return authResponse;
  }

  const user = await currentOperator(request, env);
  if (!user) {
    const denied = json({ error: "operator_session_required" }, 401);
    auditAccess(ctx, env, request, denied);
    return denied;
  }

  let response;
  try {
    // Roteamento envolvido para que a resposta final passe por um unico ponto de
    // auditoria, sem reescrever cada `return` do bloco.
    response = await (async () => {
      if (url.pathname === "/operador/api/me" && request.method === "GET") {
        return json({ name: user.name, role: user.role, roles: user.roles || [user.role], machine: user.machine });
      }
      if (url.pathname === "/operador/api/orders" && request.method === "GET") {
        const result = await listOrders(env);
        result.orders = result.orders.filter((order) => normalizeText(order.maquina) === normalizeText(user.machine));
        // Mesmo recorte da rota corporativa: o operador tem papel producao, e o
        // tablet do chao de fabrica nao deve exibir tabela de precos.
        return json(projectOrdersForUser(result, user));
      }
      if (url.pathname.startsWith("/operador/api/orders/") && request.method === "PATCH") {
        return updateOrder(request, env, user, decodeURIComponent(url.pathname.slice("/operador/api/orders/".length)));
      }
      if (url.pathname.startsWith("/operador/api/state/") && request.method === "GET") {
        return stateRoute(request, env, user, decodeURIComponent(url.pathname.slice("/operador/api/state/".length)));
      }
      return json({ error: "not_found" }, 404);
    })();
  } catch (error) {
    console.error(JSON.stringify({
      event: "operator_api_error",
      path: url.pathname,
      message: String(error?.message || error).slice(0, 240),
    }));
    response = json({ error: "internal_error", message: "Nao foi possivel concluir a operacao." }, 500);
  }
  auditAccess(ctx, env, request, response);
  return response;
}

const RECORDS_STATE_KEY = "forestpaper:apontamentos";

// Campos gerenciados pelo sistema ou preenchidos a mao pelo inspetor. Uma
// gravacao so pode preenche-los quando ainda estao vazios no banco; nunca
// sobrescreve nem limpa um valor ja existente.
const PROTECTED_RECORD_FIELDS = new Set([
  "status", "motivoStatus", "desvioEncontrado", "observacoes", "liberado",
  "amostragemConcluida", "inspetor", "criadoEm", "qtdAvaliada",
]);

function blankValue(value) {
  return value === undefined || value === null || value === "";
}

function recordKey(item) {
  const id = String(item?.id ?? "").trim();
  return id || null;
}

function parseRecordList(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// UPSERT nao destrutivo de um apontamento: campos vazios que chegam nunca
// apagam o que ja existe e campos protegidos so sao preenchidos uma vez.
function mergeRecord(current, incoming) {
  const merged = { ...current };
  for (const [field, value] of Object.entries(incoming || {})) {
    if (value === undefined) continue;
    if (PROTECTED_RECORD_FIELDS.has(field)) {
      if (blankValue(merged[field])) merged[field] = value;
      continue;
    }
    if (blankValue(value) && !blankValue(merged[field])) continue;
    merged[field] = value;
  }
  return merged;
}

// A carga enviada pelo navegador atualiza e insere, mas nunca remove: um
// apontamento que ja esta no banco e nao veio nesta chamada e preservado.
function mergeRecordList(current, incoming) {
  const byId = new Map();
  const order = [];
  const keep = [];
  for (const item of current) {
    const id = recordKey(item);
    if (!id) { keep.push(item); continue; }
    if (!byId.has(id)) order.push(id);
    byId.set(id, item);
  }
  let created = 0;
  let updated = 0;
  for (const item of incoming) {
    const id = recordKey(item);
    if (!id) continue;
    if (byId.has(id)) {
      byId.set(id, mergeRecord(byId.get(id), item));
      updated += 1;
    } else {
      byId.set(id, item);
      order.push(id);
      created += 1;
    }
  }
  return { records: [...keep, ...order.map((id) => byId.get(id))], created, updated };
}

async function mergeStateRecords(request, env, user, key, incoming) {
  if (!Array.isArray(incoming)) return json({ error: "invalid_state_merge" }, 400);
  if (incoming.length > 500) return json({ error: "state_merge_too_large" }, 400);
  const row = await env.DB.prepare("SELECT value FROM app_state WHERE id = ?").bind(key).first();
  const current = parseRecordList(row?.value);
  const result = mergeRecordList(current, incoming);
  const serialized = JSON.stringify(result.records);
  if (serialized.length > 2_000_000) return json({ error: "invalid_state_value" }, 400);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO app_state (id, value, updated_at, updated_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ).bind(key, serialized, now, user.identityHash).run();
  await audit(env, user, "state_merge", "state", key, {
    created: result.created, updated: result.updated, kept: current.length, total: result.records.length,
  });
  return json({
    ok: true, updatedAt: now, value: serialized,
    created: result.created, updated: result.updated, total: result.records.length,
  });
}

async function stateRoute(request, env, user, key) {
  if (!STATE_KEYS.has(key)) return json({ error: "state_key_not_allowed" }, 404);
  if (request.method === "GET") {
    // Os apontamentos sao as inspecoes da Qualidade: mesmo recorte do PUT.
    // forestpaper:maquinas fica legivel por qualquer perfil ativo — e lista de
    // nomes de equipamento, nao dado sensivel, e restringir produziria 403 no
    // boot de comercial, financeiro e diretoria, poluindo o log de auditoria.
    if (key === RECORDS_STATE_KEY
      && !(userHasRole(user, "admin") || userHasRole(user, "qualidade"))) {
      return json({ error: "forbidden" }, 403);
    }
    const row = await env.DB.prepare("SELECT value, updated_at FROM app_state WHERE id = ?").bind(key).first();
    return json({ value: row?.value || null, updatedAt: row?.updated_at || null });
  }
  if (request.method !== "PUT") return json({ error: "method_not_allowed" }, 405);
  // O painel libera todas as abas para admin (configureAccess no app.html). Sem
  // o admin aqui, o inspetor administrador preenchia o formulario, via o
  // apontamento na tela e perdia o registro no 403 da gravacao.
  const permitted = userHasRole(user, "admin")
    || (key === "forestpaper:apontamentos" && userHasRole(user, "qualidade"))
    || (key === "forestpaper:maquinas" && userHasRole(user, "producao"));
  if (!permitted) return json({ error: "forbidden" }, 403);
  const body = await request.json();
  // Caminho normal dos apontamentos: merge por id, sem apagar o historico.
  if (body.merge !== undefined) {
    if (key !== RECORDS_STATE_KEY) return json({ error: "state_merge_not_allowed" }, 400);
    return mergeStateRecords(request, env, user, key, body.merge);
  }
  // Substituicao total: destrutiva por natureza, reservada a acoes explicitas
  // (ex.: "Apagar todos os apontamentos"). Exige confirmacao no corpo.
  if (key === RECORDS_STATE_KEY && body.replaceAll !== true) {
    return json({ error: "state_replace_requires_confirmation" }, 400);
  }
  if (typeof body.value !== "string" || body.value.length > 2_000_000) {
    return json({ error: "invalid_state_value" }, 400);
  }
  JSON.parse(body.value);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO app_state (id, value, updated_at, updated_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ).bind(key, body.value, now, user.identityHash).run();
  await audit(env, user, "state_update", "state", key, {});
  return json({ ok: true, updatedAt: now });
}

async function api(request, env, ctx) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (url.pathname === "/api/health") return json({ ok: true, service: "forest-paper" });
  const auth = await requireUser(request, env);
  if (auth.response) {
    auditAccess(ctx, env, request, auth.response);
    return auth.response;
  }
  const { user } = auth;

  // Fora do caminho da resposta: a contagem de uso nao deve somar latencia a
  // nenhuma rota. recordUsage engole os proprios erros.
  ctx?.waitUntil(recordUsage(env, user, url));

  let response;
  try {
    response = await routeApi(request, env, user, url);
  } catch (error) {
    console.error(JSON.stringify({
      event: "api_unhandled_error", path: url.pathname, method: request.method,
      message: String(error?.message || error).slice(0, 240),
    }));
    response = json({ error: "internal_error", message: "Nao foi possivel concluir a operacao." }, 500);
  }
  // Um unico ponto de auditoria por requisicao, depois do roteamento: o guard de
  // perfil e os guards de setor dentro das rotas produzem uma linha so, com a
  // decisao final.
  auditAccess(ctx, env, request, response);
  return response;
}

async function routeApi(request, env, user, url) {
  if (url.pathname.startsWith("/api/finance/")) {
    return handleFinanceRequest(request, env, user);
  }

  if (url.pathname === "/api/commercial" || url.pathname.startsWith("/api/commercial/")) {
    return handleCommercialRequest(request, env, user);
  }

  if (url.pathname === "/api/me" && request.method === "GET") {
    return json({ name: user.name, role: user.role, roles: user.roles || [user.role] });
  }
  if (url.pathname === "/api/operators" || url.pathname.startsWith("/api/operators/")
    || url.pathname === "/api/operator-devices" || url.pathname.startsWith("/api/operator-devices/")) {
    return handleOperatorsAdminRequest(request, env, user);
  }
  if (url.pathname === "/api/manual-payables" || url.pathname.startsWith("/api/manual-payables/")) {
    return handleManualPayablesRequest(request, env, user);
  }
  // Antes do handler generico de /api/analytics/: uso interno vem do D1, nao da
  // GraphQL da Cloudflare.
  if (url.pathname === "/api/analytics/usage") {
    return handleUsageRequest(request, env, user);
  }
  if (url.pathname.startsWith("/api/analytics/")) {
    return handleAnalyticsRequest(request, env, user);
  }
  if (url.pathname === "/api/orders" && request.method === "GET") {
    return json(projectOrdersForUser(await listOrders(env), user));
  }
  if (url.pathname === "/api/orders" && request.method === "PUT") {
    if (!canManageProduction(user)) return json({ error: "forbidden" }, 403);
    const body = await request.json();
    if (!Array.isArray(body.orders) || body.orders.length > 5000) return json({ error: "orders_required" }, 400);
    const orders = body.orders.map((row) => {
      const parsed = orderFromRow(row) || {};
      return {
        id: normalizeText(row.id || parsed.id),
        filial: normalizeText(row.filial ?? parsed.filial),
        pedido: normalizeText(row.numeroOP || row.pedido || parsed.pedido),
        item: normalizeText(row.item ?? parsed.item),
        dataEmissao: normalizeText(row.dataEmissao ?? parsed.dataEmissao),
        codigoCliente: normalizeText(row.codigoCliente ?? parsed.codigoCliente),
        lojaCliente: normalizeText(row.lojaCliente ?? parsed.lojaCliente),
        cliente: normalizeText(row.cliente ?? parsed.cliente),
        cidade: normalizeText(row.cidade ?? parsed.cidade),
        uf: normalizeText(row.uf ?? parsed.uf),
        codigoProduto: normalizeText(row.codigoProduto ?? parsed.codigoProduto),
        produto: normalizeText(row.produto ?? parsed.produto),
        unidade: normalizeText(row.unidade ?? parsed.unidade),
        quantidade: numberValue(row.quantidade ?? parsed.quantidade),
        precoUnitario: numberValue(row.precoUnitario ?? parsed.precoUnitario),
        valorTotal: numberValue(row.valorCarga ?? row.valorTotal ?? parsed.valorTotal),
        tes: normalizeText(row.tes ?? parsed.tes),
        vendedor: normalizeText(row.vendedor ?? parsed.vendedor),
        condicaoPagamento: normalizeText(row.condicaoPagamento ?? parsed.condicaoPagamento),
        tipoPedido: normalizeText(row.tipoPedido ?? parsed.tipoPedido),
        notaFiscal: normalizeText(row.notaFiscal ?? parsed.notaFiscal),
        serieNota: normalizeText(row.serieNota ?? parsed.serieNota),
      };
    }).filter((order) => order.id && order.pedido);
    const result = await upsertOrders(env, orders, "manual-excel");
    await audit(env, user, "manual_import", "excel", "", result);
    return json(result);
  }
  if (url.pathname.startsWith("/api/orders/") && request.method === "PATCH") {
    return updateOrder(request, env, user, decodeURIComponent(url.pathname.slice("/api/orders/".length)));
  }
  if (url.pathname.startsWith("/api/state/")) {
    return stateRoute(request, env, user, decodeURIComponent(url.pathname.slice("/api/state/".length)));
  }
  if (url.pathname === "/api/sync" && request.method === "POST") {
    if (!canManageProduction(user)) return json({ error: "forbidden" }, 403);
    try {
      return json(await syncFromProtheus(env, user));
    } catch (error) {
      return json({ error: "sync_failed", message: error.message }, 502);
    }
  }
  if (url.pathname === "/api/quality/workbook" && request.method === "GET") {
    if (!canRecordQuality(user)) return json({ error: "forbidden" }, 403);
    return json(await qualityWorkbookStatus(env));
  }
  if (url.pathname === "/api/quality/workbook/rows" && request.method === "POST") {
    if (!canRecordQuality(user)) return json({ error: "forbidden" }, 403);
    const body = await request.json().catch(() => null);
    if (!body || typeof body.record !== "object" || body.record === null) {
      return json({ error: "record_required" }, 400);
    }
    try {
      const result = await appendQualityRow(env, body.record);
      await audit(env, user, "quality_workbook_row", "workbook", result.sheet, {
        mode: result.mode,
        lote: String(body.record.lote || "").slice(0, 60),
      });
      return json({ ok: true, ...result });
    } catch (error) {
      const failure = error instanceof GraphError ? error : null;
      console.error(JSON.stringify({
        event: "quality_workbook_error",
        code: failure?.code || "unexpected",
        message: String(error?.message || error).slice(0, 240),
      }));
      return json({
        error: failure?.code || "workbook_append_failed",
        message: failure?.message || "Nao foi possivel gravar na planilha oficial.",
      }, failure?.status || 502);
    }
  }
  if (url.pathname === "/api/audit" && request.method === "GET") {
    if (!userHasRole(user, "diretoria")) return json({ error: "forbidden" }, 403);
    const result = await env.DB.prepare(
      `SELECT actor_name, actor_role, action, entity_type, entity_id, details, created_at
       FROM audit_log ORDER BY id DESC LIMIT 250`,
    ).all();
    return json({ events: result.results });
  }
  return json({ error: "not_found" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/operador/api/")) return operatorApi(request, env, ctx);
    if (url.pathname.startsWith("/api/")) return api(request, env, ctx);
    if (!env.ASSETS) return text("Static assets binding ausente", 500);
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller, env, ctx) {
    // Resumo diario e retencao da auditoria. A limpeza roda ainda que o e-mail
    // falhe: sendAlertMail nunca lanca, e o purge vem depois de proposito.
    if (controller.cron === "0 10 * * *") {
      ctx.waitUntil((async () => {
        try { await dailyDigest(env); }
        catch (error) {
          console.error(JSON.stringify({ event: "access_digest_error", message: String(error?.message || error).slice(0, 240) }));
        }
        try { await purgeOldAudit(env); }
        catch (error) {
          console.error(JSON.stringify({ event: "access_audit_purge_error", message: String(error?.message || error).slice(0, 240) }));
        }
      })());
      return;
    }
    // syncFinanceCache/syncCommercialBilling ja logam o erro internamente (finance_sync_runs /
    // commercial sync state) e relancam a excecao para que chamadas manuais via HTTP consigam
    // reportar falha ao usuario. Aqui a chamada e fire-and-forget (ctx.waitUntil), entao sem este
    // catch uma falha do Protheus (ex.: timeout 522) vira uma excecao nao tratada no Worker.
    if (controller.cron === "22,52 * * * *") {
      ctx.waitUntil(syncFromProtheus(env).catch((error) => {
        console.error(JSON.stringify({ event: "scheduled_orders_sync_error", message: String(error?.message || error).slice(0, 240) }));
      }));
      // Retencao da telemetria de uso, uma vez por dia. Este cron dispara de
      // hora em hora; sem o recorte de horario seriam 48 DELETEs diarios que
      // nao apagariam nada em 47 deles.
      const hour = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false,
      }).format(new Date());
      if (hour === "03") {
        ctx.waitUntil(purgeOldUsage(env).catch((error) => {
          console.error(JSON.stringify({ event: "usage_purge_error", message: String(error?.message || error).slice(0, 240) }));
        }));
      }
      return;
    }
    if (controller.cron === "*/15 * * * *") {
      ctx.waitUntil(syncFinanceCache(env).catch((error) => {
        console.error(JSON.stringify({ event: "scheduled_finance_sync_error", message: String(error?.message || error).slice(0, 240) }));
      }));
      return;
    }
    if (controller.cron === "7,37 * * * *") {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date());
      const period = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      const day = `${period.year}-${period.month}-${period.day}`;
      // A consulta diária evita os timeouts 522 observados no Protheus ao
      // reler o mês inteiro a cada meia hora. Os dias anteriores permanecem no D1.
      ctx.waitUntil(syncCommercialBilling(env, null, { month: day.slice(0, 7), day }).catch((error) => {
        console.error(JSON.stringify({ event: "scheduled_commercial_sync_error", message: String(error?.message || error).slice(0, 240) }));
      }));
      return;
    }
  },
};
