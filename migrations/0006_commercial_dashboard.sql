CREATE TABLE IF NOT EXISTS commercial_invoice_items (
  id TEXT PRIMARY KEY,
  filial TEXT NOT NULL DEFAULT '',
  documento TEXT NOT NULL,
  serie TEXT NOT NULL DEFAULT '',
  data_emissao TEXT NOT NULL DEFAULT '',
  codigo_cliente TEXT NOT NULL DEFAULT '',
  loja_cliente TEXT NOT NULL DEFAULT '',
  cliente TEXT NOT NULL DEFAULT '',
  cidade TEXT NOT NULL DEFAULT '',
  uf TEXT NOT NULL DEFAULT '',
  codigo_vendedor TEXT NOT NULL DEFAULT '',
  vendedor TEXT NOT NULL DEFAULT '',
  pedido TEXT NOT NULL DEFAULT '',
  item_pedido TEXT NOT NULL DEFAULT '',
  item_nota TEXT NOT NULL DEFAULT '',
  codigo_produto TEXT NOT NULL DEFAULT '',
  produto TEXT NOT NULL DEFAULT '',
  quantidade REAL NOT NULL DEFAULT 0,
  preco_unitario REAL NOT NULL DEFAULT 0,
  valor_item REAL NOT NULL DEFAULT 0,
  desconto REAL NOT NULL DEFAULT 0,
  frete_nota REAL NOT NULL DEFAULT 0,
  seguro_nota REAL NOT NULL DEFAULT 0,
  despesas_nota REAL NOT NULL DEFAULT 0,
  ipi_nota REAL NOT NULL DEFAULT 0,
  icms_nota REAL NOT NULL DEFAULT 0,
  valor_bruto_nota REAL NOT NULL DEFAULT 0,
  valor_mercadoria_nota REAL NOT NULL DEFAULT 0,
  valor_faturado_nota REAL NOT NULL DEFAULT 0,
  tipo_nota TEXT NOT NULL DEFAULT '',
  tes TEXT NOT NULL DEFAULT '',
  cfop TEXT NOT NULL DEFAULT '',
  percentual_comissao REAL NOT NULL DEFAULT 0,
  comissao_estimada REAL NOT NULL DEFAULT 0,
  erp_hash TEXT NOT NULL,
  source_updated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS commercial_invoice_emission_idx
  ON commercial_invoice_items (data_emissao DESC);

CREATE INDEX IF NOT EXISTS commercial_invoice_branch_idx
  ON commercial_invoice_items (filial, data_emissao DESC);

CREATE INDEX IF NOT EXISTS commercial_invoice_seller_idx
  ON commercial_invoice_items (codigo_vendedor, data_emissao DESC);

CREATE INDEX IF NOT EXISTS commercial_invoice_document_idx
  ON commercial_invoice_items (filial, documento, serie);

CREATE TABLE IF NOT EXISTS commercial_targets (
  id TEXT PRIMARY KEY,
  periodo TEXT NOT NULL,
  filial TEXT NOT NULL DEFAULT '',
  codigo_vendedor TEXT NOT NULL DEFAULT '',
  valor_meta REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  UNIQUE (periodo, filial, codigo_vendedor)
);

CREATE INDEX IF NOT EXISTS commercial_targets_period_idx
  ON commercial_targets (periodo, filial, codigo_vendedor);
