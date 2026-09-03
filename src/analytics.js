// Espelha o Cloudflare Web Analytics dentro do painel, lendo a GraphQL
// Analytics API da conta. Os nomes de dataset, dimensao e quantil abaixo foram
// confirmados por introspecao do schema — nao ha documentacao publica listando
// os nodes rum*, entao alterar qualquer identificador aqui exige reintrospectar.
//
// Escopo: dado anonimo e amostrado (o beacon nao identifica usuario). Para saber
// quem usou qual modulo seria preciso telemetria propria em D1.

const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const ALLOWED_DAYS = new Set([7, 21, 30]);
const DEFAULT_DAYS = 7;
const TOP_LIMIT = 10;

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

// Um unico request com nodes aliasados: a GraphQL API cobra por query, e sete
// consultas separadas gastariam sete vezes mais do orcamento por nada.
const QUERY = `
query($acc:String!,$from:Time!,$to:Time!,$host:String!,$top:Int!){
  viewer{
    accounts(filter:{accountTag:$acc}){
      series: rumPageloadEventsAdaptiveGroups(
        filter:{datetime_geq:$from,datetime_leq:$to,requestHost:$host}
        limit:500 orderBy:[date_ASC]
      ){ count sum{visits} dimensions{date} }

      paths: rumPageloadEventsAdaptiveGroups(
        filter:{datetime_geq:$from,datetime_leq:$to,requestHost:$host}
        limit:$top orderBy:[count_DESC]
      ){ count dimensions{requestPath} }

      browsers: rumPageloadEventsAdaptiveGroups(
        filter:{datetime_geq:$from,datetime_leq:$to,requestHost:$host}
        limit:$top orderBy:[count_DESC]
      ){ count dimensions{userAgentBrowser} }

      systems: rumPageloadEventsAdaptiveGroups(
        filter:{datetime_geq:$from,datetime_leq:$to,requestHost:$host}
        limit:$top orderBy:[count_DESC]
      ){ count dimensions{userAgentOS} }

      devices: rumPageloadEventsAdaptiveGroups(
        filter:{datetime_geq:$from,datetime_leq:$to,requestHost:$host}
        limit:$top orderBy:[count_DESC]
      ){ count dimensions{deviceType} }

      performance: rumPerformanceEventsAdaptiveGroups(
        filter:{datetime_geq:$from,datetime_leq:$to,requestHost:$host}
        limit:1
      ){ count quantiles{pageLoadTimeP50 pageLoadTimeP75 firstContentfulPaintP75} }

      vitals: rumWebVitalsEventsAdaptiveGroups(
        filter:{datetime_geq:$from,datetime_leq:$to,requestHost:$host}
        limit:1
      ){ count quantiles{largestContentfulPaintP75 interactionToNextPaintP75 cumulativeLayoutShiftP75} }
    }
  }
}`;

/** Converte linhas agrupadas em [{ label, pageviews }], descartando rotulo vazio. */
function toBreakdown(rows, dimension) {
  return (rows || [])
    .map((row) => ({ label: String(row?.dimensions?.[dimension] ?? "").trim(), pageviews: row?.count || 0 }))
    .filter((item) => item.label !== "");
}

function parseDays(value) {
  const days = Number.parseInt(value ?? "", 10);
  return ALLOWED_DAYS.has(days) ? days : DEFAULT_DAYS;
}

// Colar o valor no `wrangler secret put` costuma trazer \r, espaco ou aspas
// junto — no PowerShell isso e a regra, nao a excecao. Qualquer um deles torna
// o header Authorization invalido e a API responde 400 sem dizer o motivo.
function cleanSecret(value) {
  return String(value ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^bearer\s+/i, "")
    .trim();
}

/**
 * Formato do secret sem revelar o valor.
 *
 * O erro 9106 da Cloudflare ("Authentication failed") e identico para token
 * ausente, token com espaco no meio e token com aspas — todos viram header
 * invalido. Sem saber o formato do que foi gravado nao da para distinguir
 * "colei errado" de "criei com a permissao errada", e a diferenca muda a acao.
 */
function secretShape(value) {
  const raw = String(value ?? "");
  const marks = [];
  if (/\s/.test(raw.trim())) marks.push("contem espaco no meio");
  if (/["']/.test(raw)) marks.push("contem aspas");
  if (/^\s*bearer\s/i.test(raw)) marks.push("comeca com Bearer");
  if (/^\s*-H\b/.test(raw)) marks.push("parece um trecho de comando curl");
  return `secret com ${cleanSecret(raw).length} caracteres apos limpeza${marks.length ? ` (${marks.join(", ")})` : ""}`;
}

async function fetchAnalytics(env, days) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cleanSecret(env.CF_ANALYTICS_TOKEN)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: QUERY,
      variables: {
        acc: cleanSecret(env.CF_ACCOUNT_ID),
        host: cleanSecret(env.ANALYTICS_SITE_HOST),
        from: from.toISOString(),
        to: to.toISOString(),
        top: TOP_LIMIT,
      },
    }),
  });

  if (!response.ok) {
    // Sem o corpo da resposta o painel mostraria so o status, que nao distingue
    // token malformado de permissao ausente.
    const detail = await response.text().catch(() => "");
    throw new Error(`graphql_http_${response.status}: ${detail.slice(0, 200)}`);
  }

  const payload = await response.json();
  // A API responde 200 com errors preenchido quando a query e invalida ou o
  // token perdeu permissao; sem esta checagem o painel mostraria zeros calmos.
  if (payload?.errors?.length) {
    throw new Error(String(payload.errors[0]?.message || "graphql_error").slice(0, 240));
  }

  const account = payload?.data?.viewer?.accounts?.[0];
  if (!account) throw new Error("conta_sem_retorno");

  const series = (account.series || []).map((row) => ({
    date: row?.dimensions?.date || "",
    pageviews: row?.count || 0,
    visits: row?.sum?.visits || 0,
  }));

  const performance = account.performance?.[0]?.quantiles || {};
  const vitals = account.vitals?.[0]?.quantiles || {};

  // Os quantis de tempo vem em MICROSSEGUNDOS. O schema nao documenta a unidade
  // e a descricao do campo tampouco: tratar como ms exibia "4540,30 s" para uma
  // pagina que carrega em 4,5 s. CLS fica de fora — e adimensional.
  const toMs = (value) => (value === null || value === undefined ? null : value / 1000);

  return {
    range: { from: from.toISOString(), to: to.toISOString(), days },
    host: env.ANALYTICS_SITE_HOST,
    totals: {
      pageviews: series.reduce((sum, item) => sum + item.pageviews, 0),
      visits: series.reduce((sum, item) => sum + item.visits, 0),
    },
    series,
    paths: toBreakdown(account.paths, "requestPath"),
    browsers: toBreakdown(account.browsers, "userAgentBrowser"),
    systems: toBreakdown(account.systems, "userAgentOS"),
    devices: toBreakdown(account.devices, "deviceType"),
    performance: {
      pageLoadP50: toMs(performance.pageLoadTimeP50),
      pageLoadP75: toMs(performance.pageLoadTimeP75),
      firstContentfulPaintP75: toMs(performance.firstContentfulPaintP75),
    },
    vitals: {
      lcpP75: toMs(vitals.largestContentfulPaintP75),
      inpP75: toMs(vitals.interactionToNextPaintP75),
      clsP75: vitals.cumulativeLayoutShiftP75 ?? null,
    },
  };
}

export async function handleAnalyticsRequest(request, env, user) {
  const url = new URL(request.url);
  if (user.role !== "admin") return json({ error: "forbidden" }, 403);
  if (url.pathname !== "/api/analytics/web" || request.method !== "GET") {
    return json({ error: "not_found" }, 404);
  }
  // Config incompleta e o caso comum em staging: responder 503 com motivo
  // evita que o painel atribua a falta de dado a ausencia de visitas.
  if (!env.CF_ANALYTICS_TOKEN || !env.CF_ACCOUNT_ID || !env.ANALYTICS_SITE_HOST) {
    return json({
      error: "analytics_nao_configurado",
      message: "Faltam CF_ANALYTICS_TOKEN, CF_ACCOUNT_ID ou ANALYTICS_SITE_HOST.",
    }, 503);
  }

  try {
    return json(await fetchAnalytics(env, parseDays(url.searchParams.get("days"))));
  } catch (error) {
    const message = String(error?.message || error).slice(0, 240);
    console.error(JSON.stringify({ event: "analytics_error", path: url.pathname, message }));
    // 9106 e 10000 sao os codigos de autenticacao da API: so nesses casos o
    // formato do secret ajuda a diagnosticar.
    const authFailure = /9106|10000|authentication/i.test(message);
    return json({
      error: "analytics_indisponivel",
      message: authFailure ? `${message} — ${secretShape(env.CF_ANALYTICS_TOKEN)}` : message,
    }, 502);
  }
}
