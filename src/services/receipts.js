const { AppError } = require("../lib/errors");
const { OPTION_LABELS } = require("../lib/clinic-options");
const { DEFAULT_PLATFORM_SETTINGS } = require("../default-clinic-data");
const { deletePrivateDocument, persistPrivateDocument, readPrivateDocument } = require("./storage");
const { renderReceiptPdf } = require("./receipt-pdf");

const DEFAULT_NOTICE_TEXT =
  "Este recibo não substitui nota fiscal nem documento fiscal equivalente.";
const DEFAULT_SERVICE_DESCRIPTION = "Atendimento psicológico";

function formatReceiptNumber(sequenceNumber) {
  return `REC-${String(sequenceNumber).padStart(6, "0")}`;
}

function buildReceiptDeliveryMessage(receipt) {
  const date = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(
    new Date(receipt.sessionDate)
  );
  return `Olá. Segue o recibo referente ao atendimento psicológico realizado em ${date}.`;
}

async function generateReceiptForSession({ sessionId, force = false, repositories, runtimeConfig }) {
  const session = await repositories.clinic.getSessionById(sessionId);
  if (!session) {
    throw new AppError("Sessão não encontrada.", 404);
  }

  if (session.paymentStatus !== "pago") {
    throw new AppError("Só é possível gerar recibo para sessão com pagamento marcado como pago.", 400);
  }

  const patient = await repositories.clinic.getPatientById(session.patientId);
  if (!patient) {
    throw new AppError("Paciente da sessão não encontrado.", 404);
  }

  const existingReceipt = await repositories.phase2.getReceiptBySessionId(sessionId);
  if (existingReceipt && !force) {
    return {
      receipt: existingReceipt,
      reused: true,
      deliveryMessage: buildReceiptDeliveryMessage(existingReceipt)
    };
  }

  const settings = await repositories.clinic.getPlatformSettings();
  const professionalName =
    settings.professionalName || DEFAULT_PLATFORM_SETTINGS.professionalName;
  const crp = settings.crp || DEFAULT_PLATFORM_SETTINGS.crp;

  if (!professionalName || !crp) {
    throw new AppError(
      "Configure nome profissional e CRP na agenda/admin antes de gerar recibos.",
      400
    );
  }

  const sequenceNumber = existingReceipt?.sequenceNumber || (await repositories.phase2.getNextReceiptSequence());
  const receiptNumber = existingReceipt?.receiptNumber || formatReceiptNumber(sequenceNumber);
  const paymentDate = repositories.clinic.getReceivedAtValue(session);
  const receiptPayload = {
    sessionId: session.id,
    patientId: patient.id,
    receiptNumber,
    sequenceNumber,
    professionalName,
    crp,
    professionalDocument: settings.professionalDocument || "",
    receiptCity: settings.receiptCity || "",
    receiptFooterText: settings.receiptFooterText || DEFAULT_NOTICE_TEXT,
    patientName: patient.fullName,
    payerName: patient.guardianName || "",
    payerDocument: "",
    sessionDate: session.scheduledAt,
    paymentDate,
    amount: session.price,
    paymentMethod: session.paymentMethod,
    paymentMethodLabel:
      OPTION_LABELS.paymentMethod[session.paymentMethod] || session.paymentMethod,
    serviceDescription: DEFAULT_SERVICE_DESCRIPTION,
    noticeText: DEFAULT_NOTICE_TEXT
  };

  const pdfBuffer = await renderReceiptPdf(receiptPayload);
  const storedDocument = await persistPrivateDocument(pdfBuffer, runtimeConfig, {
    folder: "receipts",
    extension: ".pdf",
    contentType: "application/pdf"
  });

  // Grava o registro apontando para o arquivo novo ANTES de remover o antigo.
  // Na ordem inversa, uma falha no insert deixava o banco apontando para um PDF
  // já apagado — o recibo existia na listagem e não abria mais.
  const savedReceipt = await repositories.phase2.saveReceipt({
    ...receiptPayload,
    fileStorageProvider: storedDocument.storageProvider,
    fileObjectKey: storedDocument.objectKey,
    fileContentType: storedDocument.contentType,
    fileSizeBytes: storedDocument.sizeBytes
  });

  if (
    existingReceipt?.fileObjectKey &&
    existingReceipt.fileObjectKey !== storedDocument.objectKey
  ) {
    // Limpeza do arquivo substituído: melhor esforço, já com o registro salvo.
    try {
      await deletePrivateDocument(
        existingReceipt.fileObjectKey,
        runtimeConfig,
        existingReceipt.fileStorageProvider
      );
    } catch (error) {
      console.warn("[RECEIPT]", {
        receiptNumber,
        message: "PDF anterior não pôde ser removido do storage."
      });
    }
  }

  return {
    receipt: savedReceipt,
    reused: false,
    deliveryMessage: buildReceiptDeliveryMessage(savedReceipt)
  };
}

async function downloadReceiptById({ receiptId, repositories, runtimeConfig }) {
  const receipt = await repositories.phase2.getReceiptById(receiptId);
  if (!receipt) {
    throw new AppError("Recibo não encontrado.", 404);
  }

  const buffer = await readPrivateDocument(
    receipt.fileObjectKey,
    runtimeConfig,
    receipt.fileStorageProvider
  );

  return {
    receipt,
    buffer
  };
}

module.exports = {
  buildReceiptDeliveryMessage,
  downloadReceiptById,
  formatReceiptNumber,
  generateReceiptForSession
};
