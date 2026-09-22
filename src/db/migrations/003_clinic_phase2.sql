ALTER TABLE clinic_sessions ADD COLUMN google_calendar_event_id TEXT NOT NULL DEFAULT '';
ALTER TABLE clinic_sessions ADD COLUMN google_calendar_id TEXT NOT NULL DEFAULT '';
ALTER TABLE clinic_sessions ADD COLUMN google_calendar_sync_status TEXT NOT NULL DEFAULT 'skipped' CHECK (google_calendar_sync_status IN ('pending', 'synced', 'failed', 'skipped'));
ALTER TABLE clinic_sessions ADD COLUMN google_calendar_last_synced_at TEXT NOT NULL DEFAULT '';
ALTER TABLE clinic_sessions ADD COLUMN google_calendar_error TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_clinic_sessions_google_sync_status ON clinic_sessions (google_calendar_sync_status);

CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL UNIQUE REFERENCES clinic_sessions(id) ON DELETE CASCADE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  receipt_number TEXT NOT NULL UNIQUE,
  sequence_number INTEGER NOT NULL UNIQUE,
  professional_name TEXT NOT NULL,
  crp TEXT NOT NULL,
  professional_document TEXT NOT NULL DEFAULT '',
  receipt_city TEXT NOT NULL DEFAULT '',
  receipt_footer_text TEXT NOT NULL DEFAULT '',
  patient_name TEXT NOT NULL,
  payer_name TEXT NOT NULL DEFAULT '',
  payer_document TEXT NOT NULL DEFAULT '',
  session_date TEXT NOT NULL,
  payment_date TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL,
  service_description TEXT NOT NULL,
  notice_text TEXT NOT NULL,
  file_storage_provider TEXT NOT NULL,
  file_object_key TEXT NOT NULL,
  file_content_type TEXT NOT NULL DEFAULT 'application/pdf',
  file_size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_receipts_patient_id ON receipts (patient_id);
CREATE INDEX IF NOT EXISTS idx_receipts_sequence_number ON receipts (sequence_number);

CREATE TABLE IF NOT EXISTS google_calendar_connections (
  connection_key TEXT PRIMARY KEY,
  email TEXT NOT NULL DEFAULT '',
  access_token TEXT NOT NULL DEFAULT '',
  refresh_token TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT '',
  token_type TEXT NOT NULL DEFAULT '',
  expiry_date TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
