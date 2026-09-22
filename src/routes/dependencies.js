const {
  ensurePostgresAdminSessionSchema,
  ensurePostgresCheckConstraintsSchema,
  ensurePostgresClinicalRecordSchema,
  ensurePostgresClinicalSchema,
  ensurePostgresPhase2Schema,
  ensurePostgresReceiptSequenceSchema,
  ensurePostgresSecurityAuditSchema,
  hasPendingPostgresMigrations,
  runMigrations
} = require("../db/run-migrations");
const { createDatabase, createMigrationDatabase } = require("../db/database");
const { createAdminRepository } = require("../repositories/admin-repository");
const { createClinicRepository } = require("../repositories/clinic-repository");
const { createClinicalRepository } = require("../repositories/clinical-repository");
const { createPhase2Repository } = require("../repositories/phase2-repository");
const { createSiteRepository } = require("../repositories/site-repository");
const { ensureAdminUser, ensureUploadDirectory } = require("../services/bootstrap");
const { createGoogleCalendarService } = require("../services/google-calendar");
const { createGoogleCalendarSyncService } = require("../services/google-calendar-sync");
const { AppError } = require("../lib/errors");

function createRepositories(db, runtimeConfig) {
  return {
    admins: createAdminRepository(db),
    site: createSiteRepository(db),
    clinic: createClinicRepository(db),
    clinical: createClinicalRepository(db),
    phase2: createPhase2Repository(db, runtimeConfig)
  };
}

function createServices(runtimeConfig, overrides = {}) {
  const googleCalendarApi = overrides.googleCalendarService || createGoogleCalendarService(runtimeConfig);

  return {
    googleCalendarApi,
    googleCalendarSync: createGoogleCalendarSyncService(runtimeConfig, googleCalendarApi)
  };
}

function shouldLogBootstrap(runtimeConfig) {
  return runtimeConfig.isProduction || process.env.DEBUG_BOOTSTRAP === "true";
}

async function runBootstrapStep(runtimeConfig, step, action) {
  const startedAt = Date.now();

  if (shouldLogBootstrap(runtimeConfig)) {
    console.info("[BOOTSTRAP]", { step, status: "start" });
  }

  try {
    const result = await action();

    if (shouldLogBootstrap(runtimeConfig)) {
      console.info("[BOOTSTRAP]", {
        step,
        status: "done",
        durationMs: Date.now() - startedAt
      });
    }

    return result;
  } catch (error) {
    console.error("[BOOTSTRAP]", {
      step,
      status: "failed",
      durationMs: Date.now() - startedAt,
      message: error.message,
      name: error.name
    });
    throw error;
  }
}

async function createAppDependencies(runtimeConfig, serviceOverrides = {}) {
  const db = createDatabase(runtimeConfig);

  try {
    return await bootstrapDependencies(db, runtimeConfig, serviceOverrides);
  } catch (error) {
    // O chamador zera a promessa memoizada quando o boot falha, para tentar de
    // novo no próximo request. Sem fechar aqui, cada tentativa deixaria uma
    // conexão pendurada.
    await closeDatabaseQuietly(db);
    throw error;
  }
}

async function closeDatabaseQuietly(db) {
  try {
    if (typeof db?.end === "function") {
      await db.end({ timeout: 5 });
    } else if (typeof db?.close === "function") {
      db.close();
    }
  } catch (error) {
    // Fechar é melhor esforço: o erro original é o que importa propagar.
  }
}

async function bootstrapDependencies(db, runtimeConfig, serviceOverrides) {

  if (runtimeConfig.dataProvider === "postgres" && runtimeConfig.runDatabaseMigrationsOnBoot) {
    // Verifica migrações pendentes na conexão principal (pooler, confiável)
    // ANTES de abrir a conexão de migração. A conexão de migração pode apontar
    // para o endpoint non-pooling/direto, que é instável a partir de serverless
    // e, quando lento, trava o boot (e com isso toda rota que depende do banco).
    // No caso normal (tudo aplicado) pulamos essa conexão por completo.
    const pending = await runBootstrapStep(runtimeConfig, "postgres-migrations-check", () =>
      hasPendingPostgresMigrations(db)
    );

    if (pending) {
      const migrationDb = createMigrationDatabase(runtimeConfig);
      try {
        await runBootstrapStep(runtimeConfig, "postgres-migrations", () => runMigrations(migrationDb));
      } finally {
        await migrationDb.end({ timeout: 5 });
      }
    } else if (shouldLogBootstrap(runtimeConfig)) {
      console.info("[BOOTSTRAP]", {
        step: "postgres-migrations",
        status: "skipped-already-applied"
      });
    }
  } else if (runtimeConfig.dataProvider === "postgres" && shouldLogBootstrap(runtimeConfig)) {
    console.info("[BOOTSTRAP]", {
      step: "postgres-migrations",
      status: "skipped"
    });
  }

  if (runtimeConfig.dataProvider === "postgres" && !runtimeConfig.runDatabaseMigrationsOnBoot) {
    await runBootstrapStep(runtimeConfig, "postgres-phase2-compat", () =>
      ensurePostgresPhase2Schema(db)
    );
    await runBootstrapStep(runtimeConfig, "postgres-security-audit-compat", () =>
      ensurePostgresSecurityAuditSchema(db)
    );
    await runBootstrapStep(runtimeConfig, "postgres-clinical-compat", () =>
      ensurePostgresClinicalSchema(db)
    );
    await runBootstrapStep(runtimeConfig, "postgres-receipt-sequence-compat", () =>
      ensurePostgresReceiptSequenceSchema(db)
    );
    await runBootstrapStep(runtimeConfig, "postgres-admin-session-compat", () =>
      ensurePostgresAdminSessionSchema(db)
    );
    await runBootstrapStep(runtimeConfig, "postgres-check-constraints-compat", () =>
      ensurePostgresCheckConstraintsSchema(db)
    );
    await runBootstrapStep(runtimeConfig, "postgres-clinical-record-compat", () =>
      ensurePostgresClinicalRecordSchema(db)
    );
  }
  if (runtimeConfig.dataProvider !== "postgres") {
    await runBootstrapStep(runtimeConfig, "sqlite-migrations", () => runMigrations(db));
  }
  const repositories = createRepositories(db, runtimeConfig);
  const services = createServices(runtimeConfig, serviceOverrides);
  await runBootstrapStep(runtimeConfig, "site-seed-defaults", () => repositories.site.seedDefaults());
  await runBootstrapStep(runtimeConfig, "clinic-seed-defaults", () =>
    repositories.clinic.seedDefaults()
  );
  await runBootstrapStep(runtimeConfig, "storage-ready", () => ensureUploadDirectory(runtimeConfig));
  await runBootstrapStep(runtimeConfig, "admin-ready", () =>
    ensureAdminUser(repositories.admins, runtimeConfig)
  );

  if (shouldLogBootstrap(runtimeConfig)) {
    console.info("[BOOTSTRAP]", { status: "complete" });
  }

  return { db, repositories, services };
}

// Garante que uma promessa não fique pendente para sempre. Em serverless, um
// boot pendurado bloquearia TODAS as requisições concorrentes da instância até
// o 504 do Vercel. Aqui ele falha rápido (e o chamador reseta para tentar de
// novo no próximo request).
function withTimeout(promise, ms, message) {
  if (!ms || ms <= 0) {
    return promise;
  }

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new AppError(message, 503)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function resolveDependencies(app) {
  if (app.locals.dependencies) {
    return app.locals.dependencies;
  }

  if (!app.locals.dependenciesPromise) {
    // withTimeout rejeita, mas a criação continua correndo por baixo e acaba
    // devolvendo um db que ninguém mais referencia. Sem este encadeamento, cada
    // boot que estoura o tempo deixa uma conexão pendurada.
    const criacao = createAppDependencies(
      app.locals.runtimeConfig,
      app.locals.serviceOverrides
    );
    let expirou = false;

    criacao
      .then((dependencies) => {
        if (expirou) {
          return closeDatabaseQuietly(dependencies.db);
        }
        return null;
      })
      .catch(() => null);

    app.locals.dependenciesPromise = withTimeout(
      criacao,
      app.locals.runtimeConfig.bootTimeoutMs,
      "Inicialização do servidor excedeu o tempo limite. Tente novamente em instantes."
    )
      .then((dependencies) => {
        app.locals.dependencies = dependencies;
        return dependencies;
      })
      .catch((error) => {
        expirou = true;
        app.locals.dependenciesPromise = null;
        throw error;
      });
  }

  return app.locals.dependenciesPromise;
}

async function getRepositories(req) {
  const dependencies = await resolveDependencies(req.app);
  return dependencies.repositories;
}

async function getServices(req) {
  const dependencies = await resolveDependencies(req.app);
  return dependencies.services;
}

module.exports = {
  getRepositories,
  getServices,
  resolveDependencies
};
