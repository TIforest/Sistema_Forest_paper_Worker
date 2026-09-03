-- listOrders() em src/worker.js roda "SELECT ... FROM orders ORDER BY data_emissao DESC, pedido, item LIMIT 5000"
-- sem indice que cubra essa ordenacao. wrangler d1 insights mediu avgRowsRead=14415 e
-- avgDurationMs=50ms nessa query (5x o limite de CPU de 10ms do plano Free), rodando ~1.400x/dia
-- via GET /api/orders. Este indice permite ao SQLite retornar as linhas ja na ordem exigida,
-- sem sort completo em memoria.
CREATE INDEX IF NOT EXISTS orders_listing_idx
  ON orders (data_emissao DESC, pedido, item);
