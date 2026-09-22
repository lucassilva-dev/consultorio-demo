const { normalizeClinicFilterBoundary } = require("../lib/clinic-time");
const { sanitizeDateLike, sanitizePlainText } = require("../lib/sanitize");
const { getRepositories } = require("./dependencies");
const { asyncRoute, sanitizeBoundedInteger } = require("./shared");

function sanitizeAuditLogFilters(query = {}) {
  const page = sanitizeBoundedInteger(query.page, { min: 1, max: 1000000, fallback: 1 });
  const pageSize = sanitizeBoundedInteger(query.pageSize, { min: 1, max: 100, fallback: 20 });
  const date = sanitizeDateLike(query.date || "");

  // A janela é montada pelo mesmo helper dos outros filtros: no fuso da clínica
  // (a lista é exibida nele) e devolvendo "" para data malformada. Antes, um
  // ?date=qualquer-coisa derrubava a rota inteira com RangeError.
  const dateFrom = normalizeClinicFilterBoundary(date, "start");
  const dateTo = normalizeClinicFilterBoundary(date, "end");

  return {
    action: sanitizePlainText(query.action || ""),
    entityType: sanitizePlainText(query.entityType || ""),
    adminEmail: sanitizePlainText(query.adminEmail || ""),
    date: dateFrom ? date : "",
    dateFrom,
    dateTo,
    page,
    pageSize
  };
}

function register(app, { requireAdminApi }) {
  app.get(
    "/api/admin/audit-logs",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const filters = sanitizeAuditLogFilters(req.query);
      const result = await repositories.phase2.listAuditLogs(filters);
      res.json({
        ok: true,
        data: result,
        meta: {
          filters: {
            action: filters.action,
            entityType: filters.entityType,
            adminEmail: filters.adminEmail,
            date: filters.date,
            page: filters.page,
            pageSize: filters.pageSize
          }
        }
      });
    })
  );
}

module.exports = {
  register
};
