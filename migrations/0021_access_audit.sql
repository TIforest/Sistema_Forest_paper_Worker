-- Persistencia da auditoria de acesso.
--
-- O console.log continua sendo emitido: o D1 e adicional, nao substituto. O log
-- da Cloudflare tem retencao curta, o que impedia investigar historico e, pior,
-- impedia saber se um e-mail ja tinha aparecido antes.
CREATE TABLE IF NOT EXISTS access_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL,
  email       TEXT,
  access_sub  TEXT,
  decision    TEXT NOT NULL,
  reason      TEXT,
  route       TEXT NOT NULL,
  method      TEXT NOT NULL,
  ip          TEXT,
  country     TEXT,
  user_agent  TEXT
);

-- Resumo diario varre por periodo; investigacao varre por pessoa.
CREATE INDEX IF NOT EXISTS idx_access_audit_ts ON access_audit(ts);
CREATE INDEX IF NOT EXISTS idx_access_audit_email_ts ON access_audit(email, ts);
-- O resumo le so os negados das ultimas 24h; sem este indice a consulta
-- percorreria os ~1.400 eventos/dia inteiros para achar as poucas dezenas.
CREATE INDEX IF NOT EXISTS idx_access_audit_decision_ts ON access_audit(decision, ts);

-- Memoria de quem ja apareceu, independente da retencao de 90 dias.
--
-- Deliberadamente separada de access_audit: se a "primeira aparicao" fosse
-- deduzida da propria tabela de eventos, a limpeza de 90 dias faria um
-- funcionario antigo que passou tres meses sem acessar ser anunciado como novo.
-- Aqui a linha nasce uma vez e nunca e apagada.
CREATE TABLE IF NOT EXISTS known_emails (
  email          TEXT PRIMARY KEY,
  first_seen_at  TEXT NOT NULL,
  first_decision TEXT NOT NULL,
  first_reason   TEXT,
  first_route    TEXT,
  first_ip       TEXT,
  first_country  TEXT,
  -- Cidade e regiao existem so aqui: o resumo pede "cidade/UF" da primeira
  -- aparicao, mas o evento logado nunca teve esses campos e nao vai ganha-los.
  first_city     TEXT,
  first_region   TEXT
);
CREATE INDEX IF NOT EXISTS idx_known_emails_first_seen ON known_emails(first_seen_at);

-- Limita alertas imediatos a um por operador por hora.
CREATE TABLE IF NOT EXISTS alert_throttle (
  alert_key    TEXT PRIMARY KEY,
  last_sent_at TEXT NOT NULL
);
