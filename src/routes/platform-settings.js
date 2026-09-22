const { validateWithSchema } = require("../lib/validation");
const { sanitizeNumericLike, sanitizePlainText, sanitizeUrlLike } = require("../lib/sanitize");
const { appendAuditLog } = require("../services/audit");
const { getRepositories } = require("./dependencies");
const { asyncRoute } = require("./shared");

function sanitizePlatformSettingsPayload(body = {}) {
  const payload = {};

  if (Object.prototype.hasOwnProperty.call(body, "schedulingUrl")) {
    payload.schedulingUrl = sanitizeUrlLike(body.schedulingUrl);
  }
  if (Object.prototype.hasOwnProperty.call(body, "schedulingLabel")) {
    payload.schedulingLabel = sanitizePlainText(body.schedulingLabel);
  }
  if (Object.prototype.hasOwnProperty.call(body, "meetingDefaultUrl")) {
    payload.meetingDefaultUrl = sanitizeUrlLike(body.meetingDefaultUrl);
  }
  if (Object.prototype.hasOwnProperty.call(body, "cancellationPolicyText")) {
    payload.cancellationPolicyText = sanitizePlainText(body.cancellationPolicyText);
  }
  if (Object.prototype.hasOwnProperty.call(body, "showSchedulingButton")) {
    payload.showSchedulingButton = body.showSchedulingButton;
  }
  if (Object.prototype.hasOwnProperty.call(body, "professionalName")) {
    payload.professionalName = sanitizePlainText(body.professionalName);
  }
  if (Object.prototype.hasOwnProperty.call(body, "crp")) {
    payload.crp = sanitizePlainText(body.crp);
  }
  if (Object.prototype.hasOwnProperty.call(body, "professionalDocument")) {
    payload.professionalDocument = sanitizePlainText(body.professionalDocument);
  }
  if (Object.prototype.hasOwnProperty.call(body, "receiptCity")) {
    payload.receiptCity = sanitizePlainText(body.receiptCity);
  }
  if (Object.prototype.hasOwnProperty.call(body, "receiptFooterText")) {
    payload.receiptFooterText = sanitizePlainText(body.receiptFooterText);
  }
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

function register(app, { schemas, requireAdminApi }) {
  app.get(
    "/api/admin/platform-settings",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      res.json({
        ok: true,
        data: await repositories.clinic.getPlatformSettings()
      });
    })
  );

  app.put(
    "/api/admin/platform-settings",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const payload = validateWithSchema(schemas.platformSettingsSchema, {
        ...(await repositories.clinic.getPlatformSettings()),
        ...sanitizePlatformSettingsPayload(req.body)
      });
      const savedSettings = await repositories.clinic.setPlatformSettings(payload);
      await appendAuditLog(repositories, req, {
        action: "platform_settings_updated",
        entityType: "platform_settings",
        entityId: "agenda",
        summary: "Configurações administrativas atualizadas.",
        metadata: {
          showSchedulingButton: savedSettings.showSchedulingButton,
          googleCalendarEnabled: savedSettings.googleCalendarEnabled
        }
      });
      res.json({
        ok: true,
        data: savedSettings
      });
    })
  );
}

module.exports = {
  register
};
