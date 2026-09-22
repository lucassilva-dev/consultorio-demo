const { getRepositories } = require("./dependencies");
const { asyncRoute } = require("./shared");

function register(app, { requireAdminApi }) {
  app.get(
    "/api/admin/dashboard-summary",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      res.json({
        ok: true,
        data: await repositories.clinic.getDashboardSummary()
      });
    })
  );
}

module.exports = {
  register
};
