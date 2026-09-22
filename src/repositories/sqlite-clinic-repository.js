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

function createSqliteClinicRepository(db) {
  const getLeadByIdStmt = db.prepare(`
    SELECT
      id,
      name,
      phone,
      email,
      age,
      source,
      interest,
      status,
      preferred_period AS preferredPeriod,
      administrative_note AS administrativeNote,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM leads
    WHERE id = ?
    LIMIT 1
  `);
  const insertLeadStmt = db.prepare(`
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
      @name,
      @phone,
      @email,
      @age,
      @source,
      @interest,
      @status,
      @preferred_period,
      @administrative_note,
      @created_at,
      @updated_at
    )
  `);
  const updateLeadStmt = db.prepare(`
    UPDATE leads
    SET
      name = @name,
      phone = @phone,
      email = @email,
      age = @age,
      source = @source,
      interest = @interest,
      status = @status,
      preferred_period = @preferred_period,
      administrative_note = @administrative_note,
      updated_at = @updated_at
    WHERE id = @id
  `);
  const deleteLeadStmt = db.prepare("DELETE FROM leads WHERE id = ?");
  const updateLeadStatusStmt = db.prepare(`
    UPDATE leads
    SET
      status = ?,
      updated_at = ?
    WHERE id = ?
  `);

  const getPatientByIdStmt = db.prepare(`
    SELECT
      id,
      full_name AS fullName,
      preferred_name AS preferredName,
      birth_date AS birthDate,
      age,
      phone,
      email,
      patient_type AS patientType,
      guardian_name AS guardianName,
      guardian_phone AS guardianPhone,
      session_price AS sessionPrice,
      default_weekday AS defaultWeekday,
      default_time AS defaultTime,
      modality,
      status,
      administrative_note AS administrativeNote,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM patients
    WHERE id = ?
    LIMIT 1
  `);
  const insertPatientStmt = db.prepare(`
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
      @full_name,
      @preferred_name,
      @birth_date,
      @age,
      @phone,
      @email,
      @patient_type,
      @guardian_name,
      @guardian_phone,
      @session_price,
      @default_weekday,
      @default_time,
      @modality,
      @status,
      @administrative_note,
      @created_at,
      @updated_at
    )
  `);
  const updatePatientStmt = db.prepare(`
    UPDATE patients
    SET
      full_name = @full_name,
      preferred_name = @preferred_name,
      birth_date = @birth_date,
      age = @age,
      phone = @phone,
      email = @email,
      patient_type = @patient_type,
      guardian_name = @guardian_name,
      guardian_phone = @guardian_phone,
      session_price = @session_price,
      default_weekday = @default_weekday,
      default_time = @default_time,
      modality = @modality,
      status = @status,
      administrative_note = @administrative_note,
      updated_at = @updated_at
    WHERE id = @id
  `);
  const deletePatientStmt = db.prepare("DELETE FROM patients WHERE id = ?");

  const getSessionByIdStmt = db.prepare(`
    SELECT
      s.id,
      s.patient_id AS patientId,
      p.full_name AS patientName,
      p.preferred_name AS patientPreferredName,
      s.scheduled_at AS scheduledAt,
      s.duration_minutes AS durationMinutes,
      s.status,
      s.payment_status AS paymentStatus,
      s.price,
      s.payment_method AS paymentMethod,
      s.paid_at AS paidAt,
      s.meeting_url AS meetingUrl,
      s.google_calendar_event_id AS googleCalendarEventId,
      s.google_calendar_id AS googleCalendarId,
      s.google_calendar_sync_status AS googleCalendarSyncStatus,
      s.google_calendar_last_synced_at AS googleCalendarLastSyncedAt,
      s.google_calendar_error AS googleCalendarError,
      r.id AS receiptId,
      r.receipt_number AS receiptNumber,
      s.administrative_note AS administrativeNote,
      s.created_at AS createdAt,
      s.updated_at AS updatedAt
    FROM clinic_sessions s
    INNER JOIN patients p ON p.id = s.patient_id
    LEFT JOIN receipts r ON r.session_id = s.id
    WHERE s.id = ?
    LIMIT 1
  `);
  const insertSessionStmt = db.prepare(`
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
      @patient_id,
      @scheduled_at,
      @duration_minutes,
      @status,
      @payment_status,
      @price,
      @payment_method,
      @paid_at,
      @meeting_url,
      @administrative_note,
      @created_at,
      @updated_at
    )
  `);
  const updateSessionStmt = db.prepare(`
    UPDATE clinic_sessions
    SET
      patient_id = @patient_id,
      scheduled_at = @scheduled_at,
      duration_minutes = @duration_minutes,
      status = @status,
      payment_status = @payment_status,
      price = @price,
      payment_method = @payment_method,
      paid_at = @paid_at,
      meeting_url = @meeting_url,
      administrative_note = @administrative_note,
      updated_at = @updated_at
    WHERE id = @id
  `);
  const deleteSessionStmt = db.prepare("DELETE FROM clinic_sessions WHERE id = ?");
  const markSessionPaidStmt = db.prepare(`
    UPDATE clinic_sessions
    SET
      payment_status = 'pago',
      payment_method = @payment_method,
      paid_at = @paid_at,
      updated_at = @updated_at
    WHERE id = @id
  `);
  const markSessionDoneStmt = db.prepare(`
    UPDATE clinic_sessions
    SET
      status = 'realizada',
      updated_at = @updated_at
    WHERE id = @id
  `);
  const markSessionMissedStmt = db.prepare(`
    UPDATE clinic_sessions
    SET
      status = 'falta',
      updated_at = @updated_at
    WHERE id = @id
  `);
  // O pagamento só é cancelado se ainda estava pendente. Zerar um pagamento
  // já recebido desencontrava o financeiro do recibo já emitido.
  const cancelSessionStmt = db.prepare(`
    UPDATE clinic_sessions
    SET
      status = 'cancelada',
      payment_status = CASE
        WHEN payment_status = 'pago' THEN payment_status
        ELSE 'cancelado'
      END,
      updated_at = @updated_at
    WHERE id = @id
  `);

  const getTemplateByIdStmt = db.prepare(`
    SELECT
      id,
      title,
      category,
      body,
      is_active AS isActive,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM message_templates
    WHERE id = ?
    LIMIT 1
  `);
  const insertTemplateStmt = db.prepare(`
    INSERT INTO message_templates (
      title,
      category,
      body,
      is_active,
      created_at,
      updated_at
    ) VALUES (
      @title,
      @category,
      @body,
      @is_active,
      @created_at,
      @updated_at
    )
  `);
  const updateTemplateStmt = db.prepare(`
    UPDATE message_templates
    SET
      title = @title,
      category = @category,
      body = @body,
      is_active = @is_active,
      updated_at = @updated_at
    WHERE id = @id
  `);
  const deleteTemplateStmt = db.prepare("DELETE FROM message_templates WHERE id = ?");
  const countTemplatesStmt = db.prepare("SELECT COUNT(*) AS total FROM message_templates");

  const getSettingsStmt = db.prepare(`
    SELECT payload_json
    FROM platform_settings
    WHERE settings_key = ?
    LIMIT 1
  `);
  const upsertSettingsStmt = db.prepare(`
    INSERT INTO platform_settings (
      settings_key,
      payload_json,
      created_at,
      updated_at
    ) VALUES (
      @settings_key,
      @payload_json,
      @created_at,
      @updated_at
    )
    ON CONFLICT(settings_key) DO UPDATE SET
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `);

  const convertLeadTransaction = db.transaction((leadId, overrides) => {
    const lead = getLeadByIdStmt.get(leadId);
    if (!lead) {
      return null;
    }

    const patientPayload = buildPatientFromLead(lead, overrides);
    if (
      requiresGuardianForPatientType(patientPayload.patientType) &&
      (!patientPayload.guardianName || !patientPayload.guardianPhone)
    ) {
      throw new AppError(
        leadNeedsGuardianData(lead)
          ? "Lead adolescente precisa de responsável antes da conversão."
          : "Paciente adolescente precisa de responsável antes da conversão.",
        400
      );
    }

    const now = nowIso();
    const result = insertPatientStmt.run({
      full_name: patientPayload.fullName,
      preferred_name: patientPayload.preferredName || "",
      birth_date: patientPayload.birthDate || "",
      age: toIntegerOrNull(patientPayload.age),
      phone: patientPayload.phone,
      email: patientPayload.email || "",
      patient_type: patientPayload.patientType,
      guardian_name: patientPayload.guardianName || "",
      guardian_phone: patientPayload.guardianPhone || "",
      session_price: toNumber(patientPayload.sessionPrice, 0),
      default_weekday: patientPayload.defaultWeekday || "",
      default_time: patientPayload.defaultTime || "",
      modality: patientPayload.modality,
      status: patientPayload.status,
      administrative_note: patientPayload.administrativeNote || "",
      created_at: now,
      updated_at: now
    });
    updateLeadStatusStmt.run("virou_paciente", now, leadId);

    return {
      lead: getLeadByIdStmt.get(leadId),
      patient: getPatientByIdStmt.get(result.lastInsertRowid)
    };
  });

  function mapBooleanRecord(row) {
    if (!row) {
      return null;
    }

    if (typeof row.isActive !== "undefined") {
      row.isActive = Boolean(row.isActive);
    }

    return row;
  }

  function queryRows(sql, params = []) {
    return db.prepare(sql).all(...params);
  }

  function getAgendaSettings() {
    const row = getSettingsStmt.get("agenda");
    const payload = row ? JSON.parse(row.payload_json) : {};
    return normalizePlatformSettings(payload);
  }

  function getReceivedAtValue(session) {
    return session.paidAt || session.scheduledAt;
  }

  return {
    async seedDefaults() {
      if (countTemplatesStmt.get().total === 0) {
        const now = nowIso();
        for (const template of DEFAULT_MESSAGE_TEMPLATES) {
          insertTemplateStmt.run({
            title: template.title,
            category: template.category,
            body: template.body,
            is_active: template.isActive ? 1 : 0,
            created_at: now,
            updated_at: now
          });
        }
      }

      if (!getSettingsStmt.get("agenda")) {
        const now = nowIso();
        upsertSettingsStmt.run({
          settings_key: "agenda",
          payload_json: JSON.stringify(normalizePlatformSettings()),
          created_at: now,
          updated_at: now
        });
        return;
      }

      const currentSettings = getAgendaSettings();
      const normalizedDefaults = normalizePlatformSettings();
      const needsReceiptBackfill =
        !currentSettings.professionalName || !currentSettings.crp;

      if (needsReceiptBackfill) {
        upsertSettingsStmt.run({
          settings_key: "agenda",
          payload_json: JSON.stringify(
            normalizePlatformSettings({
              ...currentSettings,
              professionalName:
                currentSettings.professionalName || normalizedDefaults.professionalName,
              crp: currentSettings.crp || normalizedDefaults.crp
            })
          ),
          created_at: nowIso(),
          updated_at: nowIso()
        });
      }
    },

    async listLeads(filters = {}) {
      const params = [];
      let sql = `
        SELECT
          id,
          name,
          phone,
          email,
          age,
          source,
          interest,
          status,
          preferred_period AS preferredPeriod,
          administrative_note AS administrativeNote,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM leads
        WHERE 1 = 1
      `;

      if (filters.search) {
        const padrao = buildLikePattern(filters.search);
        params.push(padrao, padrao);
        sql += ` AND (name LIKE ? ${LIKE_ESCAPE_CLAUSE} OR phone LIKE ? ${LIKE_ESCAPE_CLAUSE})`;
      }

      if (filters.status) {
        params.push(filters.status);
        sql += " AND status = ?";
      }

      sql += " ORDER BY created_at DESC, id DESC";
      return queryRows(sql, params);
    },

    async getLeadById(id) {
      return getLeadByIdStmt.get(Number(id)) || null;
    },

    async createLead(payload) {
      const now = nowIso();
      const result = insertLeadStmt.run({
        name: payload.name,
        phone: payload.phone,
        email: payload.email || "",
        age: toIntegerOrNull(payload.age),
        source: payload.source,
        interest: payload.interest,
        status: payload.status,
        preferred_period: payload.preferredPeriod,
        administrative_note: payload.administrativeNote || "",
        created_at: now,
        updated_at: now
      });
      return this.getLeadById(result.lastInsertRowid);
    },

    async updateLead(id, payload) {
      updateLeadStmt.run({
        id: Number(id),
        name: payload.name,
        phone: payload.phone,
        email: payload.email || "",
        age: toIntegerOrNull(payload.age),
        source: payload.source,
        interest: payload.interest,
        status: payload.status,
        preferred_period: payload.preferredPeriod,
        administrative_note: payload.administrativeNote || "",
        updated_at: nowIso()
      });
      return this.getLeadById(id);
    },

    async deleteLead(id) {
      return deleteLeadStmt.run(Number(id));
    },

    async convertLeadToPatient(id, overrides = {}) {
      return convertLeadTransaction(Number(id), overrides);
    },

    async listPatients(filters = {}) {
      const params = [];
      let sql = `
        SELECT
          id,
          full_name AS fullName,
          preferred_name AS preferredName,
          birth_date AS birthDate,
          age,
          phone,
          email,
          patient_type AS patientType,
          guardian_name AS guardianName,
          guardian_phone AS guardianPhone,
          session_price AS sessionPrice,
          default_weekday AS defaultWeekday,
          default_time AS defaultTime,
          modality,
          status,
          administrative_note AS administrativeNote,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM patients
        WHERE 1 = 1
      `;

      if (filters.search) {
        const padrao = buildLikePattern(filters.search);
        params.push(padrao, padrao, padrao);
        sql +=
          ` AND (full_name LIKE ? ${LIKE_ESCAPE_CLAUSE}` +
          ` OR preferred_name LIKE ? ${LIKE_ESCAPE_CLAUSE}` +
          ` OR phone LIKE ? ${LIKE_ESCAPE_CLAUSE})`;
      }

      if (filters.status) {
        params.push(filters.status);
        sql += " AND status = ?";
      }

      sql += " ORDER BY full_name COLLATE NOCASE ASC, id DESC";
      return queryRows(sql, params);
    },

    async getPatientById(id) {
      return getPatientByIdStmt.get(Number(id)) || null;
    },

    async createPatient(payload) {
      const now = nowIso();
      const result = insertPatientStmt.run({
        full_name: payload.fullName,
        preferred_name: payload.preferredName || "",
        birth_date: payload.birthDate || "",
        age: toIntegerOrNull(payload.age),
        phone: payload.phone,
        email: payload.email || "",
        patient_type: payload.patientType,
        guardian_name: payload.guardianName || "",
        guardian_phone: payload.guardianPhone || "",
        session_price: toNumber(payload.sessionPrice, 0),
        default_weekday: payload.defaultWeekday || "",
        default_time: payload.defaultTime || "",
        modality: payload.modality,
        status: payload.status,
        administrative_note: payload.administrativeNote || "",
        created_at: now,
        updated_at: now
      });
      return this.getPatientById(result.lastInsertRowid);
    },

    async updatePatient(id, payload) {
      updatePatientStmt.run({
        id: Number(id),
        full_name: payload.fullName,
        preferred_name: payload.preferredName || "",
        birth_date: payload.birthDate || "",
        age: toIntegerOrNull(payload.age),
        phone: payload.phone,
        email: payload.email || "",
        patient_type: payload.patientType,
        guardian_name: payload.guardianName || "",
        guardian_phone: payload.guardianPhone || "",
        session_price: toNumber(payload.sessionPrice, 0),
        default_weekday: payload.defaultWeekday || "",
        default_time: payload.defaultTime || "",
        modality: payload.modality,
        status: payload.status,
        administrative_note: payload.administrativeNote || "",
        updated_at: nowIso()
      });
      return this.getPatientById(id);
    },

    async deletePatient(id) {
      return deletePatientStmt.run(Number(id));
    },

    async listSessions(filters = {}) {
      const params = [];
      let sql = `
        SELECT
          s.id,
          s.patient_id AS patientId,
          p.full_name AS patientName,
          p.preferred_name AS patientPreferredName,
          s.scheduled_at AS scheduledAt,
          s.duration_minutes AS durationMinutes,
          s.status,
          s.payment_status AS paymentStatus,
          s.price,
          s.payment_method AS paymentMethod,
          s.paid_at AS paidAt,
          s.meeting_url AS meetingUrl,
          s.google_calendar_event_id AS googleCalendarEventId,
          s.google_calendar_id AS googleCalendarId,
          s.google_calendar_sync_status AS googleCalendarSyncStatus,
          s.google_calendar_last_synced_at AS googleCalendarLastSyncedAt,
          s.google_calendar_error AS googleCalendarError,
          r.id AS receiptId,
          r.receipt_number AS receiptNumber,
          s.administrative_note AS administrativeNote,
          s.created_at AS createdAt,
          s.updated_at AS updatedAt
        FROM clinic_sessions s
        INNER JOIN patients p ON p.id = s.patient_id
        LEFT JOIN receipts r ON r.session_id = s.id
        WHERE 1 = 1
      `;

      if (filters.patientId) {
        params.push(Number(filters.patientId));
        sql += " AND s.patient_id = ?";
      }

      if (filters.status) {
        params.push(filters.status);
        sql += " AND s.status = ?";
      }

      if (filters.paymentStatus) {
        params.push(filters.paymentStatus);
        sql += " AND s.payment_status = ?";
      }

      if (filters.dateFrom) {
        params.push(filters.dateFrom);
        sql += " AND s.scheduled_at >= ?";
      }

      if (filters.dateTo) {
        params.push(filters.dateTo);
        sql += " AND s.scheduled_at < ?";
      }

      sql += " ORDER BY s.scheduled_at ASC, s.id DESC";
      return queryRows(sql, params).map((row) => ({
        ...row,
        price: toNumber(row.price, 0)
      }));
    },

    async getSessionById(id) {
      const row = getSessionByIdStmt.get(Number(id));
      return row ? { ...row, price: toNumber(row.price, 0) } : null;
    },

    async createSession(payload) {
      const now = nowIso();
      const result = insertSessionStmt.run({
        patient_id: Number(payload.patientId),
        scheduled_at: payload.scheduledAt,
        duration_minutes: Number(payload.durationMinutes),
        status: payload.status,
        payment_status: payload.paymentStatus,
        price: toNumber(payload.price, 0),
        payment_method: payload.paymentMethod,
        paid_at: payload.paidAt || "",
        meeting_url: payload.meetingUrl || "",
        administrative_note: payload.administrativeNote || "",
        created_at: now,
        updated_at: now
      });
      return this.getSessionById(result.lastInsertRowid);
    },

    async updateSession(id, payload) {
      updateSessionStmt.run({
        id: Number(id),
        patient_id: Number(payload.patientId),
        scheduled_at: payload.scheduledAt,
        duration_minutes: Number(payload.durationMinutes),
        status: payload.status,
        payment_status: payload.paymentStatus,
        price: toNumber(payload.price, 0),
        payment_method: payload.paymentMethod,
        paid_at: payload.paidAt || "",
        meeting_url: payload.meetingUrl || "",
        administrative_note: payload.administrativeNote || "",
        updated_at: nowIso()
      });
      return this.getSessionById(id);
    },

    async deleteSession(id) {
      return deleteSessionStmt.run(Number(id));
    },

    async markSessionPaid(id, patch = {}) {
      markSessionPaidStmt.run({
        id: Number(id),
        payment_method: patch.paymentMethod || "pix",
        paid_at: patch.paidAt || nowIso(),
        updated_at: nowIso()
      });
      return this.getSessionById(id);
    },

    async markSessionDone(id) {
      markSessionDoneStmt.run({
        id: Number(id),
        updated_at: nowIso()
      });
      return this.getSessionById(id);
    },

    async markSessionMissed(id) {
      markSessionMissedStmt.run({
        id: Number(id),
        updated_at: nowIso()
      });
      return this.getSessionById(id);
    },

    async cancelSession(id) {
      cancelSessionStmt.run({
        id: Number(id),
        updated_at: nowIso()
      });
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
      let sql = `
        SELECT
          id,
          title,
          category,
          body,
          is_active AS isActive,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM message_templates
        WHERE 1 = 1
      `;

      if (filters.search) {
        params.push(buildLikePattern(filters.search));
        sql += ` AND title LIKE ? ${LIKE_ESCAPE_CLAUSE}`;
      }

      if (filters.category) {
        params.push(filters.category);
        sql += " AND category = ?";
      }

      if (typeof filters.isActive === "boolean") {
        params.push(filters.isActive ? 1 : 0);
        sql += " AND is_active = ?";
      }

      sql += " ORDER BY updated_at DESC, id DESC";
      return queryRows(sql, params).map(mapBooleanRecord);
    },

    async getMessageTemplateById(id) {
      return mapBooleanRecord(getTemplateByIdStmt.get(Number(id)) || null);
    },

    async createMessageTemplate(payload) {
      const now = nowIso();
      const result = insertTemplateStmt.run({
        title: payload.title,
        category: payload.category,
        body: payload.body,
        is_active: payload.isActive ? 1 : 0,
        created_at: now,
        updated_at: now
      });
      return this.getMessageTemplateById(result.lastInsertRowid);
    },

    async updateMessageTemplate(id, payload) {
      updateTemplateStmt.run({
        id: Number(id),
        title: payload.title,
        category: payload.category,
        body: payload.body,
        is_active: payload.isActive ? 1 : 0,
        updated_at: nowIso()
      });
      return this.getMessageTemplateById(id);
    },

    async deleteMessageTemplate(id) {
      return deleteTemplateStmt.run(Number(id));
    },

    async getPlatformSettings() {
      return getAgendaSettings();
    },

    async setPlatformSettings(payload) {
      const now = nowIso();
      const merged = normalizePlatformSettings(payload);
      upsertSettingsStmt.run({
        settings_key: "agenda",
        payload_json: JSON.stringify(merged),
        created_at: now,
        updated_at: now
      });
      return getAgendaSettings();
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
  createSqliteClinicRepository
};
