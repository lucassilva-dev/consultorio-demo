const { AppError } = require("../lib/errors");

const BLOCKED_METADATA_KEYS = [
  /password/i,
  /secret/i,
  /token/i,
  /authorization/i,
  /cookie/i,
  /database[_-]?url/i,
  /supabase/i,
  /refresh[_-]?token/i,
  /access[_-]?token/i,
  /fileObjectKey/i,
  /administrativeNote/i,
  /content/i,
  /body/i,
  /message/i,
  /description/i,
  /text/i
];

function shouldBlockMetadataKey(key) {
  return BLOCKED_METADATA_KEYS.some((pattern) => pattern.test(String(key || "")));
}

function sanitizeAuditString(value, maxLength = 180) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function sanitizeAuditMetadata(value, depth = 0) {
  if (value === null || typeof value === "undefined") {
    return null;
  }

  if (depth > 3) {
    return "[truncated]";
  }

  if (typeof value === "string") {
    return sanitizeAuditString(value, 160);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 10).map((item) => sanitizeAuditMetadata(item, depth + 1));
  }

  if (typeof value === "object") {
    return Object.entries(value).reduce((accumulator, [key, entryValue]) => {
      if (shouldBlockMetadataKey(key)) {
        return accumulator;
      }

      const sanitizedValue = sanitizeAuditMetadata(entryValue, depth + 1);
      if (
        sanitizedValue === null ||
        typeof sanitizedValue === "undefined" ||
        sanitizedValue === ""
      ) {
        return accumulator;
      }

      accumulator[key] = sanitizedValue;
      return accumulator;
    }, {});
  }

  return sanitizeAuditString(value, 120);
}

// req.ip já resolve o encadeamento de proxies segundo a configuração de
// "trust proxy" do Express (definida em registerRoutes). Ler o primeiro item
// de X-Forwarded-For na mão contornava essa lógica: como o proxy *acrescenta*
// o IP real ao final da lista, o primeiro item é justamente o que o cliente
// mandou — bastava enviar o cabeçalho para gravar um IP falso na auditoria.
function getRequestIpAddress(req) {
  return sanitizeAuditString(req.ip || "", 80);
}

async function appendAuditLog(repositories, req, entry = {}) {
  if (!repositories?.phase2?.createAuditLog) {
    return;
  }

  try {
    const sanitizedMetadata = sanitizeAuditMetadata(entry.metadata) || {};
    await repositories.phase2.createAuditLog({
      adminUserId:
        typeof entry.adminUserId !== "undefined"
          ? entry.adminUserId
          : Number(req?.adminUser?.sub || 0) || null,
      adminEmail:
        sanitizeAuditString(entry.adminEmail || req?.adminUser?.email || "", 160) || "",
      action: sanitizeAuditString(entry.action, 80),
      entityType: sanitizeAuditString(entry.entityType, 80),
      entityId:
        typeof entry.entityId === "number" || typeof entry.entityId === "string"
          ? sanitizeAuditString(entry.entityId, 120)
          : "",
      summary: sanitizeAuditString(entry.summary, 220),
      metadata: Object.keys(sanitizedMetadata).length ? sanitizedMetadata : {},
      ipAddress: getRequestIpAddress(req),
      userAgent: sanitizeAuditString(req?.get("user-agent") || "", 240)
    });
  } catch (error) {
    console.error("[AUDIT_LOG_ERROR]", {
      action: sanitizeAuditString(entry.action, 80),
      entityType: sanitizeAuditString(entry.entityType, 80),
      message: error instanceof AppError ? error.message : "Falha ao persistir log de auditoria."
    });
  }
}

module.exports = {
  appendAuditLog,
  sanitizeAuditMetadata,
  sanitizeAuditString
};
