import * as XLSX from "xlsx";
import { handleCommercialRequest, syncCommercialBilling } from "./commercial.js";
import { handleFinanceRequest, syncFinanceCache } from "./finance.js";

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
    `SELECT display_name, role
       FROM user_roles
      WHERE identity_hash = ? AND active = 1`,
  ).bind(identityHash).first();
  if (!profile) return null;
  return {
    identityHash,
    name: profile.display_name,
    role: profile.role,
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

async function graphToken(env) {
  const missing = ["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET"].filter((key) => !env[key]);
  if (missing.length) throw new Error(`Secrets ausentes: ${missing.join(", ")}`);
  const body = new URLSearchParams({
    client_id: env.MS_CLIENT_ID,
    client_secret: env.MS_CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(env.MS_TENANT_ID)}/oauth2/v2.0/token`,
    { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body },
  );
  if (!response.ok) throw new Error(`Microsoft OAuth: HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload.access_token) throw new Error("Microsoft OAuth nao retornou access_token");
  return payload.access_token;
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

async function syncFromMicrosoft(env, actor = null) {
  const startedAt = new Date().toISOString();
  const run = await env.DB.prepare(
    `INSERT INTO sync_runs (source, status, started_at) VALUES ('microsoft-graph', 'running', ?) RETURNING id`,
  ).bind(startedAt).first();
  try {
    if (!env.GRAPH_FILE_PATH) throw new Error("Variavel GRAPH_FILE_PATH nao configurada");
    const token = await graphToken(env);
    const graphUrl = `https://graph.microsoft.com/v1.0${env.GRAPH_FILE_PATH}`;
    const fileResponse = await fetch(graphUrl, { headers: { authorization: `Bearer ${token}` } });
    if (!fileResponse.ok) throw new Error(`Download do Excel: HTTP ${fileResponse.status}`);
    const workbook = XLSX.read(new Uint8Array(await fileResponse.arrayBuffer()), {
      type: "array",
      cellDates: true,
    });
    const configuredSheet = normalizeText(env.SYNC_SHEET || "Consulta1");
    const sheetName = workbook.SheetNames.find((name) => name === configuredSheet)
      || workbook.SheetNames.find((name) => /pedido|venda|consulta|produc/i.test(normalizeHeader(name)))
      || workbook.SheetNames[0];
    if (!sheetName) throw new Error("O Excel nao possui planilhas legiveis");
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", raw: true });
    const maxRows = Math.max(1, Math.min(Number(env.SYNC_MAX_ROWS || 5000), 10000));
    const orders = rows.slice(0, maxRows).map(orderFromRow).filter(Boolean);
    if (!orders.length) throw new Error("Nenhum pedido foi reconhecido na planilha");
    const result = await upsertOrders(env, orders, "microsoft-graph");
    await env.DB.prepare(
      `UPDATE sync_runs
          SET status = 'success', rows_received = ?, rows_changed = ?, finished_at = ?
        WHERE id = ?`,
    ).bind(result.received, result.changed, result.updatedAt, run.id).run();
    await audit(env, actor, "sync_success", "excel", sheetName, result);
    return result;
  } catch (error) {
    const finishedAt = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE sync_runs SET status = 'error', error_message = ?, finished_at = ? WHERE id = ?`,
    ).bind(String(error.message || error).slice(0, 500), finishedAt, run.id).run();
    await audit(env, actor, "sync_error", "excel", "", { message: error.message });
    throw error;
  }
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
  if (user.role === "diretoria") return json({ error: "read_only" }, 403);
  const body = await request.json();
  const requestedStatus = normalizeText(body.status);
  const allowed = ROLE_TRANSITIONS[user.role] || new Set();
  const status = [...allowed].find((value) => normalizeHeader(value) === normalizeHeader(requestedStatus));
  if (requestedStatus && !status) return json({ error: "invalid_transition" }, 403);
  const current = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();
  if (!current) return json({ error: "order_not_found" }, 404);
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

async function stateRoute(request, env, user, key) {
  if (!STATE_KEYS.has(key)) return json({ error: "state_key_not_allowed" }, 404);
  if (request.method === "GET") {
    const row = await env.DB.prepare("SELECT value, updated_at FROM app_state WHERE id = ?").bind(key).first();
    return json({ value: row?.value || null, updatedAt: row?.updated_at || null });
  }
  if (request.method !== "PUT") return json({ error: "method_not_allowed" }, 405);
  const permitted = (key === "forestpaper:apontamentos" && user.role === "qualidade")
    || (key === "forestpaper:maquinas" && user.role === "producao");
  if (!permitted) return json({ error: "forbidden" }, 403);
  const body = await request.json();
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

async function api(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (url.pathname === "/api/health") return json({ ok: true, service: "forest-paper" });
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;
  const { user } = auth;

  if (url.pathname.startsWith("/api/finance/")) {
    return handleFinanceRequest(request, env, user);
  }

  if (url.pathname === "/api/commercial" || url.pathname.startsWith("/api/commercial/")) {
    return handleCommercialRequest(request, env, user);
  }

  if (url.pathname === "/api/me" && request.method === "GET") {
    return json({ name: user.name, role: user.role });
  }
  if (url.pathname === "/api/orders" && request.method === "GET") {
    return json(await listOrders(env));
  }
  if (url.pathname === "/api/orders" && request.method === "PUT") {
    if (user.role !== "producao") return json({ error: "forbidden" }, 403);
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
    if (user.role !== "producao") return json({ error: "forbidden" }, 403);
    try {
      return json(await syncFromMicrosoft(env, user));
    } catch (error) {
      return json({ error: "sync_failed", message: error.message }, 502);
    }
  }
  if (url.pathname === "/api/audit" && request.method === "GET") {
    if (user.role !== "diretoria") return json({ error: "forbidden" }, 403);
    const result = await env.DB.prepare(
      `SELECT actor_name, actor_role, action, entity_type, entity_id, details, created_at
       FROM audit_log ORDER BY id DESC LIMIT 250`,
    ).all();
    return json({ events: result.results });
  }
  return json({ error: "not_found" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return api(request, env);
    if (!env.ASSETS) return text("Static assets binding ausente", 500);
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller, env, ctx) {
    if (controller.cron === "*/15 * * * *") {
      ctx.waitUntil(syncFinanceCache(env));
      return;
    }
    if (controller.cron === "*/30 * * * *") {
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
      ctx.waitUntil(syncCommercialBilling(env, null, { month: day.slice(0, 7), day }));
      return;
    }
  },
};
