const crypto = require("crypto");
const { AppError } = require("./errors");
const { getTokenEncryptionKeyState } = require("./encryption");

// Conteúdo clínico (anamnese e evoluções) usa um prefixo próprio para deixar
// a intenção explícita e impedir mistura acidental com secrets do sistema.
const CLINICAL_PREFIX = "clin:v1";
const IV_LENGTH = 12;

function requireClinicalKey(runtimeConfig = {}) {
  const state = getTokenEncryptionKeyState(runtimeConfig);
  if (!state.valid) {
    throw new AppError(
      state.reason ||
        "TOKEN_ENCRYPTION_KEY é obrigatório para registrar conteúdo clínico criptografado.",
      500
    );
  }
  return state.key;
}

function hasClinicalEncryption(runtimeConfig = {}) {
  return getTokenEncryptionKeyState(runtimeConfig).valid;
}

function isEncryptedClinicalValue(value) {
  return String(value || "").startsWith(`${CLINICAL_PREFIX}:`);
}

function encryptClinicalText(plainText, runtimeConfig = {}) {
  const normalizedValue = String(plainText ?? "");
  const key = requireClinicalKey(runtimeConfig);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(normalizedValue, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    CLINICAL_PREFIX,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(":");
}

function decryptClinicalText(cipherText, runtimeConfig = {}) {
  const normalizedValue = String(cipherText || "");
  if (!normalizedValue) {
    return "";
  }

  if (!isEncryptedClinicalValue(normalizedValue)) {
    throw new AppError("Conteúdo clínico em formato inválido.", 500);
  }

  const key = requireClinicalKey(runtimeConfig);
  const parts = normalizedValue.split(":");
  // ["clin", "v1", iv, authTag, payload]. O payload pode ser string vazia:
  // cifrar texto em branco produz ciphertext de zero bytes, e tratá-lo como
  // "formato inválido" tornava o registro ilegível para sempre. Aqui só o
  // formato é checado; a autenticidade segue por conta do GCM em final().
  if (parts.length !== 5) {
    throw new AppError("Conteúdo clínico em formato inválido.", 500);
  }

  const [, , ivValue, authTagValue, encryptedValue] = parts;

  if (!ivValue || !authTagValue) {
    throw new AppError("Conteúdo clínico em formato inválido.", 500);
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivValue, "base64url")
  );
  decipher.setAuthTag(Buffer.from(authTagValue, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function encryptClinicalPayload(payload, runtimeConfig = {}) {
  return encryptClinicalText(JSON.stringify(payload ?? {}), runtimeConfig);
}

function decryptClinicalPayload(cipherText, runtimeConfig = {}) {
  const plain = decryptClinicalText(cipherText, runtimeConfig);
  if (!plain) {
    return {};
  }

  try {
    const parsed = JSON.parse(plain);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    throw new AppError("Conteúdo clínico corrompido.", 500);
  }
}

// HMAC com a chave, e não SHA-256 puro. O digest fica em claro na tabela, ao
// lado do texto cifrado: sem chave, ele funcionava como oráculo de igualdade
// (dá para testar se um conteúdo conhecido é o que está ali) e, para respostas
// curtas e previsíveis, como alvo de dicionário.
//
// Registros gravados antes disto mantêm o hash antigo. Nada no sistema compara
// hashes entre si, então a convivência não quebra nada.
function hashClinicalContent(value, runtimeConfig = {}) {
  const normalizedValue =
    typeof value === "string" ? value : JSON.stringify(value ?? {});

  const state = getTokenEncryptionKeyState(runtimeConfig);
  if (state.valid) {
    return crypto
      .createHmac("sha256", state.key)
      .update(normalizedValue, "utf8")
      .digest("hex");
  }

  // Sem chave configurada não há conteúdo clínico para gravar de qualquer
  // forma (requireClinicalKey barra antes); o retorno vazio evita gravar um
  // digest sem proteção por engano.
  return "";
}

module.exports = {
  CLINICAL_PREFIX,
  decryptClinicalPayload,
  decryptClinicalText,
  encryptClinicalPayload,
  encryptClinicalText,
  hasClinicalEncryption,
  hashClinicalContent,
  isEncryptedClinicalValue,
  requireClinicalKey
};
