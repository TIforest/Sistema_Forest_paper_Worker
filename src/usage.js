// Telemetria de uso por usuario, complementar ao Web Analytics.
//
// O beacon da Cloudflare e anonimo por design e nunca respondera "quem usou o
// que". Como o portal inteiro esta atras do Access, o worker ja conhece a
// identidade em toda requisicao — este modulo apenas contabiliza o que ja passa
// por ali.
//
// Registro nominal, decidido em conjunto com a gestao. Retencao de 90 dias.

const RETENTION_DAYS = 90;
const ALLOWED_DAYS = new Set([7, 30, 90]);
const DEFAULT_DAYS = 30;

// Prefixo de rota -> modulo do painel. A ordem importa: o primeiro casamento
// vence, entao prefixos mais especificos vem antes.
const MODULE_ROUTES = [
  ["/api/me", "login"],
  ["/api/analytics/", "acessos"],
  ["/api/commercial", "comercial"],
  ["/api/finance/", "financeiro"],
  ["/api/manual-payables", "financeiro"],
  ["/api/operator-devices", "usuarios"],
  ["/api/operators", "usuarios"],
  ["/api/quality", "qualidade"],
  ["/api/shifts", "turnos"],
  ["/api/orders", "producao"],
  ["/api/state", "producao"],
];

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/**
 * Dia corrente no fuso de Sao Paulo.
 *
 * Usar UTC jogaria todo acesso entre 21h e 00h para o dia seguinte, o que faria
 * o turno da noite aparecer no relatorio do dia errado.
 */
function localDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const period = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${period.year}-${period.month}-${period.day}`;
}

function moduleForPath(pathname) {
  const match = MODULE_ROUTES.find(([prefix]) => pathname === prefix || pathname.startsWith(prefix));
  return match ? match[1] : null;
}

/**
 * Contabiliza um acesso. Nunca lanca: telemetria com defeito nao pode derrubar
 * a rota que o usuario pediu de fato.
 */
export async function recordUsage(env, user, url) {
  try {
    const module = moduleForPath(url.pathname);
    if (!module || !user?.identityHash) return;
    await env.DB.prepare(
      `INSERT INTO access_usage (day, actor_hash, actor_name, actor_role, module, hits, last_seen)
       VALUES (?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(day, actor_hash, module) DO UPDATE SET
         hits = hits + 1,
         last_seen = excluded.last_seen,
         actor_name = excluded.actor_name,
         actor_role = excluded.actor_role`,
    ).bind(
      localDay(),
      user.identityHash,
      user.name || "sem nome",
      user.role || "sem papel",
      module,
      new Date().toISOString(),
    ).run();
  } catch (error) {
    console.error(JSON.stringify({
      event: "usage_record_error",
      message: String(error?.message || error).slice(0, 240),
    }));
  }
}

/** Descarta o que passou da retencao. Chamado pelo cron, nao pelo request. */
export async function purgeOldUsage(env) {
  const limit = localDay(new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000));
  const result = await env.DB.prepare(`DELETE FROM access_usage WHERE day < ?`).bind(limit).run();
  return result?.meta?.changes || 0;
}

async function usageReport(env, days) {
  const from = localDay(new Date(Date.now() - days * 24 * 60 * 60 * 1000));

  const [byUser, byModule, byRole, byDay] = await env.DB.batch([
    env.DB.prepare(
      `SELECT actor_name AS nome, actor_role AS papel,
              SUM(hits) AS acessos,
              COUNT(DISTINCT module) AS modulos,
              MAX(last_seen) AS ultimoAcesso
         FROM access_usage WHERE day >= ?
        GROUP BY actor_hash ORDER BY acessos DESC`,
    ).bind(from),
    env.DB.prepare(
      `SELECT module AS modulo, SUM(hits) AS acessos, COUNT(DISTINCT actor_hash) AS usuarios
         FROM access_usage WHERE day >= ?
        GROUP BY module ORDER BY acessos DESC`,
    ).bind(from),
    env.DB.prepare(
      `SELECT actor_role AS papel, SUM(hits) AS acessos, COUNT(DISTINCT actor_hash) AS usuarios
         FROM access_usage WHERE day >= ?
        GROUP BY actor_role ORDER BY acessos DESC`,
    ).bind(from),
    env.DB.prepare(
      `SELECT day AS dia, SUM(hits) AS acessos, COUNT(DISTINCT actor_hash) AS usuarios
         FROM access_usage WHERE day >= ?
        GROUP BY day ORDER BY day ASC`,
    ).bind(from),
  ]);

  const usuarios = byUser.results || [];
  return {
    range: { days, from },
    totals: {
      usuarios: usuarios.length,
      acessos: usuarios.reduce((sum, row) => sum + (row.acessos || 0), 0),
    },
    porUsuario: usuarios,
    porModulo: byModule.results || [],
    porPapel: byRole.results || [],
    porDia: byDay.results || [],
  };
}

export async function handleUsageRequest(request, env, user) {
  const url = new URL(request.url);
  if (user.role !== "admin") return json({ error: "forbidden" }, 403);
  if (request.method !== "GET") return json({ error: "not_found" }, 404);

  const requested = Number.parseInt(url.searchParams.get("days") ?? "", 10);
  const days = ALLOWED_DAYS.has(requested) ? requested : DEFAULT_DAYS;

  try {
    return json(await usageReport(env, days));
  } catch (error) {
    const message = String(error?.message || error).slice(0, 240);
    console.error(JSON.stringify({ event: "usage_report_error", message }));
    return json({ error: "uso_indisponivel", message }, 502);
  }
}
