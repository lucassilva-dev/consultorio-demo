const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const postgres = require("postgres");
const { config } = require("../config");
const { AppError } = require("../lib/errors");

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function createSqliteClient(databasePath = config.databasePath) {
  ensureParentDirectory(databasePath);
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.kind = "sqlite";
  return db;
}

function createPostgresClient(databaseUrl, runtimeConfig, options = {}) {
  if (!databaseUrl) {
    throw new AppError("DATABASE_URL deve ser definido para usar Postgres.", 500);
  }

  // statement_timeout: o Postgres cancela no servidor qualquer query que passe
  // do limite (incl. esperas por lock), evitando conexões penduradas para
  // sempre. idle_in_transaction_session_timeout: derruba transações abandonadas.
  const statementTimeoutMs =
    options.statementTimeoutMs ?? runtimeConfig.postgresStatementTimeoutMs ?? 12000;

  const sql = postgres(databaseUrl, {
    types: {
      bigint: {
        to: 20,
        from: [20],
        serialize: (valor) => String(valor),
        parse: (valor) => Number(valor)
      }
    },
    prepare: false,
    max: 1,
    idle_timeout: 10,
    connect_timeout: 8,
    max_lifetime: 60,
    ssl: runtimeConfig.isProduction ? runtimeConfig.postgresSslMode : undefined,
    connection: {
      statement_timeout: statementTimeoutMs,
      idle_in_transaction_session_timeout: statementTimeoutMs
    }
  });

  sql.kind = "postgres";
  return sql;
}

function createDatabase(runtimeConfig = config) {
  if (typeof runtimeConfig === "string") {
    return createSqliteClient(runtimeConfig);
  }

  if (runtimeConfig.dataProvider === "postgres") {
    return createPostgresClient(runtimeConfig.databaseUrl, runtimeConfig);
  }

  return createSqliteClient(runtimeConfig.databasePath);
}

function createMigrationDatabase(runtimeConfig = config) {
  if (typeof runtimeConfig === "string") {
    return createSqliteClient(runtimeConfig);
  }

  if (runtimeConfig.dataProvider === "postgres") {
    return createPostgresClient(runtimeConfig.databaseMigrationUrl, runtimeConfig, {
      statementTimeoutMs: runtimeConfig.postgresMigrationStatementTimeoutMs
    });
  }

  return createSqliteClient(runtimeConfig.databasePath);
}

module.exports = {
  createDatabase,
  createMigrationDatabase
};
