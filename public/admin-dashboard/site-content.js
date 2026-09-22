import { state } from "./state.js";
import { clearStatus, escapeHtml, escapeSelector, setStatus } from "./ui.js";
import {
  applyFieldErrors,
  buildErrorMessage,
  clearFieldErrors,
  clearFormFeedback,
  fillForm,
  getFormValue,
  isSafeImagePath,
  refreshPreviewFromInput,
  refreshPreviews,
  setFormBusy,
  setFormFeedback
} from "./forms.js";
import { apiRequest } from "./api.js";

const helpCardsList = document.getElementById("help-cards-list");
const helpCardTemplate = document.getElementById("help-card-template");
const socialLinksList = document.getElementById("social-links-list");
const socialLinkTemplate = document.getElementById("social-link-template");

function isSafeLink(value) {
  if (!value) {
    return true;
  }

  if (value.startsWith("#")) {
    return /^#[A-Za-z0-9_-]+$/.test(value);
  }

  if (value.startsWith("/")) {
    return /^\/[A-Za-z0-9/_\-?.=&%]+$/.test(value) && !value.includes("..");
  }

  try {
    const parsed = new URL(value);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol);
  } catch (error) {
    return false;
  }
}

function createHelpCard(card = {}) {
  const fragment = helpCardTemplate.content.cloneNode(true);
  const article = fragment.querySelector(".admin-nested-card");
  const iconSelect = article.querySelector('select[name="assetValue"]');

  state.allowedHelpIcons.forEach((iconName) => {
    const option = document.createElement("option");
    option.value = iconName;
    option.textContent = iconName;
    iconSelect.appendChild(option);
  });

  article.querySelector('input[name="sortOrder"]').value = card.sortOrder || helpCardsList.children.length + 1;
  article.querySelector('input[name="title"]').value = card.title || "";
  article.querySelector('textarea[name="description"]').value = card.description || "";

  const assetTypeSelect = article.querySelector('select[name="assetType"]');
  const imageUrlField = article.querySelector('input[name="assetImageUrl"]');
  const iconField = article.querySelector(".help-icon-field");
  const imageBlock = article.querySelector(".help-image-block");

  assetTypeSelect.value = card.assetType || "icon";

  if (assetTypeSelect.value === "image") {
    imageUrlField.value = card.assetValue || "";
    iconSelect.value = state.allowedHelpIcons[0] || "wind";
    iconField.hidden = true;
    imageBlock.hidden = false;
  } else {
    iconSelect.value = card.assetValue || state.allowedHelpIcons[0] || "wind";
    imageUrlField.value = "";
    iconField.hidden = false;
    imageBlock.hidden = true;
  }

  refreshPreviews(article);
  return article;
}

function createSocialLink(link = {}) {
  const fragment = socialLinkTemplate.content.cloneNode(true);
  const article = fragment.querySelector(".admin-nested-card");

  article.querySelector('select[name="platform"]').value = link.platform || "instagram";
  article.querySelector('input[name="label"]').value = link.label || "";
  article.querySelector('input[name="url"]').value = link.url || "";

  return article;
}

/* ── Site: dez blocos independentes, um em edição por vez ── */
const siteBlocos = () => Array.from(document.querySelectorAll("[data-site-block]"));

export function marcarBlocoSujo(chave, sujo) {
  if (sujo) {
    state.siteDirty.add(chave);
  } else {
    state.siteDirty.delete(chave);
  }
  renderSiteIndex();
}

function abrirBlocoSite(chave) {
  state.siteBlock = chave;
  siteBlocos().forEach((bloco) => {
    bloco.hidden = bloco.dataset.siteBlock !== chave;
  });
  renderSiteIndex();
}

function renderSiteIndex() {
  const indice = document.getElementById("site-indice");
  if (!indice) return;

  indice.innerHTML = siteBlocos()
    .map((bloco) => {
      const chave = bloco.dataset.siteBlock;
      const sujo = state.siteDirty.has(chave);
      return `<button class="admin-site-indice-item${
        chave === state.siteBlock ? " is-active" : ""
      }" type="button" data-action="go-site-block" data-block="${escapeHtml(chave)}">
        ${sujo ? '<span class="admin-site-ponto" aria-hidden="true"></span>' : ""}
        ${escapeHtml(bloco.dataset.siteLabel)}
      </button>`;
    })
    .join("");

  // Selo por bloco.
  siteBlocos().forEach((bloco) => {
    const chave = bloco.dataset.siteBlock;
    const selo = bloco.querySelector("[data-site-selo]");
    if (!selo) return;
    const sujo = state.siteDirty.has(chave);
    selo.classList.toggle("is-sujo", sujo);
    selo.textContent = sujo ? "◐ alterações não salvas" : "● salvo";
  });

  // Resumo do conjunto embutido no subtítulo da tela.
  const total = state.siteDirty.size;
  const texto = document.getElementById("site-resumo-texto");
  if (texto) {
    texto.textContent = total
      ? `${total} bloco${total > 1 ? "s" : ""} com alterações não salvas.`
      : "Tudo salvo.";
    texto.classList.toggle("tem-pendencia", total > 0);
  }
}


// Cada bloco sabe se repovoar sozinho. Repovoar tudo depois de salvar um único
// bloco apagaria as edições ainda não salvas dos outros — e o índice passaria a
// sinalizar pendência em blocos que acabaram de ser zerados.
const PREENCHE_BLOCO_SITE = {
  home: () => fillForm(document.getElementById("home-form"), state.content.home || {}),
  about: () => fillForm(document.getElementById("about-form"), state.content.about || {}),
  aboutPanel: () =>
    fillForm(document.getElementById("about-panel-form"), state.content.aboutPanel || {}),
  work: () => fillForm(document.getElementById("work-form"), state.content.work || {}),
  attendance: () =>
    fillForm(document.getElementById("attendance-form"), state.content.attendance || {}),
  closing: () => fillForm(document.getElementById("closing-form"), state.content.closing || {}),
  seo: () => fillForm(document.getElementById("seo-form"), state.content.seo || {}),
  footer: () => fillForm(document.getElementById("footer-form"), state.content.footer || {}),
  help: () => {
    const helpForm = document.getElementById("help-form");
    helpForm.elements.namedItem("eyebrow").value = state.content.help?.eyebrow || "";
    helpForm.elements.namedItem("title").value = state.content.help?.title || "";
    helpCardsList.innerHTML = "";
    (state.content.help?.cards || []).forEach((card) => {
      helpCardsList.appendChild(createHelpCard(card));
    });
  },
  contact: () => {
    fillForm(document.getElementById("contact-form"), {
      title: state.content.contact?.title,
      text: state.content.contact?.text,
      whatsappNumber: state.content.contact?.whatsappNumber,
      whatsappMessage: state.content.contact?.whatsappMessage
    });
    socialLinksList.innerHTML = "";
    (state.content.contact?.socialLinks || []).forEach((link) => {
      socialLinksList.appendChild(createSocialLink(link));
    });
  }
};

export function preencherBlocoSite(chave) {
  PREENCHE_BLOCO_SITE[chave]?.();
}

function populateSiteForms() {
  Object.keys(PREENCHE_BLOCO_SITE).forEach(preencherBlocoSite);
  state.siteDirty.clear();
  abrirBlocoSite(state.siteBlock);
}

function serializeHelpCards() {
  return Array.from(helpCardsList.children).map((cardEl, index) => {
    const assetType = cardEl.querySelector('select[name="assetType"]').value;
    const iconValue = cardEl.querySelector('select[name="assetValue"]').value;
    const imageValue = cardEl.querySelector('input[name="assetImageUrl"]').value;
    return {
      sortOrder: Number(cardEl.querySelector('input[name="sortOrder"]').value || index + 1),
      title: cardEl.querySelector('input[name="title"]').value.trim(),
      description: cardEl.querySelector('textarea[name="description"]').value.trim(),
      assetType,
      assetValue: assetType === "image" ? imageValue : iconValue
    };
  });
}

function serializeSocialLinks() {
  return Array.from(socialLinksList.children).map((linkEl) => ({
    platform: linkEl.querySelector('select[name="platform"]').value,
    label: linkEl.querySelector('input[name="label"]').value.trim(),
    url: linkEl.querySelector('input[name="url"]').value.trim()
  }));
}

function validateHomePayload(payload) {
  if (!payload.title || !payload.subtitle || !payload.body) {
    throw new Error("Preencha os campos obrigatórios da Home.");
  }
  if (!isSafeLink(payload.ctaUrl)) {
    throw new Error("CTA da Home deve ser uma âncora, rota relativa ou URL válida.");
  }
  if (!isSafeImagePath(payload.imageUrl)) {
    throw new Error("Imagem principal inválida.");
  }
}

function validateAboutPayload(payload) {
  if (!payload.title || !payload.content) {
    throw new Error("Preencha os campos obrigatórios de Sobre.");
  }
}

function validateAboutPanelPayload(payload) {
  if (!payload.title || !payload.note) {
    throw new Error("Preencha os campos obrigatórios do painel Sobre.");
  }
}

function validateWorkPayload(payload) {
  if (!payload.lead || !payload.body) {
    throw new Error("Preencha os textos da seção de metodologia.");
  }
}

function validateAttendancePayload(payload) {
  if (!payload.lead || !payload.ctaLabel) {
    throw new Error("Preencha os campos obrigatórios da seção Atendimento.");
  }
}

function validateClosingPayload(payload) {
  if (!payload.titlePrefix || !payload.titleEmphasis || !payload.body || !payload.ctaLabel) {
    throw new Error("Preencha os campos obrigatórios da seção final.");
  }
}

function validateHelpPayload(payload) {
  if (!payload.cards.length) {
    throw new Error("Adicione ao menos um card.");
  }

  payload.cards.forEach((card, index) => {
    if (!card.title || !card.description) {
      throw new Error(`Card ${index + 1} está incompleto.`);
    }
    if (card.assetType === "icon" && !state.allowedHelpIcons.includes(card.assetValue)) {
      throw new Error(`Card ${index + 1} possui ícone inválido.`);
    }
    if (card.assetType === "image" && !isSafeImagePath(card.assetValue)) {
      throw new Error(`Card ${index + 1} precisa de uma imagem válida.`);
    }
  });
}

function validateContactPayload(payload) {
  payload.socialLinks.forEach((link, index) => {
    if (link.url && !isSafeLink(link.url)) {
      throw new Error(`Link social ${index + 1} é inválido.`);
    }
  });
}

function validateSeoPayload(payload) {
  if (!isSafeImagePath(payload.shareImageUrl)) {
    throw new Error("Imagem de compartilhamento inválida.");
  }
}

function validateFooterPayload(payload) {
  if (!payload.note || !payload.metaText) {
    throw new Error("Preencha os textos institucionais do rodapé.");
  }
}

async function handleSiteSave(event, section, serializer, validator, successMessage) {
  event.preventDefault();
  const form = event.currentTarget;
  clearStatus();
  clearFormFeedback(form);
  clearFieldErrors(form);

  if (!form.reportValidity()) {
    return;
  }

  try {
    const payload = serializer(form);
    validator(payload);
    setFormBusy(form, true, "Salvando...");
    const response = await apiRequest(`/api/admin/content/${section}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    state.content = response.data;
    // Só o bloco salvo é repovoado (com o que o servidor normalizou). Os demais
    // ficam intactos, preservando edições ainda não salvas.
    preencherBlocoSite(section);
    marcarBlocoSujo(section, false);
    setFormFeedback(form, successMessage, "success");
    setStatus(successMessage, "success");
  } catch (error) {
    applyFieldErrors(form, error.details?.fieldErrors);
    setFormFeedback(form, buildErrorMessage(error), "error");
  } finally {
    setFormBusy(form, false);
  }
}

export async function handleUpload(fileInput) {
  const file = fileInput.files[0];
  if (!file) {
    return;
  }

  const allowedExtensions = [".jpg", ".jpeg", ".png", ".webp"];
  const name = file.name.toLowerCase();
  if (!allowedExtensions.some((extension) => name.endsWith(extension))) {
    throw new Error("Formato inválido. Use jpg, jpeg, png ou webp.");
  }

  if (file.size > 3 * 1024 * 1024) {
    throw new Error("Arquivo excede o limite de 3 MB.");
  }

  const scope = fileInput.closest(".upload-block") || fileInput.closest(".admin-nested-card");
  const targetName = fileInput.dataset.uploadTarget;
  const targetInput = scope.querySelector(`[name="${escapeSelector(targetName)}"]`);

  const formData = new FormData();
  formData.append("image", file);

  setStatus("Enviando imagem...", "success");
  const response = await apiRequest("/api/admin/uploads", {
    method: "POST",
    body: formData,
    timeoutMs: 30000
  });

  targetInput.value = response.data.url;
  refreshPreviewFromInput(targetInput);
  setStatus("Imagem enviada com sucesso.", "success");
}

export async function loadContent() {
  const response = await apiRequest("/api/admin/content");
  state.content = response.data;
  state.allowedHelpIcons = response.meta.allowedHelpIcons || [];
  populateSiteForms();
}

export function registrarAdicaoDeItensDoSite() {
  document.getElementById("add-help-card").addEventListener("click", () => {
    helpCardsList.appendChild(createHelpCard());
    marcarBlocoSujo("help", true);
  });

  document.getElementById("add-social-link").addEventListener("click", () => {
    socialLinksList.appendChild(createSocialLink());
    marcarBlocoSujo("contact", true);
  });
}

export function registrarFormulariosDoSite() {
  document.getElementById("home-form").addEventListener("submit", (event) =>
    handleSiteSave(
      event,
      "home",
      (form) => ({
        eyebrow: getFormValue(form, "eyebrow").trim(),
        title: getFormValue(form, "title").trim(),
        subtitle: getFormValue(form, "subtitle").trim(),
        body: getFormValue(form, "body").trim(),
        ctaLabel: getFormValue(form, "ctaLabel").trim(),
        ctaUrl: getFormValue(form, "ctaUrl").trim(),
        imageUrl: getFormValue(form, "imageUrl").trim(),
        imageAlt: getFormValue(form, "imageAlt").trim()
      }),
      validateHomePayload,
      "Home salva com sucesso."
    )
  );

  document.getElementById("about-form").addEventListener("submit", (event) =>
    handleSiteSave(
      event,
      "about",
      (form) => ({
        eyebrow: getFormValue(form, "eyebrow").trim(),
        title: getFormValue(form, "title").trim(),
        content: getFormValue(form, "content").trim()
      }),
      validateAboutPayload,
      "Seção Sobre salva com sucesso."
    )
  );

  document.getElementById("about-panel-form").addEventListener("submit", (event) =>
    handleSiteSave(
      event,
      "aboutPanel",
      (form) => ({
        eyebrow: getFormValue(form, "eyebrow").trim(),
        title: getFormValue(form, "title").trim(),
        note: getFormValue(form, "note").trim(),
        item1Label: getFormValue(form, "item1Label").trim(),
        item1Value: getFormValue(form, "item1Value").trim(),
        item2Label: getFormValue(form, "item2Label").trim(),
        item2Value: getFormValue(form, "item2Value").trim(),
        item3Label: getFormValue(form, "item3Label").trim(),
        item3Value: getFormValue(form, "item3Value").trim(),
        item4Label: getFormValue(form, "item4Label").trim(),
        item4Value: getFormValue(form, "item4Value").trim()
      }),
      validateAboutPanelPayload,
      "Painel do Sobre salvo com sucesso."
    )
  );

  document.getElementById("help-form").addEventListener("submit", (event) =>
    handleSiteSave(
      event,
      "help",
      (form) => ({
        eyebrow: getFormValue(form, "eyebrow").trim(),
        title: getFormValue(form, "title").trim(),
        cards: serializeHelpCards()
      }),
      validateHelpPayload,
      "Cards salvos com sucesso."
    )
  );

  document.getElementById("work-form").addEventListener("submit", (event) =>
    handleSiteSave(
      event,
      "work",
      (form) => ({
        eyebrow: getFormValue(form, "eyebrow").trim(),
        titlePrefix: getFormValue(form, "titlePrefix").trim(),
        titleEmphasis: getFormValue(form, "titleEmphasis").trim(),
        titleSuffix: getFormValue(form, "titleSuffix").trim(),
        lead: getFormValue(form, "lead").trim(),
        body: getFormValue(form, "body").trim(),
        pillar1Number: getFormValue(form, "pillar1Number").trim(),
        pillar1Title: getFormValue(form, "pillar1Title").trim(),
        pillar1Description: getFormValue(form, "pillar1Description").trim(),
        pillar2Number: getFormValue(form, "pillar2Number").trim(),
        pillar2Title: getFormValue(form, "pillar2Title").trim(),
        pillar2Description: getFormValue(form, "pillar2Description").trim(),
        pillar3Number: getFormValue(form, "pillar3Number").trim(),
        pillar3Title: getFormValue(form, "pillar3Title").trim(),
        pillar3Description: getFormValue(form, "pillar3Description").trim()
      }),
      validateWorkPayload,
      "Seção de metodologia salva com sucesso."
    )
  );

  document.getElementById("attendance-form").addEventListener("submit", (event) =>
    handleSiteSave(
      event,
      "attendance",
      (form) => ({
        eyebrow: getFormValue(form, "eyebrow").trim(),
        titlePrefix: getFormValue(form, "titlePrefix").trim(),
        titleEmphasis: getFormValue(form, "titleEmphasis").trim(),
        lead: getFormValue(form, "lead").trim(),
        ctaLabel: getFormValue(form, "ctaLabel").trim(),
        feature1Title: getFormValue(form, "feature1Title").trim(),
        feature1Description: getFormValue(form, "feature1Description").trim(),
        feature2Title: getFormValue(form, "feature2Title").trim(),
        feature2Description: getFormValue(form, "feature2Description").trim(),
        feature3Title: getFormValue(form, "feature3Title").trim(),
        feature3Description: getFormValue(form, "feature3Description").trim()
      }),
      validateAttendancePayload,
      "Seção de atendimento salva com sucesso."
    )
  );

  document.getElementById("closing-form").addEventListener("submit", (event) =>
    handleSiteSave(
      event,
      "closing",
      (form) => ({
        titlePrefix: getFormValue(form, "titlePrefix").trim(),
        titleEmphasis: getFormValue(form, "titleEmphasis").trim(),
        body: getFormValue(form, "body").trim(),
        ctaLabel: getFormValue(form, "ctaLabel").trim()
      }),
      validateClosingPayload,
      "Fechamento salvo com sucesso."
    )
  );

  document.getElementById("contact-form").addEventListener("submit", (event) =>
    handleSiteSave(
      event,
      "contact",
      (form) => ({
        title: getFormValue(form, "title").trim(),
        text: getFormValue(form, "text").trim(),
        whatsappNumber: getFormValue(form, "whatsappNumber").trim(),
        whatsappMessage: getFormValue(form, "whatsappMessage").trim(),
        socialLinks: serializeSocialLinks()
      }),
      validateContactPayload,
      "Contato salvo com sucesso."
    )
  );

  document.getElementById("seo-form").addEventListener("submit", (event) =>
    handleSiteSave(
      event,
      "seo",
      (form) => ({
        title: getFormValue(form, "title").trim(),
        description: getFormValue(form, "description").trim(),
        shareImageUrl: getFormValue(form, "shareImageUrl").trim()
      }),
      validateSeoPayload,
      "SEO salvo com sucesso."
    )
  );

  document.getElementById("footer-form").addEventListener("submit", (event) =>
    handleSiteSave(
      event,
      "footer",
      (form) => ({
        note: getFormValue(form, "note").trim(),
        metaText: getFormValue(form, "metaText").trim()
      }),
      validateFooterPayload,
      "Rodapé salvo com sucesso."
    )
  );
}

export const ACOES_SITE = {
  "go-site-block": ({ actionSource }) => {
    abrirBlocoSite(actionSource.dataset.block);
  }
};
