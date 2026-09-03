// Auditoria de decisoes de acesso — SOMENTE observabilidade.
//
// O log nativo do Access marca todo mundo como "Permitido", porque a politica
// libera gmail/outlook (operadores nao tem e-mail corporativo). Quem o app barra
// depois — "Perfil corporativo nao cadastrado" — fica indistinguivel de quem
// entrou. Este modulo emite uma linha por requisicao dizendo qual foi a decisao
// real do app, com o claim `sub` para cruzar com o log do Access.
//
// Nada aqui altera autorizacao, retorno ou status. A decisao e LIDA da resposta
// ja construida pelas regras existentes, nunca calculada de novo — assim a
// instrumentacao nao pode divergir do comportamento nem introduzir uma segunda
// fonte de verdade.

import { alertOperatorBlocked } from "./alerts.js";

const DENIAL_STATUS = new Set([401, 403, 423]);

// Codigo de erro da resposta -> motivo do vocabulario fixo da auditoria.
const REASON_BY_ERROR = {
  forbidden: "setor_nao_autorizado",
  commercial_access_required: "setor_nao_autorizado",
  read_only: "setor_nao_autorizado",
  // Escopo de maquina do operador: e negacao de alcance, nao de dispositivo.
  order_not_assigned_to_operator_machine: "setor_nao_autorizado",
  device_not_authorized: "tablet_nao_autorizado",
  device_machine_mismatch: "tablet_nao_autorizado",
  invalid_credentials: "pin_invalido",
  // Motivo proprio: 5 PINs errados seguidos indicam forca bruta, enquanto um
  // PIN errado avulso e erro de digitacao. No mesmo valor o evento relevante
  // desaparecia no ruido do filtro.
  operator_temporarily_locked: "operador_bloqueado",
  // Sessao de operador ausente/expirada: credencial invalida, o equivalente
  // mais proximo no vocabulario definido.
  operator_session_required: "jwt_invalido",
};

/**
 * Identidade do Access sem expor o token.
 *
 * Le apenas `sub` e `email` do payload do JWT — o restante do claim set, e o
 * JWT em si, nunca saem daqui. Nao valida assinatura de proposito: o Access ja
 * validou na borda, e revalidar aqui seria regra de autorizacao, fora do escopo.
 */
function accessIdentity(request) {
  const header = request.headers.get("Cf-Access-Authenticated-User-Email");
  const identity = { email: header ? String(header).trim().toLowerCase() : null, sub: null };
  try {
    const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
    if (!assertion) return identity;
    const payload = assertion.split(".")[1];
    if (!payload) return identity;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)));
    identity.sub = claims?.sub ?? null;
    if (!identity.email && claims?.email) identity.email = String(claims.email).trim().toLowerCase();
  } catch {
    // JWT ausente ou ilegivel nao invalida a auditoria: o e-mail do header
    // continua valendo e `sub` fica null.
  }
  return identity;
}

async function resolveDecision(response, email) {
  if (!response || !DENIAL_STATUS.has(response.status)) {
    return { decision: "permitido", reason: null };
  }

  let code = null;
  try {
    code = (await response.clone().json())?.error ?? null;
  } catch {
    // Resposta sem corpo JSON: cai no motivo padrao pelo status.
  }

  // access_denied cobre dois casos distintos com a mesma resposta: sem
  // identidade do Access, ou identidade valida sem perfil ativo no D1. E
  // justamente a distincao que o log do Access nao permite fazer.
  if (code === "access_denied") {
    return { decision: "negado", reason: email ? "sem_perfil" : "jwt_invalido" };
  }
  if (code && REASON_BY_ERROR[code]) {
    return { decision: "negado", reason: REASON_BY_ERROR[code] };
  }
  return { decision: "negado", reason: response.status === 403 ? "setor_nao_autorizado" : "jwt_invalido" };
}

/**
 * Grava no D1. Complementa o console.log, nao substitui: o log da Cloudflare
 * tem retencao curta demais para investigar historico.
 */
async function persist(env, record, place) {
  if (!env?.DB) return;
  const statements = [
    env.DB.prepare(
      `INSERT INTO access_audit (ts, email, access_sub, decision, reason, route, method, ip, country, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(record.ts, record.email, record.access_sub, record.decision, record.reason,
      record.route, record.method, record.ip, record.country, record.user_agent),
  ];
  if (record.email) {
    // DO NOTHING: a linha nasce na primeira aparicao e nunca e reescrita, entao
    // "primeira vez" continua correto mesmo depois da limpeza de 90 dias.
    statements.push(env.DB.prepare(
      `INSERT INTO known_emails (email, first_seen_at, first_decision, first_reason,
                                 first_route, first_ip, first_country, first_city, first_region)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(email) DO NOTHING`,
    ).bind(record.email, record.ts, record.decision, record.reason,
      record.route, record.ip, record.country, place.city, place.region));
  }
  await env.DB.batch(statements);
}

async function emit(env, request, response) {
  const { email, sub } = accessIdentity(request);
  const { decision, reason } = await resolveDecision(response, email);
  const record = {
    event: "access_audit",
    ts: new Date().toISOString(),
    email,
    access_sub: sub,
    decision,
    reason,
    route: new URL(request.url).pathname,
    method: request.method,
    ip: request.headers.get("CF-Connecting-IP"),
    country: request.cf?.country,
    user_agent: (request.headers.get("User-Agent") || "").slice(0, 200),
  };
  console.log(JSON.stringify(record));

  // Cidade e regiao so alimentam known_emails, para o resumo poder dizer de onde
  // a pessoa apareceu pela primeira vez. Nao entram no evento logado.
  const place = { city: request.cf?.city ?? null, region: request.cf?.regionCode ?? null };
  try {
    await persist(env, record, place);
  } catch (error) {
    console.error(JSON.stringify({
      event: "access_audit_persist_error", message: String(error?.message || error).slice(0, 240),
    }));
  }

  // Bloqueio de operador nao espera o resumo: e o unico caso que pode indicar
  // adivinhacao de PIN em andamento.
  if (reason === "operador_bloqueado") {
    try {
      await alertOperatorBlocked(env, record);
    } catch (error) {
      console.error(JSON.stringify({
        event: "access_audit_alert_error", message: String(error?.message || error).slice(0, 240),
      }));
    }
  }
}

/**
 * Registra a decisao final da requisicao. Fora do caminho da resposta e sem
 * propagar erro: falha de log nao pode afetar o que o usuario recebe.
 */
export function auditAccess(ctx, env, request, response) {
  try {
    const pending = emit(env, request, response).catch((error) => {
      console.error(JSON.stringify({
        event: "access_audit_error",
        message: String(error?.message || error).slice(0, 240),
      }));
    });
    if (ctx?.waitUntil) ctx.waitUntil(pending);
  } catch (error) {
    console.error(JSON.stringify({
      event: "access_audit_error",
      message: String(error?.message || error).slice(0, 240),
    }));
  }
}
