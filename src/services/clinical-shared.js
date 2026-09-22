const { AppError } = require("../lib/errors");
const { requireClinicalKey } = require("../lib/clinical-crypto");
const { DEFAULT_PLATFORM_SETTINGS } = require("../default-clinic-data");

// Helpers usados pelos três serviços clínicos (anamnese e evoluções em
// clinical.js, prontuário em clinical-record.js, documentos em
// clinical-documents.js). Vivem aqui, e não em clinical.js, porque o resumo do
// prontuário precisa dos três — e o require cruzado seria circular.

function nowIso() {
  return new Date().toISOString();
}

// Garante que conteúdo clínico só seja manipulado com chave de criptografia
// válida (bloqueia rotas clínicas em produção sem TOKEN_ENCRYPTION_KEY).
function ensureClinicalEncryption(runtimeConfig) {
  requireClinicalKey(runtimeConfig);
}

function editWindowEndsAt(createdAt, runtimeConfig) {
  const hours = Number(runtimeConfig.clinicalRecordEditWindowHours);
  if (!Number.isFinite(hours) || hours <= 0) {
    return "";
  }
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) {
    return "";
  }
  return new Date(created + hours * 3600 * 1000).toISOString();
}

function withinEditWindow(createdAt, runtimeConfig) {
  const hours = Number(runtimeConfig.clinicalRecordEditWindowHours);
  if (!Number.isFinite(hours) || hours <= 0) {
    return true;
  }
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) {
    return true;
  }
  return Date.now() - created <= hours * 3600 * 1000;
}

async function getPatientOrThrow(repositories, patientId) {
  const patient = await repositories.clinic.getPatientById(patientId);
  if (!patient) {
    throw new AppError("Paciente não encontrado.", 404);
  }
  return patient;
}

function getProfessionalInfo(settings) {
  return {
    professionalName: settings?.professionalName || DEFAULT_PLATFORM_SETTINGS.professionalName,
    crp: settings?.crp || DEFAULT_PLATFORM_SETTINGS.crp
  };
}

function serializePatientMinimal(patient) {
  return {
    id: patient.id,
    fullName: patient.fullName,
    preferredName: patient.preferredName || "",
    patientType: patient.patientType,
    modality: patient.modality,
    status: patient.status,
    phone: patient.phone || "",
    email: patient.email || "",
    createdAt: patient.createdAt
  };
}

module.exports = {
  editWindowEndsAt,
  ensureClinicalEncryption,
  getPatientOrThrow,
  getProfessionalInfo,
  nowIso,
  serializePatientMinimal,
  withinEditWindow
};
