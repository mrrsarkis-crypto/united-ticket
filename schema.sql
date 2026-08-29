CREATE TABLE IF NOT EXISTS cases (
  tracking_code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  court TEXT,
  citation TEXT,
  service TEXT,
  status TEXT NOT NULL DEFAULT 'payment_pending',
  notes TEXT,
  created_at TEXT,
  paid_at TEXT,
  reminder_at TEXT,
  result TEXT
);
CREATE INDEX IF NOT EXISTS idx_cases_email ON cases(email);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
