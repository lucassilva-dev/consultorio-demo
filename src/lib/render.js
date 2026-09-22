function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderLayout({
  title,
  description = "",
  bodyClass = "",
  head = "",
  content = "",
  imageUrl = "",
  canonicalUrl = "",
  scripts = [],
  styles = []
}) {
  const stylesheetTags = styles
    .map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`)
    .join("");
  const scriptTags = scripts
    .map((src) => `<script type="module" src="${escapeHtml(src)}"></script>`)
    .join("");

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:type" content="website">
  ${imageUrl ? `<meta property="og:image" content="${escapeHtml(imageUrl)}">` : ""}
  ${canonicalUrl ? `<meta property="og:url" content="${escapeHtml(canonicalUrl)}">` : ""}
  ${canonicalUrl ? `<link rel="canonical" href="${escapeHtml(canonicalUrl)}">` : ""}
  <link rel="icon" type="image/svg+xml" href="/assets/icons/heart-handshake.svg">
  ${head}
  ${stylesheetTags}
</head>
<body class="${escapeHtml(bodyClass)}">
  ${content}
  ${scriptTags}
</body>
</html>`;
}

// Fontes do painel administrativo (design system "Clareira"). Ficam no <head>
// em vez de @import no CSS para não serializar o download atrás da folha.
const ADMIN_FONTS_HEAD = `<link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Instrument+Sans:ital,wght@0,400..700;1,400..600&family=Spline+Sans+Mono:wght@400..600&display=swap">`;

module.exports = {
  ADMIN_FONTS_HEAD,
  escapeHtml,
  renderLayout
};
