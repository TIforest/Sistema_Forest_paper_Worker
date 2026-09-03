-- Devolucoes e notas canceladas passam a ser persistidas junto do faturamento.
-- registro_tipo: 'faturamento' | 'devolucao' | 'cancelada'
ALTER TABLE commercial_invoice_items ADD COLUMN registro_tipo TEXT NOT NULL DEFAULT 'faturamento';

CREATE INDEX IF NOT EXISTS commercial_invoice_registro_tipo_idx
  ON commercial_invoice_items (registro_tipo, data_emissao DESC);
