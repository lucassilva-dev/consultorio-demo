import { state } from "./state.js";
import { CLINIC_TIME_ZONE, formatCurrency, formatDate, labelMaps } from "./format.js";
import { abrirDrawer, copyText, escapeHtml, fecharDrawer, setStatus, showToast } from "./ui.js";
import {
  applyFieldErrors,
  buildErrorMessage,
  clearFieldErrors,
  clearFormFeedback,
  fillForm,
  getEntityIdField,
  getFormChecked,
  getFormField,
  getFormValue,
  setFormBusy,
  setFormFeedback
} from "./forms.js";
import { apiRequest, runMutation, toQueryString } from "./api.js";
import { atualizarLimparFiltros } from "./filters.js";
import { refreshAfterMutation } from "./loading.js";
import { openPanel } from "./navigation.js";
import { acharPaciente } from "./patients.js";

// Insere a variável na posição do cursor do corpo da mensagem.
function inserirVariavel(variavel) {
  const campo = document.querySelector('#message-form textarea[name="body"]');
  if (!campo || !variavel) return;
  const ini = campo.selectionStart ?? campo.value.length;
  const fim = campo.selectionEnd ?? campo.value.length;
  campo.value = campo.value.slice(0, ini) + variavel + campo.value.slice(fim);
  const cursor = ini + variavel.length;
  campo.setSelectionRange(cursor, cursor);
  campo.focus();
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

export function resetMessageForm() {
  const form = document.getElementById("message-form");
  form.reset();
  getEntityIdField(form).value = "";
  getFormField(form, "isActive").checked = true;
  document.getElementById("message-form-title").textContent = "Novo modelo";
  clearFormFeedback(form);
}

function renderMessageTemplatesTable() {
  const lista = document.getElementById("messages-list");
  const empty = document.getElementById("messages-empty");
  const filtroAtivo = Boolean(state.messageFilters.search || state.messageFilters.category);

  lista.innerHTML = state.messageTemplates
    .map(
      (template) => `
        <article class="admin-registro${template.isActive ? "" : " is-inativo"}">
          <div class="admin-registro-corpo">
            <div class="admin-registro-titulo">
              ${escapeHtml(template.title)}
              <span class="chip chip-neutro chip-menor">${escapeHtml(
                labelMaps.messageCategory[template.category] || template.category
              )}</span>
              ${template.isActive ? "" : '<span class="admin-inativo">— inativo</span>'}
            </div>
            <div class="admin-registro-trecho">${escapeHtml(template.body)}</div>
          </div>
          <div class="admin-registro-acoes">
            <button class="btn btn-verde-suave btn-compacto" type="button" data-action="copy-message" data-id="${
              template.id
            }">⧉ Copiar</button>
            <button class="btn btn-secondary btn-compacto" type="button" data-action="edit-message" data-id="${
              template.id
            }">Editar</button>
            <button class="btn btn-excluir btn-compacto" type="button" data-action="delete-message" data-id="${
              template.id
            }">Excluir</button>
          </div>
        </article>
      `
    )
    .join("");

  atualizarLimparFiltros("message-filters-form", filtroAtivo);

  empty.hidden = state.messageTemplates.length > 0;
  empty.innerHTML = filtroAtivo
    ? `<h3>Nenhum modelo com esse filtro</h3>
       <p>Nenhum texto corresponde à busca ou à categoria escolhida.</p>
       <button class="btn btn-secondary btn-compacto" type="button" data-reset-filter="message">Limpar filtros</button>`
    : `<h3>Nenhum modelo cadastrado</h3>
       <p>Modelos poupam tempo nas mensagens que você repete — confirmação, lembrete, cobrança.</p>
       <button class="btn btn-primary btn-compacto" type="button" data-action="new-message">＋ Novo modelo</button>`;
}

function readMessageFormPayload(form) {
  return {
    title: getFormValue(form, "title").trim(),
    category: getFormValue(form, "category"),
    body: getFormValue(form, "body").trim(),
    isActive: getFormChecked(form, "isActive")
  };
}

export async function loadMessageTemplates() {
  const response = await apiRequest(
    `/api/admin/message-templates${toQueryString(state.messageFilters)}`
  );
  state.messageTemplates = response.data.items || [];
  renderMessageTemplatesTable();
}

export function registrarFormularioDeMensagem() {
  document.getElementById("message-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    clearFormFeedback(form);
    clearFieldErrors(form);

    try {
      const payload = readMessageFormPayload(form);
      setFormBusy(form, true, "Salvando...");
      const entityId = getEntityIdField(form).value;
      const method = entityId ? "PUT" : "POST";
      const url = entityId
        ? `/api/admin/message-templates/${entityId}`
        : "/api/admin/message-templates";
      await runMutation(url, { method, body: JSON.stringify(payload) });
      // Libera o formulário imediatamente — refresh ocorre em background
      resetMessageForm();
      fecharDrawer("message");
      showToast("Modelo salvo com sucesso.", "success");
      refreshAfterMutation([loadMessageTemplates()]).then((failures) => {
        if (failures.length) showToast("Lista pode estar desatualizada. Recarregue se necessário.", "warning");
      });
    } catch (error) {
      applyFieldErrors(form, error.details?.fieldErrors);
      setFormFeedback(form, buildErrorMessage(error), "error");
    } finally {
      setFormBusy(form, false);
    }
  });
}

// ── Copy-message modal ──────────────────────────────────────────────────────
const copyMessageModal = document.getElementById("copy-message-modal");
const copyModalPatientSelect = document.getElementById("copy-modal-patient-select");
const copyModalSessionSelect = document.getElementById("copy-modal-session-select");
const copyModalPreview = document.getElementById("copy-modal-preview");
const copyModalPreviewText = document.getElementById("copy-modal-preview-text");
const copyModalConfirm = document.getElementById("copy-modal-confirm");
let copyModalTemplate = null;

function formatTime(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: CLINIC_TIME_ZONE
  }).format(d);
}

function fillTemplateVariables(body, patient, session) {
  const firstName = patient
    ? patient.preferredName || (patient.fullName || "").split(/\s+/)[0] || ""
    : "";
  const replacements = {
    "{nome}": patient?.fullName || "{nome}",
    "{primeiro_nome}": firstName || "{primeiro_nome}",
    "{data}": session?.scheduledAt ? formatDate(session.scheduledAt) : "{data}",
    "{horario}": session?.scheduledAt ? formatTime(session.scheduledAt) : "{horario}",
    "{valor}": session?.price != null ? formatCurrency(session.price) : "{valor}",
    "{link_agendamento}": state.platformSettings?.schedulingUrl || "{link_agendamento}",
    "{link_sessao}": session?.meetingUrl || "{link_sessao}",
    "{nome_responsavel}": patient?.guardianName || "{nome_responsavel}"
  };
  return body.replace(/\{[a-z_]+\}/g, (match) => replacements[match] ?? match);
}

function updateCopyModalPreview() {
  if (!copyModalTemplate) return;
  const patientId = copyModalPatientSelect.value;
  const sessionId = copyModalSessionSelect.value;
  const patient = patientId ? acharPaciente(patientId) : null;
  const session = sessionId ? state.sessions.find((s) => String(s.id) === sessionId) : null;
  const filled = fillTemplateVariables(copyModalTemplate.body, patient, session);
  copyModalPreviewText.textContent = filled;
  copyModalPreview.hidden = false;
}

function populateCopyModalSessionSelect(patientId) {
  const sessions = patientId
    ? state.sessions.filter((s) => String(s.patientId) === patientId).slice(0, 20)
    : [];
  copyModalSessionSelect.innerHTML =
    `<option value="">Sem sessão (manter variáveis)</option>` +
    sessions
      .map(
        (s) =>
          `<option value="${escapeHtml(String(s.id))}">${escapeHtml(
            formatDate(s.scheduledAt) + " — " + formatCurrency(s.price)
          )}</option>`
      )
      .join("");
}

function openCopyMessageModal(template) {
  copyModalTemplate = template;
  // populate patients
  copyModalPatientSelect.innerHTML =
    `<option value="">Sem paciente (manter variáveis)</option>` +
    // Lista completa: filtrar em Pacientes não pode esconder gente daqui.
    (state.allPatients.length ? state.allPatients : state.patients)
      .map(
        (p) =>
          `<option value="${escapeHtml(String(p.id))}">${escapeHtml(
            p.preferredName ? `${p.fullName} (${p.preferredName})` : p.fullName
          )}</option>`
      )
      .join("");
  populateCopyModalSessionSelect("");
  copyModalPreview.hidden = true;
  copyMessageModal.showModal();
}

export function registrarModalDeCopia() {
  copyModalPatientSelect.addEventListener("change", () => {
    populateCopyModalSessionSelect(copyModalPatientSelect.value);
    updateCopyModalPreview();
  });

  copyModalSessionSelect.addEventListener("change", updateCopyModalPreview);

  copyModalConfirm.addEventListener("click", async () => {
    if (!copyModalTemplate) return;
    try {
      const patientId = copyModalPatientSelect.value;
      const sessionId = copyModalSessionSelect.value;
      const patient = patientId ? acharPaciente(patientId) : null;
      const session = sessionId ? state.sessions.find((s) => String(s.id) === sessionId) : null;
      const filled = fillTemplateVariables(copyModalTemplate.body, patient, session);
      await copyText(filled, "Modelo copiado para a área de transferência.");
      copyMessageModal.close();
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
}

export const ACOES_MENSAGENS = {
  "new-message": () => {
    resetMessageForm();
    openPanel("messages");
    abrirDrawer("message", "criar");
  },
  "insert-variable": ({ actionSource }) => {
    inserirVariavel(actionSource.dataset.variable);
  },
  "edit-message": ({ id }) => {
    const template = state.messageTemplates.find((item) => String(item.id) === id);
    if (!template) return;
    const form = document.getElementById("message-form");
    fillForm(form, template);
    getEntityIdField(form).value = template.id;
    getFormField(form, "isActive").checked = Boolean(template.isActive);
    document.getElementById("message-form-title").textContent = `Editar modelo #${template.id}`;
    openPanel("messages");
    abrirDrawer("message", "editar");
  },
  "copy-message": ({ id }) => {
    const template = state.messageTemplates.find((item) => String(item.id) === id);
    if (!template) return;
    openCopyMessageModal(template);
  },
  "delete-message": async ({ id }) => {
    if (!window.confirm("Excluir este modelo?")) return;
    await apiRequest(`/api/admin/message-templates/${id}`, { method: "DELETE" });
    await loadMessageTemplates();
    resetMessageForm();
    setStatus("Modelo excluído com sucesso.", "success");
  }
};
