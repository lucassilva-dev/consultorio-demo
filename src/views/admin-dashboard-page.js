const { ADMIN_FONTS_HEAD, escapeHtml, renderLayout } = require("../lib/render");
const {
  LEAD_INTERESTS,
  LEAD_PREFERRED_PERIODS,
  LEAD_SOURCES,
  LEAD_STATUSES,
  MESSAGE_TEMPLATE_CATEGORIES,
  MESSAGE_TEMPLATE_VARIABLES,
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  OPTION_LABELS,
  PATIENT_MODALITIES,
  PATIENT_STATUSES,
  PATIENT_TYPES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  SESSION_STATUSES,
  WEEKDAY_OPTIONS
} = require("../lib/clinic-options");

// Navegação: as dez áreas agrupadas por natureza de uso. As marcas são glifos
// Unicode — o painel não carrega biblioteca de ícones.
const NAV_GROUPS = [
  {
    titulo: "Rotina",
    itens: [
      ["dashboard", "Início", "◍"],
      ["leads", "Contatos", "◔"],
      ["patients", "Pacientes", "◉"],
      ["sessions", "Sessões", "◷"],
      ["finance", "Financeiro", "R$"]
    ]
  },
  {
    titulo: "Comunicação",
    itens: [
      ["messages", "Mensagens", "❞"],
      ["agenda", "Agenda", "⇄"],
      ["site", "Site", "⌂"]
    ]
  },
  {
    titulo: "Sistema",
    itens: [
      ["audit", "Auditoria", "≣"],
      ["settings", "Configurações", "⚙"]
    ]
  }
];

// Barra inferior do celular: as quatro áreas de uso diário mais o acesso ao
// restante pela folha "Mais".
const NAV_MOBILE = [
  ["dashboard", "Início", "◍"],
  ["sessions", "Sessões", "◷"],
  ["patients", "Pacientes", "◉"],
  ["finance", "Finanças", "R$"],
  ["mais", "Mais", "≡"]
];

function renderNavLink(key, rotulo, marca, extraClass = "") {
  const ativo = key === "dashboard";
  const classes = ["admin-nav-link", extraClass, ativo ? "is-active" : ""]
    .filter(Boolean)
    .join(" ");
  return `<button class="${classes}" type="button" data-panel-trigger="${escapeHtml(key)}"${
    ativo ? ' aria-current="page"' : ""
  }>
    <span class="admin-nav-marca" aria-hidden="true">${escapeHtml(marca)}</span>${escapeHtml(rotulo)}
    ${key === "leads" ? '<span class="admin-nav-badge" id="nav-badge-leads" hidden></span>' : ""}
  </button>`;
}

function renderNavGroups() {
  return NAV_GROUPS.map(
    (grupo) => `
      <div>
        <div class="admin-nav-grupo-titulo">${escapeHtml(grupo.titulo)}</div>
        <div class="admin-nav-lista">
          ${grupo.itens.map(([key, rotulo, marca]) => renderNavLink(key, rotulo, marca)).join("")}
        </div>
      </div>
    `
  ).join("");
}

function renderBottomNav() {
  return NAV_MOBILE.map(([key, rotulo, marca]) => {
    const ativo = key === "dashboard";
    const attrs =
      key === "mais"
        ? 'id="nav-mais" type="button" aria-expanded="false"'
        : `type="button" data-panel-trigger="${escapeHtml(key)}"${ativo ? ' aria-current="page"' : ""}`;
    return `<button class="admin-bottom-link${ativo ? " is-active" : ""}" ${attrs}>
      <span class="admin-nav-marca" aria-hidden="true">${escapeHtml(marca)}</span>
      <span>${escapeHtml(rotulo)}</span>
    </button>`;
  }).join("");
}

function renderSheetAreas() {
  return NAV_GROUPS.flatMap((grupo) => grupo.itens)
    .map(
      ([key, rotulo, marca]) => `
        <button class="admin-sheet-item${key === "dashboard" ? " is-active" : ""}" type="button" data-panel-trigger="${escapeHtml(key)}">
          <span class="admin-nav-marca" aria-hidden="true">${escapeHtml(marca)}</span>${escapeHtml(rotulo)}
        </button>`
    )
    .join("");
}

// Contrato, plano e encerramento usam o mesmo formulário de seções da
// anamnese. Cada um ganha seu próprio container: as funções que coletam as
// respostas leem do DOM, e um container compartilhado faria salvar o contrato
// levar junto os campos do plano.
function renderBlockPanel({ painel, rotulo, prefixo }) {
  return `
              <section class="cofre-painel" data-clinical-panel="${painel}" hidden>
                <div class="admin-card-head">
                  <div>
                    <div class="rotulo-micro">${escapeHtml(rotulo)}</div>
                    <h3 id="clinical-${prefixo}-status">Carregando…</h3>
                    <p class="field-help" id="clinical-${prefixo}-help"></p>
                  </div>
                  <div class="inline-actions" id="clinical-${prefixo}-actions"></div>
                </div>

                <div id="clinical-${prefixo}-progress-wrap" hidden>
                  <div class="anamnese-progresso" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="clinical-${prefixo}-progress-bar">
                    <div class="anamnese-progresso-barra" id="clinical-${prefixo}-progress" style="width:0%"></div>
                  </div>
                  <p class="field-help" id="clinical-${prefixo}-progress-text"></p>
                </div>

                <div id="clinical-${prefixo}-index" class="anamnese-indice"></div>
                <div id="clinical-${prefixo}-sections" data-form="${prefixo}"></div>
              </section>
`;
}

function renderTelaHead(titulo, descricao, acao = "") {
  return `
            <header class="admin-tela-head">
              <div>
                <h1>${escapeHtml(titulo)}</h1>
                <p>${escapeHtml(descricao)}</p>
              </div>
              ${acao}
            </header>
`;
}

function renderOptions(values, labels, options = {}) {
  const includeBlank = options.includeBlank || false;
  const blankLabel = options.blankLabel || "Selecione";
  const items = [];

  if (includeBlank) {
    items.push(`<option value="">${escapeHtml(blankLabel)}</option>`);
  }

  for (const value of values) {
    items.push(`<option value="${escapeHtml(value)}">${escapeHtml(labels[value] || value)}</option>`);
  }

  return items.join("");
}

function renderYearOptions() {
  const atual = new Date().getFullYear();
  return [atual - 1, atual, atual + 1]
    .map((ano) => `<option value="${ano}">${ano}</option>`)
    .join("");
}

function renderMonthOptions() {
  const months = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro"
  ];

  return months
    .map((label, index) => `<option value="${index + 1}">${escapeHtml(label)}</option>`)
    .join("");
}

function renderSiteForms() {
  return `
    <div class="admin-site">
      <div class="admin-site-indice" id="site-indice"></div>

      <section class="admin-card admin-site-bloco" data-site-block="home" data-site-label="Home">
        <div class="admin-card-head">
          <div>
            <h2 class="admin-card-titulo">Bloco · Home</h2>
          </div>
        <span class="admin-site-selo" data-site-selo="home">● salvo</span>
        </div>
        <form id="home-form" class="admin-form" novalidate>
          <div class="field-grid two-columns">
            <label class="field">
              <span>Eyebrow</span>
              <input name="eyebrow" required maxlength="80">
            </label>
            <label class="field">
              <span>CTA URL</span>
              <input name="ctaUrl" required maxlength="255" placeholder="#agendar ou https://...">
            </label>
            <label class="field">
              <span>Título</span>
              <input name="title" required maxlength="80">
            </label>
            <label class="field">
              <span>Subtítulo</span>
              <input name="subtitle" required maxlength="80">
            </label>
          </div>
          <label class="field">
            <span>Texto principal</span>
            <textarea name="body" rows="4" required maxlength="600"></textarea>
          </label>
          <div class="field-grid two-columns">
            <label class="field">
              <span>Rótulo do botão</span>
              <input name="ctaLabel" required maxlength="80">
            </label>
            <label class="field">
              <span>Alt da imagem</span>
              <input name="imageAlt" required maxlength="140">
            </label>
          </div>
          <div class="upload-block">
            <label class="field">
              <span>Caminho da imagem</span>
              <input name="imageUrl" required readonly>
            </label>
            <label class="btn btn-secondary upload-button">
              Enviar imagem
              <input type="file" data-upload-target="imageUrl" accept=".jpg,.jpeg,.png,.webp" hidden>
            </label>
            <p class="field-help">Aceita jpg, jpeg, png e webp com até 3 MB.</p>
            <img class="image-preview" data-preview-target="imageUrl" alt="" hidden>
          </div>
          <div class="form-actions">
            <div class="form-feedback" hidden></div>
            <div class="inline-actions">
              <button class="btn btn-secondary" type="button" data-discard-block="home">Descartar alterações</button>
              <button class="btn btn-primary" type="submit">Salvar Home</button>
            </div>
          </div>
        </form>
      </section>

      <section class="admin-card admin-site-bloco" data-site-block="about" data-site-label="Sobre" hidden>
        <div class="admin-card-head">
          <div>
            <h2 class="admin-card-titulo">Bloco · Sobre</h2>
          </div>
        <span class="admin-site-selo" data-site-selo="about">● salvo</span>
        </div>
        <form id="about-form" class="admin-form" novalidate>
          <div class="field-grid two-columns">
            <label class="field">
              <span>Eyebrow</span>
              <input name="eyebrow" required maxlength="80">
            </label>
            <label class="field">
              <span>Título</span>
              <input name="title" required maxlength="120">
            </label>
          </div>
          <label class="field">
            <span>Conteúdo</span>
            <textarea name="content" rows="8" required maxlength="2500"></textarea>
          </label>
          <div class="form-actions">
            <div class="form-feedback" hidden></div>
            <div class="inline-actions">
              <button class="btn btn-secondary" type="button" data-discard-block="about">Descartar alterações</button>
              <button class="btn btn-primary" type="submit">Salvar Sobre</button>
            </div>
          </div>
        </form>
      </section>

      <section class="admin-card admin-site-bloco" data-site-block="aboutPanel" data-site-label="Painel do Sobre" hidden>
        <div class="admin-card-head">
          <div>
            <h2 class="admin-card-titulo">Bloco · Bloco lateral</h2>
          </div>
        <span class="admin-site-selo" data-site-selo="aboutPanel">● salvo</span>
        </div>
        <form id="about-panel-form" class="admin-form" novalidate>
          <div class="field-grid two-columns">
            <label class="field">
              <span>Eyebrow</span>
              <input name="eyebrow" required maxlength="80">
            </label>
            <label class="field">
              <span>Título</span>
              <input name="title" required maxlength="120">
            </label>
          </div>
          <label class="field">
            <span>Nota final</span>
            <textarea name="note" rows="3" required maxlength="400"></textarea>
          </label>
          <div class="field-grid two-columns">
            <label class="field">
              <span>Item 1 · Rótulo</span>
              <input name="item1Label" required maxlength="40">
            </label>
            <label class="field">
              <span>Item 1 · Valor</span>
              <input name="item1Value" required maxlength="140">
            </label>
            <label class="field">
              <span>Item 2 · Rótulo</span>
              <input name="item2Label" required maxlength="40">
            </label>
            <label class="field">
              <span>Item 2 · Valor</span>
              <input name="item2Value" required maxlength="140">
            </label>
            <label class="field">
              <span>Item 3 · Rótulo</span>
              <input name="item3Label" required maxlength="40">
            </label>
            <label class="field">
              <span>Item 3 · Valor</span>
              <input name="item3Value" required maxlength="140">
            </label>
            <label class="field">
              <span>Item 4 · Rótulo</span>
              <input name="item4Label" required maxlength="40">
            </label>
            <label class="field">
              <span>Item 4 · Valor</span>
              <input name="item4Value" required maxlength="140">
            </label>
          </div>
          <div class="form-actions">
            <div class="form-feedback" hidden></div>
            <div class="inline-actions">
              <button class="btn btn-secondary" type="button" data-discard-block="aboutPanel">Descartar alterações</button>
              <button class="btn btn-primary" type="submit">Salvar painel</button>
            </div>
          </div>
        </form>
      </section>

      <section class="admin-card admin-site-bloco" data-site-block="help" data-site-label="Ajuda" hidden>
        <div class="admin-card-head">
          <div>
            <h2 class="admin-card-titulo">Bloco · Como posso te ajudar</h2>
          </div>
          <button id="add-help-card" class="btn btn-secondary" type="button">Adicionar card</button>
        <span class="admin-site-selo" data-site-selo="help">● salvo</span>
        </div>
        <form id="help-form" class="admin-form" novalidate>
          <div class="field-grid two-columns">
            <label class="field">
              <span>Eyebrow</span>
              <input name="eyebrow" required maxlength="80">
            </label>
            <label class="field">
              <span>Título da seção</span>
              <input name="title" required maxlength="120">
            </label>
          </div>
          <div id="help-cards-list" class="admin-stack"></div>
          <div class="form-actions">
            <div class="form-feedback" hidden></div>
            <div class="inline-actions">
              <button class="btn btn-secondary" type="button" data-discard-block="help">Descartar alterações</button>
              <button class="btn btn-primary" type="submit">Salvar cards</button>
            </div>
          </div>
        </form>
      </section>

      <section class="admin-card admin-site-bloco" data-site-block="work" data-site-label="Trabalho" hidden>
        <div class="admin-card-head">
          <div>
            <h2 class="admin-card-titulo">Bloco · Metodologia</h2>
          </div>
        <span class="admin-site-selo" data-site-selo="work">● salvo</span>
        </div>
        <form id="work-form" class="admin-form" novalidate>
          <div class="field-grid two-columns">
            <label class="field">
              <span>Eyebrow</span>
              <input name="eyebrow" required maxlength="80">
            </label>
            <label class="field">
              <span>Título · parte inicial</span>
              <input name="titlePrefix" required maxlength="80">
            </label>
            <label class="field">
              <span>Título · destaque</span>
              <input name="titleEmphasis" required maxlength="40">
            </label>
            <label class="field">
              <span>Título · parte final</span>
              <input name="titleSuffix" required maxlength="80">
            </label>
          </div>
          <div class="field-grid two-columns">
            <label class="field">
              <span>Parágrafo 1</span>
              <textarea name="lead" rows="4" required maxlength="500"></textarea>
            </label>
            <label class="field">
              <span>Parágrafo 2</span>
              <textarea name="body" rows="4" required maxlength="500"></textarea>
            </label>
          </div>
          <div class="admin-stack">
            <article class="admin-nested-card">
              <h3>Pilar 1</h3>
              <div class="field-grid three-columns">
                <label class="field">
                  <span>Número</span>
                  <input name="pillar1Number" required maxlength="8">
                </label>
                <label class="field">
                  <span>Título</span>
                  <input name="pillar1Title" required maxlength="80">
                </label>
                <label class="field">
                  <span>Descrição</span>
                  <textarea name="pillar1Description" rows="3" required maxlength="240"></textarea>
                </label>
              </div>
            </article>
            <article class="admin-nested-card">
              <h3>Pilar 2</h3>
              <div class="field-grid three-columns">
                <label class="field">
                  <span>Número</span>
                  <input name="pillar2Number" required maxlength="8">
                </label>
                <label class="field">
                  <span>Título</span>
                  <input name="pillar2Title" required maxlength="80">
                </label>
                <label class="field">
                  <span>Descrição</span>
                  <textarea name="pillar2Description" rows="3" required maxlength="240"></textarea>
                </label>
              </div>
            </article>
            <article class="admin-nested-card">
              <h3>Pilar 3</h3>
              <div class="field-grid three-columns">
                <label class="field">
                  <span>Número</span>
                  <input name="pillar3Number" required maxlength="8">
                </label>
                <label class="field">
                  <span>Título</span>
                  <input name="pillar3Title" required maxlength="80">
                </label>
                <label class="field">
                  <span>Descrição</span>
                  <textarea name="pillar3Description" rows="3" required maxlength="240"></textarea>
                </label>
              </div>
            </article>
          </div>
          <div class="form-actions">
            <div class="form-feedback" hidden></div>
            <div class="inline-actions">
              <button class="btn btn-secondary" type="button" data-discard-block="work">Descartar alterações</button>
              <button class="btn btn-primary" type="submit">Salvar metodologia</button>
            </div>
          </div>
        </form>
      </section>

      <section class="admin-card admin-site-bloco" data-site-block="attendance" data-site-label="Atendimento" hidden>
        <div class="admin-card-head">
          <div>
            <h2 class="admin-card-titulo">Bloco · Atendimento</h2>
          </div>
        <span class="admin-site-selo" data-site-selo="attendance">● salvo</span>
        </div>
        <form id="attendance-form" class="admin-form" novalidate>
          <div class="field-grid two-columns">
            <label class="field">
              <span>Eyebrow</span>
              <input name="eyebrow" required maxlength="80">
            </label>
            <label class="field">
              <span>CTA</span>
              <input name="ctaLabel" required maxlength="80">
            </label>
            <label class="field">
              <span>Título · parte inicial</span>
              <input name="titlePrefix" required maxlength="80">
            </label>
            <label class="field">
              <span>Título · destaque</span>
              <input name="titleEmphasis" required maxlength="40">
            </label>
          </div>
          <label class="field">
            <span>Texto principal</span>
            <textarea name="lead" rows="4" required maxlength="400"></textarea>
          </label>
          <div class="admin-stack">
            <article class="admin-nested-card">
              <h3>Destaque 1</h3>
              <div class="field-grid two-columns">
                <label class="field">
                  <span>Título</span>
                  <input name="feature1Title" required maxlength="120">
                </label>
                <label class="field">
                  <span>Descrição</span>
                  <textarea name="feature1Description" rows="3" required maxlength="240"></textarea>
                </label>
              </div>
            </article>
            <article class="admin-nested-card">
              <h3>Destaque 2</h3>
              <div class="field-grid two-columns">
                <label class="field">
                  <span>Título</span>
                  <input name="feature2Title" required maxlength="120">
                </label>
                <label class="field">
                  <span>Descrição</span>
                  <textarea name="feature2Description" rows="3" required maxlength="240"></textarea>
                </label>
              </div>
            </article>
            <article class="admin-nested-card">
              <h3>Destaque 3</h3>
              <div class="field-grid two-columns">
                <label class="field">
                  <span>Título</span>
                  <input name="feature3Title" required maxlength="120">
                </label>
                <label class="field">
                  <span>Descrição</span>
                  <textarea name="feature3Description" rows="3" required maxlength="240"></textarea>
                </label>
              </div>
            </article>
          </div>
          <div class="form-actions">
            <div class="form-feedback" hidden></div>
            <div class="inline-actions">
              <button class="btn btn-secondary" type="button" data-discard-block="attendance">Descartar alterações</button>
              <button class="btn btn-primary" type="submit">Salvar atendimento</button>
            </div>
          </div>
        </form>
      </section>

      <section class="admin-card admin-site-bloco" data-site-block="closing" data-site-label="Encerramento" hidden>
        <div class="admin-card-head">
          <div>
            <h2 class="admin-card-titulo">Bloco · Fechamento</h2>
          </div>
        <span class="admin-site-selo" data-site-selo="closing">● salvo</span>
        </div>
        <form id="closing-form" class="admin-form" novalidate>
          <div class="field-grid two-columns">
            <label class="field">
              <span>Título · parte inicial</span>
              <input name="titlePrefix" required maxlength="120">
            </label>
            <label class="field">
              <span>Título · destaque</span>
              <input name="titleEmphasis" required maxlength="120">
            </label>
          </div>
          <label class="field">
            <span>Texto</span>
            <textarea name="body" rows="4" required maxlength="500"></textarea>
          </label>
          <label class="field">
            <span>Rótulo do botão</span>
            <input name="ctaLabel" required maxlength="80">
          </label>
          <div class="form-actions">
            <div class="form-feedback" hidden></div>
            <div class="inline-actions">
              <button class="btn btn-secondary" type="button" data-discard-block="closing">Descartar alterações</button>
              <button class="btn btn-primary" type="submit">Salvar fechamento</button>
            </div>
          </div>
        </form>
      </section>

      <section class="admin-card admin-site-bloco" data-site-block="contact" data-site-label="Contato" hidden>
        <div class="admin-card-head">
          <div>
            <h2 class="admin-card-titulo">Bloco · Contato</h2>
          </div>
          <button id="add-social-link" class="btn btn-secondary" type="button">Adicionar link</button>
        <span class="admin-site-selo" data-site-selo="contact">● salvo</span>
        </div>
        <form id="contact-form" class="admin-form" novalidate>
          <label class="field">
            <span>Título</span>
            <input name="title" required maxlength="80">
          </label>
          <label class="field">
            <span>Texto</span>
            <textarea name="text" rows="4" required maxlength="1000"></textarea>
          </label>
          <div class="field-grid two-columns">
            <label class="field">
              <span>Número do WhatsApp</span>
              <input name="whatsappNumber" maxlength="20" placeholder="5511999999999">
            </label>
            <label class="field">
              <span>Mensagem padrão</span>
              <input name="whatsappMessage" required maxlength="300">
            </label>
          </div>
          <div id="social-links-list" class="admin-stack"></div>
          <div class="form-actions">
            <div class="form-feedback" hidden></div>
            <div class="inline-actions">
              <button class="btn btn-secondary" type="button" data-discard-block="contact">Descartar alterações</button>
              <button class="btn btn-primary" type="submit">Salvar contato</button>
            </div>
          </div>
        </form>
      </section>

      <section class="admin-card admin-site-bloco" data-site-block="seo" data-site-label="SEO" hidden>
        <div class="admin-card-head">
          <div>
            <h2 class="admin-card-titulo">Bloco · SEO</h2>
          </div>
        <span class="admin-site-selo" data-site-selo="seo">● salvo</span>
        </div>
        <form id="seo-form" class="admin-form" novalidate>
          <label class="field">
            <span>Title</span>
            <input name="title" required maxlength="70">
          </label>
          <label class="field">
            <span>Description</span>
            <textarea name="description" rows="3" required maxlength="180"></textarea>
          </label>
          <div class="upload-block">
            <label class="field">
              <span>Imagem de compartilhamento</span>
              <input name="shareImageUrl" required readonly>
            </label>
            <label class="btn btn-secondary upload-button">
              Enviar imagem
              <input type="file" data-upload-target="shareImageUrl" accept=".jpg,.jpeg,.png,.webp" hidden>
            </label>
            <p class="field-help">Use a mesma política segura de upload do site.</p>
            <img class="image-preview" data-preview-target="shareImageUrl" alt="" hidden>
          </div>
          <div class="form-actions">
            <div class="form-feedback" hidden></div>
            <div class="inline-actions">
              <button class="btn btn-secondary" type="button" data-discard-block="seo">Descartar alterações</button>
              <button class="btn btn-primary" type="submit">Salvar SEO</button>
            </div>
          </div>
        </form>
      </section>

      <section class="admin-card admin-site-bloco" data-site-block="footer" data-site-label="Rodapé" hidden>
        <div class="admin-card-head">
          <div>
            <h2 class="admin-card-titulo">Bloco · Rodapé</h2>
          </div>
        <span class="admin-site-selo" data-site-selo="footer">● salvo</span>
        </div>
        <form id="footer-form" class="admin-form" novalidate>
          <label class="field">
            <span>Aviso institucional</span>
            <textarea name="note" rows="4" required maxlength="400"></textarea>
          </label>
          <label class="field">
            <span>Texto complementar</span>
            <input name="metaText" required maxlength="120">
          </label>
          <div class="form-actions">
            <div class="form-feedback" hidden></div>
            <div class="inline-actions">
              <button class="btn btn-secondary" type="button" data-discard-block="footer">Descartar alterações</button>
              <button class="btn btn-primary" type="submit">Salvar rodapé</button>
            </div>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderAdminDashboardPage(user) {
  return renderLayout({
    title: "Admin | Plataforma clínica",
    description: "Painel administrativo do site e da operação clínica.",
    bodyClass: "admin-shell",
    head: ADMIN_FONTS_HEAD,
    styles: ["/admin.css"],
    scripts: ["/admin-dashboard/main.js"],
    content: `
      <div class="admin-layout">
        <nav class="admin-sidebar apenas-desktop" aria-label="Áreas do painel">
          <div class="marca">
            <div class="marca-selo" aria-hidden="true">e</div>
            <div class="marca-nome">Marina <em>· psi</em></div>
          </div>

          <div class="admin-nav-scroll">
            ${renderNavGroups()}
          </div>

          <div class="admin-sidebar-rodape">
            <div class="admin-sessao-info">
              <span class="admin-sessao-ponto" aria-hidden="true"></span>
              <span class="admin-sessao-email" title="Sessão autenticada">${escapeHtml(user.email)}</span>
            </div>
            <div class="admin-sidebar-acoes">
              <a class="btn btn-secondary" href="/" target="_blank" rel="noreferrer">Ver site <span aria-hidden="true">↗</span></a>
              <button id="logout-button" class="btn btn-secondary" type="button">Sair</button>
            </div>
          </div>
        </nav>

        <div class="admin-conteudo">
          <header class="admin-topbar apenas-mobile">
            <div class="marca-selo" aria-hidden="true">e</div>
            <div class="marca-nome">Marina</div>
            <span class="admin-topbar-sessao">
              <span class="admin-sessao-ponto" aria-hidden="true"></span>
              <span class="admin-sessao-email">${escapeHtml(user.email)}</span>
            </span>
          </header>

          <main class="admin-main">

          <section class="admin-panel usa-margens is-active" data-panel="dashboard">
            <header class="admin-tela-head admin-tela-head-solo">
              <div>
                <h1 id="dashboard-saudacao">Bem-vinda.</h1>
                <p id="dashboard-hoje"></p>
              </div>
            </header>

            <div class="admin-atalhos">
              <button class="admin-atalho" type="button" data-action="new-lead"><span aria-hidden="true">＋</span> Novo contato</button>
              <button class="admin-atalho" type="button" data-action="new-patient"><span aria-hidden="true">＋</span> Novo paciente</button>
              <button class="admin-atalho" type="button" data-action="new-session"><span aria-hidden="true">＋</span> Nova sessão</button>
              <button class="admin-atalho" id="copy-scheduling-link-dashboard" type="button"><span aria-hidden="true">⧉</span> Copiar link de agendamento</button>
              <button class="admin-atalho" type="button" data-panel-trigger="site">Editar site</button>
            </div>

            <div class="admin-contagens">
              <article class="admin-cartao-numero">
                <span class="admin-cartao-rotulo">Contatos novos</span>
                <strong id="summary-new-leads">0</strong>
                <span class="admin-cartao-nota">aguardando 1º retorno</span>
              </article>
              <article class="admin-cartao-numero">
                <span class="admin-cartao-rotulo">Pacientes ativos</span>
                <strong id="summary-active-patients">0</strong>
                <span class="admin-cartao-nota">em acompanhamento</span>
              </article>
              <article class="admin-cartao-numero">
                <span class="admin-cartao-rotulo">Sessões na semana</span>
                <strong id="summary-sessions-week">0</strong>
                <span class="admin-cartao-nota" id="summary-week-range"></span>
              </article>
              <article class="admin-cartao-numero">
                <span class="admin-cartao-rotulo">Pendentes de pagamento</span>
                <strong id="summary-pending-payments">0</strong>
                <span class="admin-cartao-nota">sessões realizadas</span>
              </article>
            </div>

            <div class="admin-dinheiros">
              <article class="admin-cartao-dinheiro">
                <span class="admin-cartao-rotulo">Recebido no mês</span>
                <strong id="summary-month-revenue">R$ 0,00</strong>
                <span class="admin-cartao-nota" id="summary-month-label">confirmado</span>
              </article>
              <article class="admin-cartao-dinheiro">
                <span class="admin-cartao-rotulo">Pendente no mês</span>
                <strong id="summary-month-pending">R$ 0,00</strong>
                <span class="admin-cartao-nota">a receber</span>
              </article>
            </div>

            <h2 class="admin-secao-titulo">Próximos atendimentos</h2>
            <div id="dashboard-upcoming-list" class="admin-lista-cartao"></div>
            <div id="dashboard-upcoming-empty" class="admin-vazio" hidden>
              Nenhum atendimento próximo cadastrado.
            </div>
          </section>

          <section class="admin-panel" data-panel="leads" hidden>
            ${renderTelaHead(
              "Contatos",
              "O funil de entrada — quem chegou e ainda não virou paciente.",
              '<button class="btn btn-escuro" type="button" data-action="new-lead"><span aria-hidden="true">＋</span> Novo contato</button>'
            )}

            <form id="lead-filters-form" class="admin-filtros-linha" novalidate>
              <input type="search" name="search" maxlength="120" placeholder="Buscar por nome ou telefone" aria-label="Buscar contatos">
              <select name="status" aria-label="Filtrar por status">${renderOptions(LEAD_STATUSES, OPTION_LABELS.leadStatus, {
                includeBlank: true,
                blankLabel: "Status: todos"
              })}</select>
              <button class="admin-limpar-filtros" type="button" data-reset-filter="lead" hidden>Limpar filtros</button>
              <span class="admin-contagem" id="leads-count"></span>
            </form>

            <div id="leads-list" class="admin-lista"></div>
            <div id="leads-empty" class="admin-vazio" hidden></div>
          </section>

          <section class="admin-panel" data-panel="patients" hidden>
            ${renderTelaHead(
              "Pacientes",
              "Cadastro administrativo. O conteúdo clínico vive no prontuário de cada um.",
              '<button class="btn btn-escuro" type="button" data-action="new-patient"><span aria-hidden="true">＋</span> Novo paciente</button>'
            )}

            <form id="patient-filters-form" class="admin-filtros-linha" novalidate>
              <input type="search" name="search" maxlength="120" placeholder="Buscar por nome, apelido ou telefone" aria-label="Buscar pacientes">
              <select name="status" aria-label="Filtrar por status">${renderOptions(PATIENT_STATUSES, OPTION_LABELS.patientStatus, {
                includeBlank: true,
                blankLabel: "Status: todos"
              })}</select>
              <button class="admin-limpar-filtros" type="button" data-reset-filter="patient" hidden>Limpar filtros</button>
              <span class="admin-contagem" id="patients-count"></span>
            </form>

            <div id="patients-list" class="admin-lista"></div>
            <div id="patients-empty" class="admin-vazio" hidden></div>
          </section>

          <section class="admin-panel" data-panel="clinical" hidden>
            <button class="cofre-voltar" type="button" data-action="back-to-patients">
              <span aria-hidden="true">←</span> Pacientes
            </button>

            <div class="cofre">
              <div class="cofre-faixa" role="note">
                <span class="glifo" aria-hidden="true">◆</span>
                <span>
                  <strong>Área criptografada — prontuário clínico.</strong>
                  Tudo aqui é sigiloso e versionado. Dados administrativos (valores, horários,
                  contatos) não entram nesta área.
                </span>
              </div>

              <div class="cofre-identidade">
                <div>
                  <h1 id="clinical-patient-name">Prontuário do paciente</h1>
                  <div class="cofre-identidade-meta" id="clinical-patient-card"></div>
                </div>
                <div class="inline-actions" id="clinical-record-actions"></div>
              </div>

              <div class="cofre-encerrado" id="clinical-record-closed-banner" role="note" hidden></div>

              <div class="admin-tabs">
                <button class="admin-tab is-active" type="button" data-clinical-tab="resumo">Resumo</button>
                <button class="admin-tab" type="button" data-clinical-tab="contrato">
                  Contrato <span class="admin-tab-contador" id="clinical-tab-contrato"></span>
                </button>
                <button class="admin-tab" type="button" data-clinical-tab="plano">
                  Plano <span class="admin-tab-contador" id="clinical-tab-plano"></span>
                </button>
                <button class="admin-tab" type="button" data-clinical-tab="anamnese">
                  Anamnese <span class="admin-tab-contador" id="clinical-tab-anamnese"></span>
                </button>
                <button class="admin-tab" type="button" data-clinical-tab="evolucoes">
                  Evoluções <span class="admin-tab-contador" id="clinical-tab-evolucoes"></span>
                </button>
                <button class="admin-tab" type="button" data-clinical-tab="documentos">
                  Documentos <span class="admin-tab-contador" id="clinical-tab-documentos"></span>
                </button>
              </div>

              <section class="cofre-painel" data-clinical-panel="resumo">
                <div id="clinical-summary"></div>
              </section>

${renderBlockPanel({
                painel: "contrato",
                rotulo: "Contrato e consentimento",
                prefixo: "contract"
              })}
${renderBlockPanel({
                painel: "plano",
                rotulo: "Plano terapêutico",
                prefixo: "plan"
              })}
              <section class="cofre-painel" data-clinical-panel="anamnese" hidden>
                <div class="admin-card-head">
                  <div>
                    <div class="rotulo-micro">Anamnese</div>
                    <h3 id="clinical-intake-status">Carregando…</h3>
                    <p class="field-help" id="clinical-intake-help"></p>
                  </div>
                  <div class="inline-actions" id="clinical-intake-actions"></div>
                </div>

                <div id="clinical-intake-progress-wrap" hidden>
                  <div class="anamnese-progresso" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="clinical-intake-progress-bar">
                    <div class="anamnese-progresso-barra" id="clinical-intake-progress" style="width:0%"></div>
                  </div>
                  <p class="field-help" id="clinical-intake-progress-text"></p>
                </div>

                <div id="clinical-intake-index" class="anamnese-indice"></div>
                <div id="clinical-intake-sections" data-form="intake"></div>
              </section>

              <section class="cofre-painel" data-clinical-panel="evolucoes" hidden>
                <div class="admin-card-head">
                  <div>
                    <div class="rotulo-micro">Evoluções</div>
                    <h3>Anotações clínicas</h3>
                  </div>
                  <button class="btn btn-primary btn-compacto" type="button" data-action="new-evolution">
                    <span aria-hidden="true">＋</span> Nova evolução
                  </button>
                </div>

                <form class="cofre-cartao" id="clinical-evolution-form" hidden>
                  <input type="hidden" name="id">
                  <input type="hidden" name="parentId">
                  <div class="field-grid two-columns">
                    <label class="field">
                      <span>Tipo</span>
                      <select name="evolutionType">
                        <option value="session">Evolução de sessão</option>
                        <option value="initial">Registro inicial</option>
                        <option value="guardian_contact">Contato com responsável</option>
                        <option value="referral">Encaminhamento</option>
                        <option value="closing">Encerramento</option>
                        <option value="other">Outro</option>
                      </select>
                    </label>
                    <label class="field">
                      <span>Sessão vinculada (opcional)</span>
                      <select name="sessionId">
                        <option value="">Sem sessão vinculada</option>
                      </select>
                    </label>
                    <label class="field">
                      <span>Data</span>
                      <input type="datetime-local" name="evolutionDate">
                    </label>
                    <label class="field">
                      <span>Título (opcional)</span>
                      <input type="text" name="title" maxlength="160" placeholder="Ex.: Sessão 1">
                    </label>
                  </div>
                  <label class="field">
                    <span>Conteúdo clínico (criptografado)</span>
                    <textarea name="content" rows="8" placeholder="Registro técnico do atendimento. Não inclua dados administrativos."></textarea>
                  </label>
                  <div class="form-feedback" hidden></div>
                  <div class="inline-actions">
                    <button class="btn btn-primary" type="submit">Salvar evolução</button>
                    <button class="btn btn-secondary" type="button" data-action="cancel-evolution-form">Cancelar</button>
                  </div>
                </form>

                <div id="clinical-evolutions-list" class="admin-lista"></div>
                <div id="clinical-evolutions-empty" class="admin-vazio" hidden></div>
              </section>
              <section class="cofre-painel" data-clinical-panel="documentos" hidden>
                <div class="admin-card-head">
                  <div>
                    <div class="rotulo-micro">Documentos</div>
                    <h3>Documentos emitidos</h3>
                    <p class="field-help">
                      Declaração, atestado, relatório, parecer e encaminhamento. Cada documento
                      recebe número próprio, sai em PDF e fica registrado no prontuário.
                    </p>
                  </div>
                  <button class="btn btn-primary btn-compacto" type="button" data-action="new-document">
                    <span aria-hidden="true">＋</span> Emitir documento
                  </button>
                </div>

                <form class="cofre-cartao" id="clinical-document-form" hidden>
                  <div class="field-grid two-columns">
                    <label class="field">
                      <span>Tipo</span>
                      <select name="documentType">
                        <option value="attendance_declaration">Declaração de comparecimento</option>
                        <option value="psychological_certificate">Atestado psicológico</option>
                        <option value="report">Relatório psicológico</option>
                        <option value="opinion">Parecer psicológico</option>
                        <option value="referral">Encaminhamento</option>
                      </select>
                    </label>
                    <label class="field">
                      <span>Título (opcional)</span>
                      <input type="text" name="title" maxlength="160" placeholder="Ex.: Comparecimento em agosto">
                    </label>
                    <label class="field">
                      <span>Destinatário</span>
                      <input type="text" name="addressee" maxlength="200" placeholder="Ex.: A quem possa interessar">
                    </label>
                    <label class="field">
                      <span>Validade (opcional)</span>
                      <input type="text" name="validUntil" maxlength="80" placeholder="Ex.: 30 dias">
                    </label>
                  </div>
                  <label class="field">
                    <span>Finalidade</span>
                    <input type="text" name="purpose" maxlength="500" placeholder="Para que serve este documento">
                  </label>
                  <label class="field">
                    <span>Conteúdo (criptografado)</span>
                    <textarea name="body" rows="7" placeholder="Texto do documento, na medida do que a finalidade exige."></textarea>
                  </label>
                  <div class="form-feedback" hidden></div>
                  <div class="inline-actions">
                    <button class="btn btn-primary" type="submit">Emitir documento</button>
                    <button class="btn btn-secondary" type="button" data-action="cancel-document-form">Cancelar</button>
                  </div>
                </form>

                <div id="clinical-documents-list" class="admin-lista"></div>
                <div id="clinical-documents-empty" class="admin-vazio" hidden></div>
              </section>
            </div>
          </section>

          <section class="admin-panel" data-panel="sessions" hidden>
            ${renderTelaHead(
              "Sessões",
              "Agenda administrativa e controle de pagamento — abra uma sessão para todas as ações.",
              '<button class="btn btn-escuro" type="button" data-action="new-session"><span aria-hidden="true">＋</span> Nova sessão</button>'
            )}

            <form id="session-filters-form" class="admin-filtros-rotulados" novalidate>
              <label class="admin-filtro-campo">
                <span>De</span>
                <input type="date" name="dateFrom">
              </label>
              <label class="admin-filtro-campo">
                <span>Até</span>
                <input type="date" name="dateTo">
              </label>
              <label class="admin-filtro-campo">
                <span>Paciente</span>
                <select name="patientId" data-patient-select>${renderOptions([], {}, {
                  includeBlank: true,
                  blankLabel: "Paciente: todos"
                })}</select>
              </label>
              <label class="admin-filtro-campo">
                <span>Status da sessão</span>
                <select name="status">${renderOptions(SESSION_STATUSES, OPTION_LABELS.sessionStatus, {
                  includeBlank: true,
                  blankLabel: "Todos"
                })}</select>
              </label>
              <label class="admin-filtro-campo">
                <span>Pagamento</span>
                <select name="paymentStatus">${renderOptions(PAYMENT_STATUSES, OPTION_LABELS.paymentStatus, {
                  includeBlank: true,
                  blankLabel: "Todos"
                })}</select>
              </label>
            </form>

            <div class="admin-filtros-resumo">
              <button class="admin-limpar-filtros" type="button" data-reset-filter="session" id="session-clear" hidden></button>
              <span class="admin-contagem" id="sessions-count"></span>
            </div>

            <div id="sessions-list" class="admin-lista"></div>
            <div id="sessions-empty" class="admin-vazio" hidden></div>
          </section>

          <section class="admin-panel" data-panel="finance" hidden>
            ${renderTelaHead(
              "Financeiro",
              "Tudo derivado das sessões — nada é lançado à mão.",
              '<button class="btn btn-secondary" id="finance-export-button" type="button"><span aria-hidden="true">⤓</span> Exportar CSV do recorte</button>'
            )}

            <form id="finance-filters-form" class="admin-filtros-linha" novalidate>
              <select name="month" aria-label="Mês">${renderMonthOptions()}</select>
              <select name="year" aria-label="Ano">${renderYearOptions()}</select>
              <select name="patientId" data-patient-select aria-label="Paciente">${renderOptions([], {}, {
                includeBlank: true,
                blankLabel: "Paciente: todos"
              })}</select>
              <select name="paymentStatus" aria-label="Status do pagamento">${renderOptions(PAYMENT_STATUSES, OPTION_LABELS.paymentStatus, {
                includeBlank: true,
                blankLabel: "Pagamento: todos"
              })}</select>
            </form>

            <div class="admin-metric-grid">
              <article class="admin-metric-card is-dinheiro">
                <span class="rotulo-micro">Recebido no mês</span>
                <strong id="finance-total-received">R$ 0,00</strong>
              </article>
              <article class="admin-metric-card is-pendente">
                <span class="rotulo-micro"><span aria-hidden="true">◐</span> Pendente no mês</span>
                <strong id="finance-total-pending">R$ 0,00</strong>
              </article>
              <article class="admin-metric-card">
                <span class="rotulo-micro">Sessões realizadas</span>
                <strong id="finance-completed-sessions">0</strong>
              </article>
              <article class="admin-metric-card">
                <span class="rotulo-micro">Pendentes de pagamento</span>
                <strong id="finance-pending-count">0</strong>
              </article>
            </div>

            <h2 class="admin-secao-titulo">Pagamentos pendentes</h2>
            <div id="finance-pending-list" class="admin-lista-cartao"></div>
            <div id="finance-pending-empty" class="admin-vazio" hidden>
              Nenhum pagamento pendente neste recorte — tudo em dia. <span aria-hidden="true">●</span>
            </div>

            <h2 class="admin-secao-titulo">Pagamentos recebidos</h2>
            <div id="finance-received-list" class="admin-lista-cartao"></div>
            <div id="finance-received-empty" class="admin-vazio" hidden>
              Nenhum pagamento recebido neste recorte.
            </div>

            <div class="admin-secao-head">
              <h2 class="admin-secao-titulo">Recibos emitidos</h2>
              <label class="admin-secao-head-controle">
                <span>Apurar por</span>
                <select id="finance-receipt-basis" aria-label="Regime de apuração dos recibos">
                  <option value="competencia">Mês da sessão</option>
                  <option value="caixa">Mês do pagamento</option>
                </select>
              </label>
            </div>
            <div id="finance-receipts-list" class="admin-lista-cartao"></div>
            <div id="finance-receipts-empty" class="admin-vazio" hidden>
              Nenhum recibo emitido neste recorte.
            </div>
          </section>

          <section class="admin-panel" data-panel="messages" hidden>
            ${renderTelaHead(
              "Mensagens",
              "Modelos prontos para WhatsApp e e-mail, com variáveis substituídas na hora de copiar.",
              '<button class="btn btn-escuro" type="button" data-action="new-message"><span aria-hidden="true">＋</span> Novo modelo</button>'
            )}

            <form id="message-filters-form" class="admin-filtros-linha" novalidate>
              <input type="search" name="search" maxlength="120" placeholder="Buscar por título" aria-label="Buscar modelos">
              <select name="category" aria-label="Categoria" class="admin-filtro-medio">${renderOptions(MESSAGE_TEMPLATE_CATEGORIES, OPTION_LABELS.messageCategory, {
                includeBlank: true,
                blankLabel: "Categoria: todas"
              })}</select>
              <button class="admin-limpar-filtros" type="button" data-reset-filter="message" hidden>Limpar</button>
            </form>

            <div id="messages-list" class="admin-lista"></div>
            <div id="messages-empty" class="admin-vazio" hidden></div>
          </section>

          <section class="admin-panel" data-panel="agenda" hidden>
            ${renderTelaHead(
              "Agenda",
              "Agendamento externo, dados do recibo e a integração com o Google Calendar."
            )}

            <div class="admin-grade-dupla">
              <section class="admin-card">
                <h2 class="admin-card-titulo">Agendamento e recibo</h2>
                <p class="admin-card-sub">Os dados profissionais saem impressos no PDF do recibo.</p>

                <form id="platform-settings-form" class="admin-form" novalidate>
                  <div class="field-grid two-columns">
                    <label class="field">
                      <span>Link de agendamento</span>
                      <input name="schedulingUrl" maxlength="255" placeholder="https://cal.com/...">
                    </label>
                    <label class="field">
                      <span>Rótulo do link</span>
                      <input name="schedulingLabel" maxlength="80" required>
                    </label>
                    <label class="field">
                      <span>Link padrão da sessão</span>
                      <input name="meetingDefaultUrl" maxlength="255" placeholder="https://meet.google.com/...">
                    </label>
                    <label class="field">
                      <span>Nome profissional</span>
                      <input name="professionalName" maxlength="140" placeholder="Nome completo">
                    </label>
                    <label class="field">
                      <span>CRP</span>
                      <input name="crp" maxlength="60" placeholder="00/00000">
                    </label>
                    <label class="field">
                      <span>Documento profissional</span>
                      <input name="professionalDocument" maxlength="60" placeholder="CPF ou CNPJ, se desejar">
                    </label>
                    <label class="field">
                      <span>Cidade do recibo</span>
                      <input name="receiptCity" maxlength="80" placeholder="Belo Horizonte">
                    </label>
                  </div>

                  <label class="field">
                    <span>Texto da política de cancelamento</span>
                    <textarea name="cancellationPolicyText" rows="3" maxlength="500" required></textarea>
                  </label>

                  <label class="field">
                    <span>Texto de rodapé do recibo</span>
                    <textarea name="receiptFooterText" rows="3" maxlength="300"></textarea>
                  </label>

                  <label class="field checkbox-field">
                    <input name="showSchedulingButton" type="checkbox">
                    <span>Exibir o botão de agendamento no site público</span>
                  </label>

                  <div class="admin-card-rodape">
                    <div class="form-feedback" hidden></div>
                    <button class="btn btn-secondary" id="copy-scheduling-link-agenda" type="button">
                      <span aria-hidden="true">⧉</span> Copiar link de agendamento
                    </button>
                    <button class="btn btn-primary" type="submit">Salvar agenda</button>
                  </div>
                </form>
              </section>

              <section class="admin-card">
                <h2 class="admin-card-titulo">Google Calendar</h2>

                <div id="google-calendar-connected" hidden>
                  <div class="admin-gcal-status">
                    <span class="chip chip-verde" id="google-calendar-status-text">
                      <span class="chip-glifo" aria-hidden="true">●</span>Conectado
                    </span>
                    <span class="mono texto-secundario" id="google-calendar-status-email"></span>
                  </div>
                  <p class="admin-card-sub" id="google-calendar-status-sync"></p>

                  <div class="inline-actions admin-gcal-acoes">
                    <button class="btn btn-secondary btn-compacto" id="google-calendar-test-button" type="button">Testar conexão</button>
                    <button class="btn btn-ambar btn-compacto" id="google-calendar-reprocess-button" type="button" hidden></button>
                    <button class="btn btn-excluir btn-compacto" id="google-calendar-disconnect-button" type="button">Desconectar</button>
                  </div>

                  <p class="form-feedback" id="google-calendar-action-feedback" hidden></p>

                  <form id="google-calendar-form" class="admin-gcal-prefs" novalidate>
                    <div class="rotulo-secao">Preferências</div>
                    <label class="field checkbox-field">
                      <input name="googleCalendarEnabled" type="checkbox">
                      <span>Ativar sincronização automática das sessões</span>
                    </label>
                    <label class="field checkbox-field">
                      <input name="googleCalendarCreateMeet" type="checkbox">
                      <span>Criar link do Google Meet quando a sessão não tiver um</span>
                    </label>
                    <label class="field checkbox-field">
                      <input name="googleCalendarSendUpdates" type="checkbox">
                      <span>Enviar convite ao e-mail do paciente, quando houver</span>
                    </label>

                    <div class="field-grid two-columns">
                      <label class="field">
                        <span>Calendário usado</span>
                        <select name="googleCalendarId" id="google-calendar-id-select">
                          <option value="primary">Principal</option>
                        </select>
                      </label>
                      <label class="field">
                        <span>Lembrete (min)</span>
                        <input class="mono" name="googleCalendarReminderMinutes" type="number" min="0" max="40320" step="5">
                      </label>
                    </div>

                    <div class="admin-card-rodape">
                      <div class="form-feedback" hidden></div>
                      <button class="btn btn-primary" type="submit">Salvar integração</button>
                    </div>
                  </form>
                </div>

                <div id="google-calendar-disconnected" hidden>
                  <p class="admin-gcal-explica" id="google-calendar-explica">
                    Nenhuma conta conectada. Conectar leva você à autorização do Google e traz de
                    volta — as sessões passam a virar eventos automaticamente.
                  </p>
                  <button class="btn btn-escuro btn-largo" id="google-calendar-connect-button" type="button">
                    Conectar ao Google Calendar
                  </button>
                </div>
              </section>
            </div>
          </section>

          <section class="admin-panel" data-panel="site" hidden>
            <header class="admin-tela-head">
              <div>
                <h1>Site</h1>
                <p>
                  Dez blocos de conteúdo, cada um salvo por conta própria.
                  <strong id="site-resumo-texto"></strong>
                </p>
              </div>
              <a class="btn btn-secondary" href="/" target="_blank" rel="noreferrer">Ver como ficou <span aria-hidden="true">↗</span></a>
            </header>

            ${renderSiteForms()}
          </section>

          <section class="admin-panel" data-panel="audit" hidden>
            ${renderTelaHead(
              "Auditoria",
              "Tudo que foi feito no painel, registrado — o único conjunto paginado do sistema."
            )}

            <form id="audit-filters-form" class="admin-filtros-linha" novalidate>
              <!-- Listas, não texto livre: a consulta compara por igualdade
                   exata, então digitar um prefixo nunca casava com nada. -->
              <select name="action" aria-label="Filtrar por ação">${renderOptions(AUDIT_ACTIONS, {}, {
                includeBlank: true,
                blankLabel: "Ação: todas"
              })}</select>
              <select name="entityType" aria-label="Filtrar por tipo de entidade">${renderOptions(AUDIT_ENTITY_TYPES, {}, {
                includeBlank: true,
                blankLabel: "Entidade: todas"
              })}</select>
              <input type="date" name="date" aria-label="Filtrar por data">
              <input type="text" name="adminEmail" maxlength="160" placeholder="E-mail do admin" aria-label="Filtrar por e-mail do administrador">
              <button class="admin-limpar-filtros" type="button" data-reset-filter="audit" hidden>Limpar filtros</button>
            </form>

            <div id="audit-list" class="admin-lista-cartao"></div>
            <div id="audit-empty" class="admin-vazio" hidden></div>

            <div class="admin-pagination">
              <button class="btn btn-secondary btn-compacto" id="audit-prev-page" type="button">
                <span aria-hidden="true">‹</span> Anterior
              </button>
              <span id="audit-pagination-text" class="admin-inline-note">Página 1</span>
              <button class="btn btn-secondary btn-compacto" id="audit-next-page" type="button">
                Próxima <span aria-hidden="true">›</span>
              </button>
            </div>
          </section>

          <section class="admin-panel" data-panel="settings" hidden>
            ${renderTelaHead(
              "Configurações",
              "Somente leitura — identificação, orientações de uso e a saúde do ambiente."
            )}

            <div class="admin-grade-dupla">
              <section class="admin-card">
                <h2 class="admin-card-titulo">Administradora</h2>
                <div class="admin-conta">
                  <div class="admin-conta-monograma" aria-hidden="true">${escapeHtml(
                    (user.email || "?").trim().charAt(0).toUpperCase()
                  )}</div>
                  <div>
                    <div class="admin-conta-nome">Marina Alves</div>
                    <div class="admin-conta-email mono">${escapeHtml(user.email)}</div>
                    <div class="texto-apoio">CRP 00/00000 · acesso único, sem outros usuários</div>
                  </div>
                </div>

                <div class="rotulo-secao">Orientações de uso</div>
                <ul class="admin-orientacoes">
                  <li>
                    <strong>Notas administrativas não recebem conteúdo clínico.</strong>
                    Hipóteses, sintomas e relatos vivem só no prontuário criptografado.
                  </li>
                  <li>O prontuário é versionado: nada é sobrescrito, e bloqueios são definitivos.</li>
                  <li>A primeira ação do dia pode demorar até 30 s — o servidor dorme quando ocioso.</li>
                  <li>Recibos têm numeração sequencial e nunca são duplicados para a mesma sessão.</li>
                </ul>
              </section>

              <section class="admin-card">
                <h2 class="admin-card-titulo">Checklist do ambiente</h2>
                <p class="admin-card-sub">Verificações de produção — só indicadores, nenhuma credencial aparece.</p>
                <div id="security-status-list" class="admin-security-list"></div>
              </section>
            </div>
          </section>
          </main>
        </div>

        <nav class="admin-bottom-nav apenas-mobile" aria-label="Navegação principal">
          ${renderBottomNav()}
        </nav>

        <button id="sheet-backdrop" class="admin-sheet-fundo apenas-mobile" type="button" aria-label="Fechar" hidden></button>
        <div id="sheet-areas" class="admin-sheet apenas-mobile" role="dialog" aria-label="Todas as áreas" hidden>
          <div class="admin-sheet-alca" aria-hidden="true"></div>
          <div class="admin-sheet-grade">
            ${renderSheetAreas()}
          </div>
          <div class="admin-sheet-rodape">
            <a class="btn btn-secondary" href="/" target="_blank" rel="noreferrer">Ver site ↗</a>
            <button id="logout-button-mobile" class="btn btn-secondary" type="button">Sair</button>
          </div>
        </div>
      </div>

      <div id="patient-drawer" class="admin-overlay" hidden>
        <div class="admin-drawer" role="dialog" aria-modal="true" aria-labelledby="patient-form-title">
          <div class="admin-drawer-head">
            <div>
              <span class="admin-selo-modo is-criando" id="patient-form-mode">＋ Criando novo</span>
              <h2 id="patient-form-title">Novo paciente</h2>
            </div>
            <button class="admin-fechar" type="button" data-close-drawer="patient" aria-label="Fechar">✕</button>
          </div>

          <form id="patient-form" class="admin-drawer-corpo" novalidate>
            <input name="id" type="hidden">
            <div class="field-grid two-columns">
              <label class="field">
                <span>Nome completo</span>
                <input name="fullName" required maxlength="140">
              </label>
              <label class="field">
                <span>Nome preferido</span>
                <input name="preferredName" maxlength="80">
              </label>
              <label class="field">
                <span>Data de nascimento</span>
                <input name="birthDate" type="date">
              </label>
              <label class="field">
                <span>Idade</span>
                <input name="age" type="number" min="0" max="120">
              </label>
              <label class="field">
                <span>Telefone</span>
                <input name="phone" maxlength="30">
              </label>
              <label class="field">
                <span>E-mail</span>
                <input name="email" maxlength="160">
              </label>
              <label class="field">
                <span>Tipo de paciente</span>
                <select name="patientType">${renderOptions(PATIENT_TYPES, OPTION_LABELS.patientType)}</select>
              </label>
              <label class="field">
                <span>Modalidade</span>
                <select name="modality">${renderOptions(PATIENT_MODALITIES, OPTION_LABELS.patientModality)}</select>
              </label>
              <label class="field">
                <span>Valor padrão da sessão</span>
                <input name="sessionPrice" type="number" min="0" step="0.01">
              </label>
              <label class="field">
                <span>Status</span>
                <select name="status">${renderOptions(PATIENT_STATUSES, OPTION_LABELS.patientStatus)}</select>
              </label>
              <label class="field">
                <span>Dia padrão</span>
                <select name="defaultWeekday">${renderOptions(WEEKDAY_OPTIONS, OPTION_LABELS.weekday, {
                  includeBlank: true,
                  blankLabel: "Sem padrão"
                })}</select>
              </label>
              <label class="field">
                <span>Horário padrão</span>
                <input name="defaultTime" type="time">
              </label>
            </div>

            <div id="guardian-fields" hidden>
              <div class="aviso aviso-info">
                <span aria-hidden="true">◐</span>
                <span>Paciente adolescente: os dados do responsável são obrigatórios.</span>
              </div>
              <div class="field-grid two-columns" style="margin-top:10px">
                <label class="field">
                  <span>Responsável</span>
                  <input name="guardianName" maxlength="120">
                </label>
                <label class="field">
                  <span>Telefone do responsável</span>
                  <input name="guardianPhone" maxlength="30">
                </label>
              </div>
            </div>

            <label class="field">
              <span>Nota administrativa</span>
              <textarea name="administrativeNote" rows="3" maxlength="400"></textarea>
            </label>
            <p class="field-help">Não use este cadastro para prontuário, hipótese clínica ou evolução terapêutica.</p>
            <div class="form-feedback" hidden></div>
          </form>

          <div class="admin-drawer-rodape">
            <button class="btn btn-secondary" type="button" data-close-drawer="patient">Cancelar</button>
            <button class="btn btn-primary" type="submit" form="patient-form">Salvar paciente</button>
          </div>
        </div>
      </div>

      <div id="lead-drawer" class="admin-overlay" hidden>
        <div class="admin-drawer" role="dialog" aria-modal="true" aria-labelledby="lead-form-title">
          <div class="admin-drawer-head">
            <div>
              <span class="admin-selo-modo is-criando" id="lead-form-mode">＋ Criando novo</span>
              <h2 id="lead-form-title">Novo contato</h2>
            </div>
            <button class="admin-fechar" type="button" data-close-drawer="lead" aria-label="Fechar">✕</button>
          </div>

          <form id="lead-form" class="admin-drawer-corpo" novalidate>
            <input name="id" type="hidden">
            <div class="field-grid two-columns">
              <label class="field">
                <span>Nome</span>
                <input name="name" required maxlength="120">
              </label>
              <label class="field">
                <span>Telefone</span>
                <input name="phone" required maxlength="30">
              </label>
              <label class="field">
                <span>E-mail</span>
                <input name="email" maxlength="160">
              </label>
              <label class="field">
                <span>Idade</span>
                <input name="age" type="number" min="0" max="120">
              </label>
              <label class="field">
                <span>Origem</span>
                <select name="source">${renderOptions(LEAD_SOURCES, OPTION_LABELS.leadSource)}</select>
              </label>
              <label class="field">
                <span>Interesse</span>
                <select name="interest">${renderOptions(LEAD_INTERESTS, OPTION_LABELS.leadInterest)}</select>
              </label>
              <label class="field">
                <span>Status</span>
                <select name="status">${renderOptions(LEAD_STATUSES, OPTION_LABELS.leadStatus)}</select>
              </label>
              <label class="field">
                <span>Período preferido</span>
                <select name="preferredPeriod">${renderOptions(LEAD_PREFERRED_PERIODS, OPTION_LABELS.preferredPeriod)}</select>
              </label>
            </div>
            <label class="field">
              <span>Nota administrativa</span>
              <textarea name="administrativeNote" rows="3" maxlength="400"></textarea>
            </label>
            <p class="field-help">Observações operacionais curtas. Não registre conteúdo clínico aqui.</p>
            <div class="form-feedback" hidden></div>
          </form>

          <div class="admin-drawer-rodape">
            <button class="btn btn-secondary" type="button" data-close-drawer="lead">Cancelar</button>
            <button class="btn btn-primary" type="submit" form="lead-form">Salvar contato</button>
          </div>
        </div>
      </div>

      <div id="session-drawer" class="admin-overlay" hidden>
        <div class="admin-drawer" role="dialog" aria-modal="true" aria-labelledby="session-form-title">
          <div class="admin-drawer-head">
            <div>
              <span class="admin-selo-modo is-criando" id="session-form-mode">＋ Criando novo</span>
              <h2 id="session-form-title">Nova sessão</h2>
            </div>
            <button class="admin-fechar" type="button" data-close-drawer="session" aria-label="Fechar">✕</button>
          </div>

          <form id="session-form" class="admin-drawer-corpo" novalidate>
            <input name="id" type="hidden">
            <div class="field-grid two-columns">
              <label class="field">
                <span>Paciente</span>
                <select name="patientId" data-patient-select required></select>
              </label>
              <label class="field">
                <span>Data e hora</span>
                <input name="scheduledAt" type="datetime-local" required>
              </label>
              <label class="field">
                <span>Duração (minutos)</span>
                <input name="durationMinutes" type="number" min="30" max="240" step="5" required>
              </label>
              <label class="field">
                <span>Valor</span>
                <input name="price" type="number" min="0" step="0.01" required>
              </label>
              <label class="field">
                <span>Status da sessão</span>
                <select name="status">${renderOptions(SESSION_STATUSES, OPTION_LABELS.sessionStatus)}</select>
              </label>
              <label class="field">
                <span>Status do pagamento</span>
                <select name="paymentStatus">${renderOptions(PAYMENT_STATUSES, OPTION_LABELS.paymentStatus)}</select>
              </label>
              <label class="field">
                <span>Forma de pagamento</span>
                <select name="paymentMethod">${renderOptions(PAYMENT_METHODS, OPTION_LABELS.paymentMethod)}</select>
              </label>
              <label class="field">
                <span>Pago em</span>
                <input name="paidAt" type="datetime-local">
              </label>
            </div>
            <label class="field">
              <span>Link da sessão</span>
              <input name="meetingUrl" maxlength="255" placeholder="https://...">
            </label>
            <label class="field">
              <span>Nota administrativa</span>
              <textarea name="administrativeNote" rows="3" maxlength="400"></textarea>
            </label>
            <div class="form-feedback" hidden></div>
          </form>

          <div class="admin-drawer-rodape">
            <button class="btn btn-secondary" type="button" data-close-drawer="session">Cancelar</button>
            <button class="btn btn-primary" type="submit" form="session-form">Salvar sessão</button>
          </div>
        </div>
      </div>

      <div id="message-drawer" class="admin-overlay" hidden>
        <div class="admin-drawer" role="dialog" aria-modal="true" aria-labelledby="message-form-title">
          <div class="admin-drawer-head">
            <div>
              <span class="admin-selo-modo is-criando" id="message-form-mode">＋ Criando novo</span>
              <h2 id="message-form-title">Novo modelo</h2>
            </div>
            <button class="admin-fechar" type="button" data-close-drawer="message" aria-label="Fechar">✕</button>
          </div>

          <form id="message-form" class="admin-drawer-corpo" novalidate>
            <input name="id" type="hidden">
            <div class="field-grid two-columns">
              <label class="field">
                <span>Título</span>
                <input name="title" required maxlength="120">
              </label>
              <label class="field">
                <span>Categoria</span>
                <select name="category">${renderOptions(MESSAGE_TEMPLATE_CATEGORIES, OPTION_LABELS.messageCategory)}</select>
              </label>
            </div>

            <div class="admin-variable-list">
              <span class="rotulo-micro">Variáveis — clique para inserir</span>
              <div>${MESSAGE_TEMPLATE_VARIABLES.map(
                (item) =>
                  `<button type="button" class="admin-variavel" data-action="insert-variable" data-variable="${escapeHtml(
                    item
                  )}">${escapeHtml(item)}</button>`
              ).join("")}</div>
            </div>

            <label class="field">
              <span>Mensagem <span class="field-contador" id="message-body-count">0/2500</span></span>
              <textarea name="body" rows="10" required maxlength="2500"></textarea>
            </label>

            <label class="field checkbox-field">
              <input name="isActive" type="checkbox" checked>
              <span>Modelo ativo</span>
            </label>
            <div class="form-feedback" hidden></div>
          </form>

          <div class="admin-drawer-rodape">
            <button class="btn btn-secondary" type="button" data-close-drawer="message">Cancelar</button>
            <button class="btn btn-primary" type="submit" form="message-form">Salvar modelo</button>
          </div>
        </div>
      </div>

      <div id="session-sheet" class="admin-overlay" hidden>
        <div class="admin-bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="session-sheet-titulo">
          <div class="admin-sheet-alca apenas-mobile" aria-hidden="true"></div>

          <div class="admin-card-head">
            <div>
              <div class="rotulo-micro">Ficha da sessão</div>
              <h3 id="session-sheet-titulo">Sessão</h3>
              <div class="admin-registro-linha" id="session-sheet-meta"></div>
            </div>
            <button class="admin-fechar" type="button" data-close-drawer="session-sheet" aria-label="Fechar">✕</button>
          </div>

          <div class="session-sheet-principais">
            <button class="btn btn-primary btn-largo" type="button" data-action="done-session" id="session-sheet-done">
              <span aria-hidden="true">●</span> Marcar realizada
            </button>
            <button class="btn btn-verde-suave btn-largo" type="button" data-action="paid-session" id="session-sheet-paid">
              <span aria-hidden="true">R$</span> Marcar pago
            </button>
          </div>

          <div class="session-sheet-grade">
            <button class="btn btn-secondary" type="button" data-action="edit-session">Editar</button>
            <button class="btn btn-secondary" type="button" data-action="reschedule-session">Remarcar</button>
            <button class="btn btn-secondary" type="button" data-action="missed-session">Falta</button>
            <button class="btn btn-secondary" type="button" data-action="cancel-session">Cancelar sessão</button>
          </div>

          <div id="session-sheet-sync" class="session-sheet-sync" hidden></div>

          <div class="session-sheet-perigo">
            <button class="btn btn-perigo-suave" type="button" data-action="delete-session">Excluir sessão</button>
          </div>
        </div>
      </div>

      <template id="help-card-template">
        <article class="admin-nested-card">
          <div class="admin-nested-card-head">
            <h3>Card</h3>
            <button type="button" class="btn btn-secondary btn-compacto" data-action="remove-help-card">Remover</button>
          </div>
          <div class="field-grid two-columns">
            <label class="field">
              <span>Ordem</span>
              <input name="sortOrder" type="number" min="1" max="99" required>
            </label>
            <label class="field">
              <span>Título</span>
              <input name="title" maxlength="120" required>
            </label>
          </div>
          <label class="field">
            <span>Descrição</span>
            <textarea name="description" rows="3" maxlength="300" required></textarea>
          </label>
          <div class="field-grid two-columns">
            <label class="field">
              <span>Tipo de mídia</span>
              <select name="assetType">
                <option value="icon">Ícone</option>
                <option value="image">Imagem</option>
              </select>
            </label>
            <label class="field help-icon-field">
              <span>Ícone</span>
              <select name="assetValue"></select>
            </label>
          </div>
          <div class="upload-block help-image-block" hidden>
            <label class="field">
              <span>Caminho da imagem</span>
              <input name="assetImageUrl" readonly>
            </label>
            <label class="btn btn-secondary upload-button">
              Enviar imagem
              <input type="file" data-upload-target="assetImageUrl" accept=".jpg,.jpeg,.png,.webp" hidden>
            </label>
            <p class="field-help">Se selecionar imagem, ela substitui o ícone no card.</p>
            <img class="image-preview" data-preview-target="assetImageUrl" alt="" hidden>
          </div>
        </article>
      </template>

      <dialog id="copy-message-modal" class="admin-modal">
        <form method="dialog" class="admin-modal-inner" id="copy-message-modal-form">
          <div class="admin-card-head">
            <div>
              <div class="rotulo-micro">Copiar mensagem</div>
              <h3>Preencher variáveis</h3>
            </div>
          </div>
          <p class="field-help">Selecione o paciente (e a sessão, se quiser incluir dados como data e valor) para substituir as variáveis automaticamente.</p>
          <div class="field-grid two-columns">
            <label class="field">
              <span>Paciente</span>
              <select id="copy-modal-patient-select">
                <option value="">Sem paciente (manter variáveis)</option>
              </select>
            </label>
            <label class="field">
              <span>Sessão</span>
              <select id="copy-modal-session-select">
                <option value="">Sem sessão (manter variáveis)</option>
              </select>
            </label>
          </div>
          <div class="admin-modal-preview" id="copy-modal-preview" hidden>
            <span class="rotulo-micro">Pré-visualização</span>
            <pre id="copy-modal-preview-text"></pre>
          </div>
          <div class="form-actions">
            <div class="inline-actions">
              <button class="btn btn-primary" type="button" id="copy-modal-confirm">Copiar</button>
              <button class="btn btn-secondary" value="cancel">Cancelar</button>
            </div>
          </div>
        </form>
      </dialog>

      <dialog id="clinical-close-modal" class="admin-modal admin-modal-wide">
        <form method="dialog" class="admin-modal-inner" id="clinical-close-form">
          <div class="admin-card-head">
            <div>
              <div class="rotulo-micro">Encerramento</div>
              <h3>Encerrar prontuário</h3>
            </div>
          </div>
          <p class="field-help">
            O encerramento fecha o registro: depois dele o prontuário passa a ser leitura, e
            correções só entram como adendo. Um prontuário encerrado pode ser reaberto.
          </p>
          <label class="field">
            <span>Motivo</span>
            <select name="closingReason">
              <option value="discharge">Alta</option>
              <option value="referral">Encaminhamento</option>
              <option value="dropout">Desistência</option>
              <option value="professional_change">Mudança de profissional</option>
              <option value="other">Outro</option>
            </select>
          </label>
          <label class="field">
            <span>Síntese do processo</span>
            <textarea name="synthesis" rows="4" maxlength="8000" placeholder="O que foi trabalhado, do início ao fim."></textarea>
          </label>
          <div class="field-grid two-columns">
            <label class="field">
              <span>Objetivos alcançados</span>
              <textarea name="reached_goals" rows="3" maxlength="8000"></textarea>
            </label>
            <label class="field">
              <span>Objetivos não alcançados</span>
              <textarea name="pending_goals" rows="3" maxlength="8000"></textarea>
            </label>
          </div>
          <label class="field">
            <span>Orientações dadas no encerramento</span>
            <textarea name="guidance" rows="3" maxlength="8000"></textarea>
          </label>
          <div class="field-grid two-columns">
            <label class="field">
              <span>Encaminhamento</span>
              <textarea name="referral" rows="3" maxlength="8000" placeholder="Para quem e por quê"></textarea>
            </label>
            <label class="field">
              <span>Combinados sobre retorno</span>
              <textarea name="return_terms" rows="3" maxlength="8000"></textarea>
            </label>
          </div>
          <div class="form-feedback" hidden></div>
          <div class="form-actions">
            <div class="inline-actions">
              <button class="btn btn-primary" type="button" data-action="confirm-close-record">Encerrar prontuário</button>
              <button class="btn btn-secondary" value="cancel">Cancelar</button>
            </div>
          </div>
        </form>
      </dialog>

      <dialog id="clinical-evolution-modal" class="admin-modal admin-modal-wide">
        <div class="admin-modal-inner">
          <div class="admin-card-head">
            <div>
              <div class="rotulo-micro" id="clinical-evolution-modal-eyebrow">Evolução</div>
              <h3 id="clinical-evolution-modal-title">Evolução clínica</h3>
            </div>
            <span id="clinical-evolution-modal-status"></span>
          </div>
          <div class="admin-modal-preview">
            <span class="rotulo-micro">Conteúdo clínico</span>
            <pre id="clinical-evolution-modal-content"></pre>
          </div>
          <div class="form-actions">
            <div class="inline-actions" id="clinical-evolution-modal-actions"></div>
            <button class="btn btn-secondary" type="button" data-action="close-evolution-modal">Fechar</button>
          </div>
        </div>
      </dialog>

      <template id="social-link-template">
        <article class="admin-nested-card">
          <div class="admin-nested-card-head">
            <h3>Link social</h3>
            <button type="button" class="btn btn-secondary btn-compacto" data-action="remove-social-link">Remover</button>
          </div>
          <div class="field-grid three-columns">
            <label class="field">
              <span>Plataforma</span>
              <select name="platform">
                <option value="whatsapp">WhatsApp</option>
                <option value="instagram">Instagram</option>
                <option value="email">E-mail</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            <label class="field">
              <span>Rótulo</span>
              <input name="label" maxlength="60" required>
            </label>
            <label class="field">
              <span>URL</span>
              <input name="url" maxlength="255" required placeholder="https://... ou mailto:...">
            </label>
          </div>
        </article>
      </template>
    `
  });
}

module.exports = {
  renderAdminDashboardPage
};
