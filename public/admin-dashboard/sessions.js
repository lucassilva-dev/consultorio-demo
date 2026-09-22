import { state } from "./state.js";
import {
  formatCurrency,
  formatDataHora,
  formatDateTime,
  formatDateTimeInputValue,
  labelMaps
} from "./format.js";
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
import { loadGoogleCalendarStatus } from "./agenda.js";
import { loadDashboardSummary } from "./dashboard.js";
import { loadFinance, loadReceipts } from "./finance.js";
import { refreshAfterMutation } from "./loading.js";
import { openPanel } from "./navigation.js";

export function applySessionPatientDefaults(patient) {
  const form = document.getElementById("session-form");
  const priceInput = getFormField(form, "price");
  const meetingUrlInput = getFormField(form, "meetingUrl");
  const defaultMeetingUrl = state.platformSettings?.meetingDefaultUrl || "";

  if (patient && (!priceInput.value || priceInput.value === "0")) {
    priceInput.value = String(patient.sessionPrice || 0);
  }

  if (defaultMeetingUrl && (!meetingUrlInput.value || meetingUrlInput.value.trim() === "")) {
    meetingUrlInput.value = defaultMeetingUrl;
  }
}

/* ── Ficha da sessão: as sete ações num só lugar ── */
function abrirFichaSessao(sessionId) {
  const sessao = state.sessions.find((item) => String(item.id) === String(sessionId));
  if (!sessao) return;

  document.getElementById("session-sheet-titulo").textContent = sessao.patientName;
  document.getElementById("session-sheet-meta").innerHTML = `
    <span class="mono">${escapeHtml(formatDateTime(sessao.scheduledAt))}</span>
    <span class="mono">${escapeHtml(formatCurrency(sessao.price))}</span>
    ${renderChip("session", sessao.status, labelMaps.sessionStatus[sessao.status])}
    ${renderChip("payment", sessao.paymentStatus, labelMaps.paymentStatus[sessao.paymentStatus])}
  `;

  // Toda ação da ficha age sobre esta sessão.
  document
    .querySelectorAll("#session-sheet [data-action]")
    .forEach((botao) => {
      botao.dataset.id = sessao.id;
    });

  // O que já foi aplicado não se aplica de novo.
  const done = document.getElementById("session-sheet-done");
  const paid = document.getElementById("session-sheet-paid");
  done.disabled = sessao.status === "realizada";
  done.textContent = sessao.status === "realizada" ? "● Já realizada" : "● Marcar realizada";
  paid.disabled = sessao.paymentStatus === "pago";
  paid.textContent = sessao.paymentStatus === "pago" ? "R$ Já pago" : "R$ Marcar pago";

  const sync = document.getElementById("session-sheet-sync");
  if (sessao.googleCalendarSyncStatus === "failed") {
    sync.hidden = false;
    sync.innerHTML = `<span class="sinc-google is-falhou">▲ Google falhou</span>
      <span class="texto-apoio">${escapeHtml(sessao.googleCalendarError || "Sincronização não concluída.")}</span>
      <button class="btn btn-secondary btn-compacto" type="button" data-action="retry-google-sync" data-id="${sessao.id}">Tentar de novo</button>`;
  } else {
    sync.hidden = true;
    sync.innerHTML = "";
  }

  abrirDrawer("session-sheet");
}

export function resetSessionForm() {
  const form = document.getElementById("session-form");
  form.reset();
  getEntityIdField(form).value = "";
  getFormField(form, "durationMinutes").value = "50";
  getFormField(form, "status").value = "agendada";
  getFormField(form, "paymentStatus").value = "pendente";
  getFormField(form, "paymentMethod").value = "pix";
  document.getElementById("session-form-title").textContent = "Nova sessão";
  clearFormFeedback(form);
}

// Sincronização do Google nunca vira chip: são dois status principais na mesma
// linha (sessão e pagamento) e um terceiro chip competiria com eles.
function buildGoogleSyncMeta(session) {
  const estados = {
    synced: ["✓ Google", ""],
    pending: ["◐ Google pendente", " is-pendente"],
    failed: ["▲ Google falhou", " is-falhou"]
  };
  const estado = estados[session.googleCalendarSyncStatus];
  if (!estado) {
    return "";
  }
  const [texto, classe] = estado;
  const retry =
    session.googleCalendarSyncStatus === "failed"
      ? ` <a href="#" data-action="retry-google-sync" data-id="${session.id}">tentar de novo</a>`
      : "";
  return `<span class="sinc-google${classe}">${texto}${retry}</span>`;
}

function renderSessionsTable() {
  const lista = document.getElementById("sessions-list");
  const empty = document.getElementById("sessions-empty");
  const contagem = document.getElementById("sessions-count");
  const f = state.sessionFilters;
  const filtrosAtivos = ["dateFrom", "dateTo", "patientId", "status", "paymentStatus"].filter(
    (k) => f[k]
  ).length;

  lista.innerHTML = state.sessions
    .map((session) => {
      const realizada = session.status === "realizada";
      const paga = session.paymentStatus === "pago";
      const sync = buildGoogleSyncMeta(session);
      return `
        <article class="admin-registro">
          <button class="admin-registro-abrir" type="button" data-action="open-session-sheet" data-id="${
            session.id
          }" aria-label="Abrir ações da sessão de ${escapeHtml(session.patientName)}">
            <span class="admin-registro-titulo">
              <strong>${escapeHtml(session.patientName)}</strong>
              <span class="mono">${escapeHtml(formatDataHora(session.scheduledAt))}</span>
            </span>
            <span class="admin-registro-linha">
              ${renderChip("session", session.status, labelMaps.sessionStatus[session.status])}
              ${renderChip(
                "payment",
                session.paymentStatus,
                labelMaps.paymentStatus[session.paymentStatus]
              )}
              ${sync}
            </span>
          </button>
          <div class="admin-registro-atalhos apenas-desktop">
            ${
              realizada
                ? ""
                : `<button class="btn btn-verde-suave btn-compacto" type="button" data-action="done-session" data-id="${session.id}">● Realizada</button>`
            }
            ${
              paga
                ? ""
                : `<button class="btn btn-primary btn-compacto" type="button" data-action="paid-session" data-id="${session.id}">R$ Pago</button>`
            }
          </div>
          <button class="btn btn-secondary admin-registro-mais" type="button" data-action="open-session-sheet" data-id="${
            session.id
          }" aria-label="Todas as ações">⋯</button>
        </article>
      `;
    })
    .join("");

  const limparSessoes = document.getElementById("session-clear");
  if (limparSessoes) {
    limparSessoes.hidden = filtrosAtivos === 0;
    limparSessoes.textContent = `Limpar ${filtrosAtivos === 1 ? "o filtro" : `os ${filtrosAtivos} filtros`}`;
  }

  // Antes exibia `N de N`, que é sempre verdadeiro e não informa nada. Com
  // filtro ativo, dizer que o número é do recorte é o que ajuda.
  contagem.textContent = state.sessions.length
    ? `${state.sessions.length}${filtrosAtivos ? " no filtro" : ""}`
    : "";

  empty.hidden = state.sessions.length > 0;
  empty.innerHTML = filtrosAtivos
    ? `<h3>Nenhuma sessão com esses filtros</h3>
       <p>Nenhum atendimento corresponde aos ${filtrosAtivos} filtro(s) aplicado(s).</p>
       <button class="btn btn-secondary btn-compacto" type="button" data-reset-filter="session">Limpar os ${filtrosAtivos} filtros</button>`
    : `<h3>Nenhuma sessão cadastrada</h3>
       <p>Agende o primeiro atendimento para acompanhar presença e pagamento.</p>
       <button class="btn btn-primary btn-compacto" type="button" data-action="new-session">＋ Nova sessão</button>`;
}

function readSessionFormPayload(form) {
  return {
    patientId: getFormValue(form, "patientId"),
    scheduledAt: getFormValue(form, "scheduledAt"),
    durationMinutes: getFormValue(form, "durationMinutes"),
    status: getFormValue(form, "status"),
    paymentStatus: getFormValue(form, "paymentStatus"),
    price: getFormValue(form, "price"),
    paymentMethod: getFormValue(form, "paymentMethod"),
    paidAt: getFormValue(form, "paidAt"),
    meetingUrl: getFormValue(form, "meetingUrl").trim(),
    administrativeNote: getFormValue(form, "administrativeNote").trim()
  };
}

export async function loadSessions() {
  const response = await apiRequest(`/api/admin/sessions${toQueryString(state.sessionFilters)}`);
  state.sessions = response.data.items || [];
  renderSessionsTable();
}

export function registrarFormularioDeSessao() {
  document.getElementById("session-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    clearFormFeedback(form);
    clearFieldErrors(form);

    try {
      const payload = readSessionFormPayload(form);
      setFormBusy(form, true, "Salvando...");
      const entityId = getEntityIdField(form).value;
      const method = entityId ? "PUT" : "POST";
      const url = entityId ? `/api/admin/sessions/${entityId}` : "/api/admin/sessions";
      await runMutation(url, { method, body: JSON.stringify(payload) });
      // Libera o formulário imediatamente — refresh ocorre em background
      resetSessionForm();
      fecharDrawer("session");
      showToast("Sessão salva com sucesso.", "success");
      refreshAfterMutation([
        loadSessions(),
        loadDashboardSummary(),
        loadFinance(),
        loadReceipts(),
        loadGoogleCalendarStatus()
      ]).then((failures) => {
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

export const ACOES_SESSOES = {
  "new-session": () => {
    resetSessionForm();
    openPanel("sessions");
    abrirDrawer("session", "criar");
  },
  "open-session-sheet": ({ id }) => {
    abrirFichaSessao(id);
  },
  "edit-session": ({ id }) => {
    fecharDrawer("session-sheet");
    const session = state.sessions.find((item) => String(item.id) === id);
    if (!session) return;
    const form = document.getElementById("session-form");
    fillForm(form, {
      ...session,
      patientId: session.patientId,
      scheduledAt: formatDateTimeInputValue(session.scheduledAt),
      paidAt: formatDateTimeInputValue(session.paidAt)
    });
    getEntityIdField(form).value = session.id;
    document.getElementById("session-form-title").textContent = `Editar sessão #${session.id}`;
    openPanel("sessions");
    abrirDrawer("session", "editar");
  },
  "reschedule-session": ({ id }) => {
    fecharDrawer("session-sheet");
    const session = state.sessions.find((item) => String(item.id) === id);
    if (!session) return;
    const form = document.getElementById("session-form");
    fillForm(form, {
      ...session,
      patientId: session.patientId,
      status: "remarcada",
      scheduledAt: formatDateTimeInputValue(session.scheduledAt),
      paidAt: formatDateTimeInputValue(session.paidAt)
    });
    getEntityIdField(form).value = session.id;
    document.getElementById("session-form-title").textContent = `Remarcar sessão #${session.id}`;
    openPanel("sessions");
    abrirDrawer("session", "editar");
  },
  "done-session": async ({ id }) => {
    fecharDrawer("session-sheet");
    await apiRequest(`/api/admin/sessions/${id}/mark-done`, { method: "POST" });
    await Promise.all([loadSessions(), loadFinance(), loadDashboardSummary()]);
    setStatus("Sessão marcada como realizada.", "success");
  },
  "missed-session": async ({ id }) => {
    fecharDrawer("session-sheet");
    await apiRequest(`/api/admin/sessions/${id}/mark-missed`, { method: "POST" });
    await Promise.all([loadSessions(), loadFinance(), loadDashboardSummary()]);
    setStatus("Sessão marcada como falta.", "success");
  },
  "paid-session": async ({ id }) => {
    fecharDrawer("session-sheet");
    // A sessão pode estar na lista de Sessões ou na de Financeiro. Se não
    // for encontrada, o corpo vai vazio e o servidor preserva a forma de
    // pagamento já registrada — antes o default "pix" sobrescrevia.
    const session =
      state.sessions.find((item) => String(item.id) === id) ||
      (state.finance?.pendingPayments || []).find((item) => String(item.id) === id) ||
      (state.finance?.receivedPayments || []).find((item) => String(item.id) === id);

    await apiRequest(`/api/admin/sessions/${id}/mark-paid`, {
      method: "POST",
      body: JSON.stringify(
        session?.paymentMethod ? { paymentMethod: session.paymentMethod } : {}
      )
    });
    await Promise.all([loadSessions(), loadFinance(), loadReceipts(), loadDashboardSummary()]);
    setStatus("Pagamento marcado como recebido.", "success");
  },
  "retry-google-sync": async ({ id }) => {
    await apiRequest(`/api/admin/sessions/${id}/retry-google-sync`, { method: "POST" });
    await Promise.all([loadSessions(), loadGoogleCalendarStatus()]);
    setStatus("Sincronização da sessão reenviada ao Google Calendar.", "success");
  },
  "cancel-session": async ({ id }) => {
    fecharDrawer("session-sheet");
    if (!window.confirm("Cancelar esta sessão?")) return;
    await apiRequest(`/api/admin/sessions/${id}/cancel`, { method: "POST" });
    await Promise.all([loadSessions(), loadFinance(), loadReceipts(), loadDashboardSummary()]);
    setStatus("Sessão cancelada.", "success");
  },
  "delete-session": async ({ id }) => {
    fecharDrawer("session-sheet");
    if (!window.confirm("Excluir esta sessão?")) return;
    await apiRequest(`/api/admin/sessions/${id}`, { method: "DELETE" });
    await Promise.all([loadSessions(), loadFinance(), loadReceipts(), loadDashboardSummary()]);
    resetSessionForm();
    setStatus("Sessão excluída com sucesso.", "success");
  }
};
