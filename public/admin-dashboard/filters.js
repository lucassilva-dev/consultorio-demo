import { state } from "./state.js";
import { setStatus } from "./ui.js";
import { getFormField, getFormValue } from "./forms.js";
import { loadAuditLogs } from "./audit.js";
import { loadFinance, loadReceipts } from "./finance.js";
import { loadLeads } from "./leads.js";
import { loadMessageTemplates } from "./messages.js";
import { loadPatients } from "./patients.js";
import { loadSessions } from "./sessions.js";

/* ── Filtros ao vivo ──
   Os filtros não têm mais botão de aplicar: mudança em select ou data vale na
   hora, e digitação espera 350 ms para não disparar uma requisição por tecla. */
const FILTROS_AO_VIVO = [
  "lead-filters-form",
  "patient-filters-form",
  "session-filters-form",
  "message-filters-form",
  "finance-filters-form",
  "audit-filters-form"
];

let temporizadorFiltro = null;

function aplicarFiltroAoVivo(form, imediato) {
  clearTimeout(temporizadorFiltro);
  const disparar = () => form.requestSubmit();
  if (imediato) {
    disparar();
  } else {
    temporizadorFiltro = setTimeout(disparar, 350);
  }
}

// Um select dispara input E change: tratar os dois como instantâneos fazia
// cada mudança de filtro sair como duas requisições idênticas. Cada tipo de
// campo tem agora um evento só.
function ehCampoInstantaneo(target) {
  return target.tagName === "SELECT" || target.type === "date";
}

export function registrarFiltrosAoVivo() {
  FILTROS_AO_VIVO.forEach((id) => {
    const form = document.getElementById(id);
    if (!form) return;

    // Digitação: só no input, com espera.
    form.addEventListener("input", (event) => {
      if (ehCampoInstantaneo(event.target)) return;
      aplicarFiltroAoVivo(form, false);
    });

    // Select e data: só no change, na hora.
    form.addEventListener("change", (event) => {
      if (!ehCampoInstantaneo(event.target)) return;
      aplicarFiltroAoVivo(form, true);
    });
  });
}

// "Limpar filtros" só existe quando há filtro para limpar.
export function atualizarLimparFiltros(formId, ativo) {
  const botao = document.querySelector(`#${formId} .admin-limpar-filtros`);
  if (botao) botao.hidden = !ativo;
}

export function syncFilterForms() {
  const leadForm = document.getElementById("lead-filters-form");
  getFormField(leadForm, "search").value = state.leadFilters.search;
  getFormField(leadForm, "status").value = state.leadFilters.status;

  const patientForm = document.getElementById("patient-filters-form");
  getFormField(patientForm, "search").value = state.patientFilters.search;
  getFormField(patientForm, "status").value = state.patientFilters.status;

  const sessionForm = document.getElementById("session-filters-form");
  getFormField(sessionForm, "patientId").value = state.sessionFilters.patientId;
  getFormField(sessionForm, "status").value = state.sessionFilters.status;
  getFormField(sessionForm, "paymentStatus").value = state.sessionFilters.paymentStatus;
  getFormField(sessionForm, "dateFrom").value = state.sessionFilters.dateFrom;
  getFormField(sessionForm, "dateTo").value = state.sessionFilters.dateTo;

  const financeForm = document.getElementById("finance-filters-form");
  getFormField(financeForm, "month").value = state.financeFilters.month;
  getFormField(financeForm, "year").value = state.financeFilters.year;
  getFormField(financeForm, "patientId").value = state.financeFilters.patientId;
  getFormField(financeForm, "paymentStatus").value = state.financeFilters.paymentStatus;

  const messageForm = document.getElementById("message-filters-form");
  getFormField(messageForm, "search").value = state.messageFilters.search;
  getFormField(messageForm, "category").value = state.messageFilters.category;

  const auditForm = document.getElementById("audit-filters-form");
  getFormField(auditForm, "action").value = state.auditFilters.action;
  getFormField(auditForm, "entityType").value = state.auditFilters.entityType;
  getFormField(auditForm, "date").value = state.auditFilters.date;
  getFormField(auditForm, "adminEmail").value = state.auditFilters.adminEmail;
}

export function registrarEnvioDosFiltros() {
  document.getElementById("lead-filters-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    state.leadFilters = {
      search: getFormValue(form, "search").trim(),
      status: getFormValue(form, "status")
    };
    await loadLeads().catch((error) => setStatus(error.message, "error"));
  });

  document.getElementById("patient-filters-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    state.patientFilters = {
      search: getFormValue(form, "search").trim(),
      status: getFormValue(form, "status")
    };
    await loadPatients().catch((error) => setStatus(error.message, "error"));
  });

  document.getElementById("session-filters-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    state.sessionFilters = {
      patientId: getFormValue(form, "patientId"),
      status: getFormValue(form, "status"),
      paymentStatus: getFormValue(form, "paymentStatus"),
      dateFrom: getFormValue(form, "dateFrom"),
      dateTo: getFormValue(form, "dateTo")
    };
    await loadSessions().catch((error) => setStatus(error.message, "error"));
  });

  document.getElementById("finance-receipt-basis")?.addEventListener("change", async (event) => {
    state.receiptBasis = event.target.value;
    await loadReceipts().catch((error) => setStatus(error.message, "error"));
  });

  document.getElementById("finance-filters-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    state.financeFilters = {
      month: getFormValue(form, "month"),
      year: getFormValue(form, "year"),
      patientId: getFormValue(form, "patientId"),
      paymentStatus: getFormValue(form, "paymentStatus")
    };
    await Promise.all([loadFinance(), loadReceipts()]).catch((error) =>
      setStatus(error.message, "error")
    );
  });

  document.getElementById("message-filters-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    state.messageFilters = {
      search: getFormValue(form, "search").trim(),
      category: getFormValue(form, "category")
    };
    await loadMessageTemplates().catch((error) => setStatus(error.message, "error"));
  });

  document.getElementById("audit-filters-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    state.auditFilters = {
      ...state.auditFilters,
      action: getFormValue(form, "action").trim(),
      entityType: getFormValue(form, "entityType").trim(),
      date: getFormValue(form, "date"),
      adminEmail: getFormValue(form, "adminEmail").trim(),
      page: 1
    };
    await loadAuditLogs().catch((error) => setStatus(error.message, "error"));
  });
}

export function registrarLimpezaDosFiltros() {
  // Delegação, e não listeners presos aos botões: os que ficam dentro dos
  // estados vazios são recriados a cada innerHTML, e os listeners registrados
  // no carregamento morriam com o markup antigo — o botão não fazia nada.
  document.addEventListener("click", async (event) => {
    const button = event.target.closest?.("[data-reset-filter]");
    if (button) {
      const kind = button.dataset.resetFilter;
      if (kind === "lead") {
        document.getElementById("lead-filters-form").reset();
        state.leadFilters = { search: "", status: "" };
        await loadLeads().catch((error) => setStatus(error.message, "error"));
      }
      if (kind === "patient") {
        document.getElementById("patient-filters-form").reset();
        state.patientFilters = { search: "", status: "" };
        await loadPatients().catch((error) => setStatus(error.message, "error"));
      }
      if (kind === "session") {
        document.getElementById("session-filters-form").reset();
        state.sessionFilters = { patientId: "", status: "", paymentStatus: "", dateFrom: "", dateTo: "" };
        await loadSessions().catch((error) => setStatus(error.message, "error"));
      }
      if (kind === "message") {
        document.getElementById("message-filters-form").reset();
        state.messageFilters = { search: "", category: "" };
        await loadMessageTemplates().catch((error) => setStatus(error.message, "error"));
      }
      if (kind === "audit") {
        document.getElementById("audit-filters-form").reset();
        state.auditFilters = {
          action: "",
          entityType: "",
          date: "",
          adminEmail: "",
          page: 1,
          pageSize: state.auditFilters.pageSize || 20
        };
        await loadAuditLogs().catch((error) => setStatus(error.message, "error"));
      }
    }
  });
}
