import { state } from "./state.js";
import { formatDateInputValue, labelMaps } from "./format.js";
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
import { loadFinance, loadReceipts } from "./finance.js";
import { loadLeads } from "./leads.js";
import { refreshAfterMutation } from "./loading.js";
import { openPanel } from "./navigation.js";
import { loadSessions } from "./sessions.js";

// Os campos de responsável só existem para adolescente: aparecem e somem
// conforme o tipo escolhido, e ficam obrigatórios quando visíveis.
export function updateGuardianFieldsState() {
  const form = document.getElementById("patient-form");
  const patientType = getFormValue(form, "patientType");
  const bloco = document.getElementById("guardian-fields");
  const exigido = patientType === "adolescente";

  bloco.hidden = !exigido;
  ["guardianName", "guardianPhone"].forEach((nome) => {
    const campo = form.elements.namedItem(nome);
    if (campo) campo.required = exigido;
  });
}

export function resetPatientForm() {
  const form = document.getElementById("patient-form");
  form.reset();
  state.pendingLeadConversion = null;
  getEntityIdField(form).value = "";
  getFormField(form, "patientType").value = "adulto";
  getFormField(form, "modality").value = "online";
  getFormField(form, "status").value = "ativo";
  getFormField(form, "sessionPrice").value = "0";
  const ageField = getFormField(form, "age");
  if (ageField) { ageField.readOnly = false; ageField.title = ""; }
  document.getElementById("patient-form-title").textContent = "Novo paciente";
  updateGuardianFieldsState();
  clearFormFeedback(form);
}

// Busca um paciente por id na lista COMPLETA. Procurar em state.patients (que
// é a lista filtrada da tela Pacientes) fazia o cadastro sumir de outras telas
// assim que houvesse uma busca ativa ali.
export function acharPaciente(id) {
  const alvo = String(id);
  return (
    state.allPatients.find((item) => String(item.id) === alvo) ||
    state.patients.find((item) => String(item.id) === alvo) ||
    null
  );
}

function refreshPatientSelectOptions() {
  const patientSelects = document.querySelectorAll("[data-patient-select]");
  patientSelects.forEach((select) => {
    const selectedValue = select.value;
    const isFilter = select.form?.id !== "session-form";
    const blankLabel = isFilter ? "Todos" : "Selecione paciente";
    // Sempre a lista completa: a busca da tela Pacientes não pode limitar quem
  // aparece nos seletores de outras telas.
  const listaCompleta = state.allPatients.length ? state.allPatients : state.patients;
    select.innerHTML = `<option value="">${blankLabel}</option>${listaCompleta
      .map(
        (patient) =>
          `<option value="${patient.id}">${escapeHtml(patient.fullName)}</option>`
      )
      .join("")}`;
    if (selectedValue) {
      select.value = String(selectedValue);
    }
  });
}

function renderPatientsTable() {
  const lista = document.getElementById("patients-list");
  const empty = document.getElementById("patients-empty");
  const contagem = document.getElementById("patients-count");
  const filtroAtivo = Boolean(state.patientFilters.search || state.patientFilters.status);

  lista.innerHTML = state.patients
    .map(
      (patient) => `
        <article class="admin-registro">
          <div class="admin-registro-corpo">
            <div class="admin-registro-titulo">
              ${escapeHtml(patient.fullName)}
              ${patient.preferredName ? `<em>${escapeHtml(patient.preferredName)}</em>` : ""}
              ${renderChip("patient", patient.status, labelMaps.patientStatus[patient.status])}
            </div>
            <div class="admin-registro-linha">
              <span>${escapeHtml(labelMaps.patientType[patient.patientType] || patient.patientType)}</span>
              <span>·</span>
              <span>${escapeHtml(labelMaps.patientModality[patient.modality] || patient.modality)}</span>
              ${patient.phone ? `<span class="mono">${escapeHtml(patient.phone)}</span>` : ""}
              ${patient.email ? `<span>${escapeHtml(patient.email)}</span>` : ""}
            </div>
          </div>
          <div class="admin-registro-acoes">
            <button class="btn btn-escuro btn-compacto" type="button" data-action="open-clinical" data-id="${patient.id}">Prontuário</button>
            <button class="btn btn-secondary btn-compacto" type="button" data-action="edit-patient" data-id="${patient.id}">Editar</button>
            <button class="btn btn-excluir btn-compacto" type="button" data-action="delete-patient" data-id="${patient.id}">Excluir</button>
          </div>
        </article>
      `
    )
    .join("");

  atualizarLimparFiltros("patient-filters-form", filtroAtivo);

  // Antes exibia `N de N`, que é sempre verdadeiro e não informa nada. Com
  // filtro ativo, dizer que o número é do recorte é o que ajuda.
  contagem.textContent = state.patients.length
    ? `${state.patients.length}${filtroAtivo ? " no filtro" : ""}`
    : "";

  // Vazio por falta de cadastro pede um caminho para criar; vazio por filtro
  // pede um caminho para afrouxar o filtro.
  empty.hidden = state.patients.length > 0;
  empty.innerHTML = filtroAtivo
    ? `<h3>Nenhum paciente com esse filtro</h3>
       <p>Nenhum cadastro corresponde à busca ou ao status escolhido.</p>
       <button class="btn btn-secondary btn-compacto" type="button" data-reset-filter="patient">Limpar filtros</button>`
    : `<h3>Nenhum paciente cadastrado</h3>
       <p>Cadastre o primeiro paciente para abrir a agenda e o prontuário dele.</p>
       <button class="btn btn-primary btn-compacto" type="button" data-action="new-patient">＋ Novo paciente</button>`;
}

function readPatientFormPayload(form) {
  return {
    fullName: getFormValue(form, "fullName").trim(),
    preferredName: getFormValue(form, "preferredName").trim(),
    birthDate: getFormValue(form, "birthDate"),
    age: getFormValue(form, "age").trim(),
    phone: getFormValue(form, "phone").trim(),
    email: getFormValue(form, "email").trim(),
    patientType: getFormValue(form, "patientType"),
    guardianName: getFormValue(form, "guardianName").trim(),
    guardianPhone: getFormValue(form, "guardianPhone").trim(),
    sessionPrice: getFormValue(form, "sessionPrice").trim() || "0",
    defaultWeekday: getFormValue(form, "defaultWeekday"),
    defaultTime: getFormValue(form, "defaultTime"),
    modality: getFormValue(form, "modality"),
    status: getFormValue(form, "status"),
    administrativeNote: getFormValue(form, "administrativeNote").trim()
  };
}

export async function loadPatients() {
  const response = await apiRequest(`/api/admin/patients${toQueryString(state.patientFilters)}`);
  state.patients = response.data.items || [];

  const filtroAtivo = Boolean(state.patientFilters.search || state.patientFilters.status);
  if (filtroAtivo) {
    // Com filtro na tela de Pacientes, os seletores precisam continuar
    // oferecendo todo mundo — quem filtrou ali não pediu para deixar de poder
    // agendar sessão para os demais.
    await loadAllPatients();
  } else {
    state.allPatients = state.patients;
    refreshPatientSelectOptions();
  }

  renderPatientsTable();
}

async function loadAllPatients() {
  const response = await apiRequest("/api/admin/patients");
  state.allPatients = response.data.items || [];
  refreshPatientSelectOptions();
}

export function registrarFormularioDePaciente() {
  document.getElementById("patient-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    clearFormFeedback(form);
    clearFieldErrors(form);

    try {
      const payload = readPatientFormPayload(form);
      const entityId = getEntityIdField(form).value;
      const isLeadConversion = Boolean(state.pendingLeadConversion && !entityId);
      setFormBusy(form, true, isLeadConversion ? "Convertendo..." : "Salvando...");
      const method = entityId ? "PUT" : "POST";
      const url = isLeadConversion
        ? `/api/admin/leads/${state.pendingLeadConversion.leadId}/convert-to-patient`
        : entityId
          ? `/api/admin/patients/${entityId}`
          : "/api/admin/patients";
      await runMutation(url, { method, body: JSON.stringify(payload) });
      // Libera o formulário imediatamente — refresh ocorre em background
      const successMsg = isLeadConversion ? "Contato convertido em paciente." : "Paciente salvo com sucesso.";
      resetPatientForm();
      fecharDrawer("patient");
      showToast(successMsg, "success");
      const refreshLoaders = isLeadConversion
        ? [loadLeads(), loadPatients(), loadDashboardSummary()]
        : [loadPatients(), loadDashboardSummary()];
      refreshAfterMutation(refreshLoaders).then((failures) => {
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

export const ACOES_PACIENTES = {
  "edit-patient": ({ id }) => {
    const patient = acharPaciente(id);
    if (!patient) return;
    state.pendingLeadConversion = null;
    const form = document.getElementById("patient-form");
    fillForm(form, {
      ...patient,
      birthDate: formatDateInputValue(patient.birthDate)
    });
    getEntityIdField(form).value = patient.id;
    document.getElementById("patient-form-title").textContent = `Editar paciente #${patient.id}`;
    updateGuardianFieldsState();
    // lock age field if birthDate is present
    const ageFieldEdit = form.elements.namedItem("age");
    const birthDateFieldEdit = form.elements.namedItem("birthDate");
    if (birthDateFieldEdit && birthDateFieldEdit.value) {
      ageFieldEdit.readOnly = true;
      ageFieldEdit.title = "Calculado automaticamente a partir da data de nascimento";
    } else if (ageFieldEdit) {
      ageFieldEdit.readOnly = false;
      ageFieldEdit.title = "";
    }
    openPanel("patients");
    abrirDrawer("patient", "editar");
  },
  "new-patient": () => {
    resetPatientForm();
    openPanel("patients");
    abrirDrawer("patient", "criar");
  },
  "delete-patient": async ({ id }) => {
    if (!window.confirm("Excluir este paciente e suas sessões associadas?")) return;
    await apiRequest(`/api/admin/patients/${id}`, { method: "DELETE" });
    await Promise.all([
      loadPatients(),
      loadSessions(),
      loadFinance(),
      loadReceipts(),
      loadDashboardSummary()
    ]);
    resetPatientForm();
    setStatus("Paciente excluído com sucesso.", "success");
  }
};
