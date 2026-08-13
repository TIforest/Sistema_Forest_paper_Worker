ALTER TABLE orders ADD COLUMN volume REAL NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN data_embarque TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN tipo_frete TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN quantidade_entregue REAL NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN vendedor_nome TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN produto_base TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN condicao_descricao TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN prazos_pagamento TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN media_pagamento_dias REAL NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS orders_commercial_period_idx
  ON orders (data_emissao, filial, vendedor);

CREATE INDEX IF NOT EXISTS orders_commercial_customer_idx
  ON orders (codigo_cliente, loja_cliente, data_emissao);

ALTER TABLE commercial_invoice_items ADD COLUMN condicao_pagamento TEXT NOT NULL DEFAULT '';
ALTER TABLE commercial_invoice_items ADD COLUMN condicao_descricao TEXT NOT NULL DEFAULT '';
ALTER TABLE commercial_invoice_items ADD COLUMN prazos_pagamento TEXT NOT NULL DEFAULT '';
ALTER TABLE commercial_invoice_items ADD COLUMN media_pagamento_dias REAL NOT NULL DEFAULT 0;
ALTER TABLE commercial_invoice_items ADD COLUMN produto_base TEXT NOT NULL DEFAULT '';
ALTER TABLE commercial_invoice_items ADD COLUMN valor_total_nf REAL NOT NULL DEFAULT 0;
ALTER TABLE commercial_invoice_items ADD COLUMN valor_bruto_item REAL NOT NULL DEFAULT 0;
ALTER TABLE commercial_invoice_items ADD COLUMN preco_por_tonelada REAL NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS commercial_invoice_condition_idx
  ON commercial_invoice_items (condicao_pagamento, data_emissao DESC);

CREATE INDEX IF NOT EXISTS commercial_invoice_customer_idx
  ON commercial_invoice_items (codigo_cliente, loja_cliente, data_emissao DESC);
