const { validateWithSchema } = require("../lib/validation");
const { normalizeClinicFilterBoundary } = require("../lib/clinic-time");
const {
  sanitizeDateLike,
  sanitizeNumericLike,
  sanitizePlainText,
  sanitizeUrlLike
} = require("../lib/sanitize");
const { AppError } = require("../lib/errors");
const { appendAuditLog } = require("../services/audit");
const { getRepositories, getServices } = require("./dependencies");
const { asyncRoute, parseEntityId, sanitizeIdFilter } = require("./shared");

// Campos que o recibo imprime. Alterar qualquer um deles depois da emissão
// desencontra o documento do registro.
function mudaOQueOReciboAfirma(sessaoAtual, payload) {
  return (
    Number(payload.patientId) !== Number(sessaoAtual.patientId) ||
    Number(payload.price) !== Number(sessaoAtual.price) ||
    String(payload.scheduledAt) !== String(sessaoAtual.scheduledAt)
  );
}

function sanitizeSessionPayload(body = {}) {
  return {
    patientId: body.patientId,
    scheduledAt: sanitizeDateLike(body.scheduledAt),
    durationMinutes: sanitizeNumericLike(body.durationMinutes),
    status: sanitizePlainText(body.status),
    paymentStatus: sanitizePlainText(body.paymentStatus),
    price: sanitizeNumericLike(body.price),
    paymentMethod: sanitizePlainText(body.paymentMethod),
    paidAt: sanitizeDateLike(body.paidAt),
    meetingUrl: sanitizeUrlLike(body.meetingUrl),
    administrativeNote: sanitizePlainText(body.administrativeNote)
  };
}

// "2026-06-30" no filtro significa o dia 30 no fuso da clínica. Com a janela
// montada em UTC, o intervalo terminava às 21h locais e escondia justamente as
// sessões da noite. Data malformada devolve vazio em vez de derrubar a rota.
function normalizeFilterDateBoundary(value, mode) {
  return normalizeClinicFilterBoundary(sanitizeDateLike(value), mode);
}

function sanitizeSessionFilters(query = {}) {
  return {
    patientId: sanitizeIdFilter(query.patientId),
    status: sanitizePlainText(query.status || ""),
    paymentStatus: sanitizePlainText(query.paymentStatus || ""),
    dateFrom: normalizeFilterDateBoundary(query.dateFrom || "", "start"),
    dateTo: normalizeFilterDateBoundary(query.dateTo || "", "end")
  };
}

function registerCollectionRoutes(app, { schemas, requireAdminApi }) {
  app.get(
    "/api/admin/sessions",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const filters = sanitizeSessionFilters(req.query);
      res.json({
        ok: true,
        data: {
          items: await repositories.clinic.listSessions(filters),
          filters
        }
      });
    })
  );

  app.post(
    "/api/admin/sessions",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const services = await getServices(req);
      const payload = validateWithSchema(schemas.sessionSchema, sanitizeSessionPayload(req.body));
      if (!(await repositories.clinic.getPatientById(payload.patientId))) {
        throw new AppError("Paciente não encontrado para esta sessão.", 404);
      }

      const createdSession = await repositories.clinic.createSession(payload);
      const syncedSession = await services.googleCalendarSync.syncSession(
        repositories,
        createdSession.id
      );
      await appendAuditLog(repositories, req, {
        action: "session_created",
        entityType: "session",
        entityId: syncedSession.id,
        summary: "Sessão criada.",
        metadata: {
          patientId: syncedSession.patientId,
          status: syncedSession.status,
          paymentStatus: syncedSession.paymentStatus
        }
      });

      res.status(201).json({
        ok: true,
        data: syncedSession
      });
    })
  );
}

function registerItemRoutes(app, { schemas, requireAdminApi }) {
  app.put(
    "/api/admin/sessions/:id",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const services = await getServices(req);
      const id = parseEntityId(req.params.id, "Sessão");
      const sessaoAtual = await repositories.clinic.getSessionById(id);
      if (!sessaoAtual) {
        throw new AppError("Sessão não encontrada.", 404);
      }

      const payload = validateWithSchema(schemas.sessionSchema, sanitizeSessionPayload(req.body));
      if (!(await repositories.clinic.getPatientById(payload.patientId))) {
        throw new AppError("Paciente não encontrado para esta sessão.", 404);
      }

      // O recibo é um documento já entregue, com paciente, valor e data
      // impressos. Deixar a sessão ser editada por baixo dele fazia o PDF
      // descrever uma coisa e o sistema outra.
      const reciboDaSessao = await repositories.phase2.getReceiptBySessionId(id);
      if (reciboDaSessao && mudaOQueOReciboAfirma(sessaoAtual, payload)) {
        throw new AppError(
          `Esta sessão tem o recibo ${reciboDaSessao.receiptNumber} emitido. ` +
            "Paciente, valor e data não podem mudar sem reemitir o documento.",
          409
        );
      }

      await repositories.clinic.updateSession(id, payload);
      const syncedSession = await services.googleCalendarSync.syncSession(repositories, id);
      await appendAuditLog(repositories, req, {
        action: payload.status === "remarcada" ? "session_rescheduled" : "session_updated",
        entityType: "session",
        entityId: id,
        summary:
          payload.status === "remarcada" ? "Sessão remarcada." : "Sessão atualizada.",
        metadata: {
          patientId: syncedSession.patientId,
          status: syncedSession.status,
          paymentStatus: syncedSession.paymentStatus
        }
      });

      res.json({
        ok: true,
        data: syncedSession
      });
    })
  );

  app.delete(
    "/api/admin/sessions/:id",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Sessão");
      const existingSession = await repositories.clinic.getSessionById(id);
      if (!existingSession) {
        throw new AppError("Sessão não encontrada.", 404);
      }

      // A tabela de recibos apaga em cascata pela sessão. Excluir aqui levaria
      // junto um documento já entregue ao paciente e deixaria o PDF órfão no
      // storage privado. Cancelar preserva o histórico.
      const recibo = await repositories.phase2.getReceiptBySessionId(id);
      if (recibo) {
        throw new AppError(
          `Esta sessão tem o recibo ${recibo.receiptNumber} emitido e não pode ser excluída. ` +
            "Cancele a sessão para manter o histórico.",
          409
        );
      }

      // Remove o compromisso da agenda do paciente antes de apagar a sessão:
      // depois do delete não há mais como saber qual era o evento.
      const services = await getServices(req);
      await services.googleCalendarSync.removeSessionEvent(repositories, id);

      await repositories.clinic.deleteSession(id);
      await appendAuditLog(repositories, req, {
        action: "session_deleted",
        entityType: "session",
        entityId: id,
        summary: "Sessão excluída.",
        metadata: {
          patientId: existingSession.patientId,
          status: existingSession.status,
          paymentStatus: existingSession.paymentStatus
        }
      });
      res.json({ ok: true });
    })
  );

  app.post(
    "/api/admin/sessions/:id/mark-paid",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Sessão");
      const sessionToPay = await repositories.clinic.getSessionById(id);
      if (!sessionToPay) {
        throw new AppError("Sessão não encontrada.", 404);
      }

      // Sem forma de pagamento no corpo, preserva a que já estava na sessão.
      // Antes o default "pix" sobrescrevia, por exemplo, uma transferência.
      const paymentMethod = sanitizePlainText(req.body.paymentMethod || "");
      const payload = validateWithSchema(schemas.sessionPaymentSchema, {
        ...(paymentMethod ? { paymentMethod } : {}),
        paidAt: sanitizeDateLike(req.body.paidAt || "")
      });
      const updatedSession = await repositories.clinic.markSessionPaid(id, {
        paymentMethod: payload.paymentMethod || sessionToPay.paymentMethod || "pix",
        paidAt: payload.paidAt || undefined
      });
      await appendAuditLog(repositories, req, {
        action: "session_payment_marked",
        entityType: "session",
        entityId: id,
        summary: "Pagamento de sessão marcado como pago.",
        metadata: {
          paymentMethod: updatedSession.paymentMethod,
          paymentStatus: updatedSession.paymentStatus
        }
      });

      res.json({
        ok: true,
        data: updatedSession
      });
    })
  );

  app.post(
    "/api/admin/sessions/:id/mark-done",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Sessão");
      if (!(await repositories.clinic.getSessionById(id))) {
        throw new AppError("Sessão não encontrada.", 404);
      }
      const updatedSession = await repositories.clinic.markSessionDone(id);
      await appendAuditLog(repositories, req, {
        action: "session_marked_done",
        entityType: "session",
        entityId: id,
        summary: "Sessão marcada como realizada.",
        metadata: {
          status: updatedSession.status
        }
      });

      res.json({
        ok: true,
        data: updatedSession
      });
    })
  );

  app.post(
    "/api/admin/sessions/:id/mark-missed",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Sessão");
      if (!(await repositories.clinic.getSessionById(id))) {
        throw new AppError("Sessão não encontrada.", 404);
      }
      const updatedSession = await repositories.clinic.markSessionMissed(id);
      await appendAuditLog(repositories, req, {
        action: "session_marked_missed",
        entityType: "session",
        entityId: id,
        summary: "Sessão marcada como falta.",
        metadata: {
          status: updatedSession.status
        }
      });

      res.json({
        ok: true,
        data: updatedSession
      });
    })
  );

  app.post(
    "/api/admin/sessions/:id/cancel",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const services = await getServices(req);
      const id = parseEntityId(req.params.id, "Sessão");
      if (!(await repositories.clinic.getSessionById(id))) {
        throw new AppError("Sessão não encontrada.", 404);
      }

      await repositories.clinic.cancelSession(id);
      const syncedSession = await services.googleCalendarSync.syncSession(repositories, id);
      await appendAuditLog(repositories, req, {
        action: "session_canceled",
        entityType: "session",
        entityId: id,
        summary: "Sessão cancelada.",
        metadata: {
          status: syncedSession.status,
          paymentStatus: syncedSession.paymentStatus
        }
      });

      res.json({
        ok: true,
        data: syncedSession
      });
    })
  );

  app.post(
    "/api/admin/sessions/:id/retry-google-sync",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const services = await getServices(req);
      const id = parseEntityId(req.params.id, "Sessão");
      // Com a sincronização desligada, syncSession marcaria a sessão como
      // "skipped" e apagaria a mensagem do erro — o histórico da falha sumia e
      // a tela dizia que tudo certo, sem nada ter sido enviado.
      const agenda = await repositories.clinic.getPlatformSettings();
      if (!agenda.googleCalendarEnabled) {
        throw new AppError(
          "Ative a sincronização com o Google Calendar antes de tentar de novo.",
          400
        );
      }

      const syncedSession = await services.googleCalendarSync.syncSession(repositories, id);
      await appendAuditLog(repositories, req, {
        action: "google_calendar_retry_session_sync",
        entityType: "session",
        entityId: id,
        summary: "Reprocessamento manual de sincronização do Google Calendar.",
        metadata: {
          googleCalendarSyncStatus: syncedSession.googleCalendarSyncStatus
        }
      });

      res.json({
        ok: true,
        data: syncedSession
      });
    })
  );
}

module.exports = {
  registerCollectionRoutes,
  registerItemRoutes
};
