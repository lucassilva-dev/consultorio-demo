const { AppError } = require("../lib/errors");
const { normalizeDateTimeToIso } = require("../lib/clinic-time");
const {
  decryptClinicalPayload,
  decryptClinicalText,
  encryptClinicalPayload,
  encryptClinicalText,
  hashClinicalContent
} = require("../lib/clinical-crypto");
const { buildDefaultPayload, normalizeIntakePayload } = require("../lib/clinical-template");
const {
  editWindowEndsAt,
  ensureClinicalEncryption,
  getPatientOrThrow,
  getProfessionalInfo,
  nowIso,
  serializePatientMinimal,
  withinEditWindow
} = require("./clinical-shared");
const {
  BLOCK_LABELS,
  assertRecordOpenForPatient,
  ensureRecordForPatient,
  getRecordOverview,
  serializeRecord
} = require("./clinical-record");
const {
  DOCUMENT_TYPE_LABELS,
  EVOLUTION_TYPE_LABELS,
  renderClinicalRecordPdf,
  renderEvolutionPdf,
  renderIntakePdf
} = require("./clinical-pdf");

const EVOLUTION_TYPES = [
  "session",
  "initial",
  "guardian_contact",
  "referral",
  "closing",
  "addendum",
  "correction",
  "other"
];

const INTAKE_STATUS_LABELS = {
  draft: "Rascunho",
  completed: "Concluída",
  locked: "Bloqueada"
};

const EVOLUTION_STATUS_LABELS = {
  draft: "Rascunho",
  signed: "Assinada",
  locked: "Bloqueada",
  amended: "Retificada"
};


// ── Serialização (sem vazar conteúdo onde não deve) ──────────────────────────
function serializeIntakeSummary(intake, versionsCount = 0) {
  if (!intake) {
    return null;
  }
  return {
    id: intake.id,
    patientId: intake.patientId,
    status: intake.status,
    statusLabel: INTAKE_STATUS_LABELS[intake.status] || intake.status,
    createdAt: intake.createdAt,
    updatedAt: intake.updatedAt,
    completedAt: intake.completedAt || "",
    lockedAt: intake.lockedAt || "",
    versionsCount
  };
}

function serializeIntakeDetail(
  intake,
  payload,
  versionsCount = 0,
  runtimeConfig = {},
  recordClosed = false
) {
  return {
    ...serializeIntakeSummary(intake, versionsCount),
    editable:
      !recordClosed &&
      intake.status === "draft" &&
      withinEditWindow(intake.createdAt, runtimeConfig),
    editableUntil: editWindowEndsAt(intake.createdAt, runtimeConfig),
    recordClosed,
    payload
  };
}

function serializeEvolutionSummary(evolution, runtimeConfig = {}, extras = {}) {
  if (!evolution) {
    return null;
  }
  return {
    hasAmendments: Boolean(extras.hasAmendments),
    recordClosed: Boolean(extras.recordClosed),
    id: evolution.id,
    patientId: evolution.patientId,
    sessionId: evolution.sessionId || null,
    evolutionDate: evolution.evolutionDate,
    evolutionType: evolution.evolutionType,
    evolutionTypeLabel: EVOLUTION_TYPE_LABELS[evolution.evolutionType] || evolution.evolutionType,
    title: evolution.title || "",
    status: evolution.status,
    statusLabel: EVOLUTION_STATUS_LABELS[evolution.status] || evolution.status,
    parentEvolutionId: evolution.parentEvolutionId || null,
    createdAt: evolution.createdAt,
    updatedAt: evolution.updatedAt,
    signedAt: evolution.signedAt || "",
    lockedAt: evolution.lockedAt || "",
    editableUntil: editWindowEndsAt(evolution.createdAt, runtimeConfig)
  };
}

function serializeEvolutionDetail(evolution, content, runtimeConfig = {}, extras = {}) {
  // "editável" precisa considerar a janela de tempo e o encerramento do
  // prontuário, não só o status: sem isso a interface oferece Editar num
  // registro que o servidor já vai recusar.
  const editable =
    !extras.recordClosed &&
    evolution.status === "draft" &&
    withinEditWindow(evolution.createdAt, runtimeConfig);
  return {
    ...serializeEvolutionSummary(evolution, runtimeConfig, extras),
    editable,
    content
  };
}


// Registros que a resolução do CFP trata como definitivos: uma vez concluídos,
// assinados ou bloqueados, não podem simplesmente sumir junto com o cadastro.
const STATUS_DEFINITIVOS_ANAMNESE = ["completed", "locked"];
const STATUS_DEFINITIVOS_EVOLUCAO = ["signed", "locked", "amended"];
const STATUS_DEFINITIVOS_BLOCO = ["completed", "locked"];

// Resume o prontuário do paciente para decidir sobre exclusão. Lê apenas
// status — nunca conteúdo —, então não exige TOKEN_ENCRYPTION_KEY.
async function getClinicalRecordFootprint({ patientId, repositories }) {
  const intake = await repositories.clinical.getIntakeByPatientId(patientId);
  const evolutions = await repositories.clinical.listEvolutionsByPatientId(patientId);
  const record = await repositories.clinical.getRecordByPatientId(patientId);

  const anamneseDefinitiva = Boolean(intake) && STATUS_DEFINITIVOS_ANAMNESE.includes(intake.status);
  const evolucoesDefinitivas = evolutions.filter((evolution) =>
    STATUS_DEFINITIVOS_EVOLUCAO.includes(evolution.status)
  ).length;

  // Blocos concluídos ou bloqueados e documentos emitidos são tão definitivos
  // quanto anamnese concluída: um contrato assinado e uma declaração entregue
  // não podem sumir junto com o cadastro do paciente.
  let blocosDefinitivos = 0;
  let documentosEmitidos = 0;
  if (record) {
    const blocos = await repositories.clinical.listBlocksByRecordId(record.id);
    blocosDefinitivos = blocos.filter((bloco) =>
      STATUS_DEFINITIVOS_BLOCO.includes(bloco.status)
    ).length;
    documentosEmitidos = await repositories.clinical.countDocuments(record.id);
  }

  const prontuarioEncerrado = Boolean(record) && record.status === "closed";

  return {
    hasIntake: Boolean(intake),
    hasRecord: Boolean(record),
    recordClosed: prontuarioEncerrado,
    evolutionsCount: evolutions.length,
    documentsCount: documentosEmitidos,
    definitiveBlocks: blocosDefinitivos,
    hasRecords:
      Boolean(intake) || evolutions.length > 0 || Boolean(record) || documentosEmitidos > 0,
    definitiveIntake: anamneseDefinitiva,
    definitiveEvolutions: evolucoesDefinitivas,
    hasDefinitiveRecords:
      anamneseDefinitiva ||
      evolucoesDefinitivas > 0 ||
      blocosDefinitivos > 0 ||
      documentosEmitidos > 0 ||
      prontuarioEncerrado
  };
}

// ── Anamnese ─────────────────────────────────────────────────────────────────
async function getIntakeForPatient({ patientId, repositories, runtimeConfig }) {
  ensureClinicalEncryption(runtimeConfig);
  await getPatientOrThrow(repositories, patientId);
  const intake = await repositories.clinical.getIntakeByPatientId(patientId);

  if (!intake) {
    return {
      intake: null,
      template: buildDefaultPayload()
    };
  }

  const versionsCount = await repositories.clinical.countIntakeVersions(intake.id);
  const payload = intake.encryptedPayload
    ? decryptClinicalPayload(intake.encryptedPayload, runtimeConfig)
    : buildDefaultPayload();

  return {
    intake: serializeIntakeDetail(
      intake,
      payload,
      versionsCount,
      runtimeConfig,
      await prontuarioEncerrado(repositories, patientId)
    ),
    template: buildDefaultPayload()
  };
}

async function createIntakeForPatient({ patientId, payload, adminUser, repositories, runtimeConfig }) {
  ensureClinicalEncryption(runtimeConfig);
  await getPatientOrThrow(repositories, patientId);
  await assertRecordOpenForPatient(repositories, patientId);
  await ensureRecordForPatient({ patientId, adminUser, repositories });

  const existing = await repositories.clinical.getIntakeByPatientId(patientId);
  if (existing) {
    throw new AppError("Este paciente já possui uma anamnese.", 409);
  }

  const normalized = normalizeIntakePayload(payload);
  const encryptedPayload = encryptClinicalPayload(normalized, runtimeConfig);
  const payloadHash = hashClinicalContent(normalized, runtimeConfig);

  const intake = await repositories.clinical.createIntake({
    patientId,
    status: "draft",
    encryptedPayload,
    payloadHash,
    createdByAdminId: adminUser?.sub || null,
    createdByAdminEmail: adminUser?.email || ""
  });

  return serializeIntakeDetail(intake, normalized, 0, runtimeConfig);
}

async function prontuarioEncerrado(repositories, patientId) {
  const record = await repositories.clinical.getRecordByPatientId(patientId);
  return Boolean(record) && record.status === "closed";
}

async function getIntakeOrThrow(repositories, intakeId) {
  const intake = await repositories.clinical.getIntakeById(intakeId);
  if (!intake) {
    throw new AppError("Anamnese não encontrada.", 404);
  }
  return intake;
}

async function updateIntake({ intakeId, payload, changeReason, adminUser, repositories, runtimeConfig }) {
  ensureClinicalEncryption(runtimeConfig);
  const intake = await getIntakeOrThrow(repositories, intakeId);
  await assertRecordOpenForPatient(repositories, intake.patientId);

  if (intake.status !== "draft") {
    throw new AppError(
      "Anamnese concluída ou bloqueada não pode ser editada diretamente.",
      409
    );
  }

  if (!withinEditWindow(intake.createdAt, runtimeConfig)) {
    throw new AppError(
      "A janela de edição da anamnese expirou. Conclua a anamnese para encerrá-la.",
      409
    );
  }

  // Preserva a versão anterior antes de sobrescrever.
  const versionNumber = await repositories.clinical.getNextIntakeVersionNumber(intakeId);
  await repositories.clinical.addIntakeVersion({
    intakeId,
    encryptedPayload: intake.encryptedPayload,
    payloadHash: intake.payloadHash,
    versionNumber,
    changedByAdminId: adminUser?.sub || null,
    changedByAdminEmail: adminUser?.email || "",
    changeReason: String(changeReason || "Atualização de rascunho").slice(0, 200)
  });

  const normalized = normalizeIntakePayload(payload);
  const updated = await repositories.clinical.updateIntake(intakeId, {
    encryptedPayload: encryptClinicalPayload(normalized, runtimeConfig),
    payloadHash: hashClinicalContent(normalized, runtimeConfig)
  });

  const versionsCount = await repositories.clinical.countIntakeVersions(intakeId);
  return serializeIntakeDetail(updated, normalized, versionsCount, runtimeConfig);
}

async function completeIntake({ intakeId, repositories, runtimeConfig }) {
  ensureClinicalEncryption(runtimeConfig);
  const intake = await getIntakeOrThrow(repositories, intakeId);
  await assertRecordOpenForPatient(repositories, intake.patientId);

  if (intake.status === "locked") {
    throw new AppError("Anamnese bloqueada não pode ser alterada.", 409);
  }

  const updated = await repositories.clinical.updateIntake(intakeId, {
    status: "completed",
    completedAt: intake.completedAt || nowIso()
  });
  const versionsCount = await repositories.clinical.countIntakeVersions(intakeId);
  return serializeIntakeSummary(updated, versionsCount);
}

async function lockIntake({ intakeId, repositories, runtimeConfig }) {
  ensureClinicalEncryption(runtimeConfig);
  const intake = await getIntakeOrThrow(repositories, intakeId);

  if (intake.status === "locked") {
    throw new AppError("Anamnese já está bloqueada.", 409);
  }

  const updated = await repositories.clinical.updateIntake(intakeId, {
    status: "locked",
    completedAt: intake.completedAt || nowIso(),
    lockedAt: nowIso()
  });
  const versionsCount = await repositories.clinical.countIntakeVersions(intakeId);
  return serializeIntakeSummary(updated, versionsCount);
}

async function exportIntakePdf({ intakeId, repositories, runtimeConfig }) {
  ensureClinicalEncryption(runtimeConfig);
  const intake = await getIntakeOrThrow(repositories, intakeId);
  const patient = await getPatientOrThrow(repositories, intake.patientId);
  const settings = await repositories.clinic.getPlatformSettings();
  const { professionalName, crp } = getProfessionalInfo(settings);

  const payload = intake.encryptedPayload
    ? decryptClinicalPayload(intake.encryptedPayload, runtimeConfig)
    : buildDefaultPayload();

  const buffer = await renderIntakePdf({
    professionalName,
    crp,
    patient,
    intake: { status: intake.status, payload }
  });

  return { intake, patient, buffer };
}

// ── Evoluções ────────────────────────────────────────────────────────────────
async function listEvolutions({ patientId, repositories, runtimeConfig }) {
  ensureClinicalEncryption(runtimeConfig);
  await getPatientOrThrow(repositories, patientId);
  const rows = await repositories.clinical.listEvolutionsByPatientId(patientId);
  // Comparação por String: em Postgres os ids voltam como string e em SQLite
  // como número, e o vínculo precisa fechar nos dois.
  const retificadas = new Set(
    rows
      .filter((row) => row.parentEvolutionId)
      .map((row) => String(row.parentEvolutionId))
  );
  const encerrado = await prontuarioEncerrado(repositories, patientId);
  return rows.map((row) =>
    serializeEvolutionSummary(row, runtimeConfig, {
      hasAmendments: retificadas.has(String(row.id)),
      recordClosed: encerrado
    })
  );
}

async function getEvolutionOrThrow(repositories, evolutionId) {
  const evolution = await repositories.clinical.getEvolutionById(evolutionId);
  if (!evolution) {
    throw new AppError("Evolução não encontrada.", 404);
  }
  return evolution;
}

// Um registro foi retificado quando existe adendo apontando para ele. É fato
// derivado do vínculo, não do status — por isso precisa ser calculado também
// no detalhe, e não só na listagem.
async function temAdendos(repositories, evolution) {
  const irmas = await repositories.clinical.listEvolutionsByPatientId(evolution.patientId);
  return irmas.some(
    (item) => String(item.parentEvolutionId || "") === String(evolution.id)
  );
}

async function getEvolution({ evolutionId, repositories, runtimeConfig }) {
  ensureClinicalEncryption(runtimeConfig);
  const evolution = await getEvolutionOrThrow(repositories, evolutionId);
  const content = evolution.encryptedContent
    ? decryptClinicalText(evolution.encryptedContent, runtimeConfig)
    : "";
  return serializeEvolutionDetail(evolution, content, runtimeConfig, {
    hasAmendments: await temAdendos(repositories, evolution),
    recordClosed: await prontuarioEncerrado(repositories, evolution.patientId)
  });
}

async function resolveEvolutionInput(payload, repositories) {
  const patientId = Number(payload.patientId);
  if (!Number.isInteger(patientId) || patientId <= 0) {
    throw new AppError("Paciente inválido.", 400);
  }
  await getPatientOrThrow(repositories, patientId);

  const evolutionType = EVOLUTION_TYPES.includes(payload.evolutionType)
    ? payload.evolutionType
    : "session";

  let sessionId = null;
  if (payload.sessionId) {
    sessionId = Number(payload.sessionId);
    const session = await repositories.clinic.getSessionById(sessionId);
    if (!session) {
      throw new AppError("Sessão vinculada não encontrada.", 404);
    }
    if (Number(session.patientId) !== patientId) {
      throw new AppError("A sessão vinculada não pertence a este paciente.", 400);
    }
  }

  const evolutionDate =
    payload.evolutionDate && !Number.isNaN(Date.parse(payload.evolutionDate))
      ? normalizeDateTimeToIso(payload.evolutionDate)
      : nowIso();

  return { patientId, evolutionType, sessionId, evolutionDate };
}

async function createEvolution({ payload, adminUser, repositories, runtimeConfig }) {
  ensureClinicalEncryption(runtimeConfig);
  const { patientId, evolutionType, sessionId, evolutionDate } = await resolveEvolutionInput(
    payload,
    repositories
  );
  await assertRecordOpenForPatient(repositories, patientId);
  await ensureRecordForPatient({ patientId, adminUser, repositories });

  const content = String(payload.content || "");
  // Conteúdo em branco gera um registro clínico sem informação — e, antes da
  // correção da guarda em clinical-crypto, um registro que nunca mais abria.
  if (!content.trim()) {
    throw new AppError("Informe o conteúdo da evolução.", 400);
  }

  const evolution = await repositories.clinical.createEvolution({
    patientId,
    sessionId,
    evolutionDate,
    evolutionType,
    title: String(payload.title || "").slice(0, 160),
    encryptedContent: encryptClinicalText(content, runtimeConfig),
    contentHash: hashClinicalContent(content, runtimeConfig),
    status: "draft",
    createdByAdminId: adminUser?.sub || null,
    createdByAdminEmail: adminUser?.email || ""
  });

  return serializeEvolutionDetail(evolution, content, runtimeConfig);
}

async function updateEvolution({ evolutionId, payload, changeReason, adminUser, repositories, runtimeConfig }) {
  ensureClinicalEncryption(runtimeConfig);
  const evolution = await getEvolutionOrThrow(repositories, evolutionId);
  await assertRecordOpenForPatient(repositories, evolution.patientId);

  if (evolution.status !== "draft") {
    throw new AppError(
      "Registro assinado ou bloqueado não pode ser editado diretamente. Crie um adendo/retificação.",
      409
    );
  }

  if (!withinEditWindow(evolution.createdAt, runtimeConfig)) {
    throw new AppError(
      "A janela de edição expirou. Crie um adendo/retificação para registrar mudanças.",
      409
    );
  }

  const content =
    typeof payload.content === "string"
      ? payload.content
      : evolution.encryptedContent
        ? decryptClinicalText(evolution.encryptedContent, runtimeConfig)
        : "";

  // Validar antes de gravar o snapshot: recusar depois deixaria uma versão órfã.
  if (!content.trim()) {
    throw new AppError("Informe o conteúdo da evolução.", 400);
  }

  const versionNumber = await repositories.clinical.getNextEvolutionVersionNumber(evolutionId);
  await repositories.clinical.addEvolutionVersion({
    evolutionId,
    encryptedContent: evolution.encryptedContent,
    contentHash: evolution.contentHash,
    versionNumber,
    changedByAdminId: adminUser?.sub || null,
    changedByAdminEmail: adminUser?.email || "",
    changeReason: String(changeReason || "Atualização de rascunho").slice(0, 200)
  });

  // Mesmo tratamento do horário de sessão: valor sem fuso é horário da
  // clínica. Antes, o painel convertia no fuso do aparelho e o servidor
  // reinterpretava — duas convenções para o mesmo tipo de campo.
  const evolutionDate =
    payload.evolutionDate && !Number.isNaN(Date.parse(payload.evolutionDate))
      ? normalizeDateTimeToIso(payload.evolutionDate)
      : evolution.evolutionDate;

  // A sessão vinculada é editável no formulário, então precisa ser aceita aqui
  // — antes a troca era descartada em silêncio. A sessão precisa ser do mesmo
  // paciente, pela mesma regra da criação.
  let sessionId = evolution.sessionId;
  if (typeof payload.sessionId !== "undefined") {
    if (!payload.sessionId) {
      sessionId = null;
    } else {
      const vinculada = await repositories.clinic.getSessionById(Number(payload.sessionId));
      if (!vinculada) {
        throw new AppError("Sessão vinculada não encontrada.", 404);
      }
      if (Number(vinculada.patientId) !== Number(evolution.patientId)) {
        throw new AppError("A sessão vinculada não pertence a este paciente.", 400);
      }
      sessionId = Number(payload.sessionId);
    }
  }

  const updated = await repositories.clinical.updateEvolution(evolutionId, {
    evolutionDate,
    sessionId,
    evolutionType: EVOLUTION_TYPES.includes(payload.evolutionType)
      ? payload.evolutionType
      : evolution.evolutionType,
    title: typeof payload.title === "string" ? payload.title.slice(0, 160) : evolution.title,
    encryptedContent: encryptClinicalText(content, runtimeConfig),
    contentHash: hashClinicalContent(content, runtimeConfig)
  });

  return serializeEvolutionDetail(updated, content, runtimeConfig);
}

async function signEvolution({ evolutionId, repositories, runtimeConfig }) {
  ensureClinicalEncryption(runtimeConfig);
  const evolution = await getEvolutionOrThrow(repositories, evolutionId);
  await assertRecordOpenForPatient(repositories, evolution.patientId);

  if (evolution.status === "locked") {
    throw new AppError("Registro bloqueado não pode ser alterado.", 409);
  }

  const updated = await repositories.clinical.updateEvolution(evolutionId, {
    status: "signed",
    signedAt: evolution.signedAt || nowIso()
  });
  return serializeEvolutionSummary(updated, runtimeConfig);
}

async function lockEvolution({ evolutionId, repositories, runtimeConfig }) {
  ensureClinicalEncryption(runtimeConfig);
  const evolution = await getEvolutionOrThrow(repositories, evolutionId);

  if (evolution.status === "locked") {
    throw new AppError("Registro já está bloqueado.", 409);
  }

  const updated = await repositories.clinical.updateEvolution(evolutionId, {
    status: "locked",
    signedAt: evolution.signedAt || nowIso(),
    lockedAt: nowIso()
  });
  return serializeEvolutionSummary(updated, runtimeConfig);
}

async function createAddendum({ evolutionId, payload, adminUser, repositories, runtimeConfig }) {
  ensureClinicalEncryption(runtimeConfig);
  const parent = await getEvolutionOrThrow(repositories, evolutionId);

  const content = String(payload.content || "");
  if (!content.trim()) {
    throw new AppError("Informe o conteúdo do adendo/retificação.", 400);
  }

  const requestedType = payload.evolutionType === "correction" ? "correction" : "addendum";

  const addendum = await repositories.clinical.createEvolution({
    patientId: parent.patientId,
    sessionId: parent.sessionId || null,
    evolutionDate: nowIso(),
    evolutionType: requestedType,
    title: String(payload.title || "").slice(0, 160),
    encryptedContent: encryptClinicalText(content, runtimeConfig),
    contentHash: hashClinicalContent(content, runtimeConfig),
    status: "signed",
    parentEvolutionId: parent.id,
    createdByAdminId: adminUser?.sub || null,
    createdByAdminEmail: adminUser?.email || ""
  });

  // Marca o registro original como retificado, sem alterar o conteúdo. Um
  // registro bloqueado NÃO volta para "amended": isso desfazia o bloqueio e
  // deixava lockedAt preenchido junto de um status que dizia o contrário.
  // Para esses, o vínculo do adendo é o que sinaliza a retificação
  // (hasAmendments, calculado na listagem).
  if (parent.status === "signed") {
    await repositories.clinical.updateEvolution(parent.id, { status: "amended" });
  }

  return serializeEvolutionDetail(addendum, content, runtimeConfig);
}

async function exportEvolutionPdf({ evolutionId, repositories, runtimeConfig }) {
  ensureClinicalEncryption(runtimeConfig);
  const evolution = await getEvolutionOrThrow(repositories, evolutionId);
  const patient = await getPatientOrThrow(repositories, evolution.patientId);
  const settings = await repositories.clinic.getPlatformSettings();
  const { professionalName, crp } = getProfessionalInfo(settings);

  const content = evolution.encryptedContent
    ? decryptClinicalText(evolution.encryptedContent, runtimeConfig)
    : "";

  const buffer = await renderEvolutionPdf({
    professionalName,
    crp,
    patient,
    evolution: {
      evolutionDate: evolution.evolutionDate,
      evolutionType: evolution.evolutionType,
      title: evolution.title,
      status: evolution.status,
      parentEvolutionId: evolution.parentEvolutionId,
      content
    }
  });

  return { evolution, patient, buffer };
}

// ── Prontuário (resumo) ───────────────────────────────────────────────────────
async function getClinicalRecordSummary({ patientId, repositories, runtimeConfig }) {
  ensureClinicalEncryption(runtimeConfig);
  const patient = await getPatientOrThrow(repositories, patientId);

  const intake = await repositories.clinical.getIntakeByPatientId(patientId);
  const intakeVersionsCount = intake
    ? await repositories.clinical.countIntakeVersions(intake.id)
    : 0;
  const evolutionsCount = await repositories.clinical.countEvolutions(patientId);
  const latestEvolution = await repositories.clinical.getLatestEvolution(patientId);
  const evolutions = await repositories.clinical.listEvolutionsByPatientId(patientId);
  const { record, blocks, documentsCount } = await getRecordOverview({ patientId, repositories });
  const documents = record
    ? await repositories.clinical.listDocumentsByRecordId(record.id)
    : [];

  // Linha do tempo resumida (sem conteúdo clínico).
  const timeline = [];
  if (record) {
    timeline.push({
      type: "record_opened",
      label: "Prontuário aberto",
      date: record.openedAt
    });
  }
  for (const [blockType, bloco] of Object.entries(blocks)) {
    timeline.push({
      type: "block",
      blockType,
      label: `${BLOCK_LABELS[blockType] || blockType} — registrado`,
      status: bloco.status,
      date: bloco.createdAt
    });
    if (bloco.completedAt) {
      timeline.push({
        type: "block_completed",
        blockType,
        label: `${BLOCK_LABELS[blockType] || blockType} — concluído`,
        date: bloco.completedAt
      });
    }
  }
  if (intake) {
    timeline.push({
      type: "intake_created",
      label: "Anamnese criada",
      date: intake.createdAt
    });
    if (intake.completedAt) {
      timeline.push({
        type: "intake_completed",
        label: "Anamnese concluída",
        date: intake.completedAt
      });
    }
    if (intake.lockedAt) {
      timeline.push({
        type: "intake_locked",
        label: "Anamnese bloqueada",
        date: intake.lockedAt
      });
    }
  }
  for (const evolution of evolutions) {
    timeline.push({
      type: "evolution",
      evolutionId: evolution.id,
      label: EVOLUTION_TYPE_LABELS[evolution.evolutionType] || evolution.evolutionType,
      status: evolution.status,
      parentEvolutionId: evolution.parentEvolutionId || null,
      date: evolution.evolutionDate
    });
  }
  for (const documento of documents) {
    timeline.push({
      type: "document",
      documentId: documento.id,
      label: `${DOCUMENT_TYPE_LABELS[documento.documentType] || documento.documentType} — ${documento.documentNumber}`,
      status: documento.status,
      date: documento.issuedAt
    });
  }
  if (record && record.closedAt) {
    timeline.push({
      type: "record_closed",
      label: "Prontuário encerrado",
      date: record.closedAt
    });
  }
  timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return {
    patient: serializePatientMinimal(patient),
    record: serializeRecord(record),
    blocks,
    documentsCount,
    intake: intake ? serializeIntakeSummary(intake, intakeVersionsCount) : null,
    evolutionsCount,
    latestEvolution: latestEvolution ? serializeEvolutionSummary(latestEvolution, runtimeConfig) : null,
    timeline: timeline.slice(0, 40)
  };
}

async function exportClinicalRecordPdf({ patientId, repositories, runtimeConfig }) {
  ensureClinicalEncryption(runtimeConfig);
  const patient = await getPatientOrThrow(repositories, patientId);
  const settings = await repositories.clinic.getPlatformSettings();
  const { professionalName, crp } = getProfessionalInfo(settings);

  const intakeRow = await repositories.clinical.getIntakeByPatientId(patientId);
  const intake = intakeRow
    ? {
        status: intakeRow.status,
        payload: intakeRow.encryptedPayload
          ? decryptClinicalPayload(intakeRow.encryptedPayload, runtimeConfig)
          : buildDefaultPayload()
      }
    : null;

  // Prontuário, blocos e documentos entram na exportação: sem eles o PDF
  // continuaria sendo "anamnese mais evoluções", que é justamente o que fazia
  // o registro não parecer um prontuário.
  const record = await repositories.clinical.getRecordByPatientId(patientId);
  const blocks = {};
  let documents = [];
  if (record) {
    for (const bloco of await repositories.clinical.listBlocksForExport(record.id)) {
      blocks[bloco.blockType] = {
        status: bloco.status,
        payload: bloco.encryptedPayload
          ? decryptClinicalPayload(bloco.encryptedPayload, runtimeConfig)
          : buildDefaultPayload(bloco.blockType)
      };
    }
    documents = await repositories.clinical.listDocumentsByRecordId(record.id);
  }

  const evolutionRows = await repositories.clinical.listEvolutionsForExport(patientId);
  const evolutions = evolutionRows.map((evolution) => ({
    evolutionDate: evolution.evolutionDate,
    evolutionType: evolution.evolutionType,
    title: evolution.title,
    status: evolution.status,
    parentEvolutionId: evolution.parentEvolutionId,
    content: evolution.encryptedContent
      ? decryptClinicalText(evolution.encryptedContent, runtimeConfig)
      : ""
  }));

  const buffer = await renderClinicalRecordPdf({
    professionalName,
    crp,
    patient,
    record: serializeRecord(record),
    blocks,
    intake,
    evolutions,
    documents
  });

  return { patient, buffer };
}

module.exports = {
  EVOLUTION_TYPES,
  getClinicalRecordFootprint,
  createAddendum,
  createEvolution,
  createIntakeForPatient,
  completeIntake,
  exportClinicalRecordPdf,
  exportEvolutionPdf,
  exportIntakePdf,
  getClinicalRecordSummary,
  getEvolution,
  getIntakeForPatient,
  listEvolutions,
  lockEvolution,
  lockIntake,
  signEvolution,
  updateEvolution,
  updateIntake
};
