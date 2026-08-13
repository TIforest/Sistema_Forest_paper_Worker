PRAGMA foreign_keys = OFF;

CREATE TABLE user_roles_new (
  identity_hash TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('producao', 'qualidade', 'diretoria', 'admin')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO user_roles_new (identity_hash, display_name, role, active, created_at)
SELECT identity_hash, display_name, role, active, created_at
FROM user_roles;

DROP TABLE user_roles;
ALTER TABLE user_roles_new RENAME TO user_roles;

PRAGMA foreign_keys = ON;
