-- Prontuário clínico: anamnese estruturada e evoluções clínicas.
-- Todo conteúdo clínico é armazenado criptografado em repouso (AES-256-GCM).

CREATE TABLE IF NOT EXISTS clinical_intakes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed', 'locked')),
  encrypted_payload TEXT NOT NULL DEFAULT '',
  payload_hash TEXT NOT NULL DEFAULT '',
  created_by_admin_id INTEGER,
  created_by_admin_email TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT '',
  locked_at TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clinical_intakes_patient ON clinical_intakes (patient_id);

CREATE TABLE IF NOT EXISTS clinical_intake_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  intake_id INTEGER NOT NULL REFERENCES clinical_intakes(id) ON DELETE CASCADE,
  encrypted_payload TEXT NOT NULL DEFAULT '',
  payload_hash TEXT NOT NULL DEFAULT '',
  version_number INTEGER NOT NULL,
  changed_by_admin_id INTEGER,
  changed_by_admin_email TEXT NOT NULL DEFAULT '',
  change_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clinical_intake_versions_intake ON clinical_intake_versions (intake_id);

CREATE TABLE IF NOT EXISTS clinical_evolutions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  session_id INTEGER REFERENCES clinic_sessions(id) ON DELETE SET NULL,
  evolution_date TEXT NOT NULL,
  evolution_type TEXT NOT NULL DEFAULT 'session' CHECK (
    evolution_type IN (
      'session', 'initial', 'guardian_contact', 'referral', 'closing', 'addendum', 'correction', 'other'
    )
  ),
  title TEXT NOT NULL DEFAULT '',
  encrypted_content TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'signed', 'locked', 'amended')),
  parent_evolution_id INTEGER REFERENCES clinical_evolutions(id) ON DELETE SET NULL,
  created_by_admin_id INTEGER,
  created_by_admin_email TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  signed_at TEXT NOT NULL DEFAULT '',
  locked_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_clinical_evolutions_patient ON clinical_evolutions (patient_id);
CREATE INDEX IF NOT EXISTS idx_clinical_evolutions_session ON clinical_evolutions (session_id);
CREATE INDEX IF NOT EXISTS idx_clinical_evolutions_parent ON clinical_evolutions (parent_evolution_id);

CREATE TABLE IF NOT EXISTS clinical_evolution_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evolution_id INTEGER NOT NULL REFERENCES clinical_evolutions(id) ON DELETE CASCADE,
  encrypted_content TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL DEFAULT '',
  version_number INTEGER NOT NULL,
  changed_by_admin_id INTEGER,
  changed_by_admin_email TEXT NOT NULL DEFAULT '',
  change_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clinical_evolution_versions_evolution ON clinical_evolution_versions (evolution_id);
