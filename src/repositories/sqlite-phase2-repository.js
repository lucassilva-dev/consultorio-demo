const { decryptSecret, encryptSecret } = require("../lib/encryption");
const {
  LIKE_ESCAPE_CLAUSE,
  buildLikePattern,
  nowIso,
  toNumber
} = require("./clinic-repository-helpers");

function mapReceiptRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    amount: toNumber(row.amount, 0),
    fileSizeBytes: Number(row.fileSizeBytes || 0)
  };
}

function parseAuditMetadata(value) {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    return {};
  }
}

function mapAuditLogRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    adminUserId: row.adminUserId ? Number(row.adminUserId) : null,
    metadata: parseAuditMetadata(row.metadataJson)
  };
}

function createSqlitePhase2Repository(db, runtimeConfig) {
  const getReceiptByIdStmt = db.prepare(`
    SELECT
      r.id,
      r.session_id AS sessionId,
      r.patient_id AS patientId,
      r.receipt_number AS receiptNumber,
      r.sequence_number AS sequenceNumber,
      r.professional_name AS professionalName,
      r.crp,
      r.professional_document AS professionalDocument,
      r.receipt_city AS receiptCity,
      r.receipt_footer_text AS receiptFooterText,
      r.patient_name AS patientName,
      r.payer_name AS payerName,
      r.payer_document AS payerDocument,
      r.session_date AS sessionDate,
      r.payment_date AS paymentDate,
      r.amount,
      r.payment_method AS paymentMethod,
      r.service_description AS serviceDescription,
      r.notice_text AS noticeText,
      r.file_storage_provider AS fileStorageProvider,
      r.file_object_key AS fileObjectKey,
      r.file_content_type AS fileContentType,
      r.file_size_bytes AS fileSizeBytes,
      r.created_at AS createdAt,
      r.updated_at AS updatedAt,
      s.scheduled_at AS scheduledAt,
      p.full_name AS patientFullName
    FROM receipts r
    INNER JOIN clinic_sessions s ON s.id = r.session_id
    INNER JOIN patients p ON p.id = r.patient_id
    WHERE r.id = ?
    LIMIT 1
  `);
  const getReceiptBySessionIdStmt = db.prepare(`
    SELECT
      r.id,
      r.session_id AS sessionId,
      r.patient_id AS patientId,
      r.receipt_number AS receiptNumber,
      r.sequence_number AS sequenceNumber,
      r.professional_name AS professionalName,
      r.crp,
      r.professional_document AS professionalDocument,
      r.receipt_city AS receiptCity,
      r.receipt_footer_text AS receiptFooterText,
      r.patient_name AS patientName,
      r.payer_name AS payerName,
      r.payer_document AS payerDocument,
      r.session_date AS sessionDate,
      r.payment_date AS paymentDate,
      r.amount,
      r.payment_method AS paymentMethod,
      r.service_description AS serviceDescription,
      r.notice_text AS noticeText,
      r.file_storage_provider AS fileStorageProvider,
      r.file_object_key AS fileObjectKey,
      r.file_content_type AS fileContentType,
      r.file_size_bytes AS fileSizeBytes,
      r.created_at AS createdAt,
      r.updated_at AS updatedAt,
      s.scheduled_at AS scheduledAt,
      p.full_name AS patientFullName
    FROM receipts r
    INNER JOIN clinic_sessions s ON s.id = r.session_id
    INNER JOIN patients p ON p.id = r.patient_id
    WHERE r.session_id = ?
    LIMIT 1
  `);
  // Aloca (não apenas lê) o próximo número: o UPDATE ... RETURNING é atômico,
  // e o contador nunca regride, mesmo que um recibo seja removido.
  const allocateReceiptSequenceStmt = db.prepare(`
    UPDATE receipt_sequence
    SET next_value = next_value + 1
    WHERE id = 1
    RETURNING next_value - 1 AS nextValue
  `);
  const seedReceiptSequenceStmt = db.prepare(`
    INSERT INTO receipt_sequence (id, next_value)
    SELECT 1, COALESCE((SELECT MAX(sequence_number) FROM receipts), 0) + 1
    WHERE NOT EXISTS (SELECT 1 FROM receipt_sequence WHERE id = 1)
  `);
  const upsertReceiptStmt = db.prepare(`
    INSERT INTO receipts (
      session_id,
      patient_id,
      receipt_number,
      sequence_number,
      professional_name,
      crp,
      professional_document,
      receipt_city,
      receipt_footer_text,
      patient_name,
      payer_name,
      payer_document,
      session_date,
      payment_date,
      amount,
      payment_method,
      service_description,
      notice_text,
      file_storage_provider,
      file_object_key,
      file_content_type,
      file_size_bytes,
      created_at,
      updated_at
    ) VALUES (
      @session_id,
      @patient_id,
      @receipt_number,
      @sequence_number,
      @professional_name,
      @crp,
      @professional_document,
      @receipt_city,
      @receipt_footer_text,
      @patient_name,
      @payer_name,
      @payer_document,
      @session_date,
      @payment_date,
      @amount,
      @payment_method,
      @service_description,
      @notice_text,
      @file_storage_provider,
      @file_object_key,
      @file_content_type,
      @file_size_bytes,
      @created_at,
      @updated_at
    )
    ON CONFLICT(session_id) DO UPDATE SET
      patient_id = excluded.patient_id,
      receipt_number = excluded.receipt_number,
      sequence_number = excluded.sequence_number,
      professional_name = excluded.professional_name,
      crp = excluded.crp,
      professional_document = excluded.professional_document,
      receipt_city = excluded.receipt_city,
      receipt_footer_text = excluded.receipt_footer_text,
      patient_name = excluded.patient_name,
      payer_name = excluded.payer_name,
      payer_document = excluded.payer_document,
      session_date = excluded.session_date,
      payment_date = excluded.payment_date,
      amount = excluded.amount,
      payment_method = excluded.payment_method,
      service_description = excluded.service_description,
      notice_text = excluded.notice_text,
      file_storage_provider = excluded.file_storage_provider,
      file_object_key = excluded.file_object_key,
      file_content_type = excluded.file_content_type,
      file_size_bytes = excluded.file_size_bytes,
      updated_at = excluded.updated_at
  `);
  const getGoogleCalendarConnectionStmt = db.prepare(`
    SELECT
      connection_key AS connectionKey,
      email,
      access_token AS accessToken,
      refresh_token AS refreshToken,
      scope,
      token_type AS tokenType,
      expiry_date AS expiryDate,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM google_calendar_connections
    WHERE connection_key = 'default'
    LIMIT 1
  `);
  const getGoogleCalendarConnectionOverviewStmt = db.prepare(`
    SELECT
      email,
      access_token AS accessToken,
      refresh_token AS refreshToken
    FROM google_calendar_connections
    WHERE connection_key = 'default'
    LIMIT 1
  `);
  const upsertGoogleCalendarConnectionStmt = db.prepare(`
    INSERT INTO google_calendar_connections (
      connection_key,
      email,
      access_token,
      refresh_token,
      scope,
      token_type,
      expiry_date,
      created_at,
      updated_at
    ) VALUES (
      'default',
      @email,
      @access_token,
      @refresh_token,
      @scope,
      @token_type,
      @expiry_date,
      @created_at,
      @updated_at
    )
    ON CONFLICT(connection_key) DO UPDATE SET
      email = excluded.email,
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      scope = excluded.scope,
      token_type = excluded.token_type,
      expiry_date = excluded.expiry_date,
      updated_at = excluded.updated_at
  `);
  const deleteGoogleCalendarConnectionStmt = db.prepare(`
    DELETE FROM google_calendar_connections
    WHERE connection_key = 'default'
  `);
  const createAuditLogStmt = db.prepare(`
    INSERT INTO audit_logs (
      admin_user_id,
      admin_email,
      action,
      entity_type,
      entity_id,
      summary,
      metadata_json,
      ip_address,
      user_agent,
      created_at
    ) VALUES (
      @admin_user_id,
      @admin_email,
      @action,
      @entity_type,
      @entity_id,
      @summary,
      @metadata_json,
      @ip_address,
      @user_agent,
      @created_at
    )
  `);
  const updateSessionGoogleSyncStmt = db.prepare(`
    UPDATE clinic_sessions
    SET
      google_calendar_event_id = @google_calendar_event_id,
      google_calendar_id = @google_calendar_id,
      google_calendar_sync_status = @google_calendar_sync_status,
      google_calendar_last_synced_at = @google_calendar_last_synced_at,
      google_calendar_error = @google_calendar_error,
      meeting_url = COALESCE(@meeting_url, meeting_url),
      updated_at = @updated_at
    WHERE id = @id
  `);

  function queryRows(sql, params = []) {
    return db.prepare(sql).all(...params);
  }

  function decryptConnectionRow(row) {
    if (!row) {
      return null;
    }

    return {
      ...row,
      accessToken: decryptSecret(row.accessToken, runtimeConfig),
      refreshToken: decryptSecret(row.refreshToken, runtimeConfig)
    };
  }

  return {
    async listReceipts(filters = {}) {
      const params = [];
      let sql = `
        SELECT
          r.id,
          r.session_id AS sessionId,
          r.patient_id AS patientId,
          r.receipt_number AS receiptNumber,
          r.sequence_number AS sequenceNumber,
          r.professional_name AS professionalName,
          r.crp,
          r.professional_document AS professionalDocument,
          r.receipt_city AS receiptCity,
          r.receipt_footer_text AS receiptFooterText,
          r.patient_name AS patientName,
          r.payer_name AS payerName,
          r.payer_document AS payerDocument,
          r.session_date AS sessionDate,
          r.payment_date AS paymentDate,
          r.amount,
          r.payment_method AS paymentMethod,
          r.service_description AS serviceDescription,
          r.notice_text AS noticeText,
          r.file_storage_provider AS fileStorageProvider,
          r.file_object_key AS fileObjectKey,
          r.file_content_type AS fileContentType,
          r.file_size_bytes AS fileSizeBytes,
          r.created_at AS createdAt,
          r.updated_at AS updatedAt
        FROM receipts r
        WHERE 1 = 1
      `;

      if (filters.patientId) {
        params.push(Number(filters.patientId));
        sql += " AND r.patient_id = ?";
      }

      if (filters.sessionId) {
        params.push(Number(filters.sessionId));
        sql += " AND r.session_id = ?";
      }

      // Competência filtra pelo mês do atendimento; caixa, pelo mês do
      // pagamento. A coluna é escolhida aqui, nunca vinda do cliente.
      const dateColumn = filters.basis === "caixa" ? "r.payment_date" : "r.session_date";

      if (filters.dateFrom) {
        params.push(filters.dateFrom);
        sql += ` AND ${dateColumn} >= ?`;
      }

      if (filters.dateTo) {
        params.push(filters.dateTo);
        sql += ` AND ${dateColumn} < ?`;
      }

      sql += ` ORDER BY ${dateColumn} DESC, r.id DESC`;
      return queryRows(sql, params).map(mapReceiptRow);
    },

    async getReceiptById(id) {
      return mapReceiptRow(getReceiptByIdStmt.get(Number(id)) || null);
    },

    async getReceiptBySessionId(sessionId) {
      return mapReceiptRow(getReceiptBySessionIdStmt.get(Number(sessionId)) || null);
    },

    async getNextReceiptSequence() {
      const alocado = allocateReceiptSequenceStmt.get();
      if (alocado) {
        return Number(alocado.nextValue);
      }

      // Sem a linha do contador (banco anterior à migração 006, ou restaurado
      // pela metade), semear a partir do maior número já emitido é a única
      // saída segura. Cair num default fixo repetiria número de recibo.
      seedReceiptSequenceStmt.run();
      const aposSemear = allocateReceiptSequenceStmt.get();
      if (!aposSemear) {
        throw new Error("Não foi possível alocar o número do recibo.");
      }
      return Number(aposSemear.nextValue);
    },

    async saveReceipt(payload) {
      const existing = await this.getReceiptBySessionId(payload.sessionId);
      const now = nowIso();
      upsertReceiptStmt.run({
        session_id: Number(payload.sessionId),
        patient_id: Number(payload.patientId),
        receipt_number: payload.receiptNumber,
        sequence_number: Number(payload.sequenceNumber),
        professional_name: payload.professionalName,
        crp: payload.crp,
        professional_document: payload.professionalDocument || "",
        receipt_city: payload.receiptCity || "",
        receipt_footer_text: payload.receiptFooterText || "",
        patient_name: payload.patientName,
        payer_name: payload.payerName || "",
        payer_document: payload.payerDocument || "",
        session_date: payload.sessionDate,
        payment_date: payload.paymentDate,
        amount: toNumber(payload.amount, 0),
        payment_method: payload.paymentMethod,
        service_description: payload.serviceDescription,
        notice_text: payload.noticeText,
        file_storage_provider: payload.fileStorageProvider,
        file_object_key: payload.fileObjectKey,
        file_content_type: payload.fileContentType || "application/pdf",
        file_size_bytes: Number(payload.fileSizeBytes || 0),
        created_at: existing?.createdAt || now,
        updated_at: now
      });
      return this.getReceiptBySessionId(payload.sessionId);
    },

    async getGoogleCalendarConnection() {
      return decryptConnectionRow(getGoogleCalendarConnectionStmt.get() || null);
    },

    async getGoogleCalendarConnectionOverview() {
      const row = getGoogleCalendarConnectionOverviewStmt.get() || null;
      if (!row) {
        return null;
      }

      return {
        email: row.email || "",
        connected: Boolean(row.accessToken || row.refreshToken)
      };
    },

    async saveGoogleCalendarConnection(payload) {
      const now = nowIso();
      upsertGoogleCalendarConnectionStmt.run({
        email: payload.email || "",
        access_token: encryptSecret(payload.accessToken || "", runtimeConfig),
        refresh_token: encryptSecret(payload.refreshToken || "", runtimeConfig),
        scope: payload.scope || "",
        token_type: payload.tokenType || "",
        expiry_date: payload.expiryDate || "",
        created_at: now,
        updated_at: now
      });
      return this.getGoogleCalendarConnection();
    },

    async deleteGoogleCalendarConnection() {
      deleteGoogleCalendarConnectionStmt.run();
    },

    async updateSessionGoogleCalendarSync(sessionId, patch = {}) {
      const current = db
        .prepare(`
          SELECT
            id,
            google_calendar_event_id AS googleCalendarEventId,
            google_calendar_id AS googleCalendarId,
            google_calendar_sync_status AS googleCalendarSyncStatus,
            google_calendar_last_synced_at AS googleCalendarLastSyncedAt,
            google_calendar_error AS googleCalendarError,
            meeting_url AS meetingUrl
          FROM clinic_sessions
          WHERE id = ?
          LIMIT 1
        `)
        .get(Number(sessionId));

      if (!current) {
        return null;
      }

      updateSessionGoogleSyncStmt.run({
        id: Number(sessionId),
        google_calendar_event_id:
          typeof patch.googleCalendarEventId === "string"
            ? patch.googleCalendarEventId
            : current.googleCalendarEventId || "",
        google_calendar_id:
          typeof patch.googleCalendarId === "string"
            ? patch.googleCalendarId
            : current.googleCalendarId || "",
        google_calendar_sync_status:
          patch.googleCalendarSyncStatus || current.googleCalendarSyncStatus || "skipped",
        google_calendar_last_synced_at:
          typeof patch.googleCalendarLastSyncedAt === "string"
            ? patch.googleCalendarLastSyncedAt
            : current.googleCalendarLastSyncedAt || "",
        google_calendar_error:
          typeof patch.googleCalendarError === "string"
            ? patch.googleCalendarError
            : current.googleCalendarError || "",
        meeting_url:
          typeof patch.meetingUrl === "string" && patch.meetingUrl
            ? patch.meetingUrl
            : null,
        updated_at: nowIso()
      });

      return current;
    },

    async listFailedGoogleCalendarSessions(limit = 25) {
      return queryRows(
        `
          SELECT
            s.id,
            s.patient_id AS patientId,
            p.full_name AS patientName,
            s.scheduled_at AS scheduledAt,
            s.status,
            s.google_calendar_event_id AS googleCalendarEventId,
            s.google_calendar_id AS googleCalendarId,
            s.google_calendar_sync_status AS googleCalendarSyncStatus,
            s.google_calendar_last_synced_at AS googleCalendarLastSyncedAt,
            s.google_calendar_error AS googleCalendarError
          FROM clinic_sessions s
          INNER JOIN patients p ON p.id = s.patient_id
          WHERE s.google_calendar_sync_status = 'failed'
          ORDER BY s.updated_at DESC, s.id DESC
          LIMIT ?
        `,
        [Number(limit)]
      );
    },

    async getGoogleCalendarSyncSummary() {
      const row = db
        .prepare(`
          SELECT
            MAX(NULLIF(google_calendar_last_synced_at, '')) AS lastSyncedAt,
            SUM(CASE WHEN google_calendar_sync_status = 'failed' THEN 1 ELSE 0 END) AS failedCount
          FROM clinic_sessions
        `)
        .get();

      return {
        lastSyncedAt: row?.lastSyncedAt || "",
        failedCount: Number(row?.failedCount || 0)
      };
    },

    async createAuditLog(payload) {
      createAuditLogStmt.run({
        admin_user_id: payload.adminUserId ? Number(payload.adminUserId) : null,
        admin_email: payload.adminEmail || "",
        action: payload.action || "",
        entity_type: payload.entityType || "",
        entity_id: payload.entityId ? String(payload.entityId) : "",
        summary: payload.summary || "",
        metadata_json: JSON.stringify(payload.metadata || {}),
        ip_address: payload.ipAddress || "",
        user_agent: payload.userAgent || "",
        created_at: nowIso()
      });
    },

    async listAuditLogs(filters = {}) {
      const params = [];
      let whereClause = " WHERE 1 = 1";

      if (filters.action) {
        params.push(filters.action);
        whereClause += " AND action = ?";
      }

      if (filters.entityType) {
        params.push(filters.entityType);
        whereClause += " AND entity_type = ?";
      }

      if (filters.adminEmail) {
        params.push(buildLikePattern(filters.adminEmail));
        whereClause += ` AND admin_email LIKE ? ${LIKE_ESCAPE_CLAUSE}`;
      }

      if (filters.dateFrom) {
        params.push(filters.dateFrom);
        whereClause += " AND created_at >= ?";
      }

      if (filters.dateTo) {
        params.push(filters.dateTo);
        whereClause += " AND created_at < ?";
      }

      const totalRow = db
        .prepare(`SELECT COUNT(*) AS total FROM audit_logs${whereClause}`)
        .get(...params);
      const page = Number(filters.page || 1);
      const pageSize = Number(filters.pageSize || 20);
      const rows = db
        .prepare(
          `
            SELECT
              id,
              admin_user_id AS adminUserId,
              admin_email AS adminEmail,
              action,
              entity_type AS entityType,
              entity_id AS entityId,
              summary,
              metadata_json AS metadataJson,
              ip_address AS ipAddress,
              user_agent AS userAgent,
              created_at AS createdAt
            FROM audit_logs
            ${whereClause}
            ORDER BY created_at DESC, id DESC
            LIMIT ?
            OFFSET ?
          `
        )
        .all(...params, pageSize, (page - 1) * pageSize);

      return {
        items: rows.map(mapAuditLogRow),
        total: Number(totalRow?.total || 0),
        page,
        pageSize
      };
    }
  };
}

module.exports = {
  createSqlitePhase2Repository
};
