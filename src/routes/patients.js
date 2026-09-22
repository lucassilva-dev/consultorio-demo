const { requiresGuardianForPatientType } = require("../repositories/clinic-repository-helpers");
const clinicalService = require("../services/clinical");
const { validateWithSchema } = require("../lib/validation");
const { sanitizePlainText } = require("../lib/sanitize");
const { AppError } = require("../lib/errors");
const { appendAuditLog } = require("../services/audit");
const { getRepositories, getServices } = require("./dependencies");
const { asyncRoute, parseEntityId, sanitizePatientPayload } = require("./shared");

function sanitizePatientFilters(query = {}) {
  return {
    search: sanitizePlainText(query.search || ""),
    status: sanitizePlainText(query.status || "")
  };
}

function buildDefinitiveRecordError(footprint) {
  const motivos = [];
  if (footprint.definitiveIntake) {
    motivos.push("anamnese concluída");
  }
  if (footprint.definitiveEvolutions > 0) {
    motivos.push(
      footprint.definitiveEvolutions === 1
        ? "1 evolução assinada"
        : `${footprint.definitiveEvolutions} evoluções assinadas`
    );
  }
  if (footprint.definitiveBlocks > 0) {
    motivos.push(
      footprint.definitiveBlocks === 1
        ? "1 bloco concluído"
        : `${footprint.definitiveBlocks} blocos concluídos`
    );
  }
  if (footprint.documentsCount > 0) {
    motivos.push(
      footprint.documentsCount === 1
        ? "1 documento emitido"
        : `${footprint.documentsCount} documentos emitidos`
    );
  }
  if (footprint.recordClosed) {
    motivos.push("prontuário encerrado");
  }

  const detalhe = motivos.length ? ` (${motivos.join(", ")})` : "";
  return (
    `Este paciente tem prontuário que não pode ser apagado${detalhe}. ` +
    "Marque o paciente como encerrado para fechar o acompanhamento sem perder o registro."
  );
}

function register(app, { schemas, requireAdminApi }) {
  app.get(
    "/api/admin/patients",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const filters = sanitizePatientFilters(req.query);
      res.json({
        ok: true,
        data: {
          items: await repositories.clinic.listPatients(filters),
          filters
        }
      });
    })
  );

  app.post(
    "/api/admin/patients",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const payload = validateWithSchema(schemas.patientSchema, sanitizePatientPayload(req.body));
      // Mesma regra da edição: dado de responsável só faz sentido para
      // adolescente, e não pode acabar impresso como pagador no recibo.
      if (!requiresGuardianForPatientType(payload.patientType)) {
        payload.guardianName = "";
        payload.guardianPhone = "";
      }

      const createdPatient = await repositories.clinic.createPatient(payload);
      await appendAuditLog(repositories, req, {
        action: "patient_created",
        entityType: "patient",
        entityId: createdPatient.id,
        summary: "Paciente criado.",
        metadata: {
          patientType: createdPatient.patientType,
          status: createdPatient.status
        }
      });
      res.status(201).json({
        ok: true,
        data: createdPatient
      });
    })
  );

  app.put(
    "/api/admin/patients/:id",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Paciente");
      if (!(await repositories.clinic.getPatientById(id))) {
        throw new AppError("Paciente não encontrado.", 404);
      }

      const payload = validateWithSchema(schemas.patientSchema, sanitizePatientPayload(req.body));

      // Dados do responsável só fazem sentido para adolescente. Ao mudar o tipo,
      // eles continuavam gravados e apareciam como pagador no recibo — dado de
      // terceiro num documento onde já não cabe.
      if (!requiresGuardianForPatientType(payload.patientType)) {
        payload.guardianName = "";
        payload.guardianPhone = "";
      }

      const updatedPatient = await repositories.clinic.updatePatient(id, payload);
      await appendAuditLog(repositories, req, {
        action: "patient_updated",
        entityType: "patient",
        entityId: id,
        summary: "Paciente atualizado.",
        metadata: {
          patientType: updatedPatient.patientType,
          status: updatedPatient.status
        }
      });
      res.json({
        ok: true,
        data: updatedPatient
      });
    })
  );

  app.delete(
    "/api/admin/patients/:id",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Paciente");
      const existingPatient = await repositories.clinic.getPatientById(id);
      if (!existingPatient) {
        throw new AppError("Paciente não encontrado.", 404);
      }

      // A exclusão do paciente apaga o prontuário inteiro em cascata — contrato,
      // plano, anamnese, evoluções e documentos. Registro concluído, assinado,
      // emitido ou encerrado não pode ser destruído por essa via: o caminho
      // correto é inativar o paciente e preservar o prontuário.
      const footprint = await clinicalService.getClinicalRecordFootprint({
        patientId: id,
        repositories
      });

      if (footprint.hasDefinitiveRecords) {
        throw new AppError(
          buildDefinitiveRecordError(footprint),
          409
        );
      }

      const recibos = await repositories.phase2.listReceipts({ patientId: id });
      if (recibos.length) {
        throw new AppError(
          `Este paciente tem ${recibos.length} recibo(s) emitido(s) e não pode ser apagado. ` +
            "Marque o paciente como encerrado para fechar o acompanhamento sem perder os documentos.",
          409
        );
      }

      // Só depois de TODAS as recusas: limpar a agenda antes fazia uma exclusão
      // que terminava em 409 já ter apagado os compromissos do paciente — e
      // disparado avisos de cancelamento para ele — sem nada ter sido excluído.
      //
      // As sessões somem por cascata, e com elas a referência aos eventos: sem
      // remover aqui, os compromissos ficam para sempre na agenda com o nome de
      // alguém que já não está no sistema.
      const services = await getServices(req);
      const sessoesDoPaciente = await repositories.clinic.listSessions({ patientId: id });
      for (const sessao of sessoesDoPaciente) {
        if (sessao.googleCalendarEventId) {
          await services.googleCalendarSync.removeSessionEvent(repositories, sessao.id);
        }
      }

      await repositories.clinic.deletePatient(id);
      await appendAuditLog(repositories, req, {
        action: "patient_deleted",
        entityType: "patient",
        entityId: id,
        summary: "Paciente excluído.",
        metadata: {
          patientType: existingPatient.patientType,
          status: existingPatient.status
        }
      });

      // Rascunhos podem ir junto, mas a destruição de conteúdo clínico precisa
      // deixar rastro próprio — o log de exclusão de paciente não conta isso.
      if (footprint.hasRecords) {
        await appendAuditLog(repositories, req, {
          action: "clinical_record_destroyed",
          entityType: "clinical_record",
          entityId: id,
          summary: "Prontuário em rascunho destruído junto com a exclusão do paciente.",
          metadata: {
            hadIntake: footprint.hasIntake,
            hadRecord: footprint.hasRecord,
            evolutionsCount: footprint.evolutionsCount,
            documentsCount: footprint.documentsCount
          }
        });
      }
      res.json({ ok: true });
    })
  );
}

module.exports = {
  register
};
