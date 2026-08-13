PRAGMA foreign_keys = OFF;

CREATE TABLE user_roles_new (
  identity_hash TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('producao', 'qualidade', 'comercial', 'diretoria', 'admin')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  machine_name TEXT NOT NULL DEFAULT '',
  pin_salt TEXT,
  pin_hash TEXT,
  pin_iterations INTEGER NOT NULL DEFAULT 120000,
  pin_updated_at TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT
);

INSERT INTO user_roles_new (
  identity_hash, display_name, role, active, created_at, machine_name,
  pin_salt, pin_hash, pin_iterations, pin_updated_at, failed_attempts, locked_until
)
SELECT identity_hash, display_name, role, active, created_at, machine_name,
       pin_salt, pin_hash, pin_iterations, pin_updated_at, failed_attempts, locked_until
FROM user_roles;

DROP TABLE user_roles;
ALTER TABLE user_roles_new RENAME TO user_roles;

PRAGMA foreign_keys = ON;
