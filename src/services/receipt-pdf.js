const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { toPdfData } = require("../lib/pdf-text");
const { formatClinicDate } = require("../lib/clinic-time");

// Página A4 com margem de 56pt dos dois lados, como no desenho do recibo.
const LARGURA_UTIL = 595.28 - 56 * 2;

function formatDate(value) {
  return formatClinicDate(value, { dateStyle: "medium" }) || "—";
}

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number(value || 0));
}

// Quebra pela largura real da fonte, não por contagem de caracteres: nome em
// caixa alta ou texto de rodapé longo saíam desenhados fora da margem.
function wrapText(text, { font, size, larguraMaxima }) {
  const words = String(text || "")
    .split(new RegExp(String.fromCharCode(92) + "s+"))
    .filter(Boolean);
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (font.widthOfTextAtSize(nextLine, size) <= larguraMaxima) {
      currentLine = nextLine;
      continue;
    }

    if (currentLine) lines.push(currentLine);
    currentLine = word;
  }

  if (currentLine) lines.push(currentLine);
  return lines.length ? lines : [""];
}

async function renderReceiptPdf(rawData) {
  // Nome de paciente com acento decomposto (NFD) ou caractere fora do WinAnsi
  // fazia drawText lançar e o recibo inteiro falhar com 500.
  const data = toPdfData(rawData || {});
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]);
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const colors = {
    text: rgb(0.22, 0.16, 0.15),
    muted: rgb(0.46, 0.35, 0.3),
    accent: rgb(0.47, 0.14, 0.58)
  };

  let y = 790;
  const left = 56;
  const lineGap = 18;

  function drawLine(label, value) {
    page.drawText(label, {
      x: left,
      y,
      size: 10,
      font: boldFont,
      color: colors.muted
    });
    y -= 14;

    for (const line of wrapText(value, {
      font: regularFont,
      size: 11,
      larguraMaxima: LARGURA_UTIL
    })) {
      page.drawText(line, {
        x: left,
        y,
        size: 11,
        font: regularFont,
        color: colors.text
      });
      y -= 14;
    }

    y -= 6;
  }

  page.drawText("Recibo de pagamento", {
    x: left,
    y,
    size: 23,
    font: boldFont,
    color: colors.accent
  });

  y -= 34;

  page.drawText(`Recibo nº ${data.receiptNumber}`, {
    x: left,
    y,
    size: 12,
    font: boldFont,
    color: colors.text
  });

  y -= 30;

  drawLine("Profissional", data.professionalName);
  drawLine("CRP", data.crp);

  if (data.professionalDocument) {
    drawLine("Documento profissional", data.professionalDocument);
  }

  drawLine("Paciente", data.patientName);

  if (data.payerName) {
    drawLine("Responsável / pagador", data.payerName);
  }

  if (data.payerDocument) {
    drawLine("Documento do pagador", data.payerDocument);
  }

  drawLine("Data da sessão", formatDate(data.sessionDate));
  drawLine("Data do pagamento", formatDate(data.paymentDate));
  drawLine("Valor", formatCurrency(data.amount));
  drawLine("Forma de pagamento", data.paymentMethodLabel || data.paymentMethod);
  drawLine("Serviço", data.serviceDescription);

  const declaration = [
    `${data.professionalName}, inscrita no CRP ${data.crp},`,
    `declara ter recebido o valor de ${formatCurrency(data.amount)} referente a ${data.serviceDescription.toLowerCase()},`,
    `prestado${data.patientName ? ` para ${data.patientName}` : ""} em ${formatDate(data.sessionDate)}.`
  ].join(" ");

  page.drawText("Declaração", {
    x: left,
    y,
    size: 10,
    font: boldFont,
    color: colors.muted
  });
  y -= 16;

  for (const line of wrapText(declaration, {
    font: regularFont,
    size: 11,
    larguraMaxima: LARGURA_UTIL
  })) {
    page.drawText(line, {
      x: left,
      y,
      size: 11,
      font: regularFont,
      color: colors.text
    });
    y -= 15;
  }

  y -= lineGap;

  if (data.receiptCity) {
    page.drawText(`${data.receiptCity}, ${formatDate(data.paymentDate)}`, {
      x: left,
      y,
      size: 11,
      font: regularFont,
      color: colors.text
    });
    y -= 32;
  }

  page.drawLine({
    start: { x: left, y },
    end: { x: left + 220, y },
    thickness: 1,
    color: colors.muted
  });
  y -= 16;

  page.drawText(data.professionalName, {
    x: left,
    y,
    size: 11,
    font: regularFont,
    color: colors.text
  });
  y -= 14;
  page.drawText(`CRP ${data.crp}`, {
    x: left,
    y,
    size: 10,
    font: regularFont,
    color: colors.muted
  });

  const footerLines = wrapText(data.receiptFooterText, {
    font: regularFont,
    size: 9,
    larguraMaxima: LARGURA_UTIL
  });
  let footerY = 118;
  for (const line of footerLines) {
    page.drawText(line, {
      x: left,
      y: footerY,
      size: 9,
      font: regularFont,
      color: colors.muted
    });
    footerY -= 12;
  }

  page.drawText(data.noticeText, {
    x: left,
    y: 70,
    size: 9,
    font: boldFont,
    color: colors.text
  });

  return Buffer.from(await pdfDoc.save());
}

module.exports = {
  renderReceiptPdf
};
