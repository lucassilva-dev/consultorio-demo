const { DEFAULT_MESSAGE_TEMPLATES } = require("../default-clinic-data");
const { AppError } = require("../lib/errors");
const { getClinicDateParts } = require("../lib/clinic-time");
const {
  LIKE_ESCAPE_CLAUSE,
  buildLikePattern,
  buildPatientFromLead,
  getMonthRange,
  getWeekRange,
  leadNeedsGuardianData,
  mergePlatformSettings,
  normalizePlatformSettings,
  nowIso,
  requiresGuardianForPatientType,
  toIntegerOrNull,
  toNumber
} = require("./clinic-repository-helpers");

function createPostgresClinicRepository(db) {
  async function selectLeadById(sql, id) {
    const rows = await sql`
      SELECT
        id,
        name,
        phone,
        email,
        age,
        source,
        interest,
        status,
        preferred_period AS "preferredPeriod",
        administrative_note AS "administrativeNote",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM leads
      WHERE id = ${Number(id)}
      LIMIT 1
    `;
    return rows[0] || null;
  }

  async function selectPatientById(sql, id) {
    const rows = await sql`
      SELECT
        id,
        full_name AS "fullName",
        preferred_name AS "preferredName",
        birth_date AS "birthDate",
        age,
        phone,
        email,
        patient_type AS "patientType",
        guardian_name AS "guardianName",
        guardian_phone AS "guardianPhone",
        session_price AS "sessionPrice",
        default_weekday AS "defaultWeekday",
        default_time AS "defaultTime",
        modality,
        status,
        administrative_note AS "administrativeNote",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM patients
      WHERE id = ${Number(id)}
      LIMIT 1
    `;
    return rows[0]
      ? { ...rows[0], sessionPrice: toNumber(rows[0].sessionPrice, 0) }
      : null;
  }

  async function selectSessionById(sql, id) {
    const rows = await sql`
      SELECT
        s.id,
        s.patient_id AS "patientId",
        p.full_name AS "patientName",
        p.preferred_name AS "patientPreferredName",
        s.scheduled_at AS "scheduledAt",
        s.duration_minutes AS "durationMinutes",
        s.status,
        s.payment_status AS "paymentStatus",
        s.price,
        s.payment_method AS "paymentMethod",
        s.paid_at AS "paidAt",
        s.meeting_url AS "meetingUrl",
        s.google_calendar_event_id AS "googleCalendarEventId",
        s.google_calendar_id AS "googleCalendarId",
        s.google_calendar_sync_status AS "googleCalendarSyncStatus",
        s.google_calendar_last_synced_at AS "googleCalendarLastSyncedAt",
        s.google_calendar_error AS "googleCalendarError",
        r.id AS "receiptId",
        r.receipt_number AS "receiptNumber",
        s.administrative_note AS "administrativeNote",
        s.created_at AS "createdAt",
        s.updated_at AS "updatedAt"
      FROM clinic_sessions s
      INNER JOIN patients p ON p.id = s.patient_id
      LEFT JOIN receipts r ON r.session_id = s.id
      WHERE s.id = ${Number(id)}
      LIMIT 1
    `;

    return rows[0] ? { ...rows[0], price: toNumber(rows[0].price, 0) } : null;
  }

  async function selectTemplateById(sql, id) {
    const rows = await sql`
      SELECT
        id,
        title,
        category,
        body,
        is_active AS "isActive",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM message_templates
      WHERE id = ${Number(id)}
      LIMIT 1
    `;
    return rows[0] || null;
  }

  async function readAgendaSettings(sql) {
    const rows = await sql`
      SELECT payload_json
      FROM platform_settings
      WHERE settings_key = 'agenda'
      LIMIT 1
    `;
    const payload = rows[0]?.payload_json || {};
    return normalizePlatformSettings(
      typeof payload === "string" ? JSON.parse(payload) : payload
    );
  }

  function runUnsafe(sqlText, params = []) {
    return db.unsafe(sqlText, params);
  }

  function getReceivedAtValue(session) {
    return session.paidAt || session.scheduledAt;
  }

  return {
    async seedDefaults() {
      const totals = await db`SELECT COUNT(*)::int AS total FROM message_templates`;
      if ((totals[0]?.total || 0) === 0) {
        const now = nowIso();
        for (const template of DEFAULT_MESSAGE_TEMPLATES) {
          await db`
            INSERT INTO message_templates (
              title,
              category,
              body,
              is_active,
              created_at,
              updated_at
            ) VALUES (
              ${template.title},
              ${template.category},
              ${template.body},
              ${template.isActive},
              ${now},
              ${now}
            )
          `;
        }
      }

      const existingSettings = await db`
        SELECT settings_key
        FROM platform_settings
        WHERE settings_key = 'agenda'
        LIMIT 1
      `;

      if (!existingSettings[0]) {
        const now = nowIso();
        await db`
          INSERT INTO platform_settings (
            settings_key,
            payload_json,
            created_at,
            updated_at
          ) VALUES (
            'agenda',
            ${db.json(normalizePlatformSettings())},
            ${now},
            ${now}
          )
        `;
        return;
      }

      const currentSettings = await readAgendaSettings(db);
      const normalizedDefaults = normalizePlatformSettings();
      const needsReceiptBackfill =
        !currentSettings.professionalName || !currentSettings.crp;

      if (needsReceiptBackfill) {
        const now = nowIso();
        await db`
          UPDATE platform_settings
          SET
            payload_json = ${db.json(
              normalizePlatformSettings({
                ...currentSettings,
                professionalName:
                  currentSettings.professionalName || normalizedDefaults.professionalName,
                crp: currentSettings.crp || normalizedDefaults.crp
              })
            )},
            updated_at = ${now}
          WHERE settings_key = 'agenda'
        `;
      }
    },

    async listLeads(filters = {}) {
      const params = [];
      let sqlText = `
        SELECT
          id,
          name,
          phone,
          email,
          age,
          source,
          interest,
          status,
          preferred_period AS "preferredPeriod",
          administrative_note AS "administrativeNote",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM leads
        WHERE 1 = 1
      `;

      if (filters.search) {
        params.push(buildLikePattern(filters.search));
        sqlText +=
          ` AND (name ILIKE $${params.length} ${LIKE_ESCAPE_CLAUSE}` +
          ` OR phone ILIKE $${params.length} ${LIKE_ESCAPE_CLAUSE})`;
      }

      if (filters.status) {
        params.push(filters.status);
        sqlText += ` AND status = $${params.length}`;
      }

      sqlText += " ORDER BY created_at DESC, id DESC";
      return runUnsafe(sqlText, params);
    },

    async getLeadById(id) {
      return selectLeadById(db, id);
    },

    async createLead(payload) {
      const now = nowIso();
      const rows = await db`
        INSERT INTO leads (
          name,
          phone,
          email,
          age,
          source,
          interest,
          status,
          preferred_period,
          administrative_note,
          created_at,
          updated_at
        ) VALUES (
          ${payload.name},
          ${payload.phone},
          ${payload.email || ""},
          ${toIntegerOrNull(payload.age)},
          ${payload.source},
          ${payload.interest},
          ${payload.status},
          ${payload.preferredPeriod},
          ${payload.administrativeNote || ""},
          ${now},
          ${now}
        )
        RETURNING id
      `;
      return this.getLeadById(rows[0]?.id);
    },

    async updateLead(id, payload) {
      await db`
        UPDATE leads
        SET
          name = ${payload.name},
          phone = ${payload.phone},
          email = ${payload.email || ""},
          age = ${toIntegerOrNull(payload.age)},
          source = ${payload.source},
          interest = ${payload.interest},
          status = ${payload.status},
          preferred_period = ${payload.preferredPeriod},
          administrative_note = ${payload.administrativeNote || ""},
          updated_at = ${nowIso()}
        WHERE id = ${Number(id)}
      `;
      return this.getLeadById(id);
    },

    async deleteLead(id) {
      return db`DELETE FROM leads WHERE id = ${Number(id)}`;
    },

    async convertLeadToPatient(id, overrides = {}) {
      return db.begin(async (sql) => {
        const lead = await selectLeadById(sql, id);
        if (!lead) {
          return null;
        }

        const payload = buildPatientFromLead(lead, overrides);
        if (
          requiresGuardianForPatientType(payload.patientType) &&
          (!payload.guardianName || !payload.guardianPhone)
        ) {
          throw new AppError(
            leadNeedsGuardianData(lead)
              ? "Lead adolescente precisa de responsável antes da conversão."
              : "Paciente adolescente precisa de responsável antes da conversão.",
            400
          );
        }

        const now = nowIso();
        const patientRows = await sql`
          INSERT INTO patients (
            full_name,
            preferred_name,
            birth_date,
            age,
            phone,
            email,
            patient_type,
            guardian_name,
            guardian_phone,
            session_price,
            default_weekday,
            default_time,
            modality,
            status,
            administrative_note,
            created_at,
            updated_at
          ) VALUES (
            ${payload.fullName},
            ${payload.preferredName || ""},
            ${payload.birthDate || ""},
            ${toIntegerOrNull(payload.age)},
            ${payload.phone},
            ${payload.email || ""},
            ${payload.patientType},
            ${payload.guardianName || ""},
            ${payload.guardianPhone || ""},
            ${toNumber(payload.sessionPrice, 0)},
            ${payload.defaultWeekday || ""},
            ${payload.defaultTime || ""},
            ${payload.modality},
            ${payload.status},
            ${payload.administrativeNote || ""},
            ${now},
            ${now}
          )
          RETURNING id
        `;

        await sql`
          UPDATE leads
          SET status = 'virou_paciente', updated_at = ${now}
          WHERE id = ${Number(id)}
        `;

        return {
          lead: await selectLeadById(sql, id),
          patient: await selectPatientById(sql, patientRows[0]?.id)
        };
      });
    },

    async listPatients(filters = {}) {
      const params = [];
      let sqlText = `
        SELECT
          id,
          full_name AS "fullName",
          preferred_name AS "preferredName",
          birth_date AS "birthDate",
          age,
          phone,
          email,
          patient_type AS "patientType",
          guardian_name AS "guardianName",
          guardian_phone AS "guardianPhone",
          session_price AS "sessionPrice",
          default_weekday AS "defaultWeekday",
          default_time AS "defaultTime",
          modality,
          status,
          administrative_note AS "administrativeNote",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM patients
        WHERE 1 = 1
      `;

      if (filters.search) {
        params.push(buildLikePattern(filters.search));
        sqlText +=
          ` AND (full_name ILIKE $${params.length} ${LIKE_ESCAPE_CLAUSE}` +
          ` OR preferred_name ILIKE $${params.length} ${LIKE_ESCAPE_CLAUSE}` +
          ` OR phone ILIKE $${params.length} ${LIKE_ESCAPE_CLAUSE})`;
      }

      if (filters.status) {
        params.push(filters.status);
        sqlText += ` AND status = $${params.length}`;
      }

      sqlText += ' ORDER BY full_name ASC, id DESC';
      const rows = await runUnsafe(sqlText, params);
      return rows.map((row) => ({ ...row, sessionPrice: toNumber(row.sessionPrice, 0) }));
    },

    async getPatientById(id) {
      return selectPatientById(db, id);
    },

    async createPatient(payload) {
      const now = nowIso();
      const rows = await db`
        INSERT INTO patients (
          full_name,
          preferred_name,
          birth_date,
          age,
          phone,
          email,
          patient_type,
          guardian_name,
          guardian_phone,
          session_price,
          default_weekday,
          default_time,
          modality,
          status,
          administrative_note,
          created_at,
          updated_at
        ) VALUES (
          ${payload.fullName},
          ${payload.preferredName || ""},
          ${payload.birthDate || ""},
          ${toIntegerOrNull(payload.age)},
          ${payload.phone},
          ${payload.email || ""},
          ${payload.patientType},
          ${payload.guardianName || ""},
          ${payload.guardianPhone || ""},
          ${toNumber(payload.sessionPrice, 0)},
          ${payload.defaultWeekday || ""},
          ${payload.defaultTime || ""},
          ${payload.modality},
          ${payload.status},
          ${payload.administrativeNote || ""},
          ${now},
          ${now}
        )
        RETURNING id
      `;
      return this.getPatientById(rows[0]?.id);
    },

    async updatePatient(id, payload) {
      await db`
        UPDATE patients
        SET
          full_name = ${payload.fullName},
          preferred_name = ${payload.preferredName || ""},
          birth_date = ${payload.birthDate || ""},
          age = ${toIntegerOrNull(payload.age)},
          phone = ${payload.phone},
          email = ${payload.email || ""},
          patient_type = ${payload.patientType},
          guardian_name = ${payload.guardianName || ""},
          guardian_phone = ${payload.guardianPhone || ""},
          session_price = ${toNumber(payload.sessionPrice, 0)},
          default_weekday = ${payload.defaultWeekday || ""},
          default_time = ${payload.defaultTime || ""},
          modality = ${payload.modality},
          status = ${payload.status},
          administrative_note = ${payload.administrativeNote || ""},
          updated_at = ${nowIso()}
        WHERE id = ${Number(id)}
      `;
      return this.getPatientById(id);
    },

    async deletePatient(id) {
      return db`DELETE FROM patients WHERE id = ${Number(id)}`;
    },

    async listSessions(filters = {}) {
      const params = [];
      let sqlText = `
        SELECT
          s.id,
          s.patient_id AS "patientId",
          p.full_name AS "patientName",
          p.preferred_name AS "patientPreferredName",
          s.scheduled_at AS "scheduledAt",
          s.duration_minutes AS "durationMinutes",
          s.status,
          s.payment_status AS "paymentStatus",
          s.price,
          s.payment_method AS "paymentMethod",
          s.paid_at AS "paidAt",
          s.meeting_url AS "meetingUrl",
          s.google_calendar_event_id AS "googleCalendarEventId",
          s.google_calendar_id AS "googleCalendarId",
          s.google_calendar_sync_status AS "googleCalendarSyncStatus",
          s.google_calendar_last_synced_at AS "googleCalendarLastSyncedAt",
          s.google_calendar_error AS "googleCalendarError",
          r.id AS "receiptId",
          r.receipt_number AS "receiptNumber",
          s.administrative_note AS "administrativeNote",
          s.created_at AS "createdAt",
          s.updated_at AS "updatedAt"
        FROM clinic_sessions s
        INNER JOIN patients p ON p.id = s.patient_id
        LEFT JOIN receipts r ON r.session_id = s.id
        WHERE 1 = 1
      `;

      if (filters.patientId) {
        params.push(Number(filters.patientId));
        sqlText += ` AND s.patient_id = $${params.length}`;
      }

      if (filters.status) {
        params.push(filters.status);
        sqlText += ` AND s.status = $${params.length}`;
      }

      if (filters.paymentStatus) {
        params.push(filters.paymentStatus);
        sqlText += ` AND s.payment_status = $${params.length}`;
      }

      if (filters.dateFrom) {
        params.push(filters.dateFrom);
        sqlText += ` AND s.scheduled_at >= $${params.length}`;
      }

      if (filters.dateTo) {
        params.push(filters.dateTo);
        sqlText += ` AND s.scheduled_at < $${params.length}`;
      }

      sqlText += " ORDER BY s.scheduled_at ASC, s.id DESC";
      const rows = await runUnsafe(sqlText, params);
      return rows.map((row) => ({ ...row, price: toNumber(row.price, 0) }));
    },

    async getSessionById(id) {
      return selectSessionById(db, id);
    },

    async createSession(payload) {
      const now = nowIso();
      const rows = await db`
        INSERT INTO clinic_sessions (
          patient_id,
          scheduled_at,
          duration_minutes,
          status,
          payment_status,
          price,
          payment_method,
          paid_at,
          meeting_url,
          administrative_note,
          created_at,
          updated_at
        ) VALUES (
          ${Number(payload.patientId)},
          ${payload.scheduledAt},
          ${Number(payload.durationMinutes)},
          ${payload.status},
          ${payload.paymentStatus},
          ${toNumber(payload.price, 0)},
          ${payload.paymentMethod},
          ${payload.paidAt || ""},
          ${payload.meetingUrl || ""},
          ${payload.administrativeNote || ""},
          ${now},
          ${now}
        )
        RETURNING id
      `;
      return this.getSessionById(rows[0]?.id);
    },

    async updateSession(id, payload) {
      await db`
        UPDATE clinic_sessions
        SET
          patient_id = ${Number(payload.patientId)},
          scheduled_at = ${payload.scheduledAt},
          duration_minutes = ${Number(payload.durationMinutes)},
          status = ${payload.status},
          payment_status = ${payload.paymentStatus},
          price = ${toNumber(payload.price, 0)},
          payment_method = ${payload.paymentMethod},
          paid_at = ${payload.paidAt || ""},
          meeting_url = ${payload.meetingUrl || ""},
          administrative_note = ${payload.administrativeNote || ""},
          updated_at = ${nowIso()}
        WHERE id = ${Number(id)}
      `;
      return this.getSessionById(id);
    },

    async deleteSession(id) {
      return db`DELETE FROM clinic_sessions WHERE id = ${Number(id)}`;
    },

    async markSessionPaid(id, patch = {}) {
      await db`
        UPDATE clinic_sessions
        SET
          payment_status = 'pago',
          payment_method = ${patch.paymentMethod || "pix"},
          paid_at = ${patch.paidAt || nowIso()},
          updated_at = ${nowIso()}
        WHERE id = ${Number(id)}
      `;
      return this.getSessionById(id);
    },

    async markSessionDone(id) {
      await db`
        UPDATE clinic_sessions
        SET
          status = 'realizada',
          updated_at = ${nowIso()}
        WHERE id = ${Number(id)}
      `;
      return this.getSessionById(id);
    },

    async markSessionMissed(id) {
      await db`
        UPDATE clinic_sessions
        SET
          status = 'falta',
          updated_at = ${nowIso()}
        WHERE id = ${Number(id)}
      `;
      return this.getSessionById(id);
    },

    // O pagamento só é cancelado se ainda estava pendente. Zerar um pagamento
    // já recebido desencontrava o financeiro do recibo já emitido.
    async cancelSession(id) {
      await db`
        UPDATE clinic_sessions
        SET
          status = 'cancelada',
          payment_status = CASE
            WHEN payment_status = 'pago' THEN payment_status
            ELSE 'cancelado'
          END,
          updated_at = ${nowIso()}
        WHERE id = ${Number(id)}
      `;
      return this.getSessionById(id);
    },

    async listFinanceSessions(filters = {}) {
      // getClinicDateParts, não getUTC*: virada de mês em UTC acontece às 21h
      // do dia anterior no fuso da clínica, e o mês corrente saía errado por
      // três horas todo fim de mês.
      const hoje = getClinicDateParts();
      const year = Number(filters.year) || hoje.year;
      const month = Number(filters.month) || hoje.month;
      const range = getMonthRange(year, month);
      return this.listSessions({
        patientId: filters.patientId,
        paymentStatus: filters.paymentStatus,
        dateFrom: range.start,
        dateTo: range.end
      });
    },

    async getFinanceSummary(filters = {}) {
      // O agregado ignora o filtro de status de pagamento: ele descreve o mês
      // como um todo. O filtro vale para as listas, não para os totais.
      const { paymentStatus, ...periodo } = filters;
      const sessions = await this.listFinanceSessions(periodo);
      const pendingPayments = sessions.filter(
        (session) =>
          session.paymentStatus === "pendente" && session.status !== "cancelada"
      );
      const receivedPayments = sessions.filter((session) => session.paymentStatus === "pago");
      const completedSessions = sessions.filter((session) => session.status === "realizada");

      // paymentStatus não é usado aqui de propósito: as listas devolvidas já
      // vêm separadas por status (pendingPayments e receivedPayments), então
      // o filtro só teria o efeito de corromper os totais.
      return {
        summary: {
          totalReceived: receivedPayments.reduce(
            (total, session) => total + toNumber(session.price, 0),
            0
          ),
          totalPending: pendingPayments.reduce(
            (total, session) => total + toNumber(session.price, 0),
            0
          ),
          completedSessions: completedSessions.length,
          pendingPayments: pendingPayments.length
        },
        pendingPayments,
        receivedPayments
      };
    },

    async listMessageTemplates(filters = {}) {
      const params = [];
      let sqlText = `
        SELECT
          id,
          title,
          category,
          body,
          is_active AS "isActive",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM message_templates
        WHERE 1 = 1
      `;

      if (filters.search) {
        params.push(buildLikePattern(filters.search));
        sqlText += ` AND title ILIKE $${params.length} ${LIKE_ESCAPE_CLAUSE}`;
      }

      if (filters.category) {
        params.push(filters.category);
        sqlText += ` AND category = $${params.length}`;
      }

      if (typeof filters.isActive === "boolean") {
        params.push(filters.isActive);
        sqlText += ` AND is_active = $${params.length}`;
      }

      sqlText += " ORDER BY updated_at DESC, id DESC";
      return runUnsafe(sqlText, params);
    },

    async getMessageTemplateById(id) {
      return selectTemplateById(db, id);
    },

    async createMessageTemplate(payload) {
      const now = nowIso();
      const rows = await db`
        INSERT INTO message_templates (
          title,
          category,
          body,
          is_active,
          created_at,
          updated_at
        ) VALUES (
          ${payload.title},
          ${payload.category},
          ${payload.body},
          ${payload.isActive},
          ${now},
          ${now}
        )
        RETURNING id
      `;
      return this.getMessageTemplateById(rows[0]?.id);
    },

    async updateMessageTemplate(id, payload) {
      await db`
        UPDATE message_templates
        SET
          title = ${payload.title},
          category = ${payload.category},
          body = ${payload.body},
          is_active = ${payload.isActive},
          updated_at = ${nowIso()}
        WHERE id = ${Number(id)}
      `;
      return this.getMessageTemplateById(id);
    },

    async deleteMessageTemplate(id) {
      return db`DELETE FROM message_templates WHERE id = ${Number(id)}`;
    },

    async getPlatformSettings() {
      return readAgendaSettings(db);
    },

    async setPlatformSettings(payload) {
      const merged = normalizePlatformSettings(payload);
      const now = nowIso();
      await db`
        INSERT INTO platform_settings (
          settings_key,
          payload_json,
          created_at,
          updated_at
        ) VALUES (
          'agenda',
          ${db.json(merged)},
          ${now},
          ${now}
        )
        ON CONFLICT (settings_key) DO UPDATE SET
          payload_json = EXCLUDED.payload_json,
          updated_at = EXCLUDED.updated_at
      `;
      return readAgendaSettings(db);
    },

    async getDashboardSummary() {
      const weekRange = getWeekRange();
      const now = nowIso();
      const leads = await this.listLeads({ status: "novo" });
      const patients = await this.listPatients({ status: "ativo" });
      const weekSessions = await this.listSessions({
        dateFrom: weekRange.start,
        dateTo: weekRange.end
      });
      const pendingPayments = await this.listSessions({ paymentStatus: "pendente" });
      const finance = await this.getFinanceSummary();
      const upcomingSessions = (await this.listSessions({ dateFrom: now }))
        .filter((session) => ["agendada", "remarcada"].includes(session.status))
        .slice(0, 5);
      const settings = await this.getPlatformSettings();

      return {
        newLeads: leads.length,
        activePatients: patients.length,
        sessionsThisWeek: weekSessions.filter((session) => session.status !== "cancelada").length,
        pendingPayments: pendingPayments.filter((session) => session.status !== "cancelada").length,
        monthRevenue: finance.summary.totalReceived,
        monthPending: finance.summary.totalPending,
        upcomingSessions,
        schedulingUrl: settings.schedulingUrl || "",
        schedulingLabel: settings.schedulingLabel || ""
      };
    },

    getReceivedAtValue
  };
}

module.exports = {
  createPostgresClinicRepository
};
