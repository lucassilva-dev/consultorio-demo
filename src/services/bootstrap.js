const { AppError } = require("../lib/errors");
const {
  hashPassword,
  parseSerializedPasswordRecord
} = require("../lib/password");
const { ensureStorageReady } = require("./storage");

async function ensureUploadDirectory(runtimeConfig) {
  if (runtimeConfig.storageProvider === "supabase") {
    await ensureStorageReady(runtimeConfig, { allowSoftFailure: true });
    return;
  }

  await ensureStorageReady(runtimeConfig);
}

async function ensureAdminUser(adminRepository, runtimeConfig) {
  if (!runtimeConfig.adminEmail) {
    return null;
  }

  const passwordRecord = resolveAdminPasswordRecord(runtimeConfig);
  const existingUser = await adminRepository.findByEmail(runtimeConfig.adminEmail);

  if (existingUser && !passwordRecord) {
    return existingUser;
  }

  if (!existingUser && !passwordRecord) {
    if (runtimeConfig.isProduction) {
      throw new AppError("Defina ADMIN_EMAIL e ADMIN_PASSWORD_HASH para produção.", 500);
    }
    return null;
  }

  if (existingUser) {
    const mudouASenha =
      existingUser.password_hash !== passwordRecord.password_hash ||
      existingUser.password_salt !== passwordRecord.password_salt;

    const atualizado = await adminRepository.syncAdminPasswordRecord(
      runtimeConfig.adminEmail,
      passwordRecord
    );

    // Quem troca a senha quer justamente cortar quem já estava dentro. Sem
    // incrementar o contador de sessão, o cookie anterior seguia válido pelos
    // 7 dias de validade do token.
    if (mudouASenha && atualizado && adminRepository.incrementSessionEpoch) {
      return adminRepository.incrementSessionEpoch(atualizado.id);
    }

    return atualizado;
  }

  return adminRepository.createAdminUserFromRecord(runtimeConfig.adminEmail, passwordRecord);
}

function resolveAdminPasswordRecord(runtimeConfig) {
  if (runtimeConfig.adminPasswordHash) {
    try {
      return parseSerializedPasswordRecord(runtimeConfig.adminPasswordHash);
    } catch (error) {
      throw new AppError(error.message, 500);
    }
  }

  if (!runtimeConfig.adminInitialPassword) {
    return null;
  }

  if (runtimeConfig.isProduction) {
    throw new AppError(
      "ADMIN_INITIAL_PASSWORD não é permitido em produção. Use ADMIN_PASSWORD_HASH.",
      500
    );
  }

  if (runtimeConfig.adminInitialPassword.length < runtimeConfig.adminInitialPasswordMinLength) {
    throw new AppError(
      `ADMIN_INITIAL_PASSWORD deve ter pelo menos ${runtimeConfig.adminInitialPasswordMinLength} caracteres para criar o administrador inicial.`,
      500
    );
  }

  return toPasswordRecord(hashPassword(runtimeConfig.adminInitialPassword));
}

function toPasswordRecord(record) {
  return {
    password_hash: record.hash,
    password_salt: record.salt,
    password_iterations: record.iterations
  };
}

module.exports = {
  ensureAdminUser,
  ensureUploadDirectory
};
