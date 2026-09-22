import { state } from "./state.js";
import { labelMaps } from "./format.js";
import { abrirDrawer, escapeHtml, fecharDrawer, renderChip, setStatus, showToast } from "./ui.js";
import {
  applyFieldErrors,
  buildErrorMessage,
  clearFieldErrors,
  clearFormFeedback,
  fillForm,
  getEntityIdField,
  getFormField,
  getFormValue,
  setFormBusy,
  setFormFeedback
} from "./forms.js";
import { apiRequest, runMutation, toQueryString } from "./api.js";
import { loadDashboardSummary } from "./dashboard.js";
import { atualizarLimparFiltros } from "./filters.js";
import { refreshAfterMutation } from "./loading.js";
import { openPanel } from "./navigation.js";
import { loadPatients, resetPatientForm, updateGuardianFieldsState } from "./patients.js";

function leadRequiresGuardian(lead) {
  return ["adolescente", "responsavel_adolescente"].includes(lead?.interest);
}

function startLeadConversion(lead) {
  const form = document.getElementById("patient-form");
  const firstName = lead.name.split(/\s+/)[0] || lead.name;
  const isResponsibleLead = lead.interest === "responsavel_adolescente";

  fillForm(form, {
    fullName: lead.name,
    preferredName: firstName,
    birthDate: "",
    age: lead.age ?? "",
    phone: lead.phone,
    email: lead.email || "",
    patientType: "adolescente",
    guardianName: isResponsibleLead ? lead.name : "",
    guardianPhone: isResponsibleLead ? lead.phone : "",
    sessionPrice: "0",
    defaultWeekday: "",
    defaultTime: "",
    modality: "online",
    status: "ativo",
    administrativeNote: lead.administrativeNote
      ? `Lead convertido: ${lead.administrativeNote}`
      : "Paciente criado a partir de contato interessado."
  });
  getEntityIdField(form).value = "";
  state.pendingLeadConversion = {
    leadId: lead.id
  };
  document.getElementById("patient-form-title").textContent = `Converter contato #${lead.id} em paciente`;
  updateGuardianFieldsState();
  clearFormFeedback(form);
  setFormFeedback(
    form,
    isResponsibleLead
      ? "Revise os dados do paciente e confirme as informações do responsável antes de salvar."
      : "Complete os dados do responsável antes de salvar a conversão.",
    "success"
  );
  openPanel("patients");
  // A conversão de adolescente é um passo obrigatório: abre já no drawer, com
  // os campos de responsável visíveis.
  abrirDrawer("patient", "criar");
  document.getElementById("patient-form-mode").textContent = "＋ Convertendo contato";
}

export function resetLeadForm() {
  const form = document.getElementById("lead-form");
  form.reset();
  getEntityIdField(form).value = "";
  getFormField(form, "source").value = "site";
  getFormField(form, "interest").value = "adulto";
  getFormField(form, "status").value = "novo";
  getFormField(form, "preferredPeriod").value = "flexivel";
  document.getElementById("lead-form-title").textContent = "Novo contato";
  clearFormFeedback(form);
}

function renderLeadsTable() {
  const lista = document.getElementById("leads-list");
  const empty = document.getElementById("leads-empty");
  const contagem = document.getElementById("leads-count");
  const filtroAtivo = Boolean(state.leadFilters.search || state.leadFilters.status);

  lista.innerHTML = state.leads
    .map((lead) => {
      const virou = lead.status === "virou_paciente";
      return `
        <article class="admin-registro">
          <div class="admin-registro-corpo">
            <div class="admin-registro-titulo">
              ${escapeHtml(lead.name)}
              ${renderChip("lead", lead.status, labelMaps.leadStatus[lead.status])}
            </div>
            <div class="admin-registro-linha">
              <span class="mono">${escapeHtml(lead.phone)}</span>
              ${lead.email ? `<span>${escapeHtml(lead.email)}</span>` : ""}
              <span>via ${escapeHtml(labelMaps.leadSource[lead.source] || lead.source)} · ${escapeHtml(
                labelMaps.leadInterest[lead.interest] || lead.interest
              )}</span>
              ${lead.age ? `<span>${escapeHtml(String(lead.age))} anos</span>` : ""}
            </div>
          </div>
          <div class="admin-registro-acoes">
            <button class="btn btn-verde-suave btn-compacto" type="button" data-action="convert-lead" data-id="${
              lead.id
            }"${virou ? " disabled title=\"Este contato já virou paciente\"" : ""}>Virou paciente</button>
            <button class="btn btn-secondary btn-compacto" type="button" data-action="edit-lead" data-id="${
              lead.id
            }">Editar</button>
            <button class="btn btn-excluir btn-compacto" type="button" data-action="delete-lead" data-id="${
              lead.id
            }">Excluir</button>
          </div>
        </article>
      `;
    })
    .join("");

  atualizarLimparFiltros("lead-filters-form", filtroAtivo);

  // Antes exibia `N de N`, que é sempre verdadeiro e não informa nada. Com
  // filtro ativo, dizer que o número é do recorte é o que ajuda.
  contagem.textContent = state.leads.length
    ? `${state.leads.length}${filtroAtivo ? " no filtro" : ""}`
    : "";

  empty.hidden = state.leads.length > 0;
  empty.innerHTML = filtroAtivo
    ? `<h3>Nenhum contato com esse filtro</h3>
       <p>Nenhum cadastro corresponde à busca ou ao status escolhido.</p>
       <button class="btn btn-secondary btn-compacto" type="button" data-reset-filter="lead">Limpar filtros</button>`
    : `<h3>Nenhum contato cadastrado</h3>
       <p>Registre quem entrou em contato para acompanhar o interesse até virar paciente.</p>
       <button class="btn btn-primary btn-compacto" type="button" data-action="new-lead">＋ Novo contato</button>`;
}

function readLeadFormPayload(form) {
  return {
    name: getFormValue(form, "name").trim(),
    phone: getFormValue(form, "phone").trim(),
    email: getFormValue(form, "email").trim(),
    age: getFormValue(form, "age").trim(),
    source: getFormValue(form, "source"),
    interest: getFormValue(form, "interest"),
    status: getFormValue(form, "status"),
    preferredPeriod: getFormValue(form, "preferredPeriod"),
    administrativeNote: getFormValue(form, "administrativeNote").trim()
  };
}

export async function loadLeads() {
  const response = await apiRequest(`/api/admin/leads${toQueryString(state.leadFilters)}`);
  state.leads = response.data.items || [];
  renderLeadsTable();
}

export function registrarFormularioDeContato() {
  document.getElementById("lead-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    clearFormFeedback(form);
    clearFieldErrors(form);

    try {
      const payload = readLeadFormPayload(form);
      setFormBusy(form, true, "Salvando...");
      const entityId = getEntityIdField(form).value;
      const method = entityId ? "PUT" : "POST";
      const url = entityId ? `/api/admin/leads/${entityId}` : "/api/admin/leads";
      await runMutation(url, { method, body: JSON.stringify(payload) });
      // Libera o formulário imediatamente — refresh ocorre em background
      resetLeadForm();
      fecharDrawer("lead");
      showToast("Contato salvo com sucesso.", "success");
      refreshAfterMutation([loadLeads(), loadDashboardSummary()]).then((failures) => {
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

export const ACOES_CONTATOS = {
  "edit-lead": ({ id }) => {
    const lead = state.leads.find((item) => String(item.id) === id);
    if (!lead) return;
    const form = document.getElementById("lead-form");
    fillForm(form, lead);
    getEntityIdField(form).value = lead.id;
    document.getElementById("lead-form-title").textContent = `Editar contato #${lead.id}`;
    openPanel("leads");
    abrirDrawer("lead", "editar");
  },
  "delete-lead": async ({ id }) => {
    if (!window.confirm("Excluir este contato?")) return;
    await apiRequest(`/api/admin/leads/${id}`, { method: "DELETE" });
    await Promise.all([loadLeads(), loadDashboardSummary()]);
    resetLeadForm();
    setStatus("Contato excluído com sucesso.", "success");
  },
  "convert-lead": async ({ id }) => {
    const lead = state.leads.find((item) => String(item.id) === id);
    if (!lead) return;
    if (leadRequiresGuardian(lead)) {
      startLeadConversion(lead);
      setStatus("Conversão assistida iniciada no formulário de paciente.", "success");
      return;
    }
    if (!window.confirm("Converter este contato em paciente?")) return;
    await apiRequest(`/api/admin/leads/${id}/convert-to-patient`, { method: "POST" });
    await Promise.all([loadLeads(), loadPatients(), loadDashboardSummary()]);
    resetPatientForm();
    openPanel("patients");
    setStatus("Contato convertido em paciente.", "success");
  },
  "new-lead": () => {
    resetLeadForm();
    openPanel("leads");
    abrirDrawer("lead", "criar");
  }
};
