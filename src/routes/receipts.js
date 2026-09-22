const { getMonthRange } = require("../repositories/clinic-repository-helpers");
const { downloadReceiptById, generateReceiptForSession } = require("../services/receipts");
const { getClinicDateParts } = require("../lib/clinic-time");
const { sanitizeNumericLike, sanitizePlainText } = require("../lib/sanitize");
const { AppError } = require("../lib/errors");
const { appendAuditLog } = require("../services/audit");
const { getRepositories } = require("./dependencies");
const { asyncRoute, parseEntityId, sanitizeIdFilter, sanitizePeriodo } = require("./shared");

// Regime de apuração do recibo:
//   "competencia" — mês do atendimento (session_date). É o padrão: o recibo
//                   de uma sessão de junho pertence a junho, mesmo que o
//                   pagamento entre depois.
//   "caixa"       — mês em que o pagamento entrou (payment_date).
const RECEIPT_BASES = ["competencia", "caixa"];

function sanitizeReceiptFilters(query = {}) {
  const basis = sanitizePlainText(query.basis || "");
  // month/year só entram como período quando foram pedidos: buildReceiptFilters
  // usa a ausência para decidir se recorta o mês.
  const pediuPeriodo = Boolean(sanitizeNumericLike(query.month)) || Boolean(sanitizeNumericLike(query.year));
  const periodo = pediuPeriodo ? sanitizePeriodo(query) : { month: "", year: "" };

  return {
    ...periodo,
    patientId: sanitizeIdFilter(query.patientId),
    sessionId: sanitizeIdFilter(query.sessionId),
    basis: RECEIPT_BASES.includes(basis) ? basis : "competencia"
  };
}

function buildReceiptFilters(rawFilters = {}) {
  const basis = rawFilters.basis === "caixa" ? "caixa" : "competencia";
  const filters = {
    patientId: rawFilters.patientId,
    sessionId: rawFilters.sessionId,
    basis
  };

  // Só recorta por mês quando o mês foi pedido. Antes, buscar por paciente ou
  // por sessão aplicava silenciosamente a janela do mês corrente e escondia
  // recibos de outros meses.
  const temPeriodo = Boolean(rawFilters.month) || Boolean(rawFilters.year);
  if (!temPeriodo) {
    return filters;
  }

  const hoje = getClinicDateParts();
  const year = Number(rawFilters.year) || hoje.year;
  const month = Number(rawFilters.month) || hoje.month;
  const range = getMonthRange(year, month);

  return {
    ...filters,
    dateFrom: range.start,
    dateTo: range.end
  };
}

function serializeReceiptForAdmin(receipt) {
  if (!receipt) {
    return null;
  }

  const {
    fileObjectKey,
    ...safeReceipt
  } = receipt;

  return safeReceipt;
}

function serializeReceiptListForAdmin(items = []) {
  return items.map(serializeReceiptForAdmin);
}

function parseBooleanFlag(value) {
  return value === true || value === "true" || value === "1" || value === 1;
}

function register(app, { runtimeConfig, requireAdminApi }) {
  app.get(
    "/api/admin/receipts",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const filters = sanitizeReceiptFilters(req.query);
      res.json({
        ok: true,
        data: {
          items: serializeReceiptListForAdmin(
            await repositories.phase2.listReceipts(buildReceiptFilters(filters))
          ),
          filters
        }
      });
    })
  );

  app.get(
    "/api/admin/receipts/:id",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Recibo");
      const receipt = await repositories.phase2.getReceiptById(id);
      if (!receipt) {
        throw new AppError("Recibo não encontrado.", 404);
      }

      res.json({
        ok: true,
        data: serializeReceiptForAdmin(receipt)
      });
    })
  );

  app.post(
    "/api/admin/sessions/:id/receipt",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Sessão");
      const result = await generateReceiptForSession({
        sessionId: id,
        force: parseBooleanFlag(req.body.force || req.query.force),
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "receipt_generated",
        entityType: "receipt",
        entityId: result.receipt.id,
        summary: result.reused ? "Recibo reutilizado." : "Recibo gerado.",
        metadata: {
          sessionId: result.receipt.sessionId,
          receiptNumber: result.receipt.receiptNumber,
          reused: result.reused
        }
      });

      res.status(result.reused ? 200 : 201).json({
        ok: true,
        data: serializeReceiptForAdmin(result.receipt),
        meta: {
          reused: result.reused,
          deliveryMessage: result.deliveryMessage
        }
      });
    })
  );

  app.get(
    "/api/admin/receipts/:id/download",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Recibo");
      const { receipt, buffer } = await downloadReceiptById({
        receiptId: id,
        repositories,
        runtimeConfig
      });

      res.setHeader("Content-Type", receipt.fileContentType || "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${receipt.receiptNumber.toLowerCase()}.pdf"`
      );
      await appendAuditLog(repositories, req, {
        action: "receipt_downloaded",
        entityType: "receipt",
        entityId: receipt.id,
        summary: "Recibo baixado.",
        metadata: {
          receiptNumber: receipt.receiptNumber,
          sessionId: receipt.sessionId
        }
      });
      res.status(200).send(buffer);
    })
  );
}

module.exports = {
  register
};
