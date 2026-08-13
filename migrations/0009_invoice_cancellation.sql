ALTER TABLE commercial_invoice_items ADD COLUMN data_cancelamento TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS commercial_invoice_cancellation_idx
  ON commercial_invoice_items (data_cancelamento, tipo_nota, data_emissao DESC);
