ALTER TABLE orders ADD COLUMN cnpj_cliente TEXT NOT NULL DEFAULT '';
ALTER TABLE commercial_invoice_items ADD COLUMN cnpj_cliente TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS orders_customer_tax_id_idx
  ON orders (cnpj_cliente, data_emissao DESC);

CREATE INDEX IF NOT EXISTS commercial_invoice_customer_tax_id_idx
  ON commercial_invoice_items (cnpj_cliente, data_emissao DESC);
