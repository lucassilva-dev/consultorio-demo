const { DEFAULT_PLATFORM_SETTINGS } = require("../default-clinic-data");
const { getClinicMonthRange, getClinicWeekRange } = require("../lib/clinic-time");

function nowIso() {
  return new Date().toISOString();
}

function toIntegerOrNull(value) {
  if (value === "" || value === null || typeof value === "undefined") {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mergePlatformSettings(payload = {}) {
  return {
    ...DEFAULT_PLATFORM_SETTINGS,
    ...(payload || {})
  };
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value === "true" || value === "1" || value === "on") {
      return true;
    }
    if (value === "false" || value === "0" || value === "off") {
      return false;
    }
  }

  if (typeof value === "number") {
    return value === 1;
  }

  return fallback;
}

function normalizePlatformSettings(payload = {}) {
  const merged = mergePlatformSettings(payload);
  return {
    ...merged,
    showSchedulingButton: normalizeBoolean(merged.showSchedulingButton, false),
    googleCalendarEnabled: normalizeBoolean(merged.googleCalendarEnabled, false),
    googleCalendarCreateMeet: normalizeBoolean(merged.googleCalendarCreateMeet, false),
    googleCalendarSendUpdates: normalizeBoolean(merged.googleCalendarSendUpdates, false),
    googleCalendarReminderMinutes: toIntegerOrNull(merged.googleCalendarReminderMinutes) ?? 1440
  };
}

// Relatórios são fechados pelo calendário da clínica, não pelo do servidor.
// Com a janela em UTC, uma sessão de 30/06 às 21h (gravada como 01/07T00:00Z)
// caía no fechamento de julho.
// Busca por texto usa LIKE/ILIKE. Sem escapar, os curingas do próprio LIKE
// vazam da caixa de busca: digitar "%" lista todo mundo e "_" casa qualquer
// caractere. O caractere de escape também precisa ser escapado.
const LIKE_ESCAPE_CHAR = String.fromCharCode(92);
const LIKE_ESCAPE_CLAUSE = `ESCAPE '${LIKE_ESCAPE_CHAR}'`;

function buildLikePattern(term) {
  const texto = String(term ?? "");
  let escapado = "";
  for (const caractere of texto) {
    if (caractere === LIKE_ESCAPE_CHAR || caractere === "%" || caractere === "_") {
      escapado += LIKE_ESCAPE_CHAR;
    }
    escapado += caractere;
  }
  return `%${escapado}%`;
}

function getMonthRange(year, month) {
  return getClinicMonthRange(year, month);
}

function getWeekRange(referenceDate = new Date()) {
  return getClinicWeekRange(referenceDate);
}

function inferPatientTypeFromLead(interest) {
  if (interest === "responsavel_adolescente") {
    return "adolescente";
  }

  if (["adulto", "adolescente", "jovem_adulto"].includes(interest)) {
    return interest;
  }

  return "adulto";
}

function requiresGuardianForPatientType(patientType) {
  return patientType === "adolescente";
}

function leadNeedsGuardianData(lead) {
  return ["adolescente", "responsavel_adolescente"].includes(lead?.interest);
}

function buildPatientFromLead(lead, overrides = {}, camposEnviados = null) {
  // O formulário de conversão manda só os campos que ele mostra (responsável,
  // por exemplo), mas a sanitização monta o objeto completo com string vazia
  // no resto. Espalhar isso cru zerava nome, telefone, tipo e modalidade
  // vindos do lead.
  //
  // O critério é a chave ter vindo no corpo — não o valor estar preenchido.
  // Assim continua sendo possível enviar email: "" de propósito para apagar.
  const permitidas = camposEnviados ? new Set(camposEnviados) : null;
  const informados = Object.fromEntries(
    Object.entries(overrides).filter(([chave, valor]) => {
      if (permitidas) {
        return permitidas.has(chave);
      }
      return valor !== null && valor !== undefined;
    })
  );

  return {
    fullName: lead.name,
    preferredName: lead.name.split(/\s+/)[0] || lead.name,
    birthDate: "",
    age: lead.age ?? null,
    phone: lead.phone,
    email: lead.email || "",
    patientType: inferPatientTypeFromLead(lead.interest),
    guardianName: "",
    guardianPhone: "",
    sessionPrice: 0,
    defaultWeekday: "",
    defaultTime: "",
    modality: "online",
    status: "ativo",
    administrativeNote: lead.administrativeNote
      ? `Lead convertido: ${lead.administrativeNote}`
      : "Paciente criado a partir de contato interessado.",
    ...informados
  };
}

module.exports = {
  LIKE_ESCAPE_CLAUSE,
  buildLikePattern,
  nowIso,
  toIntegerOrNull,
  toNumber,
  mergePlatformSettings,
  normalizePlatformSettings,
  getMonthRange,
  getWeekRange,
  buildPatientFromLead,
  requiresGuardianForPatientType,
  leadNeedsGuardianData
};
