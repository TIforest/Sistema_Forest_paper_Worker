-- Telemetria de uso por usuario e modulo.
--
-- Guarda um contador por (dia, usuario, modulo) em vez de uma linha por
-- requisicao: com ~20 pessoas e 9 modulos a tabela fica na casa das centenas de
-- linhas por mes, enquanto o log bruto passaria de dezenas de milhares e exigiria
-- agregacao a cada consulta.
--
-- actor_name e actor_role sao desnormalizados de proposito. O relatorio precisa
-- mostrar quem era a pessoa no momento do acesso; se alguem muda de setor ou sai
-- da empresa, o historico nao pode se reescrever sozinho.
CREATE TABLE IF NOT EXISTS access_usage (
  day         TEXT    NOT NULL,          -- YYYY-MM-DD no fuso America/Sao_Paulo
  actor_hash  TEXT    NOT NULL,
  actor_name  TEXT    NOT NULL,
  actor_role  TEXT    NOT NULL,
  module      TEXT    NOT NULL,
  hits        INTEGER NOT NULL DEFAULT 0,
  last_seen   TEXT    NOT NULL,
  PRIMARY KEY (day, actor_hash, module)
);

-- A limpeza por retencao e os relatorios filtram sempre por intervalo de dia.
CREATE INDEX IF NOT EXISTS idx_access_usage_day ON access_usage(day);
