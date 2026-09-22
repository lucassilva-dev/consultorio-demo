const { nowIso } = require("./clinic-repository-helpers");

// id e patient_id são BIGSERIAL, e o driver postgres.js entrega int8 como
// string — o SQLite entrega número. Sem normalizar aqui, comparações estritas
// (o vínculo adendo -> evolução original, por exemplo) só quebram em produção.
function toId(value) {
  return value === null || typeof value === "undefined" || value === ""
    ? null
    : Number(value);
}

function mapIntakeRow(row) {
  if (!row) {
    return null;
  }
  return {
    ...row,
    id: toId(row.id),
    patientId: toId(row.patientId),
    createdByAdminId: toId(row.createdByAdminId)
  };
}

function mapEvolutionRow(row) {
  if (!row) {
    return null;
  }
  return {
    ...row,
    id: toId(row.id),
    patientId: toId(row.patientId),
    sessionId: toId(row.sessionId),
    parentEvolutionId: toId(row.parentEvolutionId),
    createdByAdminId: toId(row.createdByAdminId)
  };
}

function mapRecordRow(row) {
  if (!row) {
    return null;
  }
  return {
    ...row,
    id: toId(row.id),
    patientId: toId(row.patientId),
    sequenceNumber: Number(row.sequenceNumber || 0),
    openedByAdminId: toId(row.openedByAdminId),
    closedByAdminId: toId(row.closedByAdminId)
  };
}

function mapBlockRow(row) {
  if (!row) {
    return null;
  }
  return {
    ...row,
    id: toId(row.id),
    recordId: toId(row.recordId),
    createdByAdminId: toId(row.createdByAdminId)
  };
}

function mapDocumentRow(row) {
  if (!row) {
    return null;
  }
  return {
    ...row,
    id: toId(row.id),
    recordId: toId(row.recordId),
    patientId: toId(row.patientId),
    sequenceNumber: Number(row.sequenceNumber || 0),
    fileSizeBytes: Number(row.fileSizeBytes || 0),
    createdByAdminId: toId(row.createdByAdminId)
  };
}

function createPostgresClinicalRepository(db) {
  return {
    // ── Anamnese ──────────────────────────────────────────────────────────
    async getIntakeByPatientId(patientId) {
      const rows = await db`
        SELECT
          id,
          patient_id AS "patientId",
          status,
          encrypted_payload AS "encryptedPayload",
          payload_hash AS "payloadHash",
          created_by_admin_id AS "createdByAdminId",
          created_by_admin_email AS "createdByAdminEmail",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          completed_at AS "completedAt",
          locked_at AS "lockedAt"
        FROM clinical_intakes
        WHERE patient_id = ${Number(patientId)}
        LIMIT 1
      `;
      return mapIntakeRow(rows[0] || null);
    },

    async getIntakeById(id) {
      const rows = await db`
        SELECT
          id,
          patient_id AS "patientId",
          status,
          encrypted_payload AS "encryptedPayload",
          payload_hash AS "payloadHash",
          created_by_admin_id AS "createdByAdminId",
          created_by_admin_email AS "createdByAdminEmail",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          completed_at AS "completedAt",
          locked_at AS "lockedAt"
        FROM clinical_intakes
        WHERE id = ${Number(id)}
        LIMIT 1
      `;
      return mapIntakeRow(rows[0] || null);
    },

    async createIntake(payload) {
      const now = nowIso();
      const rows = await db`
        INSERT INTO clinical_intakes (
          patient_id, status, encrypted_payload, payload_hash,
          created_by_admin_id, created_by_admin_email,
          created_at, updated_at, completed_at, locked_at
        ) VALUES (
          ${Number(payload.patientId)},
          ${payload.status || "draft"},
          ${payload.encryptedPayload || ""},
          ${payload.payloadHash || ""},
          ${payload.createdByAdminId ? Number(payload.createdByAdminId) : null},
          ${payload.createdByAdminEmail || ""},
          ${now}, ${now}, '', ''
        )
        RETURNING id
      `;
      return this.getIntakeById(rows[0].id);
    },

    async updateIntake(id, patch) {
      const current = await this.getIntakeById(id);
      if (!current) {
        return null;
      }
      await db`
        UPDATE clinical_intakes SET
          status = ${patch.status ?? current.status},
          encrypted_payload = ${typeof patch.encryptedPayload === "string"
            ? patch.encryptedPayload
            : current.encryptedPayload},
          payload_hash = ${typeof patch.payloadHash === "string"
            ? patch.payloadHash
            : current.payloadHash},
          completed_at = ${typeof patch.completedAt === "string"
            ? patch.completedAt
            : current.completedAt},
          locked_at = ${typeof patch.lockedAt === "string" ? patch.lockedAt : current.lockedAt},
          updated_at = ${nowIso()}
        WHERE id = ${Number(id)}
      `;
      return this.getIntakeById(id);
    },

    async getNextIntakeVersionNumber(intakeId) {
      const rows = await db`
        SELECT COALESCE(MAX(version_number), 0) + 1 AS "nextValue"
        FROM clinical_intake_versions
        WHERE intake_id = ${Number(intakeId)}
      `;
      return Number(rows[0]?.nextValue || 1);
    },

    async addIntakeVersion(payload) {
      await db`
        INSERT INTO clinical_intake_versions (
          intake_id, encrypted_payload, payload_hash, version_number,
          changed_by_admin_id, changed_by_admin_email, change_reason, created_at
        ) VALUES (
          ${Number(payload.intakeId)},
          ${payload.encryptedPayload || ""},
          ${payload.payloadHash || ""},
          ${Number(payload.versionNumber)},
          ${payload.changedByAdminId ? Number(payload.changedByAdminId) : null},
          ${payload.changedByAdminEmail || ""},
          ${payload.changeReason || ""},
          ${nowIso()}
        )
      `;
    },

    async countIntakeVersions(intakeId) {
      const rows = await db`
        SELECT COUNT(*)::int AS total
        FROM clinical_intake_versions
        WHERE intake_id = ${Number(intakeId)}
      `;
      return Number(rows[0]?.total || 0);
    },

    // ── Evoluções ─────────────────────────────────────────────────────────
    async listEvolutionsByPatientId(patientId) {
      const rows = await db`
        SELECT
          id,
          patient_id AS "patientId",
          session_id AS "sessionId",
          evolution_date AS "evolutionDate",
          evolution_type AS "evolutionType",
          title,
          status,
          parent_evolution_id AS "parentEvolutionId",
          created_by_admin_id AS "createdByAdminId",
          created_by_admin_email AS "createdByAdminEmail",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          signed_at AS "signedAt",
          locked_at AS "lockedAt"
        FROM clinical_evolutions
        WHERE patient_id = ${Number(patientId)}
        ORDER BY evolution_date DESC, id DESC
      `;
      return rows.map(mapEvolutionRow);
    },

    async listEvolutionsForExport(patientId) {
      const rows = await db`
        SELECT
          id,
          patient_id AS "patientId",
          session_id AS "sessionId",
          evolution_date AS "evolutionDate",
          evolution_type AS "evolutionType",
          title,
          encrypted_content AS "encryptedContent",
          content_hash AS "contentHash",
          status,
          parent_evolution_id AS "parentEvolutionId",
          created_by_admin_id AS "createdByAdminId",
          created_by_admin_email AS "createdByAdminEmail",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          signed_at AS "signedAt",
          locked_at AS "lockedAt"
        FROM clinical_evolutions
        WHERE patient_id = ${Number(patientId)}
        ORDER BY evolution_date ASC, id ASC
      `;
      return rows.map(mapEvolutionRow);
    },

    async getEvolutionById(id) {
      const rows = await db`
        SELECT
          id,
          patient_id AS "patientId",
          session_id AS "sessionId",
          evolution_date AS "evolutionDate",
          evolution_type AS "evolutionType",
          title,
          encrypted_content AS "encryptedContent",
          content_hash AS "contentHash",
          status,
          parent_evolution_id AS "parentEvolutionId",
          created_by_admin_id AS "createdByAdminId",
          created_by_admin_email AS "createdByAdminEmail",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          signed_at AS "signedAt",
          locked_at AS "lockedAt"
        FROM clinical_evolutions
        WHERE id = ${Number(id)}
        LIMIT 1
      `;
      return mapEvolutionRow(rows[0] || null);
    },

    async createEvolution(payload) {
      const now = nowIso();
      const rows = await db`
        INSERT INTO clinical_evolutions (
          patient_id, session_id, evolution_date, evolution_type, title,
          encrypted_content, content_hash, status, parent_evolution_id,
          created_by_admin_id, created_by_admin_email,
          created_at, updated_at, signed_at, locked_at
        ) VALUES (
          ${Number(payload.patientId)},
          ${payload.sessionId ? Number(payload.sessionId) : null},
          ${payload.evolutionDate},
          ${payload.evolutionType || "session"},
          ${payload.title || ""},
          ${payload.encryptedContent || ""},
          ${payload.contentHash || ""},
          ${payload.status || "draft"},
          ${payload.parentEvolutionId ? Number(payload.parentEvolutionId) : null},
          ${payload.createdByAdminId ? Number(payload.createdByAdminId) : null},
          ${payload.createdByAdminEmail || ""},
          ${now}, ${now}, '', ''
        )
        RETURNING id
      `;
      return this.getEvolutionById(rows[0].id);
    },

    async updateEvolution(id, patch) {
      const current = await this.getEvolutionById(id);
      if (!current) {
        return null;
      }
      await db`
        UPDATE clinical_evolutions SET
          evolution_date = ${patch.evolutionDate ?? current.evolutionDate},
          session_id = ${typeof patch.sessionId === "undefined" ? current.sessionId : patch.sessionId},
          evolution_type = ${patch.evolutionType ?? current.evolutionType},
          title = ${typeof patch.title === "string" ? patch.title : current.title},
          encrypted_content = ${typeof patch.encryptedContent === "string"
            ? patch.encryptedContent
            : current.encryptedContent},
          content_hash = ${typeof patch.contentHash === "string"
            ? patch.contentHash
            : current.contentHash},
          status = ${patch.status ?? current.status},
          signed_at = ${typeof patch.signedAt === "string" ? patch.signedAt : current.signedAt},
          locked_at = ${typeof patch.lockedAt === "string" ? patch.lockedAt : current.lockedAt},
          updated_at = ${nowIso()}
        WHERE id = ${Number(id)}
      `;
      return this.getEvolutionById(id);
    },

    async getNextEvolutionVersionNumber(evolutionId) {
      const rows = await db`
        SELECT COALESCE(MAX(version_number), 0) + 1 AS "nextValue"
        FROM clinical_evolution_versions
        WHERE evolution_id = ${Number(evolutionId)}
      `;
      return Number(rows[0]?.nextValue || 1);
    },

    async addEvolutionVersion(payload) {
      await db`
        INSERT INTO clinical_evolution_versions (
          evolution_id, encrypted_content, content_hash, version_number,
          changed_by_admin_id, changed_by_admin_email, change_reason, created_at
        ) VALUES (
          ${Number(payload.evolutionId)},
          ${payload.encryptedContent || ""},
          ${payload.contentHash || ""},
          ${Number(payload.versionNumber)},
          ${payload.changedByAdminId ? Number(payload.changedByAdminId) : null},
          ${payload.changedByAdminEmail || ""},
          ${payload.changeReason || ""},
          ${nowIso()}
        )
      `;
    },

    async countEvolutions(patientId) {
      const rows = await db`
        SELECT COUNT(*)::int AS total
        FROM clinical_evolutions
        WHERE patient_id = ${Number(patientId)}
      `;
      return Number(rows[0]?.total || 0);
    },

    async getLatestEvolution(patientId) {
      const rows = await db`
        SELECT
          id,
          patient_id AS "patientId",
          session_id AS "sessionId",
          evolution_date AS "evolutionDate",
          evolution_type AS "evolutionType",
          title,
          status,
          parent_evolution_id AS "parentEvolutionId",
          created_by_admin_id AS "createdByAdminId",
          created_by_admin_email AS "createdByAdminEmail",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          signed_at AS "signedAt",
          locked_at AS "lockedAt"
        FROM clinical_evolutions
        WHERE patient_id = ${Number(patientId)}
        ORDER BY evolution_date DESC, id DESC
        LIMIT 1
      `;
      return mapEvolutionRow(rows[0] || null);
    },
    // ── Prontuário ────────────────────────────────────────────────────────
    async getRecordByPatientId(patientId) {
      const rows = await db`
        SELECT
          id,
          patient_id AS "patientId",
          record_number AS "recordNumber",
          sequence_number AS "sequenceNumber",
          status,
          closing_reason AS "closingReason",
          opened_at AS "openedAt",
          closed_at AS "closedAt",
          opened_by_admin_id AS "openedByAdminId",
          opened_by_admin_email AS "openedByAdminEmail",
          closed_by_admin_id AS "closedByAdminId",
          closed_by_admin_email AS "closedByAdminEmail",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM clinical_records
        WHERE patient_id = ${Number(patientId)}
        LIMIT 1
      `;
      return mapRecordRow(rows[0] || null);
    },

    async getRecordById(id) {
      const rows = await db`
        SELECT
          id,
          patient_id AS "patientId",
          record_number AS "recordNumber",
          sequence_number AS "sequenceNumber",
          status,
          closing_reason AS "closingReason",
          opened_at AS "openedAt",
          closed_at AS "closedAt",
          opened_by_admin_id AS "openedByAdminId",
          opened_by_admin_email AS "openedByAdminEmail",
          closed_by_admin_id AS "closedByAdminId",
          closed_by_admin_email AS "closedByAdminEmail",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM clinical_records
        WHERE id = ${Number(id)}
        LIMIT 1
      `;
      return mapRecordRow(rows[0] || null);
    },

    // Aloca o número no próprio UPDATE: atômico, e o contador nunca regride.
    async getNextRecordSequence() {
      const alocar = () => db`
        UPDATE clinical_record_sequence
        SET next_value = next_value + 1
        WHERE id = 1
        RETURNING next_value - 1 AS "nextValue"
      `;

      const rows = await alocar();
      if (rows[0]) {
        return Number(rows[0].nextValue);
      }

      await db`
        INSERT INTO clinical_record_sequence (id, next_value)
        SELECT 1, COALESCE((SELECT MAX(sequence_number) FROM clinical_records), 0) + 1
        ON CONFLICT (id) DO NOTHING
      `;
      const aposSemear = await alocar();
      if (!aposSemear[0]) {
        throw new Error("Não foi possível alocar o número do prontuário.");
      }
      return Number(aposSemear[0].nextValue);
    },

    async createRecord(payload) {
      const now = nowIso();
      const rows = await db`
        INSERT INTO clinical_records (
          patient_id, record_number, sequence_number, status, closing_reason,
          opened_at, closed_at, opened_by_admin_id, opened_by_admin_email,
          closed_by_admin_id, closed_by_admin_email, created_at, updated_at
        ) VALUES (
          ${Number(payload.patientId)},
          ${payload.recordNumber || ""},
          ${Number(payload.sequenceNumber || 0)},
          ${payload.status || "open"},
          '',
          ${payload.openedAt || now},
          '',
          ${payload.openedByAdminId ? Number(payload.openedByAdminId) : null},
          ${payload.openedByAdminEmail || ""},
          NULL, '', ${now}, ${now}
        )
        RETURNING id
      `;
      return this.getRecordById(rows[0].id);
    },

    async updateRecord(id, patch) {
      const current = await this.getRecordById(id);
      if (!current) {
        return null;
      }
      await db`
        UPDATE clinical_records SET
          status = ${patch.status ?? current.status},
          closing_reason = ${typeof patch.closingReason === "string"
            ? patch.closingReason
            : current.closingReason},
          closed_at = ${typeof patch.closedAt === "string" ? patch.closedAt : current.closedAt},
          closed_by_admin_id = ${typeof patch.closedByAdminId === "undefined"
            ? current.closedByAdminId
            : patch.closedByAdminId
              ? Number(patch.closedByAdminId)
              : null},
          closed_by_admin_email = ${typeof patch.closedByAdminEmail === "string"
            ? patch.closedByAdminEmail
            : current.closedByAdminEmail},
          updated_at = ${nowIso()}
        WHERE id = ${Number(id)}
      `;
      return this.getRecordById(id);
    },

    // ── Blocos do prontuário (contrato, plano, encerramento) ───────────────
    async listBlocksByRecordId(recordId) {
      const rows = await db`
        SELECT
          id,
          record_id AS "recordId",
          block_type AS "blockType",
          status,
          created_by_admin_id AS "createdByAdminId",
          created_by_admin_email AS "createdByAdminEmail",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          completed_at AS "completedAt",
          locked_at AS "lockedAt"
        FROM clinical_record_blocks
        WHERE record_id = ${Number(recordId)}
        ORDER BY id ASC
      `;
      return rows.map(mapBlockRow);
    },

    async listBlocksForExport(recordId) {
      const rows = await db`
        SELECT
          id,
          record_id AS "recordId",
          block_type AS "blockType",
          status,
          encrypted_payload AS "encryptedPayload",
          payload_hash AS "payloadHash",
          created_by_admin_id AS "createdByAdminId",
          created_by_admin_email AS "createdByAdminEmail",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          completed_at AS "completedAt",
          locked_at AS "lockedAt"
        FROM clinical_record_blocks
        WHERE record_id = ${Number(recordId)}
        ORDER BY id ASC
      `;
      return rows.map(mapBlockRow);
    },

    async getBlock(recordId, blockType) {
      const rows = await db`
        SELECT
          id,
          record_id AS "recordId",
          block_type AS "blockType",
          status,
          encrypted_payload AS "encryptedPayload",
          payload_hash AS "payloadHash",
          created_by_admin_id AS "createdByAdminId",
          created_by_admin_email AS "createdByAdminEmail",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          completed_at AS "completedAt",
          locked_at AS "lockedAt"
        FROM clinical_record_blocks
        WHERE record_id = ${Number(recordId)} AND block_type = ${String(blockType)}
        LIMIT 1
      `;
      return mapBlockRow(rows[0] || null);
    },

    async getBlockById(id) {
      const rows = await db`
        SELECT
          id,
          record_id AS "recordId",
          block_type AS "blockType",
          status,
          encrypted_payload AS "encryptedPayload",
          payload_hash AS "payloadHash",
          created_by_admin_id AS "createdByAdminId",
          created_by_admin_email AS "createdByAdminEmail",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          completed_at AS "completedAt",
          locked_at AS "lockedAt"
        FROM clinical_record_blocks
        WHERE id = ${Number(id)}
        LIMIT 1
      `;
      return mapBlockRow(rows[0] || null);
    },

    async createBlock(payload) {
      const now = nowIso();
      const rows = await db`
        INSERT INTO clinical_record_blocks (
          record_id, block_type, status, encrypted_payload, payload_hash,
          created_by_admin_id, created_by_admin_email,
          created_at, updated_at, completed_at, locked_at
        ) VALUES (
          ${Number(payload.recordId)},
          ${payload.blockType},
          ${payload.status || "draft"},
          ${payload.encryptedPayload || ""},
          ${payload.payloadHash || ""},
          ${payload.createdByAdminId ? Number(payload.createdByAdminId) : null},
          ${payload.createdByAdminEmail || ""},
          ${now}, ${now}, '', ''
        )
        RETURNING id
      `;
      return this.getBlockById(rows[0].id);
    },

    async updateBlock(id, patch) {
      const current = await this.getBlockById(id);
      if (!current) {
        return null;
      }
      await db`
        UPDATE clinical_record_blocks SET
          status = ${patch.status ?? current.status},
          encrypted_payload = ${typeof patch.encryptedPayload === "string"
            ? patch.encryptedPayload
            : current.encryptedPayload},
          payload_hash = ${typeof patch.payloadHash === "string"
            ? patch.payloadHash
            : current.payloadHash},
          completed_at = ${typeof patch.completedAt === "string"
            ? patch.completedAt
            : current.completedAt},
          locked_at = ${typeof patch.lockedAt === "string" ? patch.lockedAt : current.lockedAt},
          updated_at = ${nowIso()}
        WHERE id = ${Number(id)}
      `;
      return this.getBlockById(id);
    },

    async getNextBlockVersionNumber(blockId) {
      const rows = await db`
        SELECT COALESCE(MAX(version_number), 0) + 1 AS "nextValue"
        FROM clinical_record_block_versions
        WHERE block_id = ${Number(blockId)}
      `;
      return Number(rows[0]?.nextValue || 1);
    },

    async addBlockVersion(payload) {
      await db`
        INSERT INTO clinical_record_block_versions (
          block_id, encrypted_payload, payload_hash, version_number,
          changed_by_admin_id, changed_by_admin_email, change_reason, created_at
        ) VALUES (
          ${Number(payload.blockId)},
          ${payload.encryptedPayload || ""},
          ${payload.payloadHash || ""},
          ${Number(payload.versionNumber)},
          ${payload.changedByAdminId ? Number(payload.changedByAdminId) : null},
          ${payload.changedByAdminEmail || ""},
          ${payload.changeReason || ""},
          ${nowIso()}
        )
      `;
    },

    async countBlockVersions(blockId) {
      const rows = await db`
        SELECT COUNT(*)::int AS total
        FROM clinical_record_block_versions
        WHERE block_id = ${Number(blockId)}
      `;
      return Number(rows[0]?.total || 0);
    },

    // ── Documentos emitidos ───────────────────────────────────────────────
    async getNextDocumentSequence() {
      const alocar = () => db`
        UPDATE clinical_document_sequence
        SET next_value = next_value + 1
        WHERE id = 1
        RETURNING next_value - 1 AS "nextValue"
      `;

      const rows = await alocar();
      if (rows[0]) {
        return Number(rows[0].nextValue);
      }

      await db`
        INSERT INTO clinical_document_sequence (id, next_value)
        SELECT 1, COALESCE((SELECT MAX(sequence_number) FROM clinical_documents), 0) + 1
        ON CONFLICT (id) DO NOTHING
      `;
      const aposSemear = await alocar();
      if (!aposSemear[0]) {
        throw new Error("Não foi possível alocar o número do documento.");
      }
      return Number(aposSemear[0].nextValue);
    },

    async listDocumentsByRecordId(recordId) {
      const rows = await db`
        SELECT
          id,
          record_id AS "recordId",
          patient_id AS "patientId",
          document_number AS "documentNumber",
          sequence_number AS "sequenceNumber",
          document_type AS "documentType",
          title,
          status,
          issued_at AS "issuedAt",
          revoked_at AS "revokedAt",
          revoke_reason AS "revokeReason",
          created_by_admin_id AS "createdByAdminId",
          created_by_admin_email AS "createdByAdminEmail",
          created_at AS "createdAt"
        FROM clinical_documents
        WHERE record_id = ${Number(recordId)}
        ORDER BY issued_at DESC, id DESC
      `;
      return rows.map(mapDocumentRow);
    },

    async getDocumentById(id) {
      const rows = await db`
        SELECT
          id,
          record_id AS "recordId",
          patient_id AS "patientId",
          document_number AS "documentNumber",
          sequence_number AS "sequenceNumber",
          document_type AS "documentType",
          title,
          encrypted_content AS "encryptedContent",
          content_hash AS "contentHash",
          status,
          issued_at AS "issuedAt",
          revoked_at AS "revokedAt",
          revoke_reason AS "revokeReason",
          file_storage_provider AS "fileStorageProvider",
          file_object_key AS "fileObjectKey",
          file_content_type AS "fileContentType",
          file_size_bytes AS "fileSizeBytes",
          created_by_admin_id AS "createdByAdminId",
          created_by_admin_email AS "createdByAdminEmail",
          created_at AS "createdAt"
        FROM clinical_documents
        WHERE id = ${Number(id)}
        LIMIT 1
      `;
      return mapDocumentRow(rows[0] || null);
    },

    async createDocument(payload) {
      const now = nowIso();
      const rows = await db`
        INSERT INTO clinical_documents (
          record_id, patient_id, document_number, sequence_number, document_type,
          title, encrypted_content, content_hash, status, issued_at,
          revoked_at, revoke_reason,
          file_storage_provider, file_object_key, file_content_type, file_size_bytes,
          created_by_admin_id, created_by_admin_email, created_at
        ) VALUES (
          ${Number(payload.recordId)},
          ${Number(payload.patientId)},
          ${payload.documentNumber || ""},
          ${Number(payload.sequenceNumber || 0)},
          ${payload.documentType},
          ${payload.title || ""},
          ${payload.encryptedContent || ""},
          ${payload.contentHash || ""},
          'issued',
          ${payload.issuedAt || now},
          '', '',
          ${payload.fileStorageProvider || ""},
          ${payload.fileObjectKey || ""},
          ${payload.fileContentType || ""},
          ${Number(payload.fileSizeBytes || 0)},
          ${payload.createdByAdminId ? Number(payload.createdByAdminId) : null},
          ${payload.createdByAdminEmail || ""},
          ${now}
        )
        RETURNING id
      `;
      return this.getDocumentById(rows[0].id);
    },

    // Documento emitido é imutável: só a revogação muda estado, e ela guarda o
    // motivo em vez de apagar o registro ou o arquivo.
    async revokeDocument(id, patch) {
      const current = await this.getDocumentById(id);
      if (!current) {
        return null;
      }
      await db`
        UPDATE clinical_documents SET
          status = 'revoked',
          revoked_at = ${patch.revokedAt || nowIso()},
          revoke_reason = ${patch.revokeReason || ""}
        WHERE id = ${Number(id)}
      `;
      return this.getDocumentById(id);
    },

    async countDocuments(recordId) {
      const rows = await db`
        SELECT COUNT(*)::int AS total
        FROM clinical_documents
        WHERE record_id = ${Number(recordId)}
      `;
      return Number(rows[0]?.total || 0);
    }
  };
}

module.exports = {
  createPostgresClinicalRepository,
  mapBlockRow,
  mapDocumentRow,
  mapRecordRow,
  // Exportados para teste: são funções puras e cobrem a normalização de ids,
  // que só diverge do SQLite em produção e não aparece na suíte de integração.
  mapEvolutionRow,
  mapIntakeRow
};
