const crypto = require("crypto");
const { AppError } = require("./errors");

const SECRET_PREFIX = "enc:v1";
const LEGACY_SECRET_PREFIX = "encv1";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;

function getTokenEncryptionKeyState(runtimeConfig = {}) {
  const rawValue = String(runtimeConfig.tokenEncryptionKey || "").trim();

  if (!rawValue) {
    return {
      configured: false,
      valid: false,
      key: null,
      reason: "TOKEN_ENCRYPTION_KEY não configurado."
    };
  }

  try {
    const key = Buffer.from(rawValue, "base64");
    if (key.length !== KEY_LENGTH) {
      return {
        configured: true,
        valid: false,
        key: null,
        reason: "TOKEN_ENCRYPTION_KEY deve ser uma chave base64 com 32 bytes."
      };
    }

    return {
      configured: true,
      valid: true,
      key,
      reason: ""
    };
  } catch (error) {
    return {
      configured: true,
      valid: false,
      key: null,
      reason: "TOKEN_ENCRYPTION_KEY deve ser uma chave base64 válida."
    };
  }
}

function hasValidTokenEncryptionKey(runtimeConfig = {}) {
  return getTokenEncryptionKeyState(runtimeConfig).valid;
}

function requireTokenEncryptionKey(runtimeConfig = {}) {
  const state = getTokenEncryptionKeyState(runtimeConfig);
  if (!state.valid) {
    throw new AppError(
      state.reason || "TOKEN_ENCRYPTION_KEY é obrigatório para criptografar secrets.",
      500
    );
  }

  return state.key;
}

function deriveLegacyKey(secret) {
  return crypto.createHash("sha256").update(String(secret || "")).digest().subarray(0, KEY_LENGTH);
}

function isEncryptedSecret(value) {
  const normalizedValue = String(value || "");
  return (
    normalizedValue.startsWith(`${SECRET_PREFIX}:`) ||
    normalizedValue.startsWith(`${LEGACY_SECRET_PREFIX}:`)
  );
}

function encryptWithKey(value, key, prefix) {
  const normalizedValue = String(value || "");
  if (!normalizedValue) {
    return "";
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(normalizedValue, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    prefix,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(":");
}

function decryptWithKey(value, key, prefix) {
  const normalizedValue = String(value || "");
  if (!normalizedValue) {
    return "";
  }

  const parts = normalizedValue.split(":");
  const offset = prefix === SECRET_PREFIX ? 2 : 1;
  const ivValue = parts[offset];
  const authTagValue = parts[offset + 1];
  const encryptedValue = parts[offset + 2];

  if (!ivValue || !authTagValue || !encryptedValue) {
    throw new AppError("Secret criptografado em formato inválido.", 500);
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

function encryptSecret(plainText, runtimeConfig = {}) {
  const normalizedValue = String(plainText || "");
  if (!normalizedValue) {
    return "";
  }

  return encryptWithKey(normalizedValue, requireTokenEncryptionKey(runtimeConfig), SECRET_PREFIX);
}

function decryptSecret(cipherText, runtimeConfig = {}) {
  const normalizedValue = String(cipherText || "");
  if (!normalizedValue) {
    return "";
  }

  if (normalizedValue.startsWith(`${SECRET_PREFIX}:`)) {
    return decryptWithKey(normalizedValue, requireTokenEncryptionKey(runtimeConfig), SECRET_PREFIX);
  }

  if (normalizedValue.startsWith(`${LEGACY_SECRET_PREFIX}:`)) {
    if (!runtimeConfig.legacyTokenEncryptionSecret) {
      throw new AppError(
        "Token legado do Google Calendar encontrado sem secret antigo para descriptografia.",
        500
      );
    }

    return decryptWithKey(
      normalizedValue,
      deriveLegacyKey(runtimeConfig.legacyTokenEncryptionSecret),
      LEGACY_SECRET_PREFIX
    );
  }

  return normalizedValue;
}

module.exports = {
  decryptSecret,
  encryptSecret,
  getTokenEncryptionKeyState,
  hasValidTokenEncryptionKey,
  isEncryptedSecret
};
