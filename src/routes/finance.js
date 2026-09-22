const { sanitizePlainText } = require("../lib/sanitize");
const { appendAuditLog } = require("../services/audit");
const { getRepositories } = require("./dependencies");
const { asyncRoute, sanitizeIdFilter, sanitizePeriodo } = require("./shared");

function sanitizeFinanceFilters(query = {}) {
  return {
    ...sanitizePeriodo(query),
    patientId: sanitizeIdFilter(query.patientId),
    paymentStatus: sanitizePlainText(query.paymentStatus || "")
  };
}

// Marca de ordem de bytes. Sem ela o Excel abre o CSV como Latin-1 e todo nome
// acentuado chega corrompido. Declarada por código para não virar um caractere
// invisível no meio do arquivo.
const BOM_UTF8 = String.fromCharCode(0xfeff);

function buildFinanceCsvRows(items = []) {
  const headers = [
    "id",
    "patientName",
    "scheduledAt",
    "durationMinutes",
    "status",
    "paymentStatus",
    "price",
    "paymentMethod",
    "paidAt",
    "meetingUrl"
  ];

  // Excel e LibreOffice tratam célula que começa com = + - @ (ou com tab/CR)
  // como fórmula e a executam ao abrir o arquivo. Nome de paciente é texto
  // livre, então prefixamos com apóstrofo, que a planilha lê como texto.
  const INICIOS_DE_FORMULA = ["=", "+", "-", "@"];
  const escapeCell = (value) => {
    const texto = String(value ?? "");
    const primeiroCodigo = texto.charCodeAt(0);
    const viraFormula =
      INICIOS_DE_FORMULA.includes(texto.charAt(0)) ||
      primeiroCodigo === 9 ||
      primeiroCodigo === 13;
    const neutro = viraFormula ? `'${texto}` : texto;
    return `"${neutro.split(`"`).join(`""`)}"`;
  };
  const rows = items.map((item) =>
    [
      item.id,
      item.patientName,
      item.scheduledAt,
      item.durationMinutes,
      item.status,
      item.paymentStatus,
      item.price,
      item.paymentMethod,
      item.paidAt,
      item.meetingUrl
    ]
      .map(escapeCell)
      .join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

function register(app, { requireAdminApi }) {
  app.get(
    "/api/admin/finance/summary",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const filters = sanitizeFinanceFilters(req.query);
      res.json({
        ok: true,
        data: {
          ...(await repositories.clinic.getFinanceSummary(filters)),
          filters
        }
      });
    })
  );

  app.get(
    "/api/admin/finance/export.csv",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const filters = sanitizeFinanceFilters(req.query);
      const items = await repositories.clinic.listFinanceSessions(filters);

      // O arquivo sai com nome de paciente e valor: é saída de dado pessoal e
      // precisa de rastro, como as demais leituras sensíveis.
      await appendAuditLog(repositories, req, {
        action: "finance_csv_exported",
        entityType: "finance",
        entityId: `${filters.year}-${filters.month}`,
        summary: "Financeiro exportado em CSV.",
        metadata: { month: filters.month, year: filters.year, linhas: items.length }
      });

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="financeiro.csv"');
      // BOM: sem ele o Excel lê o arquivo como Latin-1 e nome acentuado abre
      // corrompido, que é como a planilha chega na mão de quem usa.
      res.status(200).send(`${BOM_UTF8}${buildFinanceCsvRows(items)}`);
    })
  );
}

module.exports = {
  register
};
