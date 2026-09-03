CREATE TABLE IF NOT EXISTS finance_manual_payables (
  id TEXT PRIMARY KEY,
  supplier_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL,
  due_date TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'a vencer' CHECK (status IN ('a vencer', 'pago')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by_hash TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  paid_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_finance_manual_payables_due
  ON finance_manual_payables(due_date, status);
