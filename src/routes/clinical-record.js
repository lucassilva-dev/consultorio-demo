const clinicalService = require("../services/clinical");
const clinicalRecordService = require("../services/clinical-record");
const clinicalDocumentsService = require("../services/clinical-documents");
const { validateWithSchema } = require("../lib/validation");
const { appendAuditLog, sanitizeAuditString } = require("../services/audit");
const { getRepositories } = require("./dependencies");
const { asyncRoute, parseEntityId } = require("./shared");

function register(app, { runtimeConfig, schemas, requireAdminApi }) {
  // ── Prontuário clínico (anamnese + evoluções) ────────────────────────────
  app.get(
    "/api/admin/patients/:patientId/clinical-record",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const patientId = parseEntityId(req.params.patientId, "Paciente");
      const summary = await clinicalService.getClinicalRecordSummary({
        patientId,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_record_viewed",
        entityType: "clinical_record",
        entityId: patientId,
        summary: "Prontuário visualizado.",
        metadata: {
          patientId,
          intakeId: summary.intake?.id || null,
          status: summary.intake?.status || "ausente",
          evolutionsCount: summary.evolutionsCount
        }
      });
      res.json({ ok: true, data: summary });
    })
  );

  app.get(
    "/api/admin/patients/:patientId/clinical-record/export.pdf",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const patientId = parseEntityId(req.params.patientId, "Paciente");
      const { patient, buffer } = await clinicalService.exportClinicalRecordPdf({
        patientId,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_record_exported",
        entityType: "clinical_record",
        entityId: patientId,
        summary: "Prontuário completo exportado.",
        metadata: { patientId, exportType: "clinical_record" }
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="prontuario-${patient.id}.pdf"`
      );
      res.status(200).send(buffer);
    })
  );

  // ── Prontuário: abertura e encerramento ──────────────────────────────────
  app.post(
    "/api/admin/patients/:patientId/clinical-record",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const patientId = parseEntityId(req.params.patientId, "Paciente");
      const { record, created } = await clinicalRecordService.openRecordForPatient({
        patientId,
        adminUser: req.adminUser,
        repositories,
        runtimeConfig
      });
      if (created) {
        await appendAuditLog(repositories, req, {
          action: "clinical_record_opened",
          entityType: "clinical_record",
          entityId: record.id,
          summary: "Prontuário aberto.",
          metadata: { patientId, recordNumber: record.recordNumber }
        });
      }
      res.status(created ? 201 : 200).json({ ok: true, data: record });
    })
  );

  app.post(
    "/api/admin/clinical-records/:id/close",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const recordId = parseEntityId(req.params.id, "Prontuário");
      const payload = validateWithSchema(schemas.recordCloseSchema, req.body || {});
      const record = await clinicalRecordService.closeRecord({
        recordId,
        closingReason: payload.closingReason,
        payload: { sections: payload.sections },
        adminUser: req.adminUser,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_record_closed",
        entityType: "clinical_record",
        entityId: recordId,
        summary: "Prontuário encerrado.",
        metadata: {
          patientId: record.patientId,
          recordNumber: record.recordNumber,
          closingReason: record.closingReason
        }
      });
      res.json({ ok: true, data: record });
    })
  );

  app.post(
    "/api/admin/clinical-records/:id/reopen",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const recordId = parseEntityId(req.params.id, "Prontuário");
      const payload = validateWithSchema(schemas.recordReopenSchema, req.body || {});
      const record = await clinicalRecordService.reopenRecord({
        recordId,
        reason: payload.reason,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_record_reopened",
        entityType: "clinical_record",
        entityId: recordId,
        summary: "Prontuário reaberto.",
        metadata: {
          patientId: record.patientId,
          recordNumber: record.recordNumber,
          reason: sanitizeAuditString(payload.reason, 300)
        }
      });
      res.json({ ok: true, data: record });
    })
  );

  // ── Prontuário: contrato, plano terapêutico e encerramento ───────────────
  app.get(
    "/api/admin/clinical-records/:id/blocks/:blockType",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const recordId = parseEntityId(req.params.id, "Prontuário");
      const result = await clinicalRecordService.getBlockForRecord({
        recordId,
        blockType: req.params.blockType,
        repositories,
        runtimeConfig
      });
      if (result.block) {
        await appendAuditLog(repositories, req, {
          action: "clinical_record_block_viewed",
          entityType: "clinical_record_block",
          entityId: result.block.id,
          summary: `${result.block.blockLabel} visualizado.`,
          metadata: {
            recordId,
            blockType: result.block.blockType,
            status: result.block.status
          }
        });
      }
      res.json({ ok: true, data: result });
    })
  );

  app.put(
    "/api/admin/clinical-records/:id/blocks/:blockType",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const recordId = parseEntityId(req.params.id, "Prontuário");
      const payload = validateWithSchema(schemas.recordBlockPayloadSchema, req.body || {});
      const block = await clinicalRecordService.saveBlock({
        recordId,
        blockType: req.params.blockType,
        payload: { sections: payload.sections },
        changeReason: payload.changeReason,
        adminUser: req.adminUser,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_record_block_updated",
        entityType: "clinical_record_block",
        entityId: block.id,
        summary: `${block.blockLabel} atualizado.`,
        metadata: {
          recordId,
          blockType: block.blockType,
          status: block.status,
          versionsCount: block.versionsCount
        }
      });
      res.json({ ok: true, data: block });
    })
  );

  app.post(
    "/api/admin/clinical-records/:id/blocks/:blockType/complete",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const recordId = parseEntityId(req.params.id, "Prontuário");
      const block = await clinicalRecordService.completeBlock({
        recordId,
        blockType: req.params.blockType,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_record_block_completed",
        entityType: "clinical_record_block",
        entityId: block.id,
        summary: `${block.blockLabel} concluído.`,
        metadata: { recordId, blockType: block.blockType }
      });
      res.json({ ok: true, data: block });
    })
  );

  app.post(
    "/api/admin/clinical-records/:id/blocks/:blockType/lock",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const recordId = parseEntityId(req.params.id, "Prontuário");
      const block = await clinicalRecordService.lockBlock({
        recordId,
        blockType: req.params.blockType,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_record_block_locked",
        entityType: "clinical_record_block",
        entityId: block.id,
        summary: `${block.blockLabel} bloqueado.`,
        metadata: { recordId, blockType: block.blockType }
      });
      res.json({ ok: true, data: block });
    })
  );

  app.get(
    "/api/admin/clinical-records/:id/blocks/:blockType/export.pdf",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const recordId = parseEntityId(req.params.id, "Prontuário");
      const { block, buffer } = await clinicalRecordService.exportBlockPdf({
        recordId,
        blockType: req.params.blockType,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_record_block_exported",
        entityType: "clinical_record_block",
        entityId: block.id,
        summary: "Bloco do prontuário exportado.",
        metadata: { recordId, blockType: block.blockType }
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${block.blockType}-${recordId}.pdf"`
      );
      res.status(200).send(buffer);
    })
  );

  // ── Prontuário: documentos emitidos ──────────────────────────────────────
  app.get(
    "/api/admin/clinical-records/:id/documents",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const recordId = parseEntityId(req.params.id, "Prontuário");
      const items = await clinicalDocumentsService.listDocuments({
        recordId,
        repositories,
        runtimeConfig
      });
      res.json({ ok: true, data: items });
    })
  );

  app.post(
    "/api/admin/clinical-records/:id/documents",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const recordId = parseEntityId(req.params.id, "Prontuário");
      const payload = validateWithSchema(schemas.clinicalDocumentSchema, req.body || {});
      const document = await clinicalDocumentsService.issueDocument({
        recordId,
        payload,
        adminUser: req.adminUser,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_document_issued",
        entityType: "clinical_document",
        entityId: document.id,
        summary: `${document.documentTypeLabel} emitido.`,
        metadata: {
          recordId,
          patientId: document.patientId,
          documentNumber: document.documentNumber,
          documentType: document.documentType
        }
      });
      res.status(201).json({ ok: true, data: document });
    })
  );

  app.get(
    "/api/admin/clinical-documents/:id",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const documentId = parseEntityId(req.params.id, "Documento");
      const document = await clinicalDocumentsService.getDocument({
        documentId,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_document_viewed",
        entityType: "clinical_document",
        entityId: documentId,
        summary: "Documento visualizado.",
        metadata: {
          documentNumber: document.documentNumber,
          documentType: document.documentType
        }
      });
      res.json({ ok: true, data: document });
    })
  );

  app.get(
    "/api/admin/clinical-documents/:id/download",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const documentId = parseEntityId(req.params.id, "Documento");
      const { document, buffer } = await clinicalDocumentsService.downloadDocument({
        documentId,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_document_downloaded",
        entityType: "clinical_document",
        entityId: documentId,
        summary: "Documento baixado.",
        metadata: {
          documentNumber: document.documentNumber,
          documentType: document.documentType
        }
      });
      res.setHeader("Content-Type", document.fileContentType || "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${document.documentNumber || "documento"}.pdf"`
      );
      res.status(200).send(buffer);
    })
  );

  app.post(
    "/api/admin/clinical-documents/:id/revoke",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const documentId = parseEntityId(req.params.id, "Documento");
      const payload = validateWithSchema(schemas.documentRevokeSchema, req.body || {});
      const document = await clinicalDocumentsService.revokeDocument({
        documentId,
        reason: payload.reason,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_document_revoked",
        entityType: "clinical_document",
        entityId: documentId,
        summary: `${document.documentTypeLabel} revogado.`,
        metadata: {
          documentNumber: document.documentNumber,
          documentType: document.documentType,
          reason: sanitizeAuditString(payload.reason, 300)
        }
      });
      res.json({ ok: true, data: document });
    })
  );

  app.get(
    "/api/admin/patients/:patientId/intake",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const patientId = parseEntityId(req.params.patientId, "Paciente");
      const result = await clinicalService.getIntakeForPatient({
        patientId,
        repositories,
        runtimeConfig
      });
      if (result.intake) {
        await appendAuditLog(repositories, req, {
          action: "clinical_intake_viewed",
          entityType: "clinical_intake",
          entityId: result.intake.id,
          summary: "Anamnese visualizada.",
          metadata: {
            patientId,
            intakeId: result.intake.id,
            status: result.intake.status
          }
        });
      }
      res.json({ ok: true, data: result });
    })
  );

  app.post(
    "/api/admin/patients/:patientId/intake",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const patientId = parseEntityId(req.params.patientId, "Paciente");
      const payload = validateWithSchema(schemas.intakePayloadSchema, req.body || {});
      const intake = await clinicalService.createIntakeForPatient({
        patientId,
        payload,
        adminUser: req.adminUser,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_intake_created",
        entityType: "clinical_intake",
        entityId: intake.id,
        summary: "Anamnese criada.",
        metadata: { patientId, intakeId: intake.id, status: intake.status }
      });
      res.status(201).json({ ok: true, data: intake });
    })
  );

  app.put(
    "/api/admin/intakes/:id",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Anamnese");
      const payload = validateWithSchema(schemas.intakePayloadSchema, req.body || {});
      const intake = await clinicalService.updateIntake({
        intakeId: id,
        payload,
        changeReason: req.body?.changeReason,
        adminUser: req.adminUser,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_intake_updated",
        entityType: "clinical_intake",
        entityId: intake.id,
        summary: "Anamnese atualizada.",
        metadata: { patientId: intake.patientId, intakeId: intake.id, status: intake.status }
      });
      res.json({ ok: true, data: intake });
    })
  );

  app.post(
    "/api/admin/intakes/:id/complete",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Anamnese");
      const intake = await clinicalService.completeIntake({
        intakeId: id,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_intake_completed",
        entityType: "clinical_intake",
        entityId: intake.id,
        summary: "Anamnese concluída.",
        metadata: { patientId: intake.patientId, intakeId: intake.id, status: intake.status }
      });
      res.json({ ok: true, data: intake });
    })
  );

  app.post(
    "/api/admin/intakes/:id/lock",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Anamnese");
      const intake = await clinicalService.lockIntake({
        intakeId: id,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_intake_locked",
        entityType: "clinical_intake",
        entityId: intake.id,
        summary: "Anamnese bloqueada.",
        metadata: { patientId: intake.patientId, intakeId: intake.id, status: intake.status }
      });
      res.json({ ok: true, data: intake });
    })
  );

  app.get(
    "/api/admin/intakes/:id/export.pdf",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Anamnese");
      const { intake, buffer } = await clinicalService.exportIntakePdf({
        intakeId: id,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_intake_exported",
        entityType: "clinical_intake",
        entityId: intake.id,
        summary: "Anamnese exportada.",
        metadata: { patientId: intake.patientId, intakeId: intake.id, exportType: "intake" }
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="anamnese-${intake.id}.pdf"`);
      res.status(200).send(buffer);
    })
  );

  app.get(
    "/api/admin/patients/:patientId/evolutions",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const patientId = parseEntityId(req.params.patientId, "Paciente");
      // Única rota de leitura do prontuário que não registrava acesso. Como
      // devolve a relação inteira de evoluções do paciente, a trilha precisa
      // saber que alguém a consultou.
      const items = await clinicalService.listEvolutions({
        patientId,
        repositories,
        runtimeConfig
      });

      await appendAuditLog(repositories, req, {
        action: "clinical_evolutions_listed",
        entityType: "clinical_record",
        entityId: patientId,
        summary: "Relação de evoluções do prontuário consultada.",
        metadata: { patientId, evolutionsCount: items.length }
      });

      res.json({ ok: true, data: { items } });
    })
  );

  app.get(
    "/api/admin/evolutions/:id",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Evolução");
      const evolution = await clinicalService.getEvolution({
        evolutionId: id,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_evolution_viewed",
        entityType: "clinical_evolution",
        entityId: evolution.id,
        summary: "Evolução visualizada.",
        metadata: {
          patientId: evolution.patientId,
          evolutionId: evolution.id,
          sessionId: evolution.sessionId || null,
          evolutionType: evolution.evolutionType,
          status: evolution.status
        }
      });
      res.json({ ok: true, data: evolution });
    })
  );

  app.post(
    "/api/admin/evolutions",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const payload = validateWithSchema(schemas.evolutionCreateSchema, req.body || {});
      const evolution = await clinicalService.createEvolution({
        payload,
        adminUser: req.adminUser,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_evolution_created",
        entityType: "clinical_evolution",
        entityId: evolution.id,
        summary: "Evolução criada.",
        metadata: {
          patientId: evolution.patientId,
          evolutionId: evolution.id,
          sessionId: evolution.sessionId || null,
          evolutionType: evolution.evolutionType,
          status: evolution.status
        }
      });
      res.status(201).json({ ok: true, data: evolution });
    })
  );

  app.put(
    "/api/admin/evolutions/:id",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Evolução");
      const payload = validateWithSchema(schemas.evolutionUpdateSchema, req.body || {});
      const evolution = await clinicalService.updateEvolution({
        evolutionId: id,
        payload,
        changeReason: req.body?.changeReason,
        adminUser: req.adminUser,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_evolution_updated",
        entityType: "clinical_evolution",
        entityId: evolution.id,
        summary: "Evolução atualizada.",
        metadata: {
          patientId: evolution.patientId,
          evolutionId: evolution.id,
          evolutionType: evolution.evolutionType,
          status: evolution.status
        }
      });
      res.json({ ok: true, data: evolution });
    })
  );

  app.post(
    "/api/admin/evolutions/:id/sign",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Evolução");
      const evolution = await clinicalService.signEvolution({
        evolutionId: id,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_evolution_signed",
        entityType: "clinical_evolution",
        entityId: evolution.id,
        summary: "Evolução assinada.",
        metadata: {
          patientId: evolution.patientId,
          evolutionId: evolution.id,
          status: evolution.status
        }
      });
      res.json({ ok: true, data: evolution });
    })
  );

  app.post(
    "/api/admin/evolutions/:id/lock",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Evolução");
      const evolution = await clinicalService.lockEvolution({
        evolutionId: id,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_evolution_locked",
        entityType: "clinical_evolution",
        entityId: evolution.id,
        summary: "Evolução bloqueada.",
        metadata: {
          patientId: evolution.patientId,
          evolutionId: evolution.id,
          status: evolution.status
        }
      });
      res.json({ ok: true, data: evolution });
    })
  );

  app.post(
    "/api/admin/evolutions/:id/addendum",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Evolução");
      const payload = validateWithSchema(schemas.evolutionAddendumSchema, req.body || {});
      const evolution = await clinicalService.createAddendum({
        evolutionId: id,
        payload,
        adminUser: req.adminUser,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_evolution_addendum_created",
        entityType: "clinical_evolution",
        entityId: evolution.id,
        summary: "Adendo/retificação criado.",
        metadata: {
          patientId: evolution.patientId,
          evolutionId: evolution.id,
          parentEvolutionId: evolution.parentEvolutionId || null,
          evolutionType: evolution.evolutionType,
          status: evolution.status
        }
      });
      res.status(201).json({ ok: true, data: evolution });
    })
  );

  app.get(
    "/api/admin/evolutions/:id/export.pdf",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Evolução");
      const { evolution, buffer } = await clinicalService.exportEvolutionPdf({
        evolutionId: id,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_evolution_exported",
        entityType: "clinical_evolution",
        entityId: evolution.id,
        summary: "Evolução exportada.",
        metadata: {
          patientId: evolution.patientId,
          evolutionId: evolution.id,
          exportType: "evolution"
        }
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="evolucao-${evolution.id}.pdf"`);
      res.status(200).send(buffer);
    })
  );
}

module.exports = {
  register
};
