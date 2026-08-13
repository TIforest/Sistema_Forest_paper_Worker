ALTER TABLE user_roles ADD COLUMN machine_name TEXT NOT NULL DEFAULT '';

ALTER TABLE orders ADD COLUMN production_shift TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN production_operator TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN shift_finished INTEGER;
ALTER TABLE orders ADD COLUMN shift_finished_at TEXT;

CREATE INDEX IF NOT EXISTS orders_production_shift_idx
  ON orders (production_shift, producao_concluida_em);

CREATE INDEX IF NOT EXISTS orders_machine_completed_idx
  ON orders (maquina, producao_concluida_em);
