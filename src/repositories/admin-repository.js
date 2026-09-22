const { createPostgresAdminRepository } = require("./postgres-admin-repository");
const { createSqliteAdminRepository } = require("./sqlite-admin-repository");

function createAdminRepository(db) {
  if (db.kind === "postgres") {
    return createPostgresAdminRepository(db);
  }

  return createSqliteAdminRepository(db);
}

module.exports = {
  createAdminRepository
};
