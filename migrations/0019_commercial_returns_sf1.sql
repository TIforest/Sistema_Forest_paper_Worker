-- Devolucoes de venda vem de SF1/SD1 (nota de entrada, F1_TIPO='D').
-- origem separa a procedencia da linha: 'SF2' (faturamento e devolucao de
-- compra) ou 'SF1' (devolucao de venda).
-- nota/serie/item de origem sao o vinculo obrigatorio com a nota faturada
-- (D1_NFORI / D1_SERIORI / D1_ITEMORI).
ALTER TABLE commercial_invoice_items ADD COLUMN origem TEXT NOT NULL DEFAULT 'SF2';
ALTER TABLE commercial_invoice_items ADD COLUMN nota_origem TEXT NOT NULL DEFAULT '';
ALTER TABLE commercial_invoice_items ADD COLUMN serie_origem TEXT NOT NULL DEFAULT '';
ALTER TABLE commercial_invoice_items ADD COLUMN item_origem TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS commercial_invoice_origem_idx
  ON commercial_invoice_items (origem, registro_tipo, data_emissao DESC);
