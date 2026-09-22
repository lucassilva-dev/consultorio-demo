CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  age INTEGER,
  source TEXT NOT NULL CHECK (source IN ('site', 'instagram', 'indicacao', 'whatsapp', 'outro')),
  interest TEXT NOT NULL CHECK (interest IN ('adulto', 'adolescente', 'jovem_adulto', 'responsavel_adolescente', 'outro')),
  status TEXT NOT NULL CHECK (status IN ('novo', 'contato_realizado', 'conversa_agendada', 'aguardando_retorno', 'virou_paciente', 'perdido')),
  preferred_period TEXT NOT NULL CHECK (preferred_period IN ('manha', 'tarde', 'noite', 'sabado', 'flexivel')),
  administrative_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_name ON leads (name);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads (phone);

CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  preferred_name TEXT NOT NULL DEFAULT '',
  birth_date TEXT NOT NULL DEFAULT '',
  age INTEGER,
  phone TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  patient_type TEXT NOT NULL CHECK (patient_type IN ('adulto', 'adolescente', 'jovem_adulto')),
  guardian_name TEXT NOT NULL DEFAULT '',
  guardian_phone TEXT NOT NULL DEFAULT '',
  session_price REAL NOT NULL DEFAULT 0,
  default_weekday TEXT NOT NULL DEFAULT '' CHECK (default_weekday IN ('', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo')),
  default_time TEXT NOT NULL DEFAULT '',
  modality TEXT NOT NULL CHECK (modality IN ('online', 'presencial', 'hibrido')),
  status TEXT NOT NULL CHECK (status IN ('ativo', 'pausado', 'encerrado')),
  administrative_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_patients_status ON patients (status);
CREATE INDEX IF NOT EXISTS idx_patients_full_name ON patients (full_name);
CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients (phone);

CREATE TABLE IF NOT EXISTS clinic_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  scheduled_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('agendada', 'realizada', 'falta', 'cancelada', 'remarcada')),
  payment_status TEXT NOT NULL CHECK (payment_status IN ('pendente', 'pago', 'isento', 'cancelado')),
  price REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('pix', 'dinheiro', 'cartao', 'plataforma', 'outro')),
  paid_at TEXT NOT NULL DEFAULT '',
  meeting_url TEXT NOT NULL DEFAULT '',
  administrative_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clinic_sessions_patient_id ON clinic_sessions (patient_id);
CREATE INDEX IF NOT EXISTS idx_clinic_sessions_scheduled_at ON clinic_sessions (scheduled_at);
CREATE INDEX IF NOT EXISTS idx_clinic_sessions_status ON clinic_sessions (status);
CREATE INDEX IF NOT EXISTS idx_clinic_sessions_payment_status ON clinic_sessions (payment_status);

CREATE TABLE IF NOT EXISTS message_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('novo_contato', 'envio_valor', 'confirmacao_sessao', 'lembrete_sessao', 'reagendamento', 'cobranca', 'contrato', 'adolescente_responsavel', 'retorno_ferias', 'outro')),
  body TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_message_templates_category ON message_templates (category);
CREATE INDEX IF NOT EXISTS idx_message_templates_is_active ON message_templates (is_active);

CREATE TABLE IF NOT EXISTS platform_settings (
  settings_key TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
