const crypto = require("crypto");

const PASSWORD_DIGEST = "sha256";
const PASSWORD_KEY_LENGTH = 32;
const PASSWORD_ITERATIONS = 310000;
const PASSWORD_SCHEME = "pbkdf2";

function hashPassword(password, iterations = PASSWORD_ITERATIONS) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .pbkdf2Sync(password, salt, iterations, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST)
    .toString("hex");

  return {
    hash,
    salt,
    iterations
  };
}

function serializePasswordRecord(record) {
  return [
    PASSWORD_SCHEME,
    PASSWORD_DIGEST,
    String(record.iterations),
    record.salt,
    record.hash
  ].join("$");
}

function parseSerializedPasswordRecord(value) {
  const [scheme, digest, iterations, salt, hash] = String(value || "").trim().split("$");

  if (
    scheme !== PASSWORD_SCHEME ||
    digest !== PASSWORD_DIGEST ||
    !iterations ||
    !salt ||
    !hash
  ) {
    throw new Error("Formato inválido para ADMIN_PASSWORD_HASH.");
  }

  const parsedIterations = Number(iterations);
  if (!Number.isInteger(parsedIterations) || parsedIterations < 100000) {
    throw new Error("Iterações inválidas em ADMIN_PASSWORD_HASH.");
  }

  if (!/^[a-f0-9]{32}$/i.test(salt) || !/^[a-f0-9]{64}$/i.test(hash)) {
    throw new Error("Salt ou hash inválidos em ADMIN_PASSWORD_HASH.");
  }

  return {
    password_hash: hash.toLowerCase(),
    password_salt: salt.toLowerCase(),
    password_iterations: parsedIterations
  };
}

function verifyPassword(password, record) {
  const candidateHash = crypto
    .pbkdf2Sync(
      password,
      record.password_salt,
      record.password_iterations,
      PASSWORD_KEY_LENGTH,
      PASSWORD_DIGEST
    )
    .toString("hex");

  return crypto.timingSafeEqual(
    Buffer.from(candidateHash, "hex"),
    Buffer.from(record.password_hash, "hex")
  );
}

// Registro descartável com o mesmo custo de derivação do real. Serve para
// gastar o mesmo tempo quando o e-mail não existe: sem isso, a resposta
// instantânea denuncia qual é o e-mail administrativo válido.
//
// Calculado UMA vez e reaproveitado. Construir a isca a cada tentativa rodava
// um PBKDF2 só para montá-la, mais outro para verificá-la: o caminho
// "e-mail não existe" custava o dobro do caminho "e-mail existe", e o oráculo
// continuava aberto — apenas invertido.
const decoyPorIteracoes = new Map();

function buildDecoyPasswordRecord(iterations = PASSWORD_ITERATIONS) {
  const cacheado = decoyPorIteracoes.get(iterations);
  if (cacheado) {
    return cacheado;
  }

  const record = hashPassword(crypto.randomBytes(16).toString("hex"), iterations);
  const isca = {
    password_salt: record.salt,
    password_hash: record.hash,
    password_iterations: record.iterations
  };
  decoyPorIteracoes.set(iterations, isca);
  return isca;
}

module.exports = {
  PASSWORD_ITERATIONS,
  buildDecoyPasswordRecord,
  hashPassword,
  parseSerializedPasswordRecord,
  serializePasswordRecord,
  verifyPassword
};
