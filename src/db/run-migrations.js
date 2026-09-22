const fs = require("fs");
const path = require("path");
const { createMigrationDatabase } = require("./database");

const POSTGRES_MIGRATION_LOCK_KEY = 61442831;
const POSTGRES_BASELINE_TABLES = [
  "admin_users",
  "content_sections",
  "help_cards",
  "leads",
  "patients",
  "clinic_sessions",
  "message_templates",
  "platform_settings"
];

const POSTGRES_BASELINE_CHECK_SQL = `
  SELECT COUNT(*)::int AS total
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN (${POSTGRES_BASELINE_TABLES.map((tableName) => `'${tableName}'`).join(", ")})
`;

const POSTGRES_MIGRATIONS = [
  {
    name: "001_initial",
    sql: `
      CREATE TABLE IF NOT EXISTS admin_users (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        password_iterations INTEGER NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS content_sections (
        section_key TEXT PRIMARY KEY,
        payload_json JSONB NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS help_cards (
        id BIGSERIAL PRIMARY KEY,
        sort_order INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        asset_type TEXT NOT NULL CHECK (asset_type IN ('icon', 'image')),
        asset_value TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `
  },
  {
    name: "002_clinic_admin",
    sql: `
      CREATE TABLE IF NOT EXISTS leads (
        id BIGSERIAL PRIMARY KEY,
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
        id BIGSERIAL PRIMARY KEY,
        full_name TEXT NOT NULL,
        preferred_name TEXT NOT NULL DEFAULT '',
        birth_date TEXT NOT NULL DEFAULT '',
        age INTEGER,
        phone TEXT NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        patient_type TEXT NOT NULL CHECK (patient_type IN ('adulto', 'adolescente', 'jovem_adulto')),
        guardian_name TEXT NOT NULL DEFAULT '',
        guardian_phone TEXT NOT NULL DEFAULT '',
        session_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
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
        id BIGSERIAL PRIMARY KEY,
        patient_id BIGINT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        scheduled_at TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('agendada', 'realizada', 'falta', 'cancelada', 'remarcada')),
        payment_status TEXT NOT NULL CHECK (payment_status IN ('pendente', 'pago', 'isento', 'cancelado')),
        price NUMERIC(10, 2) NOT NULL DEFAULT 0,
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
        id BIGSERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        category TEXT NOT NULL CHECK (category IN ('novo_contato', 'envio_valor', 'confirmacao_sessao', 'lembrete_sessao', 'reagendamento', 'cobranca', 'contrato', 'adolescente_responsavel', 'retorno_ferias', 'outro')),
        body TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_message_templates_category ON message_templates (category);
      CREATE INDEX IF NOT EXISTS idx_message_templates_is_active ON message_templates (is_active);

      CREATE TABLE IF NOT EXISTS platform_settings (
        settings_key TEXT PRIMARY KEY,
        payload_json JSONB NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `
  },
  {
    name: "003_clinic_phase2",
    sql: `
      ALTER TABLE clinic_sessions ADD COLUMN IF NOT EXISTS google_calendar_event_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE clinic_sessions ADD COLUMN IF NOT EXISTS google_calendar_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE clinic_sessions ADD COLUMN IF NOT EXISTS google_calendar_sync_status TEXT NOT NULL DEFAULT 'skipped';
      ALTER TABLE clinic_sessions ADD COLUMN IF NOT EXISTS google_calendar_last_synced_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE clinic_sessions ADD COLUMN IF NOT EXISTS google_calendar_error TEXT NOT NULL DEFAULT '';

      CREATE INDEX IF NOT EXISTS idx_clinic_sessions_google_sync_status ON clinic_sessions (google_calendar_sync_status);

      CREATE TABLE IF NOT EXISTS receipts (
        id BIGSERIAL PRIMARY KEY,
        session_id BIGINT NOT NULL UNIQUE REFERENCES clinic_sessions(id) ON DELETE CASCADE,
        patient_id BIGINT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        receipt_number TEXT NOT NULL UNIQUE,
        sequence_number BIGINT NOT NULL UNIQUE,
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
        amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
        payment_method TEXT NOT NULL,
        service_description TEXT NOT NULL,
        notice_text TEXT NOT NULL,
        file_storage_provider TEXT NOT NULL,
        file_object_key TEXT NOT NULL,
        file_content_type TEXT NOT NULL DEFAULT 'application/pdf',
        file_size_bytes BIGINT NOT NULL DEFAULT 0,
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
    `
  },
  {
    name: "004_security_audit",
    sql: `
      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGSERIAL PRIMARY KEY,
        admin_user_id BIGINT,
        admin_email TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        ip_address TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_type ON audit_logs (entity_type);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_email ON audit_logs (admin_email);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at);
    `
  },
  {
    name: "005_clinical_records",
    sql: `
      CREATE TABLE IF NOT EXISTS clinical_intakes (
        id BIGSERIAL PRIMARY KEY,
        patient_id BIGINT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'draft',
        encrypted_payload TEXT NOT NULL DEFAULT '',
        payload_hash TEXT NOT NULL DEFAULT '',
        created_by_admin_id BIGINT,
        created_by_admin_email TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT NOT NULL DEFAULT '',
        locked_at TEXT NOT NULL DEFAULT ''
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_clinical_intakes_patient ON clinical_intakes (patient_id);

      CREATE TABLE IF NOT EXISTS clinical_intake_versions (
        id BIGSERIAL PRIMARY KEY,
        intake_id BIGINT NOT NULL REFERENCES clinical_intakes(id) ON DELETE CASCADE,
        encrypted_payload TEXT NOT NULL DEFAULT '',
        payload_hash TEXT NOT NULL DEFAULT '',
        version_number INTEGER NOT NULL,
        changed_by_admin_id BIGINT,
        changed_by_admin_email TEXT NOT NULL DEFAULT '',
        change_reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_clinical_intake_versions_intake ON clinical_intake_versions (intake_id);

      CREATE TABLE IF NOT EXISTS clinical_evolutions (
        id BIGSERIAL PRIMARY KEY,
        patient_id BIGINT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        session_id BIGINT REFERENCES clinic_sessions(id) ON DELETE SET NULL,
        evolution_date TEXT NOT NULL,
        evolution_type TEXT NOT NULL DEFAULT 'session',
        title TEXT NOT NULL DEFAULT '',
        encrypted_content TEXT NOT NULL DEFAULT '',
        content_hash TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft',
        parent_evolution_id BIGINT REFERENCES clinical_evolutions(id) ON DELETE SET NULL,
        created_by_admin_id BIGINT,
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
        id BIGSERIAL PRIMARY KEY,
        evolution_id BIGINT NOT NULL REFERENCES clinical_evolutions(id) ON DELETE CASCADE,
        encrypted_content TEXT NOT NULL DEFAULT '',
        content_hash TEXT NOT NULL DEFAULT '',
        version_number INTEGER NOT NULL,
        changed_by_admin_id BIGINT,
        changed_by_admin_email TEXT NOT NULL DEFAULT '',
        change_reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_clinical_evolution_versions_evolution ON clinical_evolution_versions (evolution_id);
    `
  },
  {
    name: "006_receipt_sequence",
    sql: `
      -- Contador próprio para a numeração de recibo. MAX(sequence_number) + 1
      -- sobre a tabela de recibos regredia quando o último recibo era apagado
      -- (cascata de exclusão de sessão/paciente) e permitia número repetido.
      -- Este contador só avança.
      CREATE TABLE IF NOT EXISTS receipt_sequence (
        id INTEGER PRIMARY KEY,
        next_value BIGINT NOT NULL
      );

      INSERT INTO receipt_sequence (id, next_value)
      SELECT 1, COALESCE((SELECT MAX(sequence_number) FROM receipts), 0) + 1
      ON CONFLICT (id) DO NOTHING;
    `
  },
  {
    name: "007_admin_session_epoch",
    sql: `
      -- Contador de sessão do admin. O token é stateless: sem ele, limpar o
      -- cookie no logout não invalidava nada e um token capturado seguia
      -- válido por 7 dias.
      ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS session_epoch INTEGER NOT NULL DEFAULT 0;
    `
  },
  {
    name: "008_postgres_check_constraints",
    sql: `
      -- As restrições de status existiam só no SQLite: as mesmas colunas foram
      -- criadas aqui como TEXT livre, e o banco de produção aceitava qualquer
      -- valor. NOT VALID aplica a regra de agora em diante sem varrer (nem
      -- recusar) as linhas já existentes.
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinical_intakes_status_check') THEN
          ALTER TABLE clinical_intakes ADD CONSTRAINT clinical_intakes_status_check
            CHECK (status IN ('draft', 'completed', 'locked')) NOT VALID;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinical_evolutions_status_check') THEN
          ALTER TABLE clinical_evolutions ADD CONSTRAINT clinical_evolutions_status_check
            CHECK (status IN ('draft', 'signed', 'locked', 'amended')) NOT VALID;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinic_sessions_google_sync_status_check') THEN
          ALTER TABLE clinic_sessions ADD CONSTRAINT clinic_sessions_google_sync_status_check
            CHECK (google_calendar_sync_status IN ('pending', 'synced', 'failed', 'skipped')) NOT VALID;
        END IF;
      END
      $$;
    `
  },
  {
    name: "009_evolution_type_check",
    sql: `
      -- A 008 levou os CHECKs de status, mas deixou evolution_type de fora: no
      -- Postgres a coluna continuava aceitando qualquer texto.
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinical_evolutions_type_check') THEN
          ALTER TABLE clinical_evolutions ADD CONSTRAINT clinical_evolutions_type_check
            CHECK (evolution_type IN ('session', 'initial', 'guardian_contact', 'referral', 'closing', 'addendum', 'correction', 'other')) NOT VALID;
        END IF;
      END
      $$;
    `
  },
  {
    name: "010_clinical_record",
    sql: `
      -- O prontuário em si. Até aqui havia anamnese e evoluções (005), mas nada que
      -- se abrisse, se preenchesse e se fechasse. Os CHECK saem escritos aqui desde
      -- já: as migrações 008 e 009 só existem porque, na 003 e na 005, as mesmas
      -- colunas ficaram como TEXT livre no Postgres.
      CREATE TABLE IF NOT EXISTS clinical_records (
        id BIGSERIAL PRIMARY KEY,
        patient_id BIGINT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        record_number TEXT NOT NULL DEFAULT '',
        sequence_number BIGINT NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open'
          CHECK (status IN ('open', 'closed')),
        closing_reason TEXT NOT NULL DEFAULT ''
          CHECK (closing_reason IN ('', 'discharge', 'dropout', 'referral', 'professional_change', 'other')),
        opened_at TEXT NOT NULL,
        closed_at TEXT NOT NULL DEFAULT '',
        opened_by_admin_id BIGINT,
        opened_by_admin_email TEXT NOT NULL DEFAULT '',
        closed_by_admin_id BIGINT,
        closed_by_admin_email TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_clinical_records_patient ON clinical_records (patient_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_clinical_records_number ON clinical_records (record_number);

      -- Contrato, plano e encerramento têm o mesmo formato de payload da anamnese;
      -- um par genérico de tabelas cobre os três.
      CREATE TABLE IF NOT EXISTS clinical_record_blocks (
        id BIGSERIAL PRIMARY KEY,
        record_id BIGINT NOT NULL REFERENCES clinical_records(id) ON DELETE CASCADE,
        block_type TEXT NOT NULL
          CHECK (block_type IN ('contract', 'plan', 'closing')),
        status TEXT NOT NULL DEFAULT 'draft'
          CHECK (status IN ('draft', 'completed', 'locked')),
        encrypted_payload TEXT NOT NULL DEFAULT '',
        payload_hash TEXT NOT NULL DEFAULT '',
        created_by_admin_id BIGINT,
        created_by_admin_email TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT NOT NULL DEFAULT '',
        locked_at TEXT NOT NULL DEFAULT ''
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_clinical_record_blocks_type
        ON clinical_record_blocks (record_id, block_type);

      CREATE TABLE IF NOT EXISTS clinical_record_block_versions (
        id BIGSERIAL PRIMARY KEY,
        block_id BIGINT NOT NULL REFERENCES clinical_record_blocks(id) ON DELETE CASCADE,
        encrypted_payload TEXT NOT NULL DEFAULT '',
        payload_hash TEXT NOT NULL DEFAULT '',
        version_number INTEGER NOT NULL,
        changed_by_admin_id BIGINT,
        changed_by_admin_email TEXT NOT NULL DEFAULT '',
        change_reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_clinical_record_block_versions_block
        ON clinical_record_block_versions (block_id);

      -- Documentos emitidos (Resolução CFP 006/2019), no desenho dos recibos:
      -- numeração própria, PDF no armazenamento privado, registro imutável.
      CREATE TABLE IF NOT EXISTS clinical_documents (
        id BIGSERIAL PRIMARY KEY,
        record_id BIGINT NOT NULL REFERENCES clinical_records(id) ON DELETE CASCADE,
        patient_id BIGINT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        document_number TEXT NOT NULL DEFAULT '',
        sequence_number BIGINT NOT NULL DEFAULT 0,
        document_type TEXT NOT NULL
          CHECK (document_type IN ('attendance_declaration', 'psychological_certificate', 'report', 'opinion', 'referral')),
        title TEXT NOT NULL DEFAULT '',
        encrypted_content TEXT NOT NULL DEFAULT '',
        content_hash TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'issued'
          CHECK (status IN ('issued', 'revoked')),
        issued_at TEXT NOT NULL,
        revoked_at TEXT NOT NULL DEFAULT '',
        revoke_reason TEXT NOT NULL DEFAULT '',
        file_storage_provider TEXT NOT NULL DEFAULT '',
        file_object_key TEXT NOT NULL DEFAULT '',
        file_content_type TEXT NOT NULL DEFAULT '',
        file_size_bytes BIGINT NOT NULL DEFAULT 0,
        created_by_admin_id BIGINT,
        created_by_admin_email TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_clinical_documents_record ON clinical_documents (record_id);
      CREATE INDEX IF NOT EXISTS idx_clinical_documents_patient ON clinical_documents (patient_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_clinical_documents_number ON clinical_documents (document_number);

      -- Quem já tem anamnese ou evolução já tem prontuário na prática: sem este
      -- preenchimento os registros existentes ficariam órfãos do registro novo.
      INSERT INTO clinical_records (
        patient_id, record_number, sequence_number, status, closing_reason,
        opened_at, closed_at, opened_by_admin_id, opened_by_admin_email,
        closed_by_admin_id, closed_by_admin_email, created_at, updated_at
      )
      SELECT
        p.id,
        'PRT-' || lpad((ROW_NUMBER() OVER (ORDER BY p.id))::text, 6, '0'),
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

      -- Contadores que só avançam, como o de recibo (006).
      CREATE TABLE IF NOT EXISTS clinical_record_sequence (
        id INTEGER PRIMARY KEY,
        next_value BIGINT NOT NULL
      );

      INSERT INTO clinical_record_sequence (id, next_value)
      SELECT 1, COALESCE((SELECT MAX(sequence_number) FROM clinical_records), 0) + 1
      ON CONFLICT (id) DO NOTHING;

      CREATE TABLE IF NOT EXISTS clinical_document_sequence (
        id INTEGER PRIMARY KEY,
        next_value BIGINT NOT NULL
      );

      INSERT INTO clinical_document_sequence (id, next_value)
      SELECT 1, COALESCE((SELECT MAX(sequence_number) FROM clinical_documents), 0) + 1
      ON CONFLICT (id) DO NOTHING;
    `
  }
];

function getPostgresMigrationSql(name) {
  return POSTGRES_MIGRATIONS.find((migration) => migration.name === name)?.sql || "";
}

function runSqliteMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      executed_at TEXT NOT NULL
    );
  `);

  // db.migrationsDir só é usado por teste, para apontar para uma cópia
  // temporária e não sujar o diretório do repositório.
  const migrationsDir = db.migrationsDir || path.join(__dirname, "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const hasMigration = db.prepare("SELECT name FROM _migrations WHERE name = ?").pluck();
  const insertMigration = db.prepare("INSERT INTO _migrations (name, executed_at) VALUES (?, ?)");

  // Cada migração roda dentro de uma transação, com o registro no mesmo
  // commit. Sem isso, uma interrupção no meio do arquivo deixava parte do DDL
  // aplicado e a migração como não executada: no boot seguinte ela rodava de
  // novo, falhava em "duplicate column" (o SQLite não tem ADD COLUMN IF NOT
  // EXISTS) e travava o boot para sempre.
  const aplicarMigracao = db.transaction((file, sql) => {
    db.exec(sql);
    insertMigration.run(file, new Date().toISOString());
  });

  for (const file of files) {
    if (hasMigration.get(file)) {
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    aplicarMigracao(file, sql);
  }
}

async function runPostgresMigrations(db) {
  const latestMigration = POSTGRES_MIGRATIONS[POSTGRES_MIGRATIONS.length - 1]?.name;

  // Fast path sem lock: se a migração mais recente conhecida já está registrada
  // em _migrations, todo o schema necessário já existe. Evitamos abrir transação
  // e adquirir o advisory lock bloqueante a cada cold start serverless. Sem isso,
  // cold starts concorrentes serializam no lock e podem estourar o statement
  // timeout, derrubando com 504 todas as rotas que dependem do banco. Ao incluir
  // uma migração nova, ela vira a "mais recente" e o fast path corretamente não
  // dispara até que seja aplicada. Se _migrations ainda não existir (primeiro
  // boot), o SELECT lança e seguimos para o caminho com lock que cria tudo.
  if (latestMigration) {
    try {
      const alreadyApplied = await db`
        SELECT 1 FROM _migrations WHERE name = ${latestMigration} LIMIT 1
      `;
      if (alreadyApplied.length > 0) {
        return;
      }
    } catch (error) {
      // _migrations inexistente no primeiro boot — segue para o caminho com lock.
    }
  }

  await db.begin(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(${POSTGRES_MIGRATION_LOCK_KEY})`;

    await sql`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        executed_at TEXT NOT NULL
      )
    `;

    const existingRows = await sql`SELECT name FROM _migrations ORDER BY name`;
    const appliedMigrations = new Set(existingRows.map((row) => row.name));

    if (appliedMigrations.size === 0) {
      const baselineRows = await sql.unsafe(POSTGRES_BASELINE_CHECK_SQL);
      const hasLegacySchema =
        Number(baselineRows[0]?.total || 0) >= POSTGRES_BASELINE_TABLES.length;

      if (hasLegacySchema) {
        const now = new Date().toISOString();
        for (const migration of POSTGRES_MIGRATIONS.slice(0, 2)) {
          await sql`
            INSERT INTO _migrations (name, executed_at)
            VALUES (${migration.name}, ${now})
            ON CONFLICT (name) DO NOTHING
          `;
          appliedMigrations.add(migration.name);
        }
      }
    }

    for (const migration of POSTGRES_MIGRATIONS) {
      if (appliedMigrations.has(migration.name)) {
        continue;
      }

      await sql.unsafe(migration.sql);
      await sql`
        INSERT INTO _migrations (name, executed_at)
        VALUES (${migration.name}, ${new Date().toISOString()})
      `;
    }
  });
}

async function ensurePostgresCompatibilityMigration(db, migrationName) {
  const migrationSql = getPostgresMigrationSql(migrationName);

  if (!migrationSql) {
    throw new Error(`Migração Postgres ausente: ${migrationName}`);
  }

  // Fast path: se a migração já foi aplicada, evita abrir transação e adquirir o
  // advisory lock (bloqueante) em todo cold start serverless. Sem isso, cada
  // boot frio paga 1 transação + lock por migração de compatibilidade, e cold
  // starts concorrentes serializam uns nos outros — causando timeouts nas rotas
  // que dependem do banco. Se _migrations ainda não existir (primeiro boot), o
  // SELECT falha e seguimos para o caminho com lock que cria tudo.
  try {
    const alreadyApplied = await db`
      SELECT 1 FROM _migrations WHERE name = ${migrationName} LIMIT 1
    `;
    if (alreadyApplied.length > 0) {
      return;
    }
  } catch (error) {
    // _migrations inexistente no primeiro boot — segue para o caminho com lock.
  }

  await db.begin(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(${POSTGRES_MIGRATION_LOCK_KEY})`;

    const baselineRows = await sql`
      SELECT to_regclass('public.clinic_sessions') IS NOT NULL AS "hasClinicSessions"
    `;

    if (!baselineRows[0]?.hasClinicSessions) {
      throw new Error(
        "Schema base da clínica não encontrado. Rode as migrations iniciais antes da compatibilidade da fase 2."
      );
    }

    await sql`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        executed_at TEXT NOT NULL
      )
    `;

    const appliedRows = await sql`
      SELECT 1
      FROM _migrations
      WHERE name = ${migrationName}
      LIMIT 1
    `;

    if (appliedRows.length > 0) {
      return;
    }

    await sql.unsafe(migrationSql);
    await sql`
      INSERT INTO _migrations (name, executed_at)
      VALUES (${migrationName}, ${new Date().toISOString()})
      ON CONFLICT (name) DO NOTHING
    `;
  });
}

async function ensurePostgresPhase2Schema(db) {
  return ensurePostgresCompatibilityMigration(db, "003_clinic_phase2");
}

async function ensurePostgresSecurityAuditSchema(db) {
  return ensurePostgresCompatibilityMigration(db, "004_security_audit");
}

async function ensurePostgresClinicalSchema(db) {
  return ensurePostgresCompatibilityMigration(db, "005_clinical_records");
}

async function ensurePostgresReceiptSequenceSchema(db) {
  return ensurePostgresCompatibilityMigration(db, "006_receipt_sequence");
}

async function ensurePostgresAdminSessionSchema(db) {
  return ensurePostgresCompatibilityMigration(db, "007_admin_session_epoch");
}

async function ensurePostgresCheckConstraintsSchema(db) {
  await ensurePostgresCompatibilityMigration(db, "008_postgres_check_constraints");
  return ensurePostgresCompatibilityMigration(db, "009_evolution_type_check");
}

async function ensurePostgresClinicalRecordSchema(db) {
  return ensurePostgresCompatibilityMigration(db, "010_clinical_record");
}

async function runMigrations(db) {
  if (db.kind === "postgres") {
    await runPostgresMigrations(db);
    return;
  }

  runSqliteMigrations(db);
}

// Verifica, na conexão principal (pooler), se há migração Postgres pendente.
// Usado no boot para evitar abrir a conexão de migração (que pode apontar para
// o endpoint non-pooling/direto, instável a partir de serverless) quando tudo
// já está aplicado. Se _migrations não existir (primeiro boot), há pendência.
async function hasPendingPostgresMigrations(db) {
  const latestMigration = POSTGRES_MIGRATIONS[POSTGRES_MIGRATIONS.length - 1]?.name;
  if (!latestMigration) {
    return false;
  }

  try {
    const rows = await db`SELECT 1 FROM _migrations WHERE name = ${latestMigration} LIMIT 1`;
    return rows.length === 0;
  } catch (error) {
    return true;
  }
}

if (require.main === module) {
  (async () => {
    const db = createMigrationDatabase();
    try {
      await runMigrations(db);
    } finally {
      if (db.kind === "postgres") {
        await db.end({ timeout: 5 });
      } else {
        db.close();
      }
    }
  })().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  ensurePostgresAdminSessionSchema,
  ensurePostgresCheckConstraintsSchema,
  ensurePostgresClinicalRecordSchema,
  ensurePostgresClinicalSchema,
  ensurePostgresReceiptSequenceSchema,
  ensurePostgresPhase2Schema,
  ensurePostgresSecurityAuditSchema,
  hasPendingPostgresMigrations,
  runMigrations
};
