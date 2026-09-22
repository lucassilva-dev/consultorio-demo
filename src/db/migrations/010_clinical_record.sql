-- O prontuário em si.
--
-- Até aqui o sistema tinha anamnese (005) e evoluções (005), mas nada que se
-- abrisse, se preenchesse e se fechasse: o prontuário existia como soma de duas
-- peças, e não como registro. Pela Resolução CFP 001/2009 o prontuário é o
-- registro do caso — identificação, contrato e consentimento, plano
-- terapêutico, evolução de cada atendimento, documentos emitidos e
-- encerramento. Esta migração traz as quatro peças que faltavam.
--
-- Todo conteúdo clínico continua criptografado em repouso (AES-256-GCM), com o
-- prefixo clin:v1 de src/lib/clinical-crypto.js.

CREATE TABLE IF NOT EXISTS clinical_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  record_number TEXT NOT NULL DEFAULT '',
  sequence_number INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  -- Motivo em coluna própria, e não só dentro do bloco criptografado: o
  -- encerramento precisa ser filtrável sem abrir o conteúdo clínico.
  closing_reason TEXT NOT NULL DEFAULT '' CHECK (
    closing_reason IN ('', 'discharge', 'dropout', 'referral', 'professional_change', 'other')
  ),
  opened_at TEXT NOT NULL,
  closed_at TEXT NOT NULL DEFAULT '',
  opened_by_admin_id INTEGER,
  opened_by_admin_email TEXT NOT NULL DEFAULT '',
  closed_by_admin_id INTEGER,
  closed_by_admin_email TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clinical_records_patient ON clinical_records (patient_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clinical_records_number ON clinical_records (record_number);

-- Contrato, plano terapêutico e encerramento têm o mesmo formato de payload da
-- anamnese (seções com perguntas e respostas). Um par genérico de tabelas cobre
-- os três e reaproveita o versionamento que já existe, em vez de triplicar
-- clinical_intakes/clinical_intake_versions.
CREATE TABLE IF NOT EXISTS clinical_record_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL REFERENCES clinical_records(id) ON DELETE CASCADE,
  block_type TEXT NOT NULL CHECK (block_type IN ('contract', 'plan', 'closing')),
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_clinical_record_blocks_type
  ON clinical_record_blocks (record_id, block_type);

CREATE TABLE IF NOT EXISTS clinical_record_block_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  block_id INTEGER NOT NULL REFERENCES clinical_record_blocks(id) ON DELETE CASCADE,
  encrypted_payload TEXT NOT NULL DEFAULT '',
  payload_hash TEXT NOT NULL DEFAULT '',
  version_number INTEGER NOT NULL,
  changed_by_admin_id INTEGER,
  changed_by_admin_email TEXT NOT NULL DEFAULT '',
  change_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clinical_record_block_versions_block
  ON clinical_record_block_versions (block_id);

-- Documentos emitidos (Resolução CFP 006/2019). Mesmo desenho dos recibos:
-- numeração própria, PDF no armazenamento privado e registro imutável. O corpo
-- do documento — destinatário, finalidade e texto — vai criptografado num
-- payload só; em claro fica apenas o título, para a listagem.
CREATE TABLE IF NOT EXISTS clinical_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL REFERENCES clinical_records(id) ON DELETE CASCADE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  document_number TEXT NOT NULL DEFAULT '',
  sequence_number INTEGER NOT NULL DEFAULT 0,
  document_type TEXT NOT NULL CHECK (
    document_type IN (
      'attendance_declaration', 'psychological_certificate', 'report', 'opinion', 'referral'
    )
  ),
  title TEXT NOT NULL DEFAULT '',
  encrypted_content TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'revoked')),
  issued_at TEXT NOT NULL,
  revoked_at TEXT NOT NULL DEFAULT '',
  revoke_reason TEXT NOT NULL DEFAULT '',
  file_storage_provider TEXT NOT NULL DEFAULT '',
  file_object_key TEXT NOT NULL DEFAULT '',
  file_content_type TEXT NOT NULL DEFAULT '',
  file_size_bytes INTEGER NOT NULL DEFAULT 0,
  created_by_admin_id INTEGER,
  created_by_admin_email TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clinical_documents_record ON clinical_documents (record_id);
CREATE INDEX IF NOT EXISTS idx_clinical_documents_patient ON clinical_documents (patient_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clinical_documents_number ON clinical_documents (document_number);

-- Quem já tem anamnese ou evolução já tem prontuário na prática: sem este
-- preenchimento os registros existentes ficariam órfãos do registro novo, e a
-- psicóloga teria que "abrir" um prontuário que já está em andamento.
INSERT INTO clinical_records (
  patient_id, record_number, sequence_number, status, closing_reason,
  opened_at, closed_at, opened_by_admin_id, opened_by_admin_email,
  closed_by_admin_id, closed_by_admin_email, created_at, updated_at
)
SELECT
  p.id,
  'PRT-' || substr('000000' || (ROW_NUMBER() OVER (ORDER BY p.id)), -6, 6),
  ROW_NUMBER() OVER (ORDER BY p.id),
  'open',
  '',
  p.created_at,
  '',
  NULL,
  '',
  NULL,
  '',
  p.created_at,
  p.created_at
FROM patients p
WHERE (
    EXISTS (SELECT 1 FROM clinical_intakes ci WHERE ci.patient_id = p.id)
    OR EXISTS (SELECT 1 FROM clinical_evolutions ce WHERE ce.patient_id = p.id)
  )
  AND NOT EXISTS (SELECT 1 FROM clinical_records cr WHERE cr.patient_id = p.id);

-- Contadores que só avançam, como o de recibo (006): apagar um registro não
-- devolve o número ao pool. Buracos na sequência são aceitáveis; número
-- repetido em documento clínico não é.
CREATE TABLE IF NOT EXISTS clinical_record_sequence (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  next_value INTEGER NOT NULL
);

INSERT INTO clinical_record_sequence (id, next_value)
SELECT 1, COALESCE((SELECT MAX(sequence_number) FROM clinical_records), 0) + 1
WHERE NOT EXISTS (SELECT 1 FROM clinical_record_sequence WHERE id = 1);

CREATE TABLE IF NOT EXISTS clinical_document_sequence (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  next_value INTEGER NOT NULL
);

INSERT INTO clinical_document_sequence (id, next_value)
SELECT 1, COALESCE((SELECT MAX(sequence_number) FROM clinical_documents), 0) + 1
WHERE NOT EXISTS (SELECT 1 FROM clinical_document_sequence WHERE id = 1);
