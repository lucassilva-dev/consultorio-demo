const root = document.getElementById("site-app");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatParagraphs(value) {
  return escapeHtml(value)
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function upsertMeta(selector, createTag, attributeName, attributeValue, content) {
  let tag = document.head.querySelector(selector);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(attributeName, attributeValue);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

function updateSeo(seo) {
  document.title = seo.title;
  upsertMeta('meta[name="description"]', "meta", "name", "description", seo.description);
  upsertMeta('meta[property="og:title"]', "meta", "property", "og:title", seo.title);
  upsertMeta(
    'meta[property="og:description"]',
    "meta",
    "property",
    "og:description",
    seo.description
  );
  upsertMeta('meta[property="og:image"]', "meta", "property", "og:image", seo.shareImageUrl);
}

function renderSocialLink(link) {
  const icon = link.icon
    ? `<img class="site-social-icon" src="/assets/icons/${escapeHtml(link.icon)}.svg" alt="">`
    : `<span>${escapeHtml(link.label)}</span>`;

  const textClass = link.icon ? "" : " site-social-link-text";
  return `<a class="site-social-link${textClass}" href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer" aria-label="${escapeHtml(link.label)}">${icon}</a>`;
}

function renderHelpCard(card) {
  const media =
    card.assetType === "image"
      ? `<img class="site-help-icon" src="${escapeHtml(card.assetValue)}" alt="">`
      : `<img class="site-help-icon" src="/assets/icons/${escapeHtml(card.assetValue)}.svg" alt="">`;

  return `
    <article class="card">
      ${media}
      <h3 style="margin-bottom:10px;">${escapeHtml(card.title)}</h3>
      <p style="color:var(--fg-muted);font-size:15.5px;line-height:1.6;">${escapeHtml(card.description)}</p>
    </article>
  `;
}

function getAboutPanelItems(panel) {
  return [1, 2, 3, 4]
    .map((index) => ({
      label: panel[`item${index}Label`],
      value: panel[`item${index}Value`]
    }))
    .filter((item) => item.label && item.value);
}

function getWorkPillars(work) {
  return [1, 2, 3].map((index) => ({
    number: work[`pillar${index}Number`],
    title: work[`pillar${index}Title`],
    description: work[`pillar${index}Description`]
  }));
}

function getAttendanceFeatures(attendance) {
  return [1, 2, 3].map((index) => ({
    title: attendance[`feature${index}Title`],
    description: attendance[`feature${index}Description`]
  }));
}

function renderHeroActions({ hasSchedulingCta, schedulingUrl, schedulingLabel, whatsappUrl, home }) {
  if (hasSchedulingCta) {
    return `
      <div class="site-hero-actions">
        <a href="${escapeHtml(schedulingUrl)}" class="btn btn-primary">${escapeHtml(schedulingLabel)}</a>
        ${
          whatsappUrl
            ? `<a href="${escapeHtml(whatsappUrl)}" class="btn btn-secondary">Falar pelo WhatsApp</a>`
            : `<a href="#sobre" class="btn btn-secondary">Conhecer meu trabalho</a>`
        }
      </div>
    `;
  }

  return `
    <div class="site-hero-actions">
      <a href="${escapeHtml(home.ctaUrl || whatsappUrl)}" class="btn btn-primary">${escapeHtml(home.ctaLabel)}</a>
      <a href="#sobre" class="btn btn-secondary">Conhecer meu trabalho</a>
    </div>
  `;
}

function renderClosingActions({ hasSchedulingCta, schedulingUrl, schedulingLabel, whatsappUrl, contatoUrl, closing }) {
  if (hasSchedulingCta) {
    return `
      <div class="site-hero-actions site-closing-actions">
        <a href="${escapeHtml(schedulingUrl)}" class="btn btn-primary">${escapeHtml(schedulingLabel)}</a>
        ${
          whatsappUrl
            ? `<a href="${escapeHtml(whatsappUrl)}" class="btn btn-secondary">Falar pelo WhatsApp</a>`
            : ""
        }
      </div>
    `;
  }

  return `
    <a href="${escapeHtml(whatsappUrl || contatoUrl)}" class="btn btn-primary" style="padding:18px 32px;">
      ${
        whatsappUrl
          ? `<img class="site-social-icon" src="/assets/icons/message-circle.svg" alt="">`
          : ""
      }
      ${escapeHtml(closing.ctaLabel)}
    </a>
  `;
}

function renderSite(data) {
  const home = data.home || {};
  const about = data.about || {};
  const agenda = data.agenda || {};
  const aboutPanel = data.aboutPanel || {};
  const help = data.help || { cards: [] };
  const work = data.work || {};
  const attendance = data.attendance || {};
  const closing = data.closing || {};
  const contact = data.contact || {};
  const footer = data.footer || {};
  const aboutPanelItems = getAboutPanelItems(aboutPanel);
  const workPillars = getWorkPillars(work);
  const attendanceFeatures = getAttendanceFeatures(attendance);
  // Não mascarar a ausência com "#contato": as checagens `whatsappUrl ? ...`
  // logo abaixo dependem de o valor ser falsy quando não há número, senão
  // o botão continua rotulado "Falar pelo WhatsApp" e leva a lugar nenhum.
  const whatsappUrl = contact.whatsappUrl || "";
  const hasSchedulingCta =
    Boolean(agenda.showSchedulingButton) && Boolean(agenda.schedulingUrl);
  const schedulingUrl = agenda.schedulingUrl || "";
  const schedulingLabel = agenda.schedulingLabel || "Agendar conversa inicial";
  // Destino de contato quando não há WhatsApp: agendamento externo, se houver,
  // e por último a própria seção de contato — que ainda mostra e-mail e
  // Instagram. Assim nenhum CTA fica com href vazio.
  const ctaContatoUrl = whatsappUrl || schedulingUrl || "#contato";
  const socialLinks = contact.socialLinks || [];
  const footerLinks = socialLinks.length
    ? socialLinks.map(renderSocialLink).join("")
    : `<span class="eyebrow">Links sociais ainda não configurados</span>`;
  const footerUtilityLinks = `
    <div class="site-footer-links">
      <a class="site-footer-link" href="/privacidade">Privacidade</a>
    </div>
  `;

  return `
    <header class="site-header">
      <div class="container site-header-inner">
        <a href="/" class="site-brand">
          <span class="site-brand-name">${escapeHtml(home.title)} ${escapeHtml(home.subtitle)}</span>
          <span class="eyebrow">${escapeHtml(home.eyebrow)}</span>
        </a>
        <nav class="site-nav">
          <a class="site-nav-link" href="#sobre">Sobre</a>
          <a class="site-nav-link" href="#servicos">Como posso te ajudar</a>
          <a class="site-nav-link" href="#atendimento">Atendimento</a>
          <a class="btn btn-primary site-nav-cta" href="${escapeHtml(hasSchedulingCta ? schedulingUrl : home.ctaUrl || whatsappUrl)}">Agendar</a>
        </nav>
      </div>
    </header>

    <main>
      <section class="container site-hero">
        <div class="site-hero-grid">
          <div>
            <div class="eyebrow" style="margin-bottom:24px;">${escapeHtml(home.eyebrow)}</div>
            <h1 class="display-xl" style="margin-bottom:18px;">
              ${escapeHtml(home.title)}<br>
              <span style="font-style:italic;color:var(--accent);">${escapeHtml(home.subtitle)}</span>
            </h1>
            <img class="site-hero-underline" src="/assets/underline.svg" alt="">
            <p class="lede" style="max-width:520px;margin-bottom:36px;">${escapeHtml(home.body)}</p>
            ${renderHeroActions({ hasSchedulingCta, schedulingUrl, schedulingLabel, whatsappUrl, home })}
          </div>
          <div>
            <div class="site-hero-image-frame">
              <img class="site-hero-image" src="${escapeHtml(home.imageUrl)}" alt="${escapeHtml(home.imageAlt)}">
            </div>
          </div>
        </div>
      </section>

      <section id="sobre" class="section">
        <div class="container site-about-grid">
          <div class="site-about-panel">
            <div class="eyebrow" style="margin-bottom:18px;">${escapeHtml(aboutPanel.eyebrow)}</div>
            <h3 class="site-about-panel-title">${escapeHtml(aboutPanel.title)}</h3>
            <dl class="site-about-panel-list">
              ${aboutPanelItems
                .map(
                  (item) => `
                    <div class="site-about-panel-item">
                      <dt class="eyebrow site-about-panel-label">${escapeHtml(item.label)}</dt>
                      <dd class="site-about-panel-value">${escapeHtml(item.value)}</dd>
                    </div>
                  `
                )
                .join("")}
            </dl>
            <p class="site-about-panel-note">${escapeHtml(aboutPanel.note)}</p>
          </div>
          <div>
            <div class="eyebrow" style="margin-bottom:18px;">${escapeHtml(about.eyebrow)}</div>
            <h2 style="margin-bottom:28px;">${escapeHtml(about.title)}</h2>
            <div class="site-copy-stack">${formatParagraphs(about.content)}</div>
          </div>
        </div>
      </section>

      <section id="servicos" class="section section-soft">
        <div class="container">
          <div style="max-width:720px;margin-bottom:64px;">
            <div class="eyebrow" style="margin-bottom:16px;">${escapeHtml(help.eyebrow)}</div>
            <h2>${escapeHtml(help.title)}</h2>
          </div>
          <div class="site-help-grid">
            ${(help.cards || []).map(renderHelpCard).join("")}
          </div>
        </div>
      </section>

      <section class="section">
        <div class="container">
          <div class="site-split-grid" style="margin-bottom:80px;align-items:start;">
            <div>
              <div class="eyebrow" style="margin-bottom:16px;">${escapeHtml(work.eyebrow)}</div>
              <h2>${escapeHtml(work.titlePrefix)} <em style="color:var(--accent);">${escapeHtml(work.titleEmphasis)}</em> ${escapeHtml(work.titleSuffix)}</h2>
            </div>
            <div class="site-copy-stack">
              <p>${escapeHtml(work.lead)}</p>
              <p>${escapeHtml(work.body)}</p>
            </div>
          </div>
          <div class="site-pillars">
            ${workPillars
              .map(
                (pillar) => `
                  <div class="site-pillar">
                    <div class="eyebrow site-pillar-number">${escapeHtml(pillar.number)}</div>
                    <h3 class="site-pillar-title">${escapeHtml(pillar.title)}</h3>
                    <p>${escapeHtml(pillar.description)}</p>
                  </div>
                `
              )
              .join("")}
          </div>
        </div>
      </section>

      <section id="atendimento" class="section section-soft">
        <div class="container site-split-grid">
          <div>
            <div class="eyebrow" style="margin-bottom:16px;">${escapeHtml(attendance.eyebrow)}</div>
            <h2 style="margin-bottom:24px;">
              ${escapeHtml(attendance.titlePrefix)}<br>
              <em style="color:var(--accent);">${escapeHtml(attendance.titleEmphasis)}</em>
            </h2>
            <p class="lede" style="margin-bottom:36px;">${escapeHtml(attendance.lead)}</p>
            <a href="${escapeHtml(ctaContatoUrl)}" class="btn btn-primary">${escapeHtml(attendance.ctaLabel)}</a>
          </div>
          <ul class="site-feature-list">
            ${attendanceFeatures
              .map(
                (feature, index) => `
                  <li class="site-feature-item">
                    <div class="site-feature-index">${index + 1}</div>
                    <div class="site-feature-copy">
                      <h3 style="margin-bottom:6px;">${escapeHtml(feature.title)}</h3>
                      <p>${escapeHtml(feature.description)}</p>
                    </div>
                  </li>
                `
              )
              .join("")}
          </ul>
        </div>
      </section>

      <section id="agendar" class="section">
        <div class="container-narrow site-closing">
          <h2>${escapeHtml(closing.titlePrefix)}<br><em style="color:var(--accent);">${escapeHtml(closing.titleEmphasis)}</em></h2>
          <p class="lede" style="max-width:580px;margin-inline:auto;margin-bottom:44px;">${escapeHtml(closing.body)}</p>
          ${renderClosingActions({
            hasSchedulingCta,
            schedulingUrl,
            schedulingLabel,
            whatsappUrl,
            contatoUrl: ctaContatoUrl,
            closing
          })}
        </div>
      </section>

      <section id="contato" class="section site-contact-band">
        <div class="container">
          <div class="site-contact-panel">
            <div class="site-contact-copy">
              <div class="eyebrow" style="margin-bottom:16px;">Contato</div>
              <h2 style="margin-bottom:16px;">${escapeHtml(contact.title)}</h2>
              <p>${escapeHtml(contact.text)}</p>
            </div>
            <div class="site-social-list">
              ${footerLinks}
              ${
                contact.whatsappUrl
                  ? `<a class="btn btn-primary" href="${escapeHtml(contact.whatsappUrl)}">WhatsApp</a>`
                  : ""
              }
            </div>
          </div>
        </div>
      </section>
    </main>

    <footer class="site-footer">
      <div class="container site-footer-grid">
        <div>
          <div class="site-footer-name">${escapeHtml(home.title)} ${escapeHtml(home.subtitle)}</div>
          <div class="eyebrow" style="margin-bottom:24px;">${escapeHtml(home.eyebrow)}</div>
          <p class="site-footer-note">${escapeHtml(footer.note)}</p>
        </div>
        <div class="site-footer-meta">
          <p class="site-footer-meta-text">${escapeHtml(footer.metaText)}</p>
          ${footerUtilityLinks}
          <div class="site-footer-copy">© ${new Date().getFullYear()} ${escapeHtml(home.title)} ${escapeHtml(home.subtitle)} · Todos os direitos reservados</div>
        </div>
      </div>
    </footer>
  `;
}

function renderError(message) {
  root.innerHTML = `
    <main class="container site-error-state">
      <div class="eyebrow">Erro</div>
      <h1>Não foi possível carregar o site.</h1>
      <p>${escapeHtml(message)}</p>
      <button class="btn btn-primary" id="retry-button" type="button">Tentar novamente</button>
    </main>
  `;

  document.getElementById("retry-button").addEventListener("click", loadSite);
}

async function loadSite() {
  root.innerHTML = `
    <main class="container site-loading-state">
      <div class="eyebrow">Carregando</div>
      <h1>Preparando o conteúdo do site.</h1>
      <p>Buscando as informações mais recentes.</p>
    </main>
  `;

  try {
    const response = await fetch("/api/public/content", {
      headers: {
        Accept: "application/json"
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Falha ao carregar o conteúdo.");
    }

    updateSeo(payload.data.seo);
    root.innerHTML = renderSite(payload.data);
  } catch (error) {
    renderError(error.message);
  }
}

loadSite();
