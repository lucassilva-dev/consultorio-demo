const { config } = require("../src/config");
const { createMigrationDatabase } = require("../src/db/database");
const { runMigrations } = require("../src/db/run-migrations");

function fail(message) {
  console.error(`[migrate:prod] ${message}`);
  process.exit(1);
}

async function main() {
  if (!process.argv.includes("--yes")) {
    fail("Confirme a execução com `npm run migrate:prod -- --yes`.");
  }

  if (config.dataProvider !== "postgres") {
    fail("Este comando é destinado ao ambiente Postgres de produção.");
  }

  if (!config.databaseMigrationUrl) {
    fail("Defina MIGRATION_DATABASE_URL ou DATABASE_URL antes de rodar a migração.");
  }

  console.info("[migrate:prod] Iniciando migração controlada.", {
    nodeEnv: config.nodeEnv,
    dataProvider: config.dataProvider,
    usingDedicatedMigrationUrl: Boolean(process.env.MIGRATION_DATABASE_URL)
  });

  const db = createMigrationDatabase(config);

  try {
    await runMigrations(db);
    console.info("[migrate:prod] Migração concluída com sucesso.");
  } finally {
    if (db.kind === "postgres") {
      await db.end({ timeout: 5 });
    } else {
      db.close();
    }
  }
}

main().catch((error) => {
  console.error("[migrate:prod] Falha na migração.", {
    message: error.message,
    name: error.name
  });
  process.exit(1);
});
