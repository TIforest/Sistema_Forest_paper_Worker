CREATE TABLE IF NOT EXISTS feature_flags (
  flag_key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT NOT NULL DEFAULT 'system'
);

INSERT OR IGNORE INTO feature_flags (flag_key, enabled)
VALUES ('finance_payables', 0);

CREATE TABLE IF NOT EXISTS finance_payables_cache (
  cache_key TEXT PRIMARY KEY,
  branch TEXT NOT NULL,
  title_number TEXT NOT NULL,
  title_type TEXT NOT NULL DEFAULT '',
  installment TEXT NOT NULL DEFAULT '',
  nature TEXT NOT NULL DEFAULT '',
  supplier_code TEXT NOT NULL DEFAULT '',
  supplier_store TEXT NOT NULL DEFAULT '',
  supplier_name TEXT NOT NULL DEFAULT '',
  supplier_tax_id TEXT NOT NULL DEFAULT '',
  issue_date TEXT NOT NULL DEFAULT '',
  accounting_date TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL DEFAULT '',
  actual_due_date TEXT NOT NULL DEFAULT '',
  original_value REAL NOT NULL DEFAULT 0,
  open_balance REAL NOT NULL DEFAULT 0,
  settlement_date TEXT NOT NULL DEFAULT '',
  first_seen_at TEXT NOT NULL,
  source_updated_at TEXT NOT NULL,
  payload_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_finance_payables_actual_due
  ON finance_payables_cache(actual_due_date, open_balance);
CREATE INDEX IF NOT EXISTS idx_finance_payables_year
  ON finance_payables_cache(issue_date, branch);

CREATE TABLE IF NOT EXISTS finance_purchase_orders_cache (
  cache_key TEXT PRIMARY KEY,
  branch TEXT NOT NULL,
  order_number TEXT NOT NULL,
  item_number TEXT NOT NULL DEFAULT '',
  issue_date TEXT NOT NULL DEFAULT '',
  supplier_code TEXT NOT NULL DEFAULT '',
  supplier_store TEXT NOT NULL DEFAULT '',
  supplier_name TEXT NOT NULL DEFAULT '',
  supplier_tax_id TEXT NOT NULL DEFAULT '',
  payment_condition TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT '',
  product_code TEXT NOT NULL DEFAULT '',
  product_description TEXT NOT NULL DEFAULT '',
  ordered_quantity REAL NOT NULL DEFAULT 0,
  received_quantity REAL NOT NULL DEFAULT 0,
  open_quantity REAL NOT NULL DEFAULT 0,
  unit_value REAL NOT NULL DEFAULT 0,
  total_value REAL NOT NULL DEFAULT 0,
  open_value REAL NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL,
  source_updated_at TEXT NOT NULL,
  payload_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_finance_purchase_orders_year
  ON finance_purchase_orders_cache(issue_date, branch, open_quantity);

CREATE TABLE IF NOT EXISTS finance_status_overrides (
  cache_key TEXT PRIMARY KEY,
  manual_status TEXT NOT NULL CHECK (manual_status IN ('a vencer', 'vencido', 'negociado', 'pago', 'pagar')),
  updated_at TEXT NOT NULL,
  updated_by_hash TEXT NOT NULL,
  updated_by_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS finance_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cache_key TEXT NOT NULL,
  previous_status TEXT NOT NULL DEFAULT '',
  new_status TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  changed_by_hash TEXT NOT NULL,
  changed_by_name TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_finance_status_history_key
  ON finance_status_history(cache_key, changed_at DESC);

CREATE TABLE IF NOT EXISTS finance_account_balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  balance_date TEXT NOT NULL,
  account_key TEXT NOT NULL,
  account_name TEXT NOT NULL,
  balance_value REAL NOT NULL,
  recorded_at TEXT NOT NULL,
  recorded_by_hash TEXT NOT NULL,
  recorded_by_name TEXT NOT NULL,
  UNIQUE(balance_date, account_key)
);

CREATE INDEX IF NOT EXISTS idx_finance_account_balances_date
  ON finance_account_balances(balance_date DESC, account_key);

CREATE TABLE IF NOT EXISTS finance_sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'error', 'skipped')),
  payables_received INTEGER NOT NULL DEFAULT 0,
  purchases_received INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error_message TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_finance_sync_runs_started
  ON finance_sync_runs(started_at DESC);
