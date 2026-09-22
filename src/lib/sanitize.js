const sanitizeHtml = require("sanitize-html");

// sanitize-html remove o markup e, de quebra, codifica & < > como entidades.
// Guardar o texto já codificado fazia o valor ser escapado duas vezes: o que a
// psicóloga digitava como "Acolhimento & escuta" chegava ao visitante como
// "Acolhimento &amp; escuta", literalmente.
//
// A regra passa a ser uma só: o banco guarda texto puro, e o escape acontece
// exclusivamente na renderização (escapeHtml no servidor e no painel). Decodificar
// aqui não reabre risco de injeção — o valor nunca é inserido como HTML cru.
const ENTIDADES_BASICAS = [
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&quot;", String.fromCharCode(34)],
  ["&#39;", "'"],
  ["&#x27;", "'"],
  ["&nbsp;", " "],
  // & por último: decodificar antes transformaria &amp;lt; em < indevidamente.
  ["&amp;", "&"]
];

function decodeBasicEntities(value) {
  let texto = String(value);
  for (const [entidade, caractere] of ENTIDADES_BASICAS) {
    texto = texto.split(entidade).join(caractere);
  }
  return texto;
}

function sanitizePlainText(value) {
  const semMarkup = sanitizeHtml(String(value ?? ""), {
    allowedTags: [],
    allowedAttributes: {}
  });

  // Normaliza fim de linha e tira espaço nas pontas.
  return decodeBasicEntities(semMarkup)
    .split(String.fromCharCode(13)).join("")
    .trim();
}

function sanitizeNullableText(value) {
  const sanitized = sanitizePlainText(value);
  return sanitized || "";
}

function sanitizeDateLike(value) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function sanitizeTimeLike(value) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function sanitizeNumericLike(value) {
  if (value === null || typeof value === "undefined" || value === "") {
    return "";
  }

  return String(value).replace(",", ".").trim();
}

function sanitizeImagePath(value) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function sanitizeUrlLike(value) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

// Corpo com cards/socialLinks nulo, string ou objeto chegava aqui e o .map
// lançava TypeError, que virava 500. Não sendo lista, é lista vazia — e o
// schema devolve 400 com a mensagem certa.
function sanitizeHelpCards(cards) {
  if (!Array.isArray(cards)) {
    return [];
  }
  return cards.map((card) => ({
    title: sanitizePlainText(card.title),
    description: sanitizePlainText(card.description),
    assetType: sanitizePlainText(card.assetType),
    assetValue: sanitizeUrlLike(card.assetValue),
    sortOrder: Number(card.sortOrder) || 0
  }));
}

function sanitizeSocialLinks(links) {
  if (!Array.isArray(links)) {
    return [];
  }
  return links.map((link) => ({
    platform: sanitizePlainText(link.platform),
    label: sanitizePlainText(link.label),
    url: sanitizeUrlLike(link.url)
  }));
}

module.exports = {
  sanitizeDateLike,
  sanitizeHelpCards,
  sanitizeImagePath,
  sanitizeNullableText,
  sanitizeNumericLike,
  sanitizePlainText,
  sanitizeSocialLinks,
  sanitizeTimeLike,
  sanitizeUrlLike
};
