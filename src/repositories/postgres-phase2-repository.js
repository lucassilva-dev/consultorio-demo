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
    fileSizeBytes: Number(row.fileSizeBytes || 0),
    sequenceNumber: Number(row.sequenceNumber || 0)
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

function createPostgresPhase2Repository(db, runtimeConfig) {
  function runUnsafe(sqlText, params = []) {
    return db.unsafe(sqlText, params);
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
      let sqlText = `
        SELECT
          r.id,
          r.session_id AS "sessionId",
          r.patient_id AS "patientId",
          r.receipt_number AS "receiptNumber",
          r.sequence_number AS "sequenceNumber",
          r.professional_name AS "professionalName",
          r.crp,
          r.professional_document AS "professionalDocument",
          r.receipt_city AS "receiptCity",
          r.receipt_footer_text AS "receiptFooterText",
          r.patient_name AS "patientName",
          r.payer_name AS "payerName",
          r.payer_document AS "payerDocument",
          r.session_date AS "sessionDate",
          r.payment_date AS "paymentDate",
          r.amount,
          r.payment_method AS "paymentMethod",
          r.service_description AS "serviceDescription",
          r.notice_text AS "noticeText",
          r.file_storage_provider AS "fileStorageProvider",
          r.file_object_key AS "fileObjectKey",
          r.file_content_type AS "fileContentType",
          r.file_size_bytes AS "fileSizeBytes",
          r.created_at AS "createdAt",
          r.updated_at AS "updatedAt"
        FROM receipts r
        WHERE 1 = 1
      `;

      if (filters.patientId) {
        params.push(Number(filters.patientId));
        sqlText += ` AND r.patient_id = $${params.length}`;
      }

      if (filters.sessionId) {
        params.push(Number(filters.sessionId));
        sqlText += ` AND r.session_id = $${params.length}`;
      }

      // Competência filtra pelo mês do atendimento; caixa, pelo mês do
      // pagamento. A coluna é escolhida aqui, nunca vinda do cliente.
      const dateColumn = filters.basis === "caixa" ? "r.payment_date" : "r.session_date";

      if (filters.dateFrom) {
        params.push(filters.dateFrom);
        sqlText += ` AND ${dateColumn} >= $${params.length}`;
      }

      if (filters.dateTo) {
        params.push(filters.dateTo);
        sqlText += ` AND ${dateColumn} < $${params.length}`;
      }

      sqlText += ` ORDER BY ${dateColumn} DESC, r.id DESC`;
      const rows = await runUnsafe(sqlText, params);
      return rows.map(mapReceiptRow);
    },

    async getReceiptById(id) {
      const rows = await db`
        SELECT
          r.id,
          r.session_id AS "sessionId",
          r.patient_id AS "patientId",
          r.receipt_number AS "receiptNumber",
          r.sequence_number AS "sequenceNumber",
          r.professional_name AS "professionalName",
          r.crp,
          r.professional_document AS "professionalDocument",
          r.receipt_city AS "receiptCity",
          r.receipt_footer_text AS "receiptFooterText",
          r.patient_name AS "patientName",
          r.payer_name AS "payerName",
          r.payer_document AS "payerDocument",
          r.session_date AS "sessionDate",
          r.payment_date AS "paymentDate",
          r.amount,
          r.payment_method AS "paymentMethod",
          r.service_description AS "serviceDescription",
          r.notice_text AS "noticeText",
          r.file_storage_provider AS "fileStorageProvider",
          r.file_object_key AS "fileObjectKey",
          r.file_content_type AS "fileContentType",
          r.file_size_bytes AS "fileSizeBytes",
          r.created_at AS "createdAt",
          r.updated_at AS "updatedAt"
        FROM receipts r
        WHERE r.id = ${Number(id)}
        LIMIT 1
      `;
      return mapReceiptRow(rows[0] || null);
    },

    async getReceiptBySessionId(sessionId) {
      const rows = await db`
        SELECT
          r.id,
          r.session_id AS "sessionId",
          r.patient_id AS "patientId",
          r.receipt_number AS "receiptNumber",
          r.sequence_number AS "sequenceNumber",
          r.professional_name AS "professionalName",
          r.crp,
          r.professional_document AS "professionalDocument",
          r.receipt_city AS "receiptCity",
          r.receipt_footer_text AS "receiptFooterText",
          r.patient_name AS "patientName",
          r.payer_name AS "payerName",
          r.payer_document AS "payerDocument",
          r.session_date AS "sessionDate",
          r.payment_date AS "paymentDate",
          r.amount,
          r.payment_method AS "paymentMethod",
          r.service_description AS "serviceDescription",
          r.notice_text AS "noticeText",
          r.file_storage_provider AS "fileStorageProvider",
          r.file_object_key AS "fileObjectKey",
          r.file_content_type AS "fileContentType",
          r.file_size_bytes AS "fileSizeBytes",
          r.created_at AS "createdAt",
          r.updated_at AS "updatedAt"
        FROM receipts r
        WHERE r.session_id = ${Number(sessionId)}
        LIMIT 1
      `;
      return mapReceiptRow(rows[0] || null);
    },

    // Aloca (não apenas lê) o próximo número: o UPDATE ... RETURNING é atômico,
    // e o contador nunca regride, mesmo que um recibo seja removido.
    async getNextReceiptSequence() {
      const alocar = () => db`
        UPDATE receipt_sequence
        SET next_value = next_value + 1
        WHERE id = 1
        RETURNING next_value - 1 AS "nextValue"
      `;

      const rows = await alocar();
      if (rows[0]) {
        return Number(rows[0].nextValue);
      }

      // Sem a linha do contador (banco anterior à migração 006, ou restaurado
      // pela metade), semear a partir do maior número já emitido é a única
      // saída segura. Cair num default fixo repetiria número de recibo.
      await db`
        INSERT INTO receipt_sequence (id, next_value)
        SELECT 1, COALESCE((SELECT MAX(sequence_number) FROM receipts), 0) + 1
        ON CONFLICT (id) DO NOTHING
      `;
      const aposSemear = await alocar();
      if (!aposSemear[0]) {
        throw new Error("Não foi possível alocar o número do recibo.");
      }
      return Number(aposSemear[0].nextValue);
    },

    async saveReceipt(payload) {
      const existing = await this.getReceiptBySessionId(payload.sessionId);
      const now = nowIso();
      await db`
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
          ${Number(payload.sessionId)},
          ${Number(payload.patientId)},
          ${payload.receiptNumber},
          ${Number(payload.sequenceNumber)},
          ${payload.professionalName},
          ${payload.crp},
          ${payload.professionalDocument || ""},
          ${payload.receiptCity || ""},
          ${payload.receiptFooterText || ""},
          ${payload.patientName},
          ${payload.payerName || ""},
          ${payload.payerDocument || ""},
          ${payload.sessionDate},
          ${payload.paymentDate},
          ${toNumber(payload.amount, 0)},
          ${payload.paymentMethod},
          ${payload.serviceDescription},
          ${payload.noticeText},
          ${payload.fileStorageProvider},
          ${payload.fileObjectKey},
          ${payload.fileContentType || "application/pdf"},
          ${Number(payload.fileSizeBytes || 0)},
          ${existing?.createdAt || now},
          ${now}
        )
        ON CONFLICT (session_id) DO UPDATE SET
          patient_id = EXCLUDED.patient_id,
          receipt_number = EXCLUDED.receipt_number,
          sequence_number = EXCLUDED.sequence_number,
          professional_name = EXCLUDED.professional_name,
          crp = EXCLUDED.crp,
          professional_document = EXCLUDED.professional_document,
          receipt_city = EXCLUDED.receipt_city,
          receipt_footer_text = EXCLUDED.receipt_footer_text,
          patient_name = EXCLUDED.patient_name,
          payer_name = EXCLUDED.payer_name,
          payer_document = EXCLUDED.payer_document,
          session_date = EXCLUDED.session_date,
          payment_date = EXCLUDED.payment_date,
          amount = EXCLUDED.amount,
          payment_method = EXCLUDED.payment_method,
          service_description = EXCLUDED.service_description,
          notice_text = EXCLUDED.notice_text,
          file_storage_provider = EXCLUDED.file_storage_provider,
          file_object_key = EXCLUDED.file_object_key,
          file_content_type = EXCLUDED.file_content_type,
          file_size_bytes = EXCLUDED.file_size_bytes,
          updated_at = EXCLUDED.updated_at
      `;
      return this.getReceiptBySessionId(payload.sessionId);
    },

    async getGoogleCalendarConnection() {
      const rows = await db`
        SELECT
          connection_key AS "connectionKey",
          email,
          access_token AS "accessToken",
          refresh_token AS "refreshToken",
          scope,
          token_type AS "tokenType",
          expiry_date AS "expiryDate",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM google_calendar_connections
        WHERE connection_key = 'default'
        LIMIT 1
      `;
      return decryptConnectionRow(rows[0] || null);
    },

    async getGoogleCalendarConnectionOverview() {
      const rows = await db`
        SELECT
          email,
          access_token AS "accessToken",
          refresh_token AS "refreshToken"
        FROM google_calendar_connections
        WHERE connection_key = 'default'
        LIMIT 1
      `;

      const row = rows[0] || null;
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
      await db`
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
          ${payload.email || ""},
          ${encryptSecret(payload.accessToken || "", runtimeConfig)},
          ${encryptSecret(payload.refreshToken || "", runtimeConfig)},
          ${payload.scope || ""},
          ${payload.tokenType || ""},
          ${payload.expiryDate || ""},
          ${now},
          ${now}
        )
        ON CONFLICT (connection_key) DO UPDATE SET
          email = EXCLUDED.email,
          access_token = EXCLUDED.access_token,
          refresh_token = EXCLUDED.refresh_token,
          scope = EXCLUDED.scope,
          token_type = EXCLUDED.token_type,
          expiry_date = EXCLUDED.expiry_date,
          updated_at = EXCLUDED.updated_at
      `;
      return this.getGoogleCalendarConnection();
    },

    async deleteGoogleCalendarConnection() {
      await db`
        DELETE FROM google_calendar_connections
        WHERE connection_key = 'default'
      `;
    },

    async updateSessionGoogleCalendarSync(sessionId, patch = {}) {
      const currentRows = await db`
        SELECT
          id,
          google_calendar_event_id AS "googleCalendarEventId",
          google_calendar_id AS "googleCalendarId",
          google_calendar_sync_status AS "googleCalendarSyncStatus",
          google_calendar_last_synced_at AS "googleCalendarLastSyncedAt",
          google_calendar_error AS "googleCalendarError",
          meeting_url AS "meetingUrl"
        FROM clinic_sessions
        WHERE id = ${Number(sessionId)}
        LIMIT 1
      `;
      const current = currentRows[0];
      if (!current) {
        return null;
      }

      await db`
        UPDATE clinic_sessions
        SET
          google_calendar_event_id = ${typeof patch.googleCalendarEventId === "string"
            ? patch.googleCalendarEventId
            : current.googleCalendarEventId || ""},
          google_calendar_id = ${typeof patch.googleCalendarId === "string"
            ? patch.googleCalendarId
            : current.googleCalendarId || ""},
          google_calendar_sync_status = ${patch.googleCalendarSyncStatus ||
            current.googleCalendarSyncStatus ||
            "skipped"},
          google_calendar_last_synced_at = ${typeof patch.googleCalendarLastSyncedAt === "string"
            ? patch.googleCalendarLastSyncedAt
            : current.googleCalendarLastSyncedAt || ""},
          google_calendar_error = ${typeof patch.googleCalendarError === "string"
            ? patch.googleCalendarError
            : current.googleCalendarError || ""},
          meeting_url = ${typeof patch.meetingUrl === "string" && patch.meetingUrl
            ? patch.meetingUrl
            : current.meetingUrl || ""},
          updated_at = ${nowIso()}
        WHERE id = ${Number(sessionId)}
      `;

      return current;
    },

    async listFailedGoogleCalendarSessions(limit = 25) {
      const rows = await db`
        SELECT
          s.id,
          s.patient_id AS "patientId",
          p.full_name AS "patientName",
          s.scheduled_at AS "scheduledAt",
          s.status,
          s.google_calendar_event_id AS "googleCalendarEventId",
          s.google_calendar_id AS "googleCalendarId",
          s.google_calendar_sync_status AS "googleCalendarSyncStatus",
          s.google_calendar_last_synced_at AS "googleCalendarLastSyncedAt",
          s.google_calendar_error AS "googleCalendarError"
        FROM clinic_sessions s
        INNER JOIN patients p ON p.id = s.patient_id
        WHERE s.google_calendar_sync_status = 'failed'
        ORDER BY s.updated_at DESC, s.id DESC
        LIMIT ${Number(limit)}
      `;
      return rows;
    },

    async getGoogleCalendarSyncSummary() {
      const rows = await db`
        SELECT
          MAX(NULLIF(google_calendar_last_synced_at, '')) AS "lastSyncedAt",
          SUM(CASE WHEN google_calendar_sync_status = 'failed' THEN 1 ELSE 0 END)::int AS "failedCount"
        FROM clinic_sessions
      `;

      return {
        lastSyncedAt: rows[0]?.lastSyncedAt || "",
        failedCount: Number(rows[0]?.failedCount || 0)
      };
    },

    async createAuditLog(payload) {
      await db`
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
          ${payload.adminUserId ? Number(payload.adminUserId) : null},
          ${payload.adminEmail || ""},
          ${payload.action || ""},
          ${payload.entityType || ""},
          ${payload.entityId ? String(payload.entityId) : ""},
          ${payload.summary || ""},
          ${JSON.stringify(payload.metadata || {})},
          ${payload.ipAddress || ""},
          ${payload.userAgent || ""},
          ${nowIso()}
        )
      `;
    },

    async listAuditLogs(filters = {}) {
      const params = [];
      let whereClause = " WHERE 1 = 1";

      if (filters.action) {
        params.push(filters.action);
        whereClause += ` AND action = $${params.length}`;
      }

      if (filters.entityType) {
        params.push(filters.entityType);
        whereClause += ` AND entity_type = $${params.length}`;
      }

      if (filters.adminEmail) {
        params.push(buildLikePattern(filters.adminEmail));
        whereClause += ` AND admin_email ILIKE $${params.length} ${LIKE_ESCAPE_CLAUSE}`;
      }

      if (filters.dateFrom) {
        params.push(filters.dateFrom);
        whereClause += ` AND created_at >= $${params.length}`;
      }

      if (filters.dateTo) {
        params.push(filters.dateTo);
        whereClause += ` AND created_at < $${params.length}`;
      }

      const page = Number(filters.page || 1);
      const pageSize = Number(filters.pageSize || 20);
      params.push(pageSize);
      const limitParam = `$${params.length}`;
      params.push((page - 1) * pageSize);
      const offsetParam = `$${params.length}`;

      const totalRows = await runUnsafe(
        `SELECT COUNT(*)::int AS total FROM audit_logs${whereClause}`,
        params.slice(0, -2)
      );
      const rows = await runUnsafe(
        `
          SELECT
            id,
            admin_user_id AS "adminUserId",
            admin_email AS "adminEmail",
            action,
            entity_type AS "entityType",
            entity_id AS "entityId",
            summary,
            metadata_json AS "metadataJson",
            ip_address AS "ipAddress",
            user_agent AS "userAgent",
            created_at AS "createdAt"
          FROM audit_logs
          ${whereClause}
          ORDER BY created_at DESC, id DESC
          LIMIT ${limitParam}
          OFFSET ${offsetParam}
        `,
        params
      );

      return {
        items: rows.map(mapAuditLogRow),
        total: Number(totalRows[0]?.total || 0),
        page,
        pageSize
      };
    }
  };
}

module.exports = {
  createPostgresPhase2Repository
};
