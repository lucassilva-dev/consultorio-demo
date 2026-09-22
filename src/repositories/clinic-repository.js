const { createPostgresClinicRepository } = require("./postgres-clinic-repository");
const { createSqliteClinicRepository } = require("./sqlite-clinic-repository");

function createClinicRepository(db) {
  if (db.kind === "postgres") {
    return createPostgresClinicRepository(db);
  }

  return createSqliteClinicRepository(db);
}

module.exports = {
  createClinicRepository
};
