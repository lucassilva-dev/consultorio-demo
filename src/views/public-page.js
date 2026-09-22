const { renderLayout } = require("../lib/render");

function absolutizarUrl(caminho, siteUrl) {
  const valor = String(caminho || "").trim();
  if (!valor) {
    return "";
  }
  if (valor.startsWith("http://") || valor.startsWith("https://")) {
    return valor;
  }
  let base = String(siteUrl || "").trim();
  while (base.endsWith("/")) {
    base = base.slice(0, -1);
  }
  if (!base) {
    return "";
  }
  return base + (valor.startsWith("/") ? valor : "/" + valor);
}

// O conteúdo da landing é montado no cliente, mas título, descrição e imagem
// de compartilhamento precisam vir prontos do servidor: crawlers de prévia
// (WhatsApp, Instagram, buscadores) não executam JS e liam "Carregando
// conteúdo." como descrição do consultório — e nunca viam a imagem.
function renderPublicPage(seo = {}) {
  return renderLayout({
    title: seo.title || "Marina Alves | Psicóloga",
    description:
      seo.description ||
      "Psicóloga. Atendimento on-line e presencial para adultos e adolescentes.",
    // Crawler de prévia não resolve caminho relativo: og:image precisa ser
    // URL absoluta. Sem SITE_URL configurada, é melhor omitir do que publicar
    // um endereço que ninguém consegue buscar.
    imageUrl: absolutizarUrl(seo.shareImageUrl, seo.siteUrl),
    canonicalUrl: seo.siteUrl || "",
    styles: ["/colors_and_type.css", "/site.css"],
    scripts: ["/site.js"],
    content: `
      <div id="site-app" class="site-loading-shell">
        <main class="container site-loading-state">
          <div class="eyebrow">Carregando</div>
          <h1>Preparando o conteúdo do site.</h1>
          <p>Buscando as informações mais recentes.</p>
        </main>
        <footer class="site-footer site-shell-footer">
          <div class="container site-footer-grid">
            <div>
              <div class="site-footer-name">Marina Alves</div>
              <div class="eyebrow" style="margin-bottom:24px;">Psicóloga</div>
            </div>
            <div class="site-footer-meta">
              <div class="site-footer-links">
                <a class="site-footer-link" href="/privacidade">Privacidade</a>
              </div>
            </div>
          </div>
        </footer>
      </div>
    `
  });
}

module.exports = {
  renderPublicPage
};
