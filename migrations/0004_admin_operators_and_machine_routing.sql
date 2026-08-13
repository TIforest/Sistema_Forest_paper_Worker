ALTER TABLE orders ADD COLUMN target_machine TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS orders_target_machine_status_idx
  ON orders (target_machine, workflow_status);

UPDATE user_roles
   SET machine_name = ''
 WHERE role = 'admin';
