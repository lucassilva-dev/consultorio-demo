const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { toPdfText } = require("../lib/pdf-text");
const { formatClinicDate } = require("../lib/clinic-time");

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const TOP_Y = 790;
const BOTTOM_Y = 70;

const EVOLUTION_TYPE_LABELS = {
  session: "Evolução de sessão",
  initial: "Registro inicial",
  guardian_contact: "Contato com responsável",
  referral: "Encaminhamento",
  closing: "Encerramento",
  addendum: "Adendo",
  correction: "Retificação",
  other: "Outro"
};

const STATUS_LABELS = {
  draft: "Rascunho",
  completed: "Concluída",
  locked: "Bloqueada",
  signed: "Assinada",
  amended: "Retificada"
};

function formatDate(value) {
  return formatClinicDate(value, { dateStyle: "medium" }) || "—";
}

function formatDateTime(value) {
  return (
    formatClinicDate(value, { dateStyle: "medium", timeStyle: "short" }) || "—"
  );
}

// A quebra contava CARACTERES, não largura. Como a fonte é proporcional, um
// "W" ocupa quase o triplo de um "i": um nome em caixa alta, uma URL longa ou
// uma palavra sem espaços passavam da margem e saíam desenhados fora da página.
// Aqui a medida é a real, pela própria fonte que vai desenhar.
const LARGURA_UTIL = PAGE_WIDTH - MARGIN * 2;

function quebrarPalavraLonga(palavra, font, size, larguraMaxima) {
  const pedacos = [];
  let atual = "";

  for (const caractere of palavra) {
    const tentativa = atual + caractere;
    if (atual && font.widthOfTextAtSize(tentativa, size) > larguraMaxima) {
      pedacos.push(atual);
      atual = caractere;
    } else {
      atual = tentativa;
    }
  }

  if (atual) pedacos.push(atual);
  return pedacos;
}

function wrapText(text, { font, size, larguraMaxima }) {
  const lines = [];
  const paragraphs = String(text ?? "").split(String.fromCharCode(10));
  for (const paragraph of paragraphs) {
    const words = paragraph.split(new RegExp(String.fromCharCode(92) + "s+")).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }

    let currentLine = "";
    for (const word of words) {
      const nextLine = currentLine ? `${currentLine} ${word}` : word;
      if (font.widthOfTextAtSize(nextLine, size) <= larguraMaxima) {
        currentLine = nextLine;
        continue;
      }

      if (currentLine) {
        lines.push(currentLine);
        currentLine = "";
      }

      // Palavra que sozinha não cabe (URL, token) é partida em pedaços.
      if (font.widthOfTextAtSize(word, size) > larguraMaxima) {
        const pedacos = quebrarPalavraLonga(word, font, size, larguraMaxima);
        lines.push(...pedacos.slice(0, -1));
        currentLine = pedacos[pedacos.length - 1] || "";
      } else {
        currentLine = word;
      }
    }

    if (currentLine) lines.push(currentLine);
  }

  return lines;
}

function createWriter(pdfDoc, fonts, colors) {
  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = TOP_Y;

  function ensureSpace(needed) {
    if (y - needed < BOTTOM_Y) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = TOP_Y;
    }
  }

  function text(value, { size = 11, font = fonts.regular, color = colors.text, gap = 15, indent = 0 } = {}) {
    const larguraMaxima = LARGURA_UTIL - indent;
    // Higieniza ANTES de medir: widthOfTextAtSize lança nos mesmos caracteres
    // que drawText, então medir o texto cru derrubava a exportação de novo.
    for (const line of wrapText(toPdfText(value), { font, size, larguraMaxima })) {
      ensureSpace(gap);
      page.drawText(line, { x: MARGIN + indent, y, size, font, color });
      y -= gap;
    }
  }

  function heading(value, { size = 14, gap = 22 } = {}) {
    const linhas = wrapText(toPdfText(value), {
      font: fonts.bold,
      size,
      larguraMaxima: LARGURA_UTIL
    });
    ensureSpace(gap + 6);
    y -= 6;
    for (const linha of linhas) {
      ensureSpace(gap);
      page.drawText(linha, { x: MARGIN, y, size, font: fonts.bold, color: colors.accent });
      y -= gap;
    }
  }

  function label(value) {
    // Rótulo de pergunta personalizada aceita até 200 caracteres: numa linha só,
    // o excesso era desenhado para fora da página.
    const linhas = wrapText(toPdfText(value), {
      font: fonts.bold,
      size: 9,
      larguraMaxima: LARGURA_UTIL
    });
    for (const linha of linhas) {
      ensureSpace(14);
      page.drawText(linha, { x: MARGIN, y, size: 9, font: fonts.bold, color: colors.muted });
      y -= 14;
    }
  }

  function spacer(amount = 8) {
    y -= amount;
  }

  function rule() {
    ensureSpace(14);
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_WIDTH - MARGIN, y },
      thickness: 0.5,
      color: colors.muted
    });
    y -= 14;
  }

  return { text, heading, label, spacer, rule };
}

async function setupDoc() {
  const pdfDoc = await PDFDocument.create();
  const fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  };
  const colors = {
    text: rgb(0.22, 0.16, 0.15),
    muted: rgb(0.46, 0.35, 0.3),
    accent: rgb(0.47, 0.14, 0.58)
  };
  return { pdfDoc, fonts, colors };
}

function drawCover(writer, { title, professionalName, crp, patient }) {
  writer.heading(title, { size: 22, gap: 30 });
  writer.label("Profissional");
  writer.text(professionalName || "—");
  writer.label("CRP");
  writer.text(crp || "—");
  writer.spacer(6);
  writer.label("Paciente");
  writer.text(patient?.fullName || "—");
  if (patient?.preferredName) {
    writer.text(`Como prefere ser chamado(a): ${patient.preferredName}`);
  }
  writer.label("Emitido em");
  writer.text(formatDateTime(new Date().toISOString()));
  writer.spacer(6);
  writer.rule();
}

const DOCUMENT_TYPE_LABELS = {
  attendance_declaration: "Declaração de comparecimento",
  psychological_certificate: "Atestado psicológico",
  report: "Relatório psicológico",
  opinion: "Parecer psicológico",
  referral: "Encaminhamento"
};

const BLOCK_TITLES = {
  contract: "Contrato e consentimento",
  plan: "Plano terapêutico",
  closing: "Encerramento"
};

// Desenha um payload de seções (o formato compartilhado por anamnese,
// contrato, plano e encerramento).
function drawSections(writer, payload) {
  const sections = Array.isArray(payload?.sections) ? payload.sections : [];
  for (const section of sections) {
    writer.heading(section.title || "Seção", { size: 13, gap: 20 });
    const items = Array.isArray(section.items) ? section.items : [];
    for (const item of items) {
      if (item.hidden === true) {
        continue; // perguntas ocultadas não entram no PDF
      }
      writer.label(item.label || "Pergunta");
      writer.text(item.answer ? item.answer : "—");
      writer.spacer(4);
    }
  }
}

function drawBlock(writer, { blockLabel, status, payload }) {
  writer.heading(blockLabel, { size: 16 });
  writer.label("Situação");
  writer.text(STATUS_LABELS[status] || status);
  writer.spacer(4);
  drawSections(writer, payload);
}

// Espaço de assinatura. O contrato é impresso para ser assinado, e o documento
// psicológico exige assinatura do profissional (Resolução CFP 006/2019).
function drawSignature(writer, { professionalName, crp, city, extraLine = "" }) {
  writer.spacer(18);
  writer.text("__________________________________________");
  writer.text(professionalName || "—");
  writer.text(`CRP ${crp || "—"}`);
  if (extraLine) {
    writer.spacer(10);
    writer.text("__________________________________________");
    writer.text(extraLine);
  }
  if (city) {
    writer.spacer(6);
    writer.text(`${city}, ${formatDate(new Date().toISOString())}`);
  }
}

function drawIntake(writer, intake) {
  writer.heading("Anamnese", { size: 16 });
  writer.label("Status");
  writer.text(STATUS_LABELS[intake.status] || intake.status);
  writer.spacer(4);
  drawSections(writer, intake.payload);
}

function drawEvolution(writer, evolution, { compact = false } = {}) {
  const typeLabel = EVOLUTION_TYPE_LABELS[evolution.evolutionType] || evolution.evolutionType;
  writer.heading(
    `${formatDate(evolution.evolutionDate)} — ${typeLabel}`,
    { size: compact ? 12 : 14, gap: 18 }
  );
  if (evolution.title) {
    writer.text(evolution.title);
  }
  writer.label("Status");
  writer.text(STATUS_LABELS[evolution.status] || evolution.status);
  if (evolution.parentEvolutionId) {
    writer.text(`Vinculado ao registro #${evolution.parentEvolutionId}`, {});
  }
  writer.spacer(4);
  writer.label("Conteúdo clínico");
  writer.text(evolution.content ? evolution.content : "—");
  writer.spacer(6);
  if (!compact) {
    writer.rule();
  }
}

async function renderIntakePdf({ professionalName, crp, patient, intake }) {
  const { pdfDoc, fonts, colors } = await setupDoc();
  const writer = createWriter(pdfDoc, fonts, colors);
  drawCover(writer, { title: "Anamnese", professionalName, crp, patient });
  drawIntake(writer, intake);
  return Buffer.from(await pdfDoc.save());
}

async function renderEvolutionPdf({ professionalName, crp, patient, evolution }) {
  const { pdfDoc, fonts, colors } = await setupDoc();
  const writer = createWriter(pdfDoc, fonts, colors);
  drawCover(writer, { title: "Evolução clínica", professionalName, crp, patient });
  drawEvolution(writer, evolution);
  return Buffer.from(await pdfDoc.save());
}

async function renderBlockPdf({
  professionalName,
  crp,
  patient,
  recordNumber,
  blockType,
  blockLabel,
  status,
  payload,
  city
}) {
  const { pdfDoc, fonts, colors } = await setupDoc();
  const writer = createWriter(pdfDoc, fonts, colors);
  const titulo = blockLabel || BLOCK_TITLES[blockType] || "Bloco do prontuário";
  drawCover(writer, { title: titulo, professionalName, crp, patient });
  if (recordNumber) {
    writer.label("Prontuário");
    writer.text(recordNumber);
    writer.spacer(6);
  }
  drawBlock(writer, { blockLabel: titulo, status, payload });

  // Contrato é o único que sai para ser assinado pelos dois lados.
  if (blockType === "contract") {
    drawSignature(writer, {
      professionalName,
      crp,
      city,
      extraLine: patient?.fullName || "Pessoa atendida"
    });
  }

  return Buffer.from(await pdfDoc.save());
}

async function renderDocumentPdf({
  professionalName,
  crp,
  patient,
  recordNumber,
  documentNumber,
  documentType,
  title,
  issuedAt,
  content,
  city
}) {
  const { pdfDoc, fonts, colors } = await setupDoc();
  const writer = createWriter(pdfDoc, fonts, colors);
  const tipoLabel = DOCUMENT_TYPE_LABELS[documentType] || documentType;

  drawCover(writer, { title: tipoLabel, professionalName, crp, patient });

  writer.label("Documento");
  writer.text(documentNumber || "—");
  if (recordNumber) {
    writer.label("Prontuário");
    writer.text(recordNumber);
  }
  writer.label("Emitido em");
  writer.text(formatDateTime(issuedAt));
  writer.spacer(6);
  writer.rule();

  if (title) {
    writer.heading(title, { size: 15 });
  }

  // A Resolução CFP 006/2019 pede destinatário e finalidade explícitos: sem
  // eles o documento não se sustenta fora do consultório.
  writer.label("Destinatário");
  writer.text(content?.addressee ? content.addressee : "—");
  writer.label("Finalidade");
  writer.text(content?.purpose ? content.purpose : "—");
  writer.spacer(4);
  writer.label("Conteúdo");
  writer.text(content?.body ? content.body : "—");

  if (content?.validUntil) {
    writer.spacer(4);
    writer.label("Validade");
    writer.text(content.validUntil);
  }

  drawSignature(writer, { professionalName, crp, city });
  return Buffer.from(await pdfDoc.save());
}

async function renderClinicalRecordPdf({
  professionalName,
  crp,
  patient,
  record,
  blocks,
  intake,
  evolutions,
  documents
}) {
  const { pdfDoc, fonts, colors } = await setupDoc();
  const writer = createWriter(pdfDoc, fonts, colors);
  drawCover(writer, { title: "Prontuário completo", professionalName, crp, patient });

  if (record) {
    writer.label("Prontuário");
    writer.text(record.recordNumber || "—");
    writer.label("Situação");
    writer.text(record.status === "closed" ? "Encerrado" : "Aberto");
    if (record.closedAt) {
      writer.label("Encerrado em");
      writer.text(formatDateTime(record.closedAt));
      writer.label("Motivo do encerramento");
      writer.text(record.closingReasonLabel || record.closingReason || "—");
    }
    writer.spacer(4);
  }

  writer.label("Dados administrativos mínimos");
  writer.text(`Tipo de atendimento: ${patient?.patientType || "—"}`);
  writer.text(`Modalidade: ${patient?.modality || "—"}`);
  writer.text(`Status do paciente: ${patient?.status || "—"}`);
  writer.spacer(6);
  writer.rule();

  // Ordem do registro: o que foi combinado, o plano, a chegada, o percurso, os
  // documentos que saíram e o fechamento.
  for (const blockType of ["contract", "plan"]) {
    const bloco = blocks?.[blockType];
    writer.heading(BLOCK_TITLES[blockType], { size: 16 });
    if (!bloco) {
      writer.text(`${BLOCK_TITLES[blockType]} ainda não registrado.`);
    } else {
      writer.label("Situação");
      writer.text(STATUS_LABELS[bloco.status] || bloco.status);
      writer.spacer(4);
      drawSections(writer, bloco.payload);
    }
    writer.rule();
  }

  if (intake) {
    drawIntake(writer, intake);
    writer.rule();
  } else {
    writer.heading("Anamnese", { size: 16 });
    writer.text("Anamnese ainda não registrada.");
    writer.rule();
  }

  writer.heading("Evoluções", { size: 16 });
  if (!evolutions || !evolutions.length) {
    writer.text("Nenhuma evolução registrada.");
  } else {
    for (const evolution of evolutions) {
      drawEvolution(writer, evolution, { compact: false });
    }
  }

  // Documentos entram como registro de emissão — número, tipo, data e
  // situação. O conteúdo de cada um vive no PDF próprio, já emitido.
  writer.heading("Documentos emitidos", { size: 16 });
  if (!documents || !documents.length) {
    writer.text("Nenhum documento emitido.");
  } else {
    for (const documento of documents) {
      writer.label(DOCUMENT_TYPE_LABELS[documento.documentType] || documento.documentType);
      writer.text(
        `${documento.documentNumber || "—"} — ${formatDate(documento.issuedAt)}` +
          (documento.status === "revoked" ? " — revogado" : "")
      );
      if (documento.title) {
        writer.text(documento.title, { indent: 12 });
      }
      if (documento.status === "revoked" && documento.revokeReason) {
        writer.text(`Motivo da revogação: ${documento.revokeReason}`, { indent: 12 });
      }
      writer.spacer(4);
    }
  }
  writer.rule();

  const encerramento = blocks?.closing;
  writer.heading("Encerramento", { size: 16 });
  if (!encerramento) {
    writer.text("Acompanhamento em andamento.");
  } else {
    drawSections(writer, encerramento.payload);
  }

  return Buffer.from(await pdfDoc.save());
}

module.exports = {
  DOCUMENT_TYPE_LABELS,
  EVOLUTION_TYPE_LABELS,
  renderBlockPdf,
  renderClinicalRecordPdf,
  renderDocumentPdf,
  renderEvolutionPdf,
  renderIntakePdf
};
