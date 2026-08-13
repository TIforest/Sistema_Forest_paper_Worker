ALTER TABLE user_roles ADD COLUMN pin_salt TEXT;
ALTER TABLE user_roles ADD COLUMN pin_hash TEXT;
ALTER TABLE user_roles ADD COLUMN pin_iterations INTEGER NOT NULL DEFAULT 120000;
ALTER TABLE user_roles ADD COLUMN pin_updated_at TEXT;
ALTER TABLE user_roles ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_roles ADD COLUMN locked_until TEXT;

CREATE TABLE IF NOT EXISTS operator_devices (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  machine_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT,
  revoked_by TEXT
);

CREATE INDEX IF NOT EXISTS operator_devices_machine_active_idx
  ON operator_devices (machine_name, active);

CREATE TABLE IF NOT EXISTS operator_sessions (
  token_hash TEXT PRIMARY KEY,
  identity_hash TEXT NOT NULL,
  device_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (identity_hash) REFERENCES user_roles(identity_hash) ON DELETE CASCADE,
  FOREIGN KEY (device_id) REFERENCES operator_devices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS operator_sessions_identity_idx
  ON operator_sessions (identity_hash, expires_at);

CREATE INDEX IF NOT EXISTS operator_sessions_device_idx
  ON operator_sessions (device_id, expires_at);
