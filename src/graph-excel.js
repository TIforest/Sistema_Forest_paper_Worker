/**
 * Integracao com o Microsoft Graph (Excel API) para gravar os apontamentos da
 * Qualidade direto na planilha oficial (FQ 018) hospedada no SharePoint/OneDrive.
 *
 * Por que pelo Graph: a gravacao antiga acontecia no navegador com SheetJS
 * Community, que reconstroi o .xlsx inteiro e nao escreve estilos. Cada
 * apontamento devolvia o arquivo sem tabelas, cores, formatacao condicional,
 * conexoes de dados externas e graficos. Aqui quem insere a linha e o proprio
 * Excel Online: o arquivo continua intacto, o historico de versao do SharePoint
 * segue funcionando e a planilha pode estar aberta por outra pessoa.
 */

const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const LOGIN_ROOT = "https://login.microsoftonline.com";
const TOKEN_SKEW_MS = 60_000;

// Cache por isolate. O token do Entra vale ~1h e o par driveId/itemId so muda se
// a planilha for movida ou recriada, entao evitamos duas chamadas por apontamento.
let tokenCache = { value: "", expiresAt: 0 };
let workbookCache = null;

const SAO_PAULO = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const CANTONEIRA_HEADER = [
  "Data", "Inspetor(a)", "Turno", "Maquina", "Cliente", "N OP com item",
  "Descricao do produto", "Lote", "Comprimento especificado (mm)",
  "Comprimento medido (mm)", "Abas especificadas (mm)", "Abas medidas (mm)",
  "Espessura especificada (mm)", "Espessura medida (mm)", "Umidade (%)",
  "Status", "Motivo", "Desvio encontrado", "Observacoes",
];

class GraphError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

export function graphConfigured(env) {
  return Boolean(text(env.MS_TENANT_ID) && text(env.MS_CLIENT_ID) && text(env.MS_CLIENT_SECRET)
    && (text(env.QUALITY_WORKBOOK_URL) || (text(env.QUALITY_WORKBOOK_DRIVE_ID) && text(env.QUALITY_WORKBOOK_ITEM_ID))));
}

async function graphToken(env) {
  if (tokenCache.value && Date.now() < tokenCache.expiresAt - TOKEN_SKEW_MS) return tokenCache.value;
  const tenant = text(env.MS_TENANT_ID);
  const body = new URLSearchParams({
    client_id: text(env.MS_CLIENT_ID),
    client_secret: text(env.MS_CLIENT_SECRET),
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const response = await fetch(`${LOGIN_ROOT}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    tokenCache = { value: "", expiresAt: 0 };
    throw new GraphError(
      "graph_auth_failed",
      `Falha ao autenticar no Microsoft Graph: ${payload.error_description || payload.error || response.status}`,
      502,
    );
  }
  tokenCache = {
    value: payload.access_token,
    expiresAt: Date.now() + (Number(payload.expires_in) || 3600) * 1000,
  };
  return tokenCache.value;
}

/**
 * Faz a chamada ja com o token e trata os erros que a Qualidade precisa entender
 * (arquivo bloqueado, sem permissao, planilha movida). Um unico retry cobre o
 * 429/503 do Graph e o token que expirou entre o cache e a chamada.
 */
async function graphFetch(env, path, options = {}, attempt = 0) {
  const token = await graphToken(env);
  const response = await fetch(`${GRAPH_ROOT}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  if (response.status === 401 && attempt === 0) {
    tokenCache = { value: "", expiresAt: 0 };
    return graphFetch(env, path, options, attempt + 1);
  }
  if ((response.status === 429 || response.status === 503) && attempt < 1) {
    const wait = Math.min(5, Number(response.headers.get("retry-after")) || 2) * 1000;
    await new Promise((resolve) => setTimeout(resolve, wait));
    return graphFetch(env, path, options, attempt + 1);
  }
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.error?.message || `HTTP ${response.status}`;
    if (response.status === 403) {
      throw new GraphError("graph_forbidden", `O aplicativo nao tem permissao na planilha: ${detail}`, 502);
    }
    if (response.status === 404) {
      workbookCache = null;
      throw new GraphError("graph_not_found", `Planilha ou aba nao encontrada: ${detail}`, 502);
    }
    if (response.status === 423) {
      throw new GraphError("graph_locked", "A planilha esta bloqueada para edicao no momento. Tente novamente em instantes.", 503);
    }
    throw new GraphError("graph_request_failed", detail, 502);
  }
  return payload;
}

// O link que o usuario copia do navegador (SharePoint ou OneDrive) e aceito pelo
// endpoint /shares, o que evita descobrir driveId/itemId na mao para configurar.
function encodeSharingUrl(url) {
  const bytes = new TextEncoder().encode(url);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `u!${btoa(binary).replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-")}`;
}

async function resolveWorkbook(env) {
  if (workbookCache) return workbookCache;
  const driveId = text(env.QUALITY_WORKBOOK_DRIVE_ID);
  const itemId = text(env.QUALITY_WORKBOOK_ITEM_ID);
  if (driveId && itemId) {
    workbookCache = { driveId, itemId, name: text(env.QUALITY_WORKBOOK_NAME) || "planilha da Qualidade", webUrl: "" };
    return workbookCache;
  }
  const shareUrl = text(env.QUALITY_WORKBOOK_URL);
  if (!shareUrl) throw new GraphError("graph_not_configured", "QUALITY_WORKBOOK_URL nao configurada.", 503);
  const item = await graphFetch(
    env,
    `/shares/${encodeSharingUrl(shareUrl)}/driveItem?$select=id,name,webUrl,parentReference`,
  );
  if (!item?.id || !item?.parentReference?.driveId) {
    throw new GraphError("graph_not_found", "Nao foi possivel localizar a planilha pelo link configurado.", 502);
  }
  workbookCache = {
    driveId: item.parentReference.driveId,
    itemId: item.id,
    name: item.name,
    webUrl: item.webUrl || "",
  };
  return workbookCache;
}

function workbookPath(reference, suffix) {
  return `/drives/${encodeURIComponent(reference.driveId)}/items/${encodeURIComponent(reference.itemId)}/workbook${suffix}`;
}

function sheetSegment(name) {
  return `worksheets('${encodeURIComponent(String(name).replace(/'/g, "''"))}')`;
}

function columnLetters(index) {
  let value = index;
  let letters = "";
  while (value >= 0) {
    letters = String.fromCharCode(65 + (value % 26)) + letters;
    value = Math.floor(value / 26) - 1;
  }
  return letters;
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = parseFloat(String(value).replace(",", "."));
  return Number.isNaN(parsed) ? text(value) || null : parsed;
}

/**
 * Data no formato serial do Excel, calculada no fuso de Sao Paulo. O Worker roda
 * em UTC: converter o instante direto jogaria os apontamentos do fim do 3o turno
 * para o dia seguinte na planilha.
 */
function excelDateSerial(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(SAO_PAULO.formatToParts(date).map((part) => [part.type, part.value]));
  const days = (Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) - Date.UTC(1899, 11, 30)) / 86_400_000;
  const seconds = Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
  return days + seconds / 86_400;
}

const TURNO_MAP = {
  "1º Turno": "A", "2º Turno": "B", "3º Turno": "C",
  "Turno A": "A", "Turno B": "B", "Turno C": "C",
};

export function qualitySheetFor(record) {
  const tipo = text(record.tipoAmostragem);
  if (["Tubetes", "Tubeteira"].includes(tipo)) return "Tubetes";
  if (tipo === "Cantoneira") return "Cantoneira";
  if (tipo === "Klabin" || text(record.cliente).toLowerCase().includes("klabin")) return "Klabin";
  return "Diário";
}

/**
 * Mesma ordem de colunas que o app.html usava ao escrever localmente. A montagem
 * vive no Worker para existir uma unica fonte da verdade do layout de cada aba.
 */
export function qualityRowFor(record, sheetName) {
  const data = excelDateSerial(record.criadoEm);
  const turno = TURNO_MAP[text(record.turno)] || text(record.turno);
  if (sheetName === "Tubetes") {
    return [
      toNumber(record.contagemOP) || 1, data, toNumber(record.polegadas), text(record.lote),
      toNumber(record.umidade), toNumber(record.espParede), toNumber(record.diamExterno),
      toNumber(record.diamInterno), toNumber(record.compressao), toNumber(record.comprimento), "",
    ];
  }
  if (sheetName === "Klabin") {
    return [
      data, text(record.inspetor), turno, text(record.maquina), text(record.cliente), text(record.numeroOP),
      toNumber(record.contagemOP), text(record.produto), text(record.lote), toNumber(record.numeroPallet),
      text(record.inicioMeioFim), toNumber(record.formatoLargura), toNumber(record.formatoAltura),
      toNumber(record.gramatura), toNumber(record.espessura), toNumber(record.brilho),
      text(record.status).toUpperCase(), "",
    ];
  }
  if (sheetName === "Cantoneira") {
    return [
      data, text(record.inspetor), turno, text(record.maquina), text(record.cliente), text(record.numeroOP),
      text(record.produto), text(record.lote), toNumber(record.cantComprimentoNominal),
      toNumber(record.cantComprimentoMedido), toNumber(record.cantAbasNominal), toNumber(record.cantAbasMedido),
      toNumber(record.cantEspessuraNominal), toNumber(record.cantEspessuraMedida), toNumber(record.cantUmidade),
      text(record.status).toUpperCase(), text(record.motivoStatus), text(record.desvioEncontrado),
      text(record.observacoes),
    ];
  }
  return [
    data, text(record.inspetor), turno, text(record.maquina), text(record.cliente), text(record.numeroOP),
    text(record.produto), text(record.lote), toNumber(record.formatoLargura), toNumber(record.formatoAltura),
    toNumber(record.gramatura), toNumber(record.espessura), toNumber(record.brilho), text(record.direcaoFilme),
    toNumber(record.cobb), toNumber(record.umidadeGeral || record.umidade), text(record.colagem),
    text(record.embalagem), text(record.desvioEncontrado), text(record.status).toUpperCase(),
    toNumber(record.contOp), toNumber(record.contCondicao), text(record.observacoes), "",
  ];
}

async function firstTable(env, reference, sheetName) {
  const payload = await graphFetch(env, `${workbookPath(reference, `/${sheetSegment(sheetName)}/tables`)}?$select=id,name`);
  return payload?.value?.[0] || null;
}

async function ensureCantoneiraSheet(env, reference) {
  const sheets = await graphFetch(env, `${workbookPath(reference, "/worksheets")}?$select=name`);
  if ((sheets?.value || []).some((sheet) => sheet.name === "Cantoneira")) return;
  await graphFetch(env, workbookPath(reference, "/worksheets/add"), {
    method: "POST",
    body: JSON.stringify({ name: "Cantoneira" }),
  });
  const lastColumn = columnLetters(CANTONEIRA_HEADER.length - 1);
  await graphFetch(env, workbookPath(reference, `/${sheetSegment("Cantoneira")}/range(address='A1:${lastColumn}1')`), {
    method: "PATCH",
    body: JSON.stringify({ values: [CANTONEIRA_HEADER] }),
  });
  await graphFetch(env, workbookPath(reference, "/tables/add"), {
    method: "POST",
    body: JSON.stringify({ address: `Cantoneira!A1:${lastColumn}1`, hasHeaders: true }),
  });
}

/**
 * Insere o apontamento na aba correspondente.
 *
 * Caminho preferido: `tables/{id}/rows/add`, que faz o Excel estender a tabela e
 * herdar formatacao, formulas e validacao da coluna. Se a aba nao estiver como
 * Tabela do Excel, cai para um PATCH na primeira linha livre — funciona, mas a
 * formatacao so acompanha se a area ja estiver formatada.
 */
export async function appendQualityRow(env, record) {
  if (!graphConfigured(env)) {
    throw new GraphError("graph_not_configured", "Integracao com a planilha da Qualidade nao configurada.", 503);
  }
  const sheetName = qualitySheetFor(record);
  const reference = await resolveWorkbook(env);
  if (sheetName === "Cantoneira") await ensureCantoneiraSheet(env, reference);
  const values = [qualityRowFor(record, sheetName)];

  const table = await firstTable(env, reference, sheetName);
  if (table) {
    const created = await graphFetch(env, workbookPath(reference, `/tables/${encodeURIComponent(table.id)}/rows/add`), {
      method: "POST",
      body: JSON.stringify({ index: null, values }),
    });
    return {
      sheet: sheetName,
      mode: "table",
      table: table.name || table.id,
      index: created?.index ?? null,
      file: reference.name,
      webUrl: reference.webUrl,
    };
  }

  const used = await graphFetch(
    env,
    `${workbookPath(reference, `/${sheetSegment(sheetName)}/usedRange(valuesOnly=true)`)}?$select=rowIndex,rowCount,columnCount`,
  );
  const nextRow = (Number(used?.rowIndex) || 0) + (Number(used?.rowCount) || 0) + 1;
  const lastColumn = columnLetters(values[0].length - 1);
  const address = `A${nextRow}:${lastColumn}${nextRow}`;
  await graphFetch(env, workbookPath(reference, `/${sheetSegment(sheetName)}/range(address='${address}')`), {
    method: "PATCH",
    body: JSON.stringify({ values }),
  });
  return { sheet: sheetName, mode: "range", address, file: reference.name, webUrl: reference.webUrl };
}

/** Diagnostico da conexao, usado pelo cartao da aba de apontamento. */
export async function qualityWorkbookStatus(env) {
  if (!graphConfigured(env)) {
    return { configured: false, ready: false, message: "Integracao com a planilha oficial nao configurada." };
  }
  try {
    const reference = await resolveWorkbook(env);
    const sheets = await graphFetch(env, `${workbookPath(reference, "/worksheets")}?$select=name`);
    const names = (sheets?.value || []).map((sheet) => sheet.name);
    const missing = ["Diário", "Klabin", "Tubetes"].filter((name) => !names.includes(name));
    return {
      configured: true,
      ready: missing.length === 0,
      file: reference.name,
      webUrl: reference.webUrl,
      sheets: names,
      missing,
      message: missing.length
        ? `Planilha conectada, mas faltam as abas: ${missing.join(", ")}.`
        : `${reference.name} conectada — os apontamentos entram direto na planilha oficial.`,
    };
  } catch (error) {
    return {
      configured: true,
      ready: false,
      code: error?.code || "graph_request_failed",
      message: error?.message || "Nao foi possivel acessar a planilha oficial.",
    };
  }
}

export { GraphError };
