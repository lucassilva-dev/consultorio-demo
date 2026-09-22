const { createPostgresClinicalRepository } = require("./postgres-clinical-repository");
const { createSqliteClinicalRepository } = require("./sqlite-clinical-repository");

function createClinicalRepository(db) {
  if (db.kind === "postgres") {
    return createPostgresClinicalRepository(db);
  }

  return createSqliteClinicalRepository(db);
}

module.exports = {
  createClinicalRepository
};
