const { validateWithSchema } = require("../lib/validation");
const { sanitizeNumericLike, sanitizePlainText } = require("../lib/sanitize");
const { AppError } = require("../lib/errors");
const { appendAuditLog } = require("../services/audit");
const { getRepositories, getServices } = require("./dependencies");
const { asyncRoute } = require("./shared");

function sanitizeGoogleCalendarSettingsPayload(body = {}) {
  const payload = {};

  if (Object.prototype.hasOwnProperty.call(body, "googleCalendarEnabled")) {
    payload.googleCalendarEnabled = body.googleCalendarEnabled;
  }
  if (Object.prototype.hasOwnProperty.call(body, "googleCalendarId")) {
    payload.googleCalendarId = sanitizePlainText(body.googleCalendarId);
  }
  if (Object.prototype.hasOwnProperty.call(body, "googleCalendarCreateMeet")) {
    payload.googleCalendarCreateMeet = body.googleCalendarCreateMeet;
  }
  if (Object.prototype.hasOwnProperty.call(body, "googleCalendarReminderMinutes")) {
    payload.googleCalendarReminderMinutes = sanitizeNumericLike(body.googleCalendarReminderMinutes);
  }
  if (Object.prototype.hasOwnProperty.call(body, "googleCalendarSendUpdates")) {
    payload.googleCalendarSendUpdates = body.googleCalendarSendUpdates;
  }

  return payload;
}

async function mergePlatformSettingsUpdate(repositories, partialPayload) {
  const currentSettings = await repositories.clinic.getPlatformSettings();
  return {
    ...currentSettings,
    ...partialPayload
  };
}

function register(app, { schemas, requireAdminApi, requireAdminPage }) {
  app.get(
    "/api/admin/google-calendar/status",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const services = await getServices(req);
      res.json({
        ok: true,
        data: await services.googleCalendarSync.getStatus(repositories)
      });
    })
  );

  app.get(
    "/api/admin/google-calendar/auth-url",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const services = await getServices(req);
      res.json({
        ok: true,
        data: {
          url: await services.googleCalendarSync.getAuthUrl(req.adminUser)
        }
      });
    })
  );

  app.get(
    "/api/admin/google-calendar/callback",
    requireAdminPage,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const services = await getServices(req);
      const code = sanitizePlainText(req.query.code || "");
      const stateToken = sanitizePlainText(req.query.state || "");

      if (!code || !stateToken) {
        throw new AppError("Callback do Google Calendar inválido.", 400);
      }

      await services.googleCalendarSync.handleCallback(
        repositories,
        req.adminUser,
        code,
        stateToken
      );
      await appendAuditLog(repositories, req, {
        action: "google_calendar_connected",
        entityType: "google_calendar",
        entityId: "default",
        summary: "Google Calendar conectado."
      });

      return res.redirect("/admin/dashboard?panel=agenda&googleCalendar=connected");
    })
  );

  app.post(
    "/api/admin/google-calendar/disconnect",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const services = await getServices(req);
      const revogacao = await services.googleCalendarSync.disconnect(repositories);
      await appendAuditLog(repositories, req, {
        action: "google_calendar_disconnected",
        entityType: "google_calendar",
        entityId: "default",
        summary: revogacao?.revoked
          ? "Google Calendar desconectado e acesso revogado na conta Google."
          : "Google Calendar desconectado; a revogação na conta Google não foi confirmada.",
        metadata: { revoked: Boolean(revogacao?.revoked) }
      });

      // A conexão local sempre é apagada, mas quem desconecta precisa saber se
      // o acesso foi mesmo revogado do lado do Google — senão fica achando que
      // encerrou algo que continua autorizado.
      res.json({
        ok: true,
        data: { revoked: Boolean(revogacao?.revoked) },
        meta: {
          aviso: revogacao?.revoked
            ? ""
            : "Desconectado aqui, mas o Google não confirmou a revogação. Revise o acesso em myaccount.google.com/permissions."
        }
      });
    })
  );

  app.get(
    "/api/admin/google-calendar/calendars",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const services = await getServices(req);
      res.json({
        ok: true,
        data: {
          items: await services.googleCalendarSync.listCalendars(repositories)
        }
      });
    })
  );

  app.post(
    "/api/admin/google-calendar/test-connection",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const services = await getServices(req);
      const result = await services.googleCalendarSync.testConnection(repositories);
      await appendAuditLog(repositories, req, {
        action: "google_calendar_tested",
        entityType: "google_calendar",
        entityId: "default",
        summary: "Teste de conexão do Google Calendar executado.",
        metadata: {
          calendarsCount: result.calendarsCount
        }
      });
      res.json({
        ok: true,
        data: result
      });
    })
  );

  app.post(
    "/api/admin/google-calendar/reprocess-failures",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const services = await getServices(req);
      const result = await services.googleCalendarSync.reprocessFailures(repositories);
      await appendAuditLog(repositories, req, {
        action: "google_calendar_failures_reprocessed",
        entityType: "google_calendar",
        entityId: "default",
        summary: "Falhas do Google Calendar reprocessadas.",
        metadata: {
          processed: result.processed
        }
      });
      res.json({
        ok: true,
        data: result
      });
    })
  );

  app.put(
    "/api/admin/google-calendar/settings",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const currentSettings = await repositories.clinic.getPlatformSettings();
      const payload = validateWithSchema(
        schemas.platformSettingsSchema.pick({
          googleCalendarEnabled: true,
          googleCalendarId: true,
          googleCalendarCreateMeet: true,
          googleCalendarReminderMinutes: true,
          googleCalendarSendUpdates: true
        }),
        {
          googleCalendarEnabled: currentSettings.googleCalendarEnabled,
          googleCalendarId: currentSettings.googleCalendarId,
          googleCalendarCreateMeet: currentSettings.googleCalendarCreateMeet,
          googleCalendarReminderMinutes: currentSettings.googleCalendarReminderMinutes,
          googleCalendarSendUpdates: currentSettings.googleCalendarSendUpdates,
          ...sanitizeGoogleCalendarSettingsPayload(req.body)
        }
      );

      const mergedSettings = await mergePlatformSettingsUpdate(repositories, payload);
      const saved = await repositories.clinic.setPlatformSettings(mergedSettings);
      await appendAuditLog(repositories, req, {
        action: "google_calendar_settings_updated",
        entityType: "google_calendar",
        entityId: "default",
        summary: "Configurações do Google Calendar atualizadas.",
        metadata: {
          googleCalendarEnabled: saved.googleCalendarEnabled,
          googleCalendarCreateMeet: saved.googleCalendarCreateMeet,
          googleCalendarSendUpdates: saved.googleCalendarSendUpdates
        }
      });
      res.json({
        ok: true,
        data: {
          googleCalendarEnabled: saved.googleCalendarEnabled,
          googleCalendarId: saved.googleCalendarId,
          googleCalendarCreateMeet: saved.googleCalendarCreateMeet,
          googleCalendarReminderMinutes: saved.googleCalendarReminderMinutes,
          googleCalendarSendUpdates: saved.googleCalendarSendUpdates
        }
      });
    })
  );
}

module.exports = {
  register
};
