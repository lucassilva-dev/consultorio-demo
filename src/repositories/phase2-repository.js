const { createPostgresPhase2Repository } = require("./postgres-phase2-repository");
const { createSqlitePhase2Repository } = require("./sqlite-phase2-repository");

function createPhase2Repository(db, runtimeConfig) {
  if (db.kind === "postgres") {
    return createPostgresPhase2Repository(db, runtimeConfig);
  }

  return createSqlitePhase2Repository(db, runtimeConfig);
}

module.exports = {
  createPhase2Repository
};
