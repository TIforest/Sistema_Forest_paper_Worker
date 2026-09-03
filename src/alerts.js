// Notificacao de seguranca: resumo diario e alerta imediato de operador
// bloqueado.
//
// Transporte: Microsoft Graph. O Cloudflare Email Sending foi descartado porque
// exige publicar DKIM/SPF na zona do dominio, e forest.ind.br e servido pelo
// Cloudez, nao pela Cloudflare — os registros nunca resolveriam. O Graph
// reaproveita a app registration que o modulo da planilha da Qualidade ja usa,
// e o M365 ja e remetente autorizado do dominio (spf.protection.outlook.com).
//
// Nada aqui pode quebrar o cron: toda falha de envio e registrada e engolida.

const LOGIN_ROOT = "https://login.microsoftonline.com";
const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const TOKEN_SKEW_MS = 60_000;
const THROTTLE_MINUTES = 60;
const RETENTION_DAYS = 90;

let tokenCache = { value: "", expiresAt: 0 };

function text(value) {
  return String(value ?? "").trim();
}

/** Destinatarios via secret, para incluir ou remover gente sem novo deploy. */
export function alertRecipients(env) {
  return text(env.ALERT_MAIL_TO).split(/[;,\s]+/).filter((address) => address.includes("@"));
}

export function mailConfigured(env) {
  return Boolean(text(env.MS_TENANT_ID) && text(env.MS_CLIENT_ID) && text(env.MS_CLIENT_SECRET)
    && text(env.ALERT_MAIL_FROM) && alertRecipients(env).length);
}

async function graphToken(env) {
  if (tokenCache.value && Date.now() < tokenCache.expiresAt - TOKEN_SKEW_MS) return tokenCache.value;
  const body = new URLSearchParams({
    client_id: text(env.MS_CLIENT_ID),
    client_secret: text(env.MS_CLIENT_SECRET),
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const response = await fetch(`${LOGIN_ROOT}/${encodeURIComponent(text(env.MS_TENANT_ID))}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    tokenCache = { value: "", expiresAt: 0 };
    throw new Error(`graph_auth_failed: ${payload.error_description || payload.error || response.status}`);
  }
  tokenCache = { value: payload.access_token, expiresAt: Date.now() + (payload.expires_in || 3600) * 1000 };
  return tokenCache.value;
}

/**
 * Envia pelo Graph. Retorna true/false em vez de lancar — nenhum caminho de
 * chamada deve depender do sucesso do e-mail para concluir.
 */
export async function sendAlertMail(env, subject, textBody) {
  if (!mailConfigured(env)) {
    console.log(JSON.stringify({
      event: "alert_mail_skipped",
      reason: "config_incompleta",
      subject,
      // Diz exatamente o que falta, para nao virar caca ao tesouro em producao.
      faltando: [
        !text(env.MS_TENANT_ID) && "MS_TENANT_ID",
        !text(env.MS_CLIENT_ID) && "MS_CLIENT_ID",
        !text(env.MS_CLIENT_SECRET) && "MS_CLIENT_SECRET",
        !text(env.ALERT_MAIL_FROM) && "ALERT_MAIL_FROM",
        !alertRecipients(env).length && "ALERT_MAIL_TO",
      ].filter(Boolean),
    }));
    return false;
  }
  try {
    const token = await graphToken(env);
    const sender = text(env.ALERT_MAIL_FROM);
    const response = await fetch(`${GRAPH_ROOT}/users/${encodeURIComponent(sender)}/sendMail`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "Text", content: textBody },
          toRecipients: alertRecipients(env).map((address) => ({ emailAddress: { address } })),
        },
        saveToSentItems: false,
      }),
    });
    if (!response.ok) {
      const detail = text(await response.text()).slice(0, 240);
      throw new Error(`graph_sendmail_${response.status}: ${detail}`);
    }
    console.log(JSON.stringify({ event: "alert_mail_sent", subject, destinatarios: alertRecipients(env).length }));
    return true;
  } catch (error) {
    console.error(JSON.stringify({
      event: "alert_mail_error", subject, message: String(error?.message || error).slice(0, 240),
    }));
    return false;
  }
}

function brt(iso) {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}
function brtHour(iso) {
  return new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
}

/**
 * Alerta imediato de operador bloqueado, no maximo um por operador por hora.
 * Os eventos suprimidos continuam aparecendo no resumo diario.
 */
export async function alertOperatorBlocked(env, record) {
  const key = `operador_bloqueado:${record.email || "sem-email"}`;
  const now = new Date();
  const limit = new Date(now.getTime() - THROTTLE_MINUTES * 60 * 1000).toISOString();

  // Insere so se nao houver alerta recente: o proprio banco decide, evitando
  // corrida entre duas requisicoes simultaneas do mesmo operador.
  const result = await env.DB.prepare(
    `INSERT INTO alert_throttle (alert_key, last_sent_at) VALUES (?, ?)
     ON CONFLICT(alert_key) DO UPDATE SET last_sent_at = excluded.last_sent_at
     WHERE alert_throttle.last_sent_at < ?`,
  ).bind(key, now.toISOString(), limit).run();

  if (!result?.meta?.changes) {
    console.log(JSON.stringify({ event: "alert_throttled", key, janelaMinutos: THROTTLE_MINUTES }));
    return false;
  }

  return sendAlertMail(env,
    `[Forest Paper] Operador bloqueado: ${record.email || "sem e-mail"}`,
    [
      "Um operador foi bloqueado por cinco tentativas de PIN incorretas.",
      "",
      `Operador: ${record.email || "sem e-mail"}`,
      `Horário:  ${brt(record.ts)} (BRT)`,
      `Origem:   ${record.ip || "IP desconhecido"} · ${record.country || "país desconhecido"}`,
      `Rota:     ${record.method} ${record.route}`,
      "",
      "O bloqueio dura 15 minutos e se desfaz sozinho. Se não houver explicação",
      "conhecida, pode indicar tentativa de adivinhação de PIN em andamento.",
      "",
      `Novos alertas deste operador ficam suprimidos por ${THROTTLE_MINUTES} minutos;`,
      "todos os eventos aparecem no resumo diário.",
    ].join("\n"));
}

/** Apaga auditoria acima da retencao. known_emails nunca e limpa. */
export async function purgeOldAudit(env) {
  const limit = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const result = await env.DB.prepare(`DELETE FROM access_audit WHERE ts < ?`).bind(limit).run();
  const removidas = result?.meta?.changes || 0;
  console.log(JSON.stringify({ event: "access_audit_purge", removidas, retencaoDias: RETENTION_DAYS, anteriorA: limit }));
  return removidas;
}

export async function dailyDigest(env) {
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const [totais, novos, negados, bloqueados] = await env.DB.batch([
    env.DB.prepare(
      `SELECT COUNT(*) total,
              SUM(CASE WHEN decision='negado' THEN 1 ELSE 0 END) negados,
              COUNT(DISTINCT email) pessoas
         FROM access_audit WHERE ts >= ?`).bind(since),
    env.DB.prepare(
      `SELECT email, first_seen_at, first_decision, first_reason, first_city, first_region, first_country
         FROM known_emails WHERE first_seen_at >= ? ORDER BY first_seen_at`).bind(since),
    env.DB.prepare(
      `SELECT email, ts, reason, COUNT(*) n
         FROM access_audit WHERE decision='negado' AND ts >= ?
        GROUP BY email, reason ORDER BY n DESC LIMIT 40`).bind(since),
    env.DB.prepare(
      `SELECT email, ts FROM access_audit
        WHERE reason='operador_bloqueado' AND ts >= ? ORDER BY ts`).bind(since),
  ]);

  const resumo = totais.results?.[0] || { total: 0, negados: 0, pessoas: 0 };
  const listaNovos = novos.results || [];
  const listaNegados = negados.results || [];
  const listaBloqueados = bloqueados.results || [];

  const linhas = [
    `Acessos: ${resumo.total || 0}  ·  Negados: ${resumo.negados || 0}  ·  `
      + `E-mails novos: ${listaNovos.length}  ·  Operadores bloqueados: ${listaBloqueados.length}`,
    `Período: últimas 24h até ${brt(now.toISOString())} (BRT)`,
  ];

  if (listaNovos.length) {
    linhas.push("", "🆕 PRIMEIRA VEZ");
    for (const item of listaNovos) {
      const local = [item.first_city, item.first_region].filter(Boolean).join("/") || item.first_country || "origem desconhecida";
      const veredito = item.first_decision === "negado" ? `NEGADO (${item.first_reason || "sem motivo"})` : "permitido";
      linhas.push(`  ${brtHour(item.first_seen_at)}  ${item.email}  ·  ${local}  ·  ${veredito}`);
    }
  }

  if (listaNegados.length) {
    linhas.push("", "⛔ NEGADOS");
    for (const item of listaNegados) {
      linhas.push(`  ${brtHour(item.ts)}  ${item.email || "sem e-mail"}  ·  ${item.reason || "sem motivo"}`
        + (item.n > 1 ? `  (${item.n}x)` : ""));
    }
  }

  if (listaBloqueados.length) {
    linhas.push("", "🔒 OPERADORES BLOQUEADOS");
    for (const item of listaBloqueados) {
      linhas.push(`  ${brtHour(item.ts)}  ${item.email || "sem e-mail"}`);
    }
  }

  if (!listaNovos.length && !listaNegados.length && !listaBloqueados.length) {
    linhas.push("", "Nada a reportar: nenhum acesso negado e nenhum e-mail novo.");
  }

  const corpo = linhas.join("\n");
  console.log(JSON.stringify({
    event: "access_digest", total: resumo.total || 0, negados: resumo.negados || 0,
    novos: listaNovos.length, bloqueados: listaBloqueados.length,
  }));
  const assunto = `[Forest Paper] Resumo de acessos — ${resumo.negados || 0} negados, ${listaNovos.length} novos`;
  await sendAlertMail(env, assunto, corpo);
  return corpo;
}
