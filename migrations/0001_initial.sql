CREATE TABLE IF NOT EXISTS user_roles (
  identity_hash TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('producao', 'qualidade', 'diretoria')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  filial TEXT NOT NULL DEFAULT '',
  pedido TEXT NOT NULL,
  item TEXT NOT NULL DEFAULT '',
  data_emissao TEXT NOT NULL DEFAULT '',
  codigo_cliente TEXT NOT NULL DEFAULT '',
  loja_cliente TEXT NOT NULL DEFAULT '',
  cliente TEXT NOT NULL DEFAULT '',
  cidade TEXT NOT NULL DEFAULT '',
  uf TEXT NOT NULL DEFAULT '',
  codigo_produto TEXT NOT NULL DEFAULT '',
  produto TEXT NOT NULL DEFAULT '',
  unidade TEXT NOT NULL DEFAULT '',
  quantidade REAL NOT NULL DEFAULT 0,
  preco_unitario REAL NOT NULL DEFAULT 0,
  valor_total REAL NOT NULL DEFAULT 0,
  tes TEXT NOT NULL DEFAULT '',
  vendedor TEXT NOT NULL DEFAULT '',
  condicao_pagamento TEXT NOT NULL DEFAULT '',
  tipo_pedido TEXT NOT NULL DEFAULT '',
  nota_fiscal TEXT NOT NULL DEFAULT '',
  serie_nota TEXT NOT NULL DEFAULT '',
  workflow_status TEXT NOT NULL DEFAULT 'Aguardando',
  maquina TEXT NOT NULL DEFAULT '',
  iniciado_em TEXT,
  iniciado_por TEXT,
  producao_concluida_em TEXT,
  qualidade_iniciada_em TEXT,
  qualidade_por TEXT,
  liberado_em TEXT,
  liberado_por TEXT,
  rejeitado_em TEXT,
  erp_hash TEXT NOT NULL,
  source TEXT NOT NULL,
  source_updated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS orders_workflow_status_idx ON orders (workflow_status);
CREATE INDEX IF NOT EXISTS orders_pedido_idx ON orders (pedido);
CREATE INDEX IF NOT EXISTS orders_data_emissao_idx ON orders (data_emissao DESC);

CREATE TABLE IF NOT EXISTS app_state (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_hash TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log (created_at DESC);

CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  rows_received INTEGER NOT NULL DEFAULT 0,
  rows_changed INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
