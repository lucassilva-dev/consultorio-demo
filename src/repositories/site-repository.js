const { createPostgresSiteRepository } = require("./postgres-site-repository");
const { createSqliteSiteRepository } = require("./sqlite-site-repository");

function createSiteRepository(db) {
  if (db.kind === "postgres") {
    return createPostgresSiteRepository(db);
  }

  return createSqliteSiteRepository(db);
}

module.exports = {
  createSiteRepository
};
