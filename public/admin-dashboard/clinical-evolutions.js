import { state } from "./state.js";
import {
  formatCurrency,
  formatDataHora,
  formatDate,
  formatDateTime,
  formatDateTimeInputValue
} from "./format.js";
import { escapeHtml, renderChip, setStatus } from "./ui.js";
import { apiRequest } from "./api.js";
import { loadClinicalRecord, switchClinicalTab } from "./clinical-record.js";

export const EVOLUTION_STATUS_LABELS = {
  draft: "Rascunho",
  signed: "Assinada",
  locked: "Bloqueada",
  amended: "Retificada"
};

export async function loadEvolutions() {
  if (!state.clinical.patientId) return;
  const response = await apiRequest(
    `/api/admin/patients/${state.clinical.patientId}/evolutions`
  );
  state.clinical.evolutions = response.data.items;
  renderEvolutions();
}

function buildEvolutionActions(evolution) {
  const actions = [
    `<button class="btn btn-secondary btn-compacto" type="button" data-action="view-evolution" data-id="${evolution.id}">Ver</button>`
  ];
  // Editar depende do status, da janela de tempo E do prontuário estar aberto
  // — o servidor recusa nos três casos, e oferecer o botão só levava a um erro
  // depois de digitar.
  const janelaAberta =
    !evolution.editableUntil || new Date(evolution.editableUntil).getTime() > Date.now();
  const encerrado =
    evolution.recordClosed === true ||
    state.clinical.summary?.record?.status === "closed";

  if (evolution.status === "draft" && !encerrado) {
    if (janelaAberta) {
      actions.push(
        `<button class="btn btn-secondary btn-compacto" type="button" data-action="edit-evolution" data-id="${evolution.id}">Editar</button>`
      );
    }
    actions.push(
      `<button class="btn btn-secondary btn-compacto" type="button" data-action="sign-evolution" data-id="${evolution.id}">Assinar</button>`
    );
  }
  if (evolution.status !== "locked") {
    actions.push(
      `<button class="btn btn-secondary btn-compacto" type="button" data-action="addendum-evolution" data-id="${evolution.id}">Adendo</button>`,
      `<button class="btn btn-secondary btn-compacto" type="button" data-action="lock-evolution" data-id="${evolution.id}">Bloquear</button>`
    );
  }
  actions.push(
    `<button class="btn btn-secondary btn-compacto" type="button" data-action="export-evolution" data-id="${evolution.id}">PDF</button>`
  );
  return actions.join("");
}

function renderEvolutions() {
  const list = document.getElementById("clinical-evolutions-list");
  const empty = document.getElementById("clinical-evolutions-empty");
  const items = state.clinical.evolutions || [];

  empty.hidden = items.length > 0;
  empty.innerHTML = `<h3>Nenhuma evolução registrada</h3>
    <p>Cada atendimento vira um registro clínico com data, tipo e conteúdo criptografado.</p>
    <button class="btn btn-primary btn-compacto" type="button" data-action="new-evolution">＋ Nova evolução</button>`;

  // Adendos apontam para o registro que corrigem, e o original mostra que foi
  // corrigido — a relação precisa estar visível nos dois sentidos.
  const porId = new Map(items.map((item) => [item.id, item]));
  const adendoDe = new Map();
  items.forEach((item) => {
    if (item.parentEvolutionId) adendoDe.set(item.parentEvolutionId, item);
  });

  list.innerHTML = items
    .map((evolution) => {
      const pai = evolution.parentEvolutionId ? porId.get(evolution.parentEvolutionId) : null;
      const correcao = adendoDe.get(evolution.id);
      const notas = [];
      if (evolution.parentEvolutionId) {
        notas.push(
          `↳ retifica a evolução de ${escapeHtml(
            pai ? formatDate(pai.evolutionDate) : `#${evolution.parentEvolutionId}`
          )}`
        );
      }
      if (correcao) {
        notas.push(`corrigida pelo adendo de ${escapeHtml(formatDate(correcao.evolutionDate))}`);
      }

      return `
        <article class="evolucao is-${escapeHtml(evolution.status)}">
          <div class="evolucao-corpo">
            <div class="evolucao-quando">${escapeHtml(formatDateTime(evolution.evolutionDate))}</div>
            <div class="evolucao-titulo">
              ${escapeHtml(evolution.evolutionTypeLabel || evolution.evolutionType)}
              ${evolution.title ? `· ${escapeHtml(evolution.title)}` : ""}
              ${renderChip(
                "evolution",
                evolution.status,
                evolution.statusLabel || EVOLUTION_STATUS_LABELS[evolution.status] || evolution.status
              )}
            </div>
            ${
              evolution.sessionId
                ? `<div class="evolucao-vinculo"><span>sessão vinculada #${escapeHtml(
                    String(evolution.sessionId)
                  )}</span></div>`
                : ""
            }
            ${
              evolution.status === "draft" && evolution.editableUntil
                ? `<div class="evolucao-vinculo"><span class="evolucao-janela">◐ janela de edição aberta até ${escapeHtml(
                    formatDataHora(evolution.editableUntil)
                  )}</span></div>`
                : ""
            }
            ${notas.length ? `<div class="evolucao-nota">${notas.join(" · ")}</div>` : ""}
          </div>
          <div class="admin-registro-acoes">${buildEvolutionActions(evolution)}</div>
        </article>
      `;
    })
    .join("");
}

async function populateEvolutionSessionSelect(selectedSessionId) {
  const select = document.querySelector("#clinical-evolution-form select[name=\"sessionId\"]");
  if (!select) return;
  let sessions = [];
  try {
    const response = await apiRequest(
      `/api/admin/sessions?patientId=${state.clinical.patientId}`
    );
    sessions = response.data.items || [];
  } catch (error) {
    sessions = [];
  }
  select.innerHTML =
    '<option value="">Sem sessão vinculada</option>' +
    sessions
      .map(
        (session) =>
          `<option value="${session.id}">${escapeHtml(
            formatDateTime(session.scheduledAt)
          )} · ${escapeHtml(formatCurrency(session.price))}</option>`
      )
      .join("");
  if (selectedSessionId) {
    select.value = String(selectedSessionId);
  }
}

function setEvolutionFormFeedback(message) {
  const feedback = document.querySelector("#clinical-evolution-form .form-feedback");
  if (!feedback) return;
  feedback.textContent = message || "";
  feedback.hidden = !message;
}

async function openEvolutionForm({ mode, evolutionId }) {
  const form = document.getElementById("clinical-evolution-form");
  form.reset();
  setEvolutionFormFeedback("");
  form.dataset.mode = mode;
  form.elements.id.value = "";
  form.elements.parentId.value = "";
  const typeField = form.elements.evolutionType;
  const sessionField = form.elements.sessionId;
  const dateField = form.elements.evolutionDate;

  if (mode === "create") {
    await populateEvolutionSessionSelect("");
    dateField.value = formatDateTimeInputValue(new Date().toISOString());
    typeField.disabled = false;
    sessionField.disabled = false;
    dateField.disabled = false;
  } else if (mode === "edit") {
    const response = await apiRequest(`/api/admin/evolutions/${evolutionId}`);
    const detail = response.data;
    await populateEvolutionSessionSelect(detail.sessionId || "");
    form.elements.id.value = detail.id;
    typeField.value = detail.evolutionType;
    dateField.value = formatDateTimeInputValue(detail.evolutionDate);
    form.elements.title.value = detail.title || "";
    form.elements.content.value = detail.content || "";
    typeField.disabled = false;
    sessionField.disabled = false;
    dateField.disabled = false;
  } else if (mode === "addendum") {
    form.elements.parentId.value = evolutionId;
    typeField.value = "session";
    typeField.disabled = true;
    sessionField.disabled = true;
    dateField.disabled = true;
    setEvolutionFormFeedback(
      "Adendo/retificação: o registro original será marcado como retificado e mantido intacto."
    );
  }

  form.hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function hideEvolutionForm() {
  const form = document.getElementById("clinical-evolution-form");
  form.hidden = true;
  form.reset();
  setEvolutionFormFeedback("");
}

async function submitEvolutionForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const mode = form.dataset.mode || "create";
  const content = form.elements.content.value;
  const title = form.elements.title.value;

  try {
    if (mode === "addendum") {
      const parentId = form.elements.parentId.value;
      if (!content.trim()) {
        setEvolutionFormFeedback("Informe o conteúdo do adendo/retificação.");
        return;
      }
      await apiRequest(`/api/admin/evolutions/${parentId}/addendum`, {
        method: "POST",
        body: JSON.stringify({ content, title, evolutionType: "addendum" })
      });
      setStatus("Adendo/retificação registrado.", "success");
    } else if (mode === "edit") {
      const id = form.elements.id.value;
      await apiRequest(`/api/admin/evolutions/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          content,
          title,
          sessionId: form.elements.sessionId.value || "",
          evolutionType: form.elements.evolutionType.value,
          // Valor cru: quem interpreta o fuso é o servidor, no fuso da clínica.
          evolutionDate: form.elements.evolutionDate.value || ""
        })
      });
      setStatus("Evolução atualizada.", "success");
    } else {
      await apiRequest("/api/admin/evolutions", {
        method: "POST",
        body: JSON.stringify({
          patientId: state.clinical.patientId,
          sessionId: form.elements.sessionId.value || "",
          evolutionType: form.elements.evolutionType.value,
          title,
          // Valor cru: quem interpreta o fuso é o servidor, no fuso da clínica.
          evolutionDate: form.elements.evolutionDate.value || "",
          content
        })
      });
      setStatus("Evolução criada.", "success");
    }
    hideEvolutionForm();
    await loadEvolutions();
    await loadClinicalRecord();
  } catch (error) {
    setEvolutionFormFeedback(error.message);
  }
}

const clinicalEvolutionModal = document.getElementById("clinical-evolution-modal");

async function openEvolutionModal(evolutionId) {
  const response = await apiRequest(`/api/admin/evolutions/${evolutionId}`);
  const detail = response.data;
  document.getElementById("clinical-evolution-modal-eyebrow").textContent =
    detail.evolutionTypeLabel || detail.evolutionType;
  document.getElementById("clinical-evolution-modal-title").textContent =
    detail.title || formatDateTime(detail.evolutionDate);
  document.getElementById("clinical-evolution-modal-status").textContent =
    EVOLUTION_STATUS_LABELS[detail.status] || detail.status;
  document.getElementById("clinical-evolution-modal-content").textContent = detail.content || "—";
  document.getElementById("clinical-evolution-modal-actions").innerHTML =
    buildEvolutionActions(detail);
  if (typeof clinicalEvolutionModal.showModal === "function") {
    clinicalEvolutionModal.showModal();
  }
}

function closeEvolutionModal() {
  if (clinicalEvolutionModal?.open) {
    clinicalEvolutionModal.close();
  }
}

export function registrarFormularioDeEvolucao() {
  document
    .getElementById("clinical-evolution-form")
    .addEventListener("submit", submitEvolutionForm);
}

export const ACOES_EVOLUCOES = {
  "new-evolution": async () => {
    await openEvolutionForm({ mode: "create" });
  },
  "go-new-evolution": async () => {
    await switchClinicalTab("evolucoes");
    await openEvolutionForm({ mode: "create" });
    document.getElementById("clinical-evolution-form").scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  },
  "cancel-evolution-form": () => {
    hideEvolutionForm();
  },
  "view-evolution": async ({ id }) => {
    await openEvolutionModal(id);
  },
  "edit-evolution": async ({ id }) => {
    await openEvolutionForm({ mode: "edit", evolutionId: id });
  },
  "export-evolution": ({ id }) => {
    window.open(`/api/admin/evolutions/${id}/export.pdf`, "_blank");
  },
  "sign-evolution": async ({ id }) => {
    if (!window.confirm("Assinar esta evolução? Após assinada não poderá ser editada diretamente.")) return;
    await apiRequest(`/api/admin/evolutions/${id}/sign`, { method: "POST" });
    closeEvolutionModal();
    await loadEvolutions();
    await loadClinicalRecord();
    setStatus("Evolução assinada.", "success");
  },
  "lock-evolution": async ({ id }) => {
    if (!window.confirm("Bloquear esta evolução? Registros bloqueados não podem ser editados.")) return;
    await apiRequest(`/api/admin/evolutions/${id}/lock`, { method: "POST" });
    closeEvolutionModal();
    await loadEvolutions();
    await loadClinicalRecord();
    setStatus("Evolução bloqueada.", "success");
  },
  "addendum-evolution": ({ id }) => {
    closeEvolutionModal();
    openEvolutionForm({ mode: "addendum", evolutionId: id });
  },
  "close-evolution-modal": () => {
    closeEvolutionModal();
  }
};
