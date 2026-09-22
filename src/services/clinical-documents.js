const { AppError } = require("../lib/errors");
const {
  decryptClinicalPayload,
  encryptClinicalPayload,
  hashClinicalContent
} = require("../lib/clinical-crypto");
const {
  ensureClinicalEncryption,
  getPatientOrThrow,
  getProfessionalInfo,
  nowIso
} = require("./clinical-shared");
const { DOCUMENT_TYPE_LABELS, renderDocumentPdf } = require("./clinical-pdf");
const { getRecordOrThrow } = require("./clinical-record");
const { persistPrivateDocument, readPrivateDocument } = require("./storage");
const { CLINICAL_DOCUMENT_TYPES } = require("../lib/clinic-options");

// Documentos psicológicos da Resolução CFP 006/2019. Mesmo desenho dos
// recibos: numeração própria que só avança, PDF no armazenamento privado e
// registro imutável — documento emitido não se edita, se revoga.

const DOCUMENT_TYPES = CLINICAL_DOCUMENT_TYPES;

const DOCUMENT_STATUS_LABELS = {
  issued: "Emitido",
  revoked: "Revogado"
};

function formatDocumentNumber(sequenceNumber) {
  return `DOC-${String(sequenceNumber).padStart(6, "0")}`;
}

function serializeDocumentSummary(document) {
  if (!document) {
    return null;
  }
  return {
    id: document.id,
    recordId: document.recordId,
    patientId: document.patientId,
    documentNumber: document.documentNumber || "",
    documentType: document.documentType,
    documentTypeLabel: DOCUMENT_TYPE_LABELS[document.documentType] || document.documentType,
    title: document.title || "",
    status: document.status,
    statusLabel: DOCUMENT_STATUS_LABELS[document.status] || document.status,
    issuedAt: document.issuedAt,
    revokedAt: document.revokedAt || "",
    revokeReason: document.revokeReason || "",
    createdByAdminEmail: document.createdByAdminEmail || "",
    createdAt: document.createdAt
  };
}

// O detalhe abre o conteúdo; a listagem nunca abre. É a mesma separação de
// evolução, e por isso a listagem não precisa nem tocar na chave.
function serializeDocumentDetail(document, content) {
  return {
    ...serializeDocumentSummary(document),
    content
  };
}

async function getDocumentOrThrow(repositories, documentId) {
  const document = await repositories.clinical.getDocumentById(documentId);
  if (!document) {
    throw new AppError("Documento não encontrado.", 404);
  }
  return document;
}

async function issueDocument({ recordId, payload, adminUser, repositories, runtimeConfig }) {
  ensureClinicalEncryption(runtimeConfig);
  const record = await getRecordOrThrow(repositories, recordId);
  const patient = await getPatientOrThrow(repositories, record.patientId);

  if (record.status === "closed") {
    throw new AppError(
      "Prontuário encerrado não emite documento novo. Reabra o prontuário para emitir.",
      409
    );
  }

  if (!DOCUMENT_TYPES.includes(payload.documentType)) {
    throw new AppError("Tipo de documento desconhecido.", 400);
  }

  const body = String(payload.body || "");
  if (!body.trim()) {
    throw new AppError("Informe o conteúdo do documento.", 400);
  }

  const settings = await repositories.clinic.getPlatformSettings();
  const { professionalName, crp } = getProfessionalInfo(settings);
  if (!professionalName || !crp) {
    throw new AppError(
      "Configure nome profissional e CRP nas configurações antes de emitir documentos.",
      400
    );
  }

  const content = {
    addressee: String(payload.addressee || ""),
    purpose: String(payload.purpose || ""),
    body,
    validUntil: String(payload.validUntil || "")
  };

  // O número entra no PDF, então é alocado antes de desenhar.
  const sequenceNumber = await repositories.clinical.getNextDocumentSequence();
  const documentNumber = formatDocumentNumber(sequenceNumber);
  const issuedAt = nowIso();

  const pdfBuffer = await renderDocumentPdf({
    professionalName,
    crp,
    patient,
    recordNumber: record.recordNumber,
    documentNumber,
    documentType: payload.documentType,
    title: payload.title || "",
    issuedAt,
    content,
    city: settings?.receiptCity || ""
  });

  const storedDocument = await persistPrivateDocument(pdfBuffer, runtimeConfig, {
    folder: "clinical-documents",
    extension: ".pdf",
    contentType: "application/pdf"
  });

  const created = await repositories.clinical.createDocument({
    recordId: record.id,
    patientId: record.patientId,
    documentNumber,
    sequenceNumber,
    documentType: payload.documentType,
    title: String(payload.title || "").slice(0, 160),
    encryptedContent: encryptClinicalPayload(content, runtimeConfig),
    contentHash: hashClinicalContent(content, runtimeConfig),
    issuedAt,
    fileStorageProvider: storedDocument.storageProvider,
    fileObjectKey: storedDocument.objectKey,
    fileContentType: storedDocument.contentType,
    fileSizeBytes: storedDocument.sizeBytes,
    createdByAdminId: adminUser?.sub || null,
    createdByAdminEmail: adminUser?.email || ""
  });

  return serializeDocumentDetail(created, content);
}

async function listDocuments({ recordId, repositories, runtimeConfig }) {
  ensureClinicalEncryption(runtimeConfig);
  const record = await getRecordOrThrow(repositories, recordId);
  const rows = await repositories.clinical.listDocumentsByRecordId(record.id);
  return rows.map(serializeDocumentSummary);
}

async function getDocument({ documentId, repositories, runtimeConfig }) {
  ensureClinicalEncryption(runtimeConfig);
  const document = await getDocumentOrThrow(repositories, documentId);
  const content = document.encryptedContent
    ? decryptClinicalPayload(document.encryptedContent, runtimeConfig)
    : {};
  return serializeDocumentDetail(document, content);
}

async function downloadDocument({ documentId, repositories, runtimeConfig }) {
  ensureClinicalEncryption(runtimeConfig);
  const document = await getDocumentOrThrow(repositories, documentId);

  if (!document.fileObjectKey) {
    throw new AppError("Este documento não tem arquivo associado.", 404);
  }

  const buffer = await readPrivateDocument(
    document.fileObjectKey,
    runtimeConfig,
    document.fileStorageProvider
  );

  return { document, buffer };
}

// Revogar não apaga: o documento continua no prontuário, marcado, com o motivo
// registrado. Um documento que saiu do consultório não deixa de ter existido.
async function revokeDocument({ documentId, reason, repositories, runtimeConfig }) {
  ensureClinicalEncryption(runtimeConfig);
  const document = await getDocumentOrThrow(repositories, documentId);

  if (document.status === "revoked") {
    throw new AppError("Este documento já está revogado.", 409);
  }

  const motivo = String(reason || "").trim();
  if (!motivo) {
    throw new AppError("Informe o motivo da revogação.", 400);
  }

  const revogado = await repositories.clinical.revokeDocument(documentId, {
    revokedAt: nowIso(),
    revokeReason: motivo.slice(0, 500)
  });

  return serializeDocumentSummary(revogado);
}

module.exports = {
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  downloadDocument,
  formatDocumentNumber,
  getDocument,
  issueDocument,
  listDocuments,
  revokeDocument,
  serializeDocumentSummary
};
