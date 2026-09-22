const { AppError } = require("../lib/errors");
const {
  decryptClinicalPayload,
  encryptClinicalPayload,
  hashClinicalContent
} = require("../lib/clinical-crypto");
const { buildDefaultPayload, normalizeIntakePayload } = require("../lib/clinical-template");
const {
  ensureClinicalEncryption,
  getPatientOrThrow,
  getProfessionalInfo,
  nowIso,
  serializePatientMinimal
} = require("./clinical-shared");
const { RECORD_BLOCK_TYPES, RECORD_CLOSING_REASONS } = require("../lib/clinic-options");
const { renderBlockPdf } = require("./clinical-pdf");

// O prontuário como registro: abre, recebe contrato, plano, anamnese,
// evoluções e documentos, e encerra. Anamnese e evoluções continuam em
// clinical.js; aqui fica o registro que as reúne.

const BLOCK_TYPES = RECORD_BLOCK_TYPES;

const BLOCK_LABELS = {
  contract: "Contrato e consentimento",
  plan: "Plano terapêutico",
  closing: "Encerramento"
};

const BLOCK_STATUS_LABELS = {
  draft: "Rascunho",
  completed: "Concluído",
  locked: "Bloqueado"
};

const RECORD_STATUS_LABELS = {
  open: "Aberto",
  closed: "Encerrado"
};

const CLOSING_REASONS = RECORD_CLOSING_REASONS;

const CLOSING_REASON_LABELS = {
  discharge: "Alta",
  dropout: "Desistência",
  referral: "Encaminhamento",
  professional_change: "Mudança de profissional",
  other: "Outro"
};

function formatRecordNumber(sequenceNumber) {
  return `PRT-${String(sequenceNumber).padStart(6, "0")}`;
}

function assertBlockType(blockType) {
  if (!BLOCK_TYPES.includes(blockType)) {
    throw new AppError("Bloco de prontuário desconhecido.", 400);
  }
  return blockType;
}

function serializeRecord(record, extras = {}) {
  if (!record) {
    return null;
  }
  return {
    id: record.id,
    patientId: record.patientId,
    recordNumber: record.recordNumber || "",
    status: record.status,
    statusLabel: RECORD_STATUS_LABELS[record.status] || record.status,
    closingReason: record.closingReason || "",
    closingReasonLabel: record.closingReason
      ? CLOSING_REASON_LABELS[record.closingReason] || record.closingReason
      : "",
    openedAt: record.openedAt,
    closedAt: record.closedAt || "",
    openedByAdminEmail: record.openedByAdminEmail || "",
    closedByAdminEmail: record.closedByAdminEmail || "",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...extras
  };
}

function serializeBlockSummary(block, versionsCount = 0) {
  if (!block) {
    return null;
  }
  return {
    id: block.id,
    recordId: block.recordId,
    blockType: block.blockType,
    blockLabel: BLOCK_LABELS[block.blockType] || block.blockType,
    status: block.status,
    statusLabel: BLOCK_STATUS_LABELS[block.status] || block.status,
    createdAt: block.createdAt,
    updatedAt: block.updatedAt,
    completedAt: block.completedAt || "",
    lockedAt: block.lockedAt || "",
    versionsCount
  };
}

// Bloco só é editável enquanto rascunho E com o prontuário aberto: encerrado,
// o registro inteiro passa a ser leitura.
function serializeBlockDetail(block, payload, versionsCount = 0, record = null) {
  return {
    ...serializeBlockSummary(block, versionsCount),
    editable: block.status === "draft" && (!record || record.status === "open"),
    payload
  };
}

async function getRecordOrThrow(repositories, recordId) {
  const record = await repositories.clinical.getRecordById(recordId);
  if (!record) {
    throw new AppError("Prontuário não encontrado.", 404);
  }
  return record;
}

// Abre o prontuário do paciente. É idempotente de propósito: a tela chama isto
// ao criar a primeira anamnese ou evolução, e um segundo clique (ou uma corrida
// entre duas abas) devolver 409 seria só ruído.
async function ensureRecordForPatient({ patientId, adminUser, repositories }) {
  const existente = await repositories.clinical.getRecordByPatientId(patientId);
  if (existente) {
    return { record: existente, created: false };
  }

  const sequenceNumber = await repositories.clinical.getNextRecordSequence();

  try {
    const record = await repositories.clinical.createRecord({
      patientId,
      recordNumber: formatRecordNumber(sequenceNumber),
      sequenceNumber,
      status: "open",
      openedAt: nowIso(),
      openedByAdminId: adminUser?.sub || null,
      openedByAdminEmail: adminUser?.email || ""
    });
    return { record, created: true };
  } catch (error) {
    // Corrida perdida: outra requisição criou o prontuário entre a leitura
    // acima e este insert. O índice único fez seu trabalho; aqui só
    // devolvemos o registro que venceu, em vez de um 500.
    const concorrente = await repositories.clinical.getRecordByPatientId(patientId);
    if (concorrente) {
      return { record: concorrente, created: false };
    }
    throw error;
  }
}

// Guarda usada por anamnese, evoluções e blocos: prontuário encerrado não
// recebe registro novo nem edição. Correção passa a ser só por adendo.
async function assertRecordOpenForPatient(repositories, patientId) {
  const record = await repositories.clinical.getRecordByPatientId(patientId);
  if (record && record.status === "closed") {
    throw new AppError(
      "Este prontuário está encerrado e não aceita novos registros. " +
        "Para corrigir algo, registre um adendo; para retomar o acompanhamento, reabra o prontuário.",
      409
    );
  }
  return record;
}

async function openRecordForPatient({ patientId, adminUser, repositories, runtimeConfig }) {
  ensureClinicalEncryption(runtimeConfig);
  const patient = await getPatientOrThrow(repositories, patientId);
  const { record, created } = await ensureRecordForPatient({ patientId, adminUser, repositories });
  return {
    record: serializeRecord(record, { patient: serializePatientMinimal(patient) }),
    created
  };
}

// ── Blocos: contrato, plano terapêutico e encerramento ───────────────────────
async function getBlockForRecord({ recordId, blockType, repositories, runtimeConfig }) {
  ensureClinicalEncryption(runtimeConfig);
  assertBlockType(blockType);
  const record = await getRecordOrThrow(repositories, recordId);
  const block = await repositories.clinical.getBlock(recordId, blockType);

  if (!block) {
    return {
      block: null,
      template: buildDefaultPayload(blockType),
      record: serializeRecord(record)
    };
  }

  const versionsCount = await repositories.clinical.countBlockVersions(block.id);
  const payload = block.encryptedPayload
    ? decryptClinicalPayload(block.encryptedPayload, runtimeConfig)
    : buildDefaultPayload(blockType);

  return {
    block: serializeBlockDetail(block, payload, versionsCount, record),
    template: buildDefaultPayload(blockType),
    record: serializeRecord(record)
  };
}

// Uma rota só para criar e atualizar: o formulário do painel não sabe (nem
// precisa saber) se o bloco já existe.
async function saveBlock({ recordId, blockType, payload, changeReason, adminUser, repositories, runtimeConfig }) {
  ensureClinicalEncryption(runtimeConfig);
  assertBlockType(blockType);
  const record = await getRecordOrThrow(repositories, recordId);

  if (record.status === "closed") {
    throw new AppError(
      "Prontuário encerrado não aceita edição. Reabra o prontuário para retomar o acompanhamento.",
      409
    );
  }

  const normalized = normalizeIntakePayload(payload, blockType);
  const encryptedPayload = encryptClinicalPayload(normalized, runtimeConfig);
  const payloadHash = hashClinicalContent(normalized, runtimeConfig);
  const existente = await repositories.clinical.getBlock(recordId, blockType);

  if (!existente) {
    const criado = await repositories.clinical.createBlock({
      recordId,
      blockType,
      status: "draft",
      encryptedPayload,
      payloadHash,
      createdByAdminId: adminUser?.sub || null,
      createdByAdminEmail: adminUser?.email || ""
    });
    return serializeBlockDetail(criado, normalized, 0, record);
  }

  if (existente.status !== "draft") {
    throw new AppError(
      `${BLOCK_LABELS[blockType]} já foi concluído ou bloqueado e não pode ser editado diretamente.`,
      409
    );
  }

  // Snapshot do conteúdo anterior antes de sobrescrever: o prontuário é
  // versionado, nada é perdido em silêncio.
  const versionNumber = await repositories.clinical.getNextBlockVersionNumber(existente.id);
  await repositories.clinical.addBlockVersion({
    blockId: existente.id,
    encryptedPayload: existente.encryptedPayload,
    payloadHash: existente.payloadHash,
    versionNumber,
    changedByAdminId: adminUser?.sub || null,
    changedByAdminEmail: adminUser?.email || "",
    changeReason: changeReason || ""
  });

  const atualizado = await repositories.clinical.updateBlock(existente.id, {
    encryptedPayload,
    payloadHash
  });

  return serializeBlockDetail(atualizado, normalized, versionNumber, record);
}

async function getBlockOrThrow(repositories, recordId, blockType) {
  const block = await repositories.clinical.getBlock(recordId, blockType);
  if (!block) {
    throw new AppError(`${BLOCK_LABELS[blockType]} ainda não foi registrado.`, 404);
  }
  return block;
}

async function completeBlock({ recordId, blockType, repositories, runtimeConfig }) {
  ensureClinicalEncryption(runtimeConfig);
  assertBlockType(blockType);
  const record = await getRecordOrThrow(repositories, recordId);
  const block = await getBlockOrThrow(repositories, recordId, blockType);

  // Mesma regra de saveBlock: encerrado, o registro não muda de estado.
  // Bloquear continua valendo, como em lockIntake e lockEvolution — só
  // aperta, nunca afrouxa.
  if (record.status === "closed") {
    throw new AppError(
      "Prontuário encerrado não aceita alteração. Reabra o prontuário para retomar o acompanhamento.",
      409
    );
  }

  if (block.status !== "draft") {
    throw new AppError("Este bloco já foi concluído ou bloqueado.", 409);
  }

  const atualizado = await repositories.clinical.updateBlock(block.id, {
    status: "completed",
    completedAt: nowIso()
  });
  const versionsCount = await repositories.clinical.countBlockVersions(block.id);
  return serializeBlockSummary(atualizado, versionsCount);
}

// Bloqueio é definitivo: depois dele nem a própria psicóloga edita o bloco.
async function lockBlock({ recordId, blockType, repositories, runtimeConfig }) {
  ensureClinicalEncryption(runtimeConfig);
  assertBlockType(blockType);
  await getRecordOrThrow(repositories, recordId);
  const block = await getBlockOrThrow(repositories, recordId, blockType);

  if (block.status === "locked") {
    throw new AppError("Este bloco já está bloqueado.", 409);
  }

  const agora = nowIso();
  const atualizado = await repositories.clinical.updateBlock(block.id, {
    status: "locked",
    completedAt: block.completedAt || agora,
    lockedAt: agora
  });
  const versionsCount = await repositories.clinical.countBlockVersions(block.id);
  return serializeBlockSummary(atualizado, versionsCount);
}

async function exportBlockPdf({ recordId, blockType, repositories, runtimeConfig }) {
  ensureClinicalEncryption(runtimeConfig);
  assertBlockType(blockType);
  const record = await getRecordOrThrow(repositories, recordId);
  const patient = await getPatientOrThrow(repositories, record.patientId);
  const block = await getBlockOrThrow(repositories, recordId, blockType);
  const settings = await repositories.clinic.getPlatformSettings();
  const { professionalName, crp } = getProfessionalInfo(settings);

  const payload = block.encryptedPayload
    ? decryptClinicalPayload(block.encryptedPayload, runtimeConfig)
    : buildDefaultPayload(blockType);

  const buffer = await renderBlockPdf({
    professionalName,
    crp,
    patient,
    recordNumber: record.recordNumber,
    blockType,
    blockLabel: BLOCK_LABELS[blockType],
    status: block.status,
    payload,
    city: settings?.receiptCity || ""
  });

  return { record, patient, block, buffer };
}

// ── Encerramento ─────────────────────────────────────────────────────────────
async function closeRecord({ recordId, closingReason, payload, adminUser, repositories, runtimeConfig }) {
  ensureClinicalEncryption(runtimeConfig);
  const record = await getRecordOrThrow(repositories, recordId);

  if (record.status === "closed") {
    throw new AppError("Este prontuário já está encerrado.", 409);
  }

  if (!CLOSING_REASONS.includes(closingReason)) {
    throw new AppError("Informe o motivo do encerramento.", 400);
  }

  const normalized = normalizeIntakePayload(payload, "closing");
  const encryptedPayload = encryptClinicalPayload(normalized, runtimeConfig);
  const payloadHash = hashClinicalContent(normalized, runtimeConfig);
  const agora = nowIso();
  const existente = await repositories.clinical.getBlock(recordId, "closing");

  if (!existente) {
    await repositories.clinical.createBlock({
      recordId,
      blockType: "closing",
      status: "completed",
      encryptedPayload,
      payloadHash,
      createdByAdminId: adminUser?.sub || null,
      createdByAdminEmail: adminUser?.email || ""
    });
  } else {
    if (existente.encryptedPayload) {
      const versionNumber = await repositories.clinical.getNextBlockVersionNumber(existente.id);
      await repositories.clinical.addBlockVersion({
        blockId: existente.id,
        encryptedPayload: existente.encryptedPayload,
        payloadHash: existente.payloadHash,
        versionNumber,
        changedByAdminId: adminUser?.sub || null,
        changedByAdminEmail: adminUser?.email || "",
        changeReason: "Encerramento do prontuário."
      });
    }
    await repositories.clinical.updateBlock(existente.id, {
      status: "completed",
      encryptedPayload,
      payloadHash,
      completedAt: agora
    });
  }

  // O prontuário fecha por último: se algo acima falhar, ele continua aberto e
  // a psicóloga vê o erro, em vez de ficar com um registro fechado pela metade.
  const encerrado = await repositories.clinical.updateRecord(recordId, {
    status: "closed",
    closingReason,
    closedAt: agora,
    closedByAdminId: adminUser?.sub || null,
    closedByAdminEmail: adminUser?.email || ""
  });

  return serializeRecord(encerrado);
}

// Encerrar por engano não pode virar beco sem saída. A reabertura fica no log
// de auditoria com o motivo; o bloco de encerramento volta a ser editável.
async function reopenRecord({ recordId, reason, repositories, runtimeConfig }) {
  ensureClinicalEncryption(runtimeConfig);
  const record = await getRecordOrThrow(repositories, recordId);

  if (record.status !== "closed") {
    throw new AppError("Este prontuário não está encerrado.", 409);
  }

  const bloco = await repositories.clinical.getBlock(recordId, "closing");
  if (bloco && bloco.status === "completed") {
    await repositories.clinical.updateBlock(bloco.id, { status: "draft", completedAt: "" });
  }

  const reaberto = await repositories.clinical.updateRecord(recordId, {
    status: "open",
    closingReason: "",
    closedAt: "",
    closedByAdminId: null,
    closedByAdminEmail: ""
  });

  return serializeRecord(reaberto, { reopenReason: reason || "" });
}

// Situação dos blocos sem abrir conteúdo: alimenta o resumo do prontuário e a
// decisão sobre exclusão do paciente.
async function getRecordOverview({ patientId, repositories }) {
  const record = await repositories.clinical.getRecordByPatientId(patientId);
  if (!record) {
    return { record: null, blocks: {}, documentsCount: 0 };
  }

  const blocks = {};
  for (const bloco of await repositories.clinical.listBlocksByRecordId(record.id)) {
    blocks[bloco.blockType] = serializeBlockSummary(bloco);
  }

  return {
    record,
    blocks,
    documentsCount: await repositories.clinical.countDocuments(record.id)
  };
}

module.exports = {
  BLOCK_LABELS,
  BLOCK_STATUS_LABELS,
  BLOCK_TYPES,
  CLOSING_REASONS,
  CLOSING_REASON_LABELS,
  RECORD_STATUS_LABELS,
  assertRecordOpenForPatient,
  closeRecord,
  completeBlock,
  ensureRecordForPatient,
  exportBlockPdf,
  formatRecordNumber,
  getBlockForRecord,
  getRecordOrThrow,
  getRecordOverview,
  lockBlock,
  openRecordForPatient,
  reopenRecord,
  saveBlock,
  serializeBlockSummary,
  serializeRecord
};
