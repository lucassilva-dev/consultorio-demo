const { nowIso } = require("./clinic-repository-helpers");

const INTAKE_COLUMNS = `
  id,
  patient_id AS patientId,
  status,
  encrypted_payload AS encryptedPayload,
  payload_hash AS payloadHash,
  created_by_admin_id AS createdByAdminId,
  created_by_admin_email AS createdByAdminEmail,
  created_at AS createdAt,
  updated_at AS updatedAt,
  completed_at AS completedAt,
  locked_at AS lockedAt
`;

const EVOLUTION_FULL_COLUMNS = `
  id,
  patient_id AS patientId,
  session_id AS sessionId,
  evolution_date AS evolutionDate,
  evolution_type AS evolutionType,
  title,
  encrypted_content AS encryptedContent,
  content_hash AS contentHash,
  status,
  parent_evolution_id AS parentEvolutionId,
  created_by_admin_id AS createdByAdminId,
  created_by_admin_email AS createdByAdminEmail,
  created_at AS createdAt,
  updated_at AS updatedAt,
  signed_at AS signedAt,
  locked_at AS lockedAt
`;

// Listagem nunca retorna o conteúdo clínico (encrypted_content fica de fora).
const EVOLUTION_MINIMAL_COLUMNS = `
  id,
  patient_id AS patientId,
  session_id AS sessionId,
  evolution_date AS evolutionDate,
  evolution_type AS evolutionType,
  title,
  status,
  parent_evolution_id AS parentEvolutionId,
  created_by_admin_id AS createdByAdminId,
  created_by_admin_email AS createdByAdminEmail,
  created_at AS createdAt,
  updated_at AS updatedAt,
  signed_at AS signedAt,
  locked_at AS lockedAt
`;

const RECORD_COLUMNS = `
  id,
  patient_id AS patientId,
  record_number AS recordNumber,
  sequence_number AS sequenceNumber,
  status,
  closing_reason AS closingReason,
  opened_at AS openedAt,
  closed_at AS closedAt,
  opened_by_admin_id AS openedByAdminId,
  opened_by_admin_email AS openedByAdminEmail,
  closed_by_admin_id AS closedByAdminId,
  closed_by_admin_email AS closedByAdminEmail,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

const BLOCK_FULL_COLUMNS = `
  id,
  record_id AS recordId,
  block_type AS blockType,
  status,
  encrypted_payload AS encryptedPayload,
  payload_hash AS payloadHash,
  created_by_admin_id AS createdByAdminId,
  created_by_admin_email AS createdByAdminEmail,
  created_at AS createdAt,
  updated_at AS updatedAt,
  completed_at AS completedAt,
  locked_at AS lockedAt
`;

// Listagem de blocos nunca devolve o payload cifrado, pela mesma razão de
// EVOLUTION_MINIMAL_COLUMNS: o resumo do prontuário só precisa de situação.
const BLOCK_MINIMAL_COLUMNS = `
  id,
  record_id AS recordId,
  block_type AS blockType,
  status,
  created_by_admin_id AS createdByAdminId,
  created_by_admin_email AS createdByAdminEmail,
  created_at AS createdAt,
  updated_at AS updatedAt,
  completed_at AS completedAt,
  locked_at AS lockedAt
`;

const DOCUMENT_FULL_COLUMNS = `
  id,
  record_id AS recordId,
  patient_id AS patientId,
  document_number AS documentNumber,
  sequence_number AS sequenceNumber,
  document_type AS documentType,
  title,
  encrypted_content AS encryptedContent,
  content_hash AS contentHash,
  status,
  issued_at AS issuedAt,
  revoked_at AS revokedAt,
  revoke_reason AS revokeReason,
  file_storage_provider AS fileStorageProvider,
  file_object_key AS fileObjectKey,
  file_content_type AS fileContentType,
  file_size_bytes AS fileSizeBytes,
  created_by_admin_id AS createdByAdminId,
  created_by_admin_email AS createdByAdminEmail,
  created_at AS createdAt
`;

const DOCUMENT_MINIMAL_COLUMNS = `
  id,
  record_id AS recordId,
  patient_id AS patientId,
  document_number AS documentNumber,
  sequence_number AS sequenceNumber,
  document_type AS documentType,
  title,
  status,
  issued_at AS issuedAt,
  revoked_at AS revokedAt,
  revoke_reason AS revokeReason,
  created_by_admin_id AS createdByAdminId,
  created_by_admin_email AS createdByAdminEmail,
  created_at AS createdAt
`;

function mapRecordRow(row) {
  if (!row) {
    return null;
  }
  return {
    ...row,
    patientId: Number(row.patientId),
    sequenceNumber: Number(row.sequenceNumber || 0),
    openedByAdminId: row.openedByAdminId ? Number(row.openedByAdminId) : null,
    closedByAdminId: row.closedByAdminId ? Number(row.closedByAdminId) : null
  };
}

function mapBlockRow(row) {
  if (!row) {
    return null;
  }
  return {
    ...row,
    recordId: Number(row.recordId),
    createdByAdminId: row.createdByAdminId ? Number(row.createdByAdminId) : null
  };
}

function mapDocumentRow(row) {
  if (!row) {
    return null;
  }
  return {
    ...row,
    recordId: Number(row.recordId),
    patientId: Number(row.patientId),
    sequenceNumber: Number(row.sequenceNumber || 0),
    fileSizeBytes: Number(row.fileSizeBytes || 0),
    createdByAdminId: row.createdByAdminId ? Number(row.createdByAdminId) : null
  };
}

function mapIntakeRow(row) {
  if (!row) {
    return null;
  }
  return {
    ...row,
    createdByAdminId: row.createdByAdminId ? Number(row.createdByAdminId) : null
  };
}

function mapEvolutionRow(row) {
  if (!row) {
    return null;
  }
  return {
    ...row,
    sessionId: row.sessionId ? Number(row.sessionId) : null,
    parentEvolutionId: row.parentEvolutionId ? Number(row.parentEvolutionId) : null,
    createdByAdminId: row.createdByAdminId ? Number(row.createdByAdminId) : null
  };
}

function createSqliteClinicalRepository(db) {
  // Aloca (não apenas lê) o próximo número: o UPDATE ... RETURNING é atômico, e
  // o contador nunca regride, mesmo que um registro seja removido. Mesmo
  // desenho do contador de recibos.
  const allocateRecordSequenceStmt = db.prepare(`
    UPDATE clinical_record_sequence
    SET next_value = next_value + 1
    WHERE id = 1
    RETURNING next_value - 1 AS nextValue
  `);
  const seedRecordSequenceStmt = db.prepare(`
    INSERT INTO clinical_record_sequence (id, next_value)
    SELECT 1, COALESCE((SELECT MAX(sequence_number) FROM clinical_records), 0) + 1
    WHERE NOT EXISTS (SELECT 1 FROM clinical_record_sequence WHERE id = 1)
  `);
  const allocateDocumentSequenceStmt = db.prepare(`
    UPDATE clinical_document_sequence
    SET next_value = next_value + 1
    WHERE id = 1
    RETURNING next_value - 1 AS nextValue
  `);
  const seedDocumentSequenceStmt = db.prepare(`
    INSERT INTO clinical_document_sequence (id, next_value)
    SELECT 1, COALESCE((SELECT MAX(sequence_number) FROM clinical_documents), 0) + 1
    WHERE NOT EXISTS (SELECT 1 FROM clinical_document_sequence WHERE id = 1)
  `);

  return {
    // ── Anamnese ──────────────────────────────────────────────────────────
    async getIntakeByPatientId(patientId) {
      const row = db
        .prepare(`SELECT ${INTAKE_COLUMNS} FROM clinical_intakes WHERE patient_id = ? LIMIT 1`)
        .get(Number(patientId));
      return mapIntakeRow(row || null);
    },

    async getIntakeById(id) {
      const row = db
        .prepare(`SELECT ${INTAKE_COLUMNS} FROM clinical_intakes WHERE id = ? LIMIT 1`)
        .get(Number(id));
      return mapIntakeRow(row || null);
    },

    async createIntake(payload) {
      const now = nowIso();
      const result = db
        .prepare(`
          INSERT INTO clinical_intakes (
            patient_id, status, encrypted_payload, payload_hash,
            created_by_admin_id, created_by_admin_email,
            created_at, updated_at, completed_at, locked_at
          ) VALUES (
            @patient_id, @status, @encrypted_payload, @payload_hash,
            @created_by_admin_id, @created_by_admin_email,
            @created_at, @updated_at, '', ''
          )
        `)
        .run({
          patient_id: Number(payload.patientId),
          status: payload.status || "draft",
          encrypted_payload: payload.encryptedPayload || "",
          payload_hash: payload.payloadHash || "",
          created_by_admin_id: payload.createdByAdminId ? Number(payload.createdByAdminId) : null,
          created_by_admin_email: payload.createdByAdminEmail || "",
          created_at: now,
          updated_at: now
        });
      return this.getIntakeById(result.lastInsertRowid);
    },

    async updateIntake(id, patch) {
      const current = await this.getIntakeById(id);
      if (!current) {
        return null;
      }
      db
        .prepare(`
          UPDATE clinical_intakes SET
            status = @status,
            encrypted_payload = @encrypted_payload,
            payload_hash = @payload_hash,
            completed_at = @completed_at,
            locked_at = @locked_at,
            updated_at = @updated_at
          WHERE id = @id
        `)
        .run({
          id: Number(id),
          status: patch.status ?? current.status,
          encrypted_payload:
            typeof patch.encryptedPayload === "string"
              ? patch.encryptedPayload
              : current.encryptedPayload,
          payload_hash:
            typeof patch.payloadHash === "string" ? patch.payloadHash : current.payloadHash,
          completed_at:
            typeof patch.completedAt === "string" ? patch.completedAt : current.completedAt,
          locked_at: typeof patch.lockedAt === "string" ? patch.lockedAt : current.lockedAt,
          updated_at: nowIso()
        });
      return this.getIntakeById(id);
    },

    async getNextIntakeVersionNumber(intakeId) {
      const row = db
        .prepare(
          `SELECT COALESCE(MAX(version_number), 0) + 1 AS nextValue FROM clinical_intake_versions WHERE intake_id = ?`
        )
        .get(Number(intakeId));
      return Number(row?.nextValue || 1);
    },

    async addIntakeVersion(payload) {
      db
        .prepare(`
          INSERT INTO clinical_intake_versions (
            intake_id, encrypted_payload, payload_hash, version_number,
            changed_by_admin_id, changed_by_admin_email, change_reason, created_at
          ) VALUES (
            @intake_id, @encrypted_payload, @payload_hash, @version_number,
            @changed_by_admin_id, @changed_by_admin_email, @change_reason, @created_at
          )
        `)
        .run({
          intake_id: Number(payload.intakeId),
          encrypted_payload: payload.encryptedPayload || "",
          payload_hash: payload.payloadHash || "",
          version_number: Number(payload.versionNumber),
          changed_by_admin_id: payload.changedByAdminId ? Number(payload.changedByAdminId) : null,
          changed_by_admin_email: payload.changedByAdminEmail || "",
          change_reason: payload.changeReason || "",
          created_at: nowIso()
        });
    },

    async countIntakeVersions(intakeId) {
      const row = db
        .prepare(`SELECT COUNT(*) AS total FROM clinical_intake_versions WHERE intake_id = ?`)
        .get(Number(intakeId));
      return Number(row?.total || 0);
    },

    // ── Evoluções ─────────────────────────────────────────────────────────
    async listEvolutionsByPatientId(patientId) {
      const rows = db
        .prepare(`
          SELECT ${EVOLUTION_MINIMAL_COLUMNS}
          FROM clinical_evolutions
          WHERE patient_id = ?
          ORDER BY evolution_date DESC, id DESC
        `)
        .all(Number(patientId));
      return rows.map(mapEvolutionRow);
    },

    async listEvolutionsForExport(patientId) {
      const rows = db
        .prepare(`
          SELECT ${EVOLUTION_FULL_COLUMNS}
          FROM clinical_evolutions
          WHERE patient_id = ?
          ORDER BY evolution_date ASC, id ASC
        `)
        .all(Number(patientId));
      return rows.map(mapEvolutionRow);
    },

    async getEvolutionById(id) {
      const row = db
        .prepare(`SELECT ${EVOLUTION_FULL_COLUMNS} FROM clinical_evolutions WHERE id = ? LIMIT 1`)
        .get(Number(id));
      return mapEvolutionRow(row || null);
    },

    async createEvolution(payload) {
      const now = nowIso();
      const result = db
        .prepare(`
          INSERT INTO clinical_evolutions (
            patient_id, session_id, evolution_date, evolution_type, title,
            encrypted_content, content_hash, status, parent_evolution_id,
            created_by_admin_id, created_by_admin_email,
            created_at, updated_at, signed_at, locked_at
          ) VALUES (
            @patient_id, @session_id, @evolution_date, @evolution_type, @title,
            @encrypted_content, @content_hash, @status, @parent_evolution_id,
            @created_by_admin_id, @created_by_admin_email,
            @created_at, @updated_at, '', ''
          )
        `)
        .run({
          patient_id: Number(payload.patientId),
          session_id: payload.sessionId ? Number(payload.sessionId) : null,
          evolution_date: payload.evolutionDate,
          evolution_type: payload.evolutionType || "session",
          title: payload.title || "",
          encrypted_content: payload.encryptedContent || "",
          content_hash: payload.contentHash || "",
          status: payload.status || "draft",
          parent_evolution_id: payload.parentEvolutionId ? Number(payload.parentEvolutionId) : null,
          created_by_admin_id: payload.createdByAdminId ? Number(payload.createdByAdminId) : null,
          created_by_admin_email: payload.createdByAdminEmail || "",
          created_at: now,
          updated_at: now
        });
      return this.getEvolutionById(result.lastInsertRowid);
    },

    async updateEvolution(id, patch) {
      const current = await this.getEvolutionById(id);
      if (!current) {
        return null;
      }
      db
        .prepare(`
          UPDATE clinical_evolutions SET
            evolution_date = @evolution_date,
            session_id = @session_id,
            evolution_type = @evolution_type,
            title = @title,
            encrypted_content = @encrypted_content,
            content_hash = @content_hash,
            status = @status,
            signed_at = @signed_at,
            locked_at = @locked_at,
            updated_at = @updated_at
          WHERE id = @id
        `)
        .run({
          id: Number(id),
          evolution_date: patch.evolutionDate ?? current.evolutionDate,
          session_id: typeof patch.sessionId === "undefined" ? current.sessionId : patch.sessionId,
          evolution_type: patch.evolutionType ?? current.evolutionType,
          title: typeof patch.title === "string" ? patch.title : current.title,
          encrypted_content:
            typeof patch.encryptedContent === "string"
              ? patch.encryptedContent
              : current.encryptedContent,
          content_hash:
            typeof patch.contentHash === "string" ? patch.contentHash : current.contentHash,
          status: patch.status ?? current.status,
          signed_at: typeof patch.signedAt === "string" ? patch.signedAt : current.signedAt,
          locked_at: typeof patch.lockedAt === "string" ? patch.lockedAt : current.lockedAt,
          updated_at: nowIso()
        });
      return this.getEvolutionById(id);
    },

    async getNextEvolutionVersionNumber(evolutionId) {
      const row = db
        .prepare(
          `SELECT COALESCE(MAX(version_number), 0) + 1 AS nextValue FROM clinical_evolution_versions WHERE evolution_id = ?`
        )
        .get(Number(evolutionId));
      return Number(row?.nextValue || 1);
    },

    async addEvolutionVersion(payload) {
      db
        .prepare(`
          INSERT INTO clinical_evolution_versions (
            evolution_id, encrypted_content, content_hash, version_number,
            changed_by_admin_id, changed_by_admin_email, change_reason, created_at
          ) VALUES (
            @evolution_id, @encrypted_content, @content_hash, @version_number,
            @changed_by_admin_id, @changed_by_admin_email, @change_reason, @created_at
          )
        `)
        .run({
          evolution_id: Number(payload.evolutionId),
          encrypted_content: payload.encryptedContent || "",
          content_hash: payload.contentHash || "",
          version_number: Number(payload.versionNumber),
          changed_by_admin_id: payload.changedByAdminId ? Number(payload.changedByAdminId) : null,
          changed_by_admin_email: payload.changedByAdminEmail || "",
          change_reason: payload.changeReason || "",
          created_at: nowIso()
        });
    },

    async countEvolutions(patientId) {
      const row = db
        .prepare(`SELECT COUNT(*) AS total FROM clinical_evolutions WHERE patient_id = ?`)
        .get(Number(patientId));
      return Number(row?.total || 0);
    },

    async getLatestEvolution(patientId) {
      const row = db
        .prepare(`
          SELECT ${EVOLUTION_MINIMAL_COLUMNS}
          FROM clinical_evolutions
          WHERE patient_id = ?
          ORDER BY evolution_date DESC, id DESC
          LIMIT 1
        `)
        .get(Number(patientId));
      return mapEvolutionRow(row || null);
    },
    // ── Prontuário ────────────────────────────────────────────────────────
    async getRecordByPatientId(patientId) {
      const row = db
        .prepare(`SELECT ${RECORD_COLUMNS} FROM clinical_records WHERE patient_id = ? LIMIT 1`)
        .get(Number(patientId));
      return mapRecordRow(row || null);
    },

    async getRecordById(id) {
      const row = db
        .prepare(`SELECT ${RECORD_COLUMNS} FROM clinical_records WHERE id = ? LIMIT 1`)
        .get(Number(id));
      return mapRecordRow(row || null);
    },

    // Contador próprio, como o de recibo: só avança. Apagar prontuário não
    // devolve o número ao pool, e duas aberturas simultâneas não colidem.
    async getNextRecordSequence() {
      const alocado = allocateRecordSequenceStmt.get();
      if (alocado) {
        return Number(alocado.nextValue);
      }

      seedRecordSequenceStmt.run();
      const aposSemear = allocateRecordSequenceStmt.get();
      if (!aposSemear) {
        throw new Error("Não foi possível alocar o número do prontuário.");
      }
      return Number(aposSemear.nextValue);
    },

    async createRecord(payload) {
      const now = nowIso();
      const result = db
        .prepare(`
          INSERT INTO clinical_records (
            patient_id, record_number, sequence_number, status, closing_reason,
            opened_at, closed_at, opened_by_admin_id, opened_by_admin_email,
            closed_by_admin_id, closed_by_admin_email, created_at, updated_at
          ) VALUES (
            @patient_id, @record_number, @sequence_number, @status, '',
            @opened_at, '', @opened_by_admin_id, @opened_by_admin_email,
            NULL, '', @created_at, @updated_at
          )
        `)
        .run({
          patient_id: Number(payload.patientId),
          record_number: payload.recordNumber || "",
          sequence_number: Number(payload.sequenceNumber || 0),
          status: payload.status || "open",
          opened_at: payload.openedAt || now,
          opened_by_admin_id: payload.openedByAdminId ? Number(payload.openedByAdminId) : null,
          opened_by_admin_email: payload.openedByAdminEmail || "",
          created_at: now,
          updated_at: now
        });
      return this.getRecordById(result.lastInsertRowid);
    },

    async updateRecord(id, patch) {
      const current = await this.getRecordById(id);
      if (!current) {
        return null;
      }
      db
        .prepare(`
          UPDATE clinical_records SET
            status = @status,
            closing_reason = @closing_reason,
            closed_at = @closed_at,
            closed_by_admin_id = @closed_by_admin_id,
            closed_by_admin_email = @closed_by_admin_email,
            updated_at = @updated_at
          WHERE id = @id
        `)
        .run({
          id: Number(id),
          status: patch.status ?? current.status,
          closing_reason:
            typeof patch.closingReason === "string" ? patch.closingReason : current.closingReason,
          closed_at: typeof patch.closedAt === "string" ? patch.closedAt : current.closedAt,
          closed_by_admin_id:
            typeof patch.closedByAdminId === "undefined"
              ? current.closedByAdminId
              : patch.closedByAdminId
                ? Number(patch.closedByAdminId)
                : null,
          closed_by_admin_email:
            typeof patch.closedByAdminEmail === "string"
              ? patch.closedByAdminEmail
              : current.closedByAdminEmail,
          updated_at: nowIso()
        });
      return this.getRecordById(id);
    },

    // ── Blocos do prontuário (contrato, plano, encerramento) ───────────────
    async listBlocksByRecordId(recordId) {
      const rows = db
        .prepare(`
          SELECT ${BLOCK_MINIMAL_COLUMNS}
          FROM clinical_record_blocks
          WHERE record_id = ?
          ORDER BY id ASC
        `)
        .all(Number(recordId));
      return rows.map(mapBlockRow);
    },

    async listBlocksForExport(recordId) {
      const rows = db
        .prepare(`
          SELECT ${BLOCK_FULL_COLUMNS}
          FROM clinical_record_blocks
          WHERE record_id = ?
          ORDER BY id ASC
        `)
        .all(Number(recordId));
      return rows.map(mapBlockRow);
    },

    async getBlock(recordId, blockType) {
      const row = db
        .prepare(`
          SELECT ${BLOCK_FULL_COLUMNS}
          FROM clinical_record_blocks
          WHERE record_id = ? AND block_type = ?
          LIMIT 1
        `)
        .get(Number(recordId), String(blockType));
      return mapBlockRow(row || null);
    },

    async getBlockById(id) {
      const row = db
        .prepare(`SELECT ${BLOCK_FULL_COLUMNS} FROM clinical_record_blocks WHERE id = ? LIMIT 1`)
        .get(Number(id));
      return mapBlockRow(row || null);
    },

    async createBlock(payload) {
      const now = nowIso();
      const result = db
        .prepare(`
          INSERT INTO clinical_record_blocks (
            record_id, block_type, status, encrypted_payload, payload_hash,
            created_by_admin_id, created_by_admin_email,
            created_at, updated_at, completed_at, locked_at
          ) VALUES (
            @record_id, @block_type, @status, @encrypted_payload, @payload_hash,
            @created_by_admin_id, @created_by_admin_email,
            @created_at, @updated_at, '', ''
          )
        `)
        .run({
          record_id: Number(payload.recordId),
          block_type: payload.blockType,
          status: payload.status || "draft",
          encrypted_payload: payload.encryptedPayload || "",
          payload_hash: payload.payloadHash || "",
          created_by_admin_id: payload.createdByAdminId ? Number(payload.createdByAdminId) : null,
          created_by_admin_email: payload.createdByAdminEmail || "",
          created_at: now,
          updated_at: now
        });
      return this.getBlockById(result.lastInsertRowid);
    },

    async updateBlock(id, patch) {
      const current = await this.getBlockById(id);
      if (!current) {
        return null;
      }
      db
        .prepare(`
          UPDATE clinical_record_blocks SET
            status = @status,
            encrypted_payload = @encrypted_payload,
            payload_hash = @payload_hash,
            completed_at = @completed_at,
            locked_at = @locked_at,
            updated_at = @updated_at
          WHERE id = @id
        `)
        .run({
          id: Number(id),
          status: patch.status ?? current.status,
          encrypted_payload:
            typeof patch.encryptedPayload === "string"
              ? patch.encryptedPayload
              : current.encryptedPayload,
          payload_hash:
            typeof patch.payloadHash === "string" ? patch.payloadHash : current.payloadHash,
          completed_at:
            typeof patch.completedAt === "string" ? patch.completedAt : current.completedAt,
          locked_at: typeof patch.lockedAt === "string" ? patch.lockedAt : current.lockedAt,
          updated_at: nowIso()
        });
      return this.getBlockById(id);
    },

    async getNextBlockVersionNumber(blockId) {
      const row = db
        .prepare(
          `SELECT COALESCE(MAX(version_number), 0) + 1 AS nextValue FROM clinical_record_block_versions WHERE block_id = ?`
        )
        .get(Number(blockId));
      return Number(row?.nextValue || 1);
    },

    async addBlockVersion(payload) {
      db
        .prepare(`
          INSERT INTO clinical_record_block_versions (
            block_id, encrypted_payload, payload_hash, version_number,
            changed_by_admin_id, changed_by_admin_email, change_reason, created_at
          ) VALUES (
            @block_id, @encrypted_payload, @payload_hash, @version_number,
            @changed_by_admin_id, @changed_by_admin_email, @change_reason, @created_at
          )
        `)
        .run({
          block_id: Number(payload.blockId),
          encrypted_payload: payload.encryptedPayload || "",
          payload_hash: payload.payloadHash || "",
          version_number: Number(payload.versionNumber),
          changed_by_admin_id: payload.changedByAdminId ? Number(payload.changedByAdminId) : null,
          changed_by_admin_email: payload.changedByAdminEmail || "",
          change_reason: payload.changeReason || "",
          created_at: nowIso()
        });
    },

    async countBlockVersions(blockId) {
      const row = db
        .prepare(`SELECT COUNT(*) AS total FROM clinical_record_block_versions WHERE block_id = ?`)
        .get(Number(blockId));
      return Number(row?.total || 0);
    },

    // ── Documentos emitidos ───────────────────────────────────────────────
    async getNextDocumentSequence() {
      const alocado = allocateDocumentSequenceStmt.get();
      if (alocado) {
        return Number(alocado.nextValue);
      }

      seedDocumentSequenceStmt.run();
      const aposSemear = allocateDocumentSequenceStmt.get();
      if (!aposSemear) {
        throw new Error("Não foi possível alocar o número do documento.");
      }
      return Number(aposSemear.nextValue);
    },

    async listDocumentsByRecordId(recordId) {
      const rows = db
        .prepare(`
          SELECT ${DOCUMENT_MINIMAL_COLUMNS}
          FROM clinical_documents
          WHERE record_id = ?
          ORDER BY issued_at DESC, id DESC
        `)
        .all(Number(recordId));
      return rows.map(mapDocumentRow);
    },

    async getDocumentById(id) {
      const row = db
        .prepare(`SELECT ${DOCUMENT_FULL_COLUMNS} FROM clinical_documents WHERE id = ? LIMIT 1`)
        .get(Number(id));
      return mapDocumentRow(row || null);
    },

    async createDocument(payload) {
      const now = nowIso();
      const result = db
        .prepare(`
          INSERT INTO clinical_documents (
            record_id, patient_id, document_number, sequence_number, document_type,
            title, encrypted_content, content_hash, status, issued_at,
            revoked_at, revoke_reason,
            file_storage_provider, file_object_key, file_content_type, file_size_bytes,
            created_by_admin_id, created_by_admin_email, created_at
          ) VALUES (
            @record_id, @patient_id, @document_number, @sequence_number, @document_type,
            @title, @encrypted_content, @content_hash, 'issued', @issued_at,
            '', '',
            @file_storage_provider, @file_object_key, @file_content_type, @file_size_bytes,
            @created_by_admin_id, @created_by_admin_email, @created_at
          )
        `)
        .run({
          record_id: Number(payload.recordId),
          patient_id: Number(payload.patientId),
          document_number: payload.documentNumber || "",
          sequence_number: Number(payload.sequenceNumber || 0),
          document_type: payload.documentType,
          title: payload.title || "",
          encrypted_content: payload.encryptedContent || "",
          content_hash: payload.contentHash || "",
          issued_at: payload.issuedAt || now,
          file_storage_provider: payload.fileStorageProvider || "",
          file_object_key: payload.fileObjectKey || "",
          file_content_type: payload.fileContentType || "",
          file_size_bytes: Number(payload.fileSizeBytes || 0),
          created_by_admin_id: payload.createdByAdminId ? Number(payload.createdByAdminId) : null,
          created_by_admin_email: payload.createdByAdminEmail || "",
          created_at: now
        });
      return this.getDocumentById(result.lastInsertRowid);
    },

    // Documento emitido é imutável: só a revogação muda estado, e ela guarda o
    // motivo em vez de apagar o registro ou o arquivo.
    async revokeDocument(id, patch) {
      const current = await this.getDocumentById(id);
      if (!current) {
        return null;
      }
      db
        .prepare(`
          UPDATE clinical_documents SET
            status = 'revoked',
            revoked_at = @revoked_at,
            revoke_reason = @revoke_reason
          WHERE id = @id
        `)
        .run({
          id: Number(id),
          revoked_at: patch.revokedAt || nowIso(),
          revoke_reason: patch.revokeReason || ""
        });
      return this.getDocumentById(id);
    },

    async countDocuments(recordId) {
      const row = db
        .prepare(`SELECT COUNT(*) AS total FROM clinical_documents WHERE record_id = ?`)
        .get(Number(recordId));
      return Number(row?.total || 0);
    }
  };
}

module.exports = {
  createSqliteClinicalRepository
};
