const { escapeHtml, renderLayout } = require("../lib/render");

function renderPrivacyPage(options = {}) {
  // Sem e-mail padrão embutido: a página republicava um endereço pessoal mesmo
  // depois de o admin removê-lo do site. Aqui só sai o que está configurado.
  const contactEmail = options.contactEmail || "";
  const whatsappUrl = options.whatsappUrl || "";
  const instagramUrl = options.instagramUrl || "";

  const canais = [
    contactEmail
      ? `<a href="mailto:${escapeHtml(contactEmail)}">${escapeHtml(contactEmail)}</a>`
      : "",
    whatsappUrl
      ? `<a href="${escapeHtml(whatsappUrl)}" target="_blank" rel="noreferrer">WhatsApp</a>`
      : "",
    instagramUrl
      ? `<a href="${escapeHtml(instagramUrl)}" target="_blank" rel="noreferrer">Instagram</a>`
      : ""
  ].filter(Boolean);

  const paragrafoDeContato = canais.length
    ? `<p>Canal de contato da psicóloga: ${canais.join(" · ")}.</p>`
    : `<p>Os canais de contato da psicóloga estão na <a href="/#contato">seção de contato</a> do site.</p>`;

  return renderLayout({
    title: "Privacidade | Marina Alves",
    description: "Informações sobre privacidade e uso de dados administrativos no site e painel.",
    styles: ["/colors_and_type.css", "/site.css"],
    content: `
      <main class="section">
        <div class="container-narrow site-legal-page">
          <div class="eyebrow" style="margin-bottom:16px;">Privacidade</div>
          <h1 style="margin-bottom:24px;">Como os dados administrativos são tratados nesta fase</h1>
          <div class="site-copy-stack">
            <p>Este site pode coletar dados administrativos informados em formulários, contatos por WhatsApp, e-mail, links de agendamento e interações necessárias para retorno, organização de agenda, gestão de sessões e emissão de recibos.</p>
            <p>Esses dados podem incluir nome, telefone, e-mail, informações básicas de agendamento, dados administrativos de pacientes e dados necessários para recibos. Nesta fase, a plataforma não foi criada para prontuário, evolução clínica, hipótese diagnóstica, relato terapêutico sensível ou registro aprofundado de saúde.</p>
            <p>As informações são usadas para contato inicial, organização administrativa, acompanhamento de sessões, controle financeiro e emissão de documentos administrativos. Recibos e documentos ficam em área privada, não pública.</p>
            <p>Comunicações feitas por WhatsApp, e-mail ou links externos de agendamento também dependem das políticas e da infraestrutura dessas plataformas terceiras. Por isso, o uso desses canais envolve regras próprias desses serviços.</p>
            <p>Este site não é canal de emergência. Em situações de urgência, crise ou risco imediato, procure o CVV pelo telefone 188 ou um serviço de emergência local.</p>
            <p>Quando aplicável, a pessoa pode solicitar correção ou exclusão de dados administrativos mantidos para contato, agenda ou recibos, observadas as obrigações legais mínimas de guarda que possam existir.</p>
            ${paragrafoDeContato}
          </div>
          <div class="site-legal-actions">
            <a class="btn btn-secondary" href="/">Voltar para o site</a>
          </div>
        </div>
      </main>
    `
  });
}

module.exports = {
  renderPrivacyPage
};
