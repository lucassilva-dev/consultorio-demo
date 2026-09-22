const {
  buildPatientFromLead,
  requiresGuardianForPatientType
} = require("../repositories/clinic-repository-helpers");
const { validateWithSchema } = require("../lib/validation");
const { sanitizeNullableText, sanitizeNumericLike, sanitizePlainText } = require("../lib/sanitize");
const { AppError } = require("../lib/errors");
const { appendAuditLog } = require("../services/audit");
const { getRepositories } = require("./dependencies");
const { asyncRoute, parseEntityId, sanitizePatientPayload } = require("./shared");

function sanitizeLeadPayload(body = {}) {
  return {
    name: sanitizePlainText(body.name),
    phone: sanitizePlainText(body.phone),
    email: sanitizeNullableText(body.email),
    age: sanitizeNumericLike(body.age),
    source: sanitizePlainText(body.source),
    interest: sanitizePlainText(body.interest),
    status: sanitizePlainText(body.status),
    preferredPeriod: sanitizePlainText(body.preferredPeriod),
    administrativeNote: sanitizePlainText(body.administrativeNote)
  };
}

function sanitizeLeadFilters(query = {}) {
  return {
    search: sanitizePlainText(query.search || ""),
    status: sanitizePlainText(query.status || "")
  };
}

function register(app, { schemas, requireAdminApi }) {
  app.get(
    "/api/admin/leads",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const filters = sanitizeLeadFilters(req.query);
      res.json({
        ok: true,
        data: {
          items: await repositories.clinic.listLeads(filters),
          filters
        }
      });
    })
  );

  app.post(
    "/api/admin/leads",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const payload = validateWithSchema(schemas.leadSchema, sanitizeLeadPayload(req.body));
      const createdLead = await repositories.clinic.createLead(payload);
      await appendAuditLog(repositories, req, {
        action: "lead_created",
        entityType: "lead",
        entityId: createdLead.id,
        summary: "Lead criado.",
        metadata: {
          source: createdLead.source,
          interest: createdLead.interest,
          status: createdLead.status
        }
      });
      res.status(201).json({
        ok: true,
        data: createdLead
      });
    })
  );

  app.put(
    "/api/admin/leads/:id",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Lead");
      if (!(await repositories.clinic.getLeadById(id))) {
        throw new AppError("Lead não encontrado.", 404);
      }

      const payload = validateWithSchema(schemas.leadSchema, sanitizeLeadPayload(req.body));
      const updatedLead = await repositories.clinic.updateLead(id, payload);
      await appendAuditLog(repositories, req, {
        action: "lead_updated",
        entityType: "lead",
        entityId: id,
        summary: "Lead atualizado.",
        metadata: {
          status: updatedLead.status,
          interest: updatedLead.interest
        }
      });
      res.json({
        ok: true,
        data: updatedLead
      });
    })
  );

  app.delete(
    "/api/admin/leads/:id",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Lead");
      const existingLead = await repositories.clinic.getLeadById(id);
      if (!existingLead) {
        throw new AppError("Lead não encontrado.", 404);
      }

      await repositories.clinic.deleteLead(id);
      await appendAuditLog(repositories, req, {
        action: "lead_deleted",
        entityType: "lead",
        entityId: id,
        summary: "Lead excluído.",
        metadata: {
          status: existingLead.status,
          interest: existingLead.interest
        }
      });
      res.json({ ok: true });
    })
  );

  app.post(
    "/api/admin/leads/:id/convert-to-patient",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Lead");
      const existingLead = await repositories.clinic.getLeadById(id);
      if (!existingLead) {
        throw new AppError("Lead não encontrado.", 404);
      }

      // Converter duas vezes criava dois pacientes para a mesma pessoa. Um
      // duplo clique, ou a tela recarregada, bastava.
      if (existingLead.status === "virou_paciente") {
        throw new AppError(
          "Este contato já foi convertido em paciente.",
          409
        );
      }

      const camposEnviados = Object.keys(req.body || {});
      const hasOverridePayload = camposEnviados.length > 0;
      const sanitizedOverrides = hasOverridePayload ? sanitizePatientPayload(req.body) : {};
      const candidatePatient = buildPatientFromLead(
        existingLead,
        sanitizedOverrides,
        hasOverridePayload ? camposEnviados : null
      );

      // A exigência acompanha o TIPO escolhido para o paciente, não o interesse
      // que o lead registrou lá atrás: converter um contato marcado como
      // "responsável de adolescente" em paciente adulto é legítimo e não deve
      // travar pedindo dados de responsável.
      const precisaDeResponsavel = requiresGuardianForPatientType(
        candidatePatient.patientType
      );
      if (
        precisaDeResponsavel &&
        (!candidatePatient.guardianName || !candidatePatient.guardianPhone)
      ) {
        throw new AppError("Lead adolescente precisa de responsável antes da conversão.", 400, {
          fieldErrors: {
            guardianName: candidatePatient.guardianName
              ? []
              : ["Informe o nome do responsável para concluir a conversão."],
            guardianPhone: candidatePatient.guardianPhone
              ? []
              : ["Informe o telefone do responsável para concluir a conversão."]
          }
        });
      }

      const validatedPatient = validateWithSchema(schemas.patientSchema, candidatePatient);
      const result = await repositories.clinic.convertLeadToPatient(id, validatedPatient);
      if (!result) {
        throw new AppError("Não foi possível converter o lead.", 400);
      }

      await appendAuditLog(repositories, req, {
        action: "lead_converted_to_patient",
        entityType: "lead",
        entityId: id,
        summary: "Lead convertido em paciente.",
        metadata: {
          patientId: result.patient.id,
          patientType: result.patient.patientType
        }
      });

      res.status(201).json({
        ok: true,
        data: result
      });
    })
  );
}

module.exports = {
  register
};
