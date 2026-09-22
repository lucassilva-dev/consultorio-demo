const { validateWithSchema } = require("../lib/validation");
const { sanitizePlainText } = require("../lib/sanitize");
const { AppError } = require("../lib/errors");
const { appendAuditLog } = require("../services/audit");
const { getRepositories } = require("./dependencies");
const { asyncRoute, parseEntityId } = require("./shared");

function sanitizeMessageTemplatePayload(body = {}) {
  return {
    title: sanitizePlainText(body.title),
    category: sanitizePlainText(body.category),
    body: sanitizePlainText(body.body),
    isActive: body.isActive
  };
}

function sanitizeMessageTemplateFilters(query = {}) {
  return {
    search: sanitizePlainText(query.search || ""),
    category: sanitizePlainText(query.category || ""),
    isActive:
      typeof query.isActive === "undefined" || query.isActive === ""
        ? undefined
        : query.isActive === "true" || query.isActive === "1"
  };
}

function register(app, { schemas, requireAdminApi }) {
  app.get(
    "/api/admin/message-templates",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const filters = sanitizeMessageTemplateFilters(req.query);
      res.json({
        ok: true,
        data: {
          items: await repositories.clinic.listMessageTemplates(filters),
          filters
        }
      });
    })
  );

  app.post(
    "/api/admin/message-templates",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const payload = validateWithSchema(
        schemas.messageTemplateSchema,
        sanitizeMessageTemplatePayload(req.body)
      );
      const createdTemplate = await repositories.clinic.createMessageTemplate(payload);
      await appendAuditLog(repositories, req, {
        action: "message_template_created",
        entityType: "message_template",
        entityId: createdTemplate.id,
        summary: "Modelo de mensagem criado.",
        metadata: {
          category: createdTemplate.category,
          isActive: createdTemplate.isActive
        }
      });
      res.status(201).json({
        ok: true,
        data: createdTemplate
      });
    })
  );

  app.put(
    "/api/admin/message-templates/:id",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Modelo");
      if (!(await repositories.clinic.getMessageTemplateById(id))) {
        throw new AppError("Modelo não encontrado.", 404);
      }

      const payload = validateWithSchema(
        schemas.messageTemplateSchema,
        sanitizeMessageTemplatePayload(req.body)
      );
      const updatedTemplate = await repositories.clinic.updateMessageTemplate(id, payload);
      await appendAuditLog(repositories, req, {
        action: "message_template_updated",
        entityType: "message_template",
        entityId: id,
        summary: "Modelo de mensagem atualizado.",
        metadata: {
          category: updatedTemplate.category,
          isActive: updatedTemplate.isActive
        }
      });
      res.json({
        ok: true,
        data: updatedTemplate
      });
    })
  );

  app.delete(
    "/api/admin/message-templates/:id",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Modelo");
      const existingTemplate = await repositories.clinic.getMessageTemplateById(id);
      if (!existingTemplate) {
        throw new AppError("Modelo não encontrado.", 404);
      }

      await repositories.clinic.deleteMessageTemplate(id);
      await appendAuditLog(repositories, req, {
        action: "message_template_deleted",
        entityType: "message_template",
        entityId: id,
        summary: "Modelo de mensagem excluído.",
        metadata: {
          category: existingTemplate.category,
          isActive: existingTemplate.isActive
        }
      });
      res.json({ ok: true });
    })
  );
}

module.exports = {
  register
};
