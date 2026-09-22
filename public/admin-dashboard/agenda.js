import { state } from "./state.js";
import { formatDateTime } from "./format.js";
import { copyText, escapeHtml, setStatus, showToast } from "./ui.js";
import {
  applyFieldErrors,
  buildErrorMessage,
  clearFieldErrors,
  clearFormFeedback,
  fillForm,
  getFormChecked,
  getFormValue,
  setFormBusy,
  setFormFeedback
} from "./forms.js";
import { apiRequest } from "./api.js";
import { loadDashboardSummary } from "./dashboard.js";
import { buildRefreshWarning, refreshAfterMutation } from "./loading.js";
import { acharPaciente } from "./patients.js";
import { applySessionPatientDefaults, loadSessions } from "./sessions.js";

function formatGoogleCalendarStatusLabel(value) {
  return (
    {
      pending: "Pendente",
      synced: "Sincronizado",
      failed: "Falhou",
      skipped: "Ignorado"
    }[value] || "Sem status"
  );
}

function getGoogleCalendarStatusTone(value) {
  if (value === "synced") {
    return "success";
  }
  if (value === "failed") {
    return "danger";
  }
  if (value === "pending") {
    return "warning";
  }
  return "";
}

function populatePlatformSettingsForm() {
  fillForm(document.getElementById("platform-settings-form"), state.platformSettings || {});
}

function populateGoogleCalendarForm() {
  const form = document.getElementById("google-calendar-form");
  const settings = state.googleCalendarStatus?.settings || {};
  fillForm(form, settings);

  const select = document.getElementById("google-calendar-id-select");
  const selectedValue = settings.googleCalendarId || "primary";
  const calendars = state.googleCalendars.length
    ? state.googleCalendars
    : [{ id: "primary", summary: "Principal", primary: true }];

  // O calendário salvo precisa existir como opção mesmo quando a lista não
  // carregou (conexão caiu, token expirado). Sem isso, select.value não
  // encontrava a opção, o campo ficava vazio e salvar as configurações
  // devolvia 400 — sem o admin ter mexido em nada.
  const opcoes = calendars.some((calendar) => calendar.id === selectedValue)
    ? calendars
    : [...calendars, { id: selectedValue, summary: selectedValue, primary: false }];

  select.innerHTML = opcoes
    .map(
      (calendar) =>
        `<option value="${escapeHtml(calendar.id)}">${escapeHtml(
          calendar.primary ? `${calendar.summary} (principal)` : calendar.summary
        )}</option>`
    )
    .join("");
  select.value = selectedValue;
}

function renderGoogleCalendarStatus() {
  const status = state.googleCalendarStatus || {
    configured: false,
    connected: false,
    email: "",
    lastSyncedAt: "",
    failedCount: 0,
    settings: {}
  };

  const conectado = Boolean(status.connected);
  const falhas = Number(status.failedCount) || 0;

  // A integração é uma máquina de estados: conectado e desconectado são telas
  // diferentes, não a mesma tela com botões desabilitados.
  document.getElementById("google-calendar-connected").hidden = !conectado;
  document.getElementById("google-calendar-disconnected").hidden = conectado;

  if (conectado) {
    document.getElementById("google-calendar-status-email").textContent = status.email || "";
    const sincronizacao = status.lastSyncedAt
      ? `Última sincronização ${formatDateTime(status.lastSyncedAt)}`
      : "Ainda sem sincronização registrada";
    const alerta = falhas
      ? ` · <span class="sinc-google is-falhou">▲ ${falhas} ${
          falhas === 1 ? "sessão falhou" : "sessões falharam"
        } ao sincronizar</span>`
      : "";
    document.getElementById("google-calendar-status-sync").innerHTML = `${escapeHtml(
      sincronizacao
    )}${alerta}`;

    // Reprocessar só existe quando há falha para reprocessar.
    const reprocessar = document.getElementById("google-calendar-reprocess-button");
    reprocessar.hidden = falhas === 0;
    reprocessar.textContent = `Reprocessar ${falhas} ${falhas === 1 ? "falha" : "falhas"}`;
  } else {
    const explica = document.getElementById("google-calendar-explica");
    const conectar = document.getElementById("google-calendar-connect-button");
    if (status.blockedReason) {
      explica.textContent = status.blockedReason;
      conectar.disabled = true;
    } else if (!status.configured) {
      explica.textContent =
        "Faltam as credenciais GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_REDIRECT_URI no ambiente.";
      conectar.disabled = true;
    } else {
      explica.textContent =
        "Nenhuma conta conectada. Conectar leva você à autorização do Google e traz de volta — as sessões passam a virar eventos automaticamente.";
      conectar.disabled = false;
    }
  }

  populateGoogleCalendarForm();
}

function readPlatformSettingsPayload(form) {
  return {
    schedulingUrl: getFormValue(form, "schedulingUrl").trim(),
    schedulingLabel: getFormValue(form, "schedulingLabel").trim(),
    meetingDefaultUrl: getFormValue(form, "meetingDefaultUrl").trim(),
    cancellationPolicyText: getFormValue(form, "cancellationPolicyText").trim(),
    showSchedulingButton: getFormChecked(form, "showSchedulingButton"),
    professionalName: getFormValue(form, "professionalName").trim(),
    crp: getFormValue(form, "crp").trim(),
    professionalDocument: getFormValue(form, "professionalDocument").trim(),
    receiptCity: getFormValue(form, "receiptCity").trim(),
    receiptFooterText: getFormValue(form, "receiptFooterText").trim()
  };
}

function readGoogleCalendarPayload(form) {
  return {
    googleCalendarEnabled: getFormChecked(form, "googleCalendarEnabled"),
    googleCalendarId: getFormValue(form, "googleCalendarId"),
    googleCalendarCreateMeet: getFormChecked(form, "googleCalendarCreateMeet"),
    googleCalendarReminderMinutes: getFormValue(form, "googleCalendarReminderMinutes"),
    googleCalendarSendUpdates: getFormChecked(form, "googleCalendarSendUpdates")
  };
}

export async function loadPlatformSettings() {
  const response = await apiRequest("/api/admin/platform-settings");
  state.platformSettings = response.data;
  populatePlatformSettingsForm();
  const selectedPatientId = getFormValue(document.getElementById("session-form"), "patientId");
  if (selectedPatientId) {
    const patient = acharPaciente(selectedPatientId);
    applySessionPatientDefaults(patient);
  }
}

async function loadGoogleCalendars() {
  if (!state.googleCalendarStatus?.connected) {
    state.googleCalendars = [];
    renderGoogleCalendarStatus();
    return;
  }

  const response = await apiRequest("/api/admin/google-calendar/calendars");
  state.googleCalendars = response.data.items || [];
  renderGoogleCalendarStatus();
}

export async function loadGoogleCalendarStatus() {
  const response = await apiRequest("/api/admin/google-calendar/status");
  state.googleCalendarStatus = response.data;
  renderGoogleCalendarStatus();

  if (state.googleCalendarStatus.connected && !state.googleCalendarStatus.blockedReason) {
    await loadGoogleCalendars();
  } else {
    state.googleCalendars = [];
    renderGoogleCalendarStatus();
  }
}

export function registrarFormulariosDaAgenda() {
  document.getElementById("platform-settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    clearFormFeedback(form);
    clearFieldErrors(form);

    try {
      const payload = readPlatformSettingsPayload(form);
      setFormBusy(form, true, "Salvando...");
      const response = await apiRequest("/api/admin/platform-settings", {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      state.platformSettings = response.data;
      populatePlatformSettingsForm();
      const refreshFailures = await refreshAfterMutation([loadDashboardSummary()]);
      setFormFeedback(
        form,
        buildRefreshWarning("Agenda salva com sucesso.", refreshFailures),
        refreshFailures.length ? "warning" : "success"
      );
      setStatus(
        buildRefreshWarning("Configurações de agenda atualizadas.", refreshFailures),
        refreshFailures.length ? "warning" : "success"
      );
    } catch (error) {
      applyFieldErrors(form, error.details?.fieldErrors);
      setFormFeedback(form, buildErrorMessage(error), "error");
    } finally {
      setFormBusy(form, false);
    }
  });

  document.getElementById("google-calendar-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    clearFormFeedback(form);
    clearFieldErrors(form);

    try {
      const payload = readGoogleCalendarPayload(form);
      setFormBusy(form, true, "Salvando...");
      const response = await apiRequest("/api/admin/google-calendar/settings", {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      state.googleCalendarStatus = {
        ...(state.googleCalendarStatus || {}),
        settings: {
          ...(state.googleCalendarStatus?.settings || {}),
          ...response.data
        }
      };
      const refreshFailures = await refreshAfterMutation([
        loadPlatformSettings(),
        loadGoogleCalendarStatus()
      ]);
      setFormFeedback(
        form,
        buildRefreshWarning("Integração do Google Calendar salva.", refreshFailures),
        refreshFailures.length ? "warning" : "success"
      );
      setStatus(
        buildRefreshWarning("Configurações do Google Calendar atualizadas.", refreshFailures),
        refreshFailures.length ? "warning" : "success"
      );
    } catch (error) {
      applyFieldErrors(form, error.details?.fieldErrors);
      setFormFeedback(form, buildErrorMessage(error), "error");
    } finally {
      setFormBusy(form, false);
    }
  });
}

function setGcalActionFeedback(message, tone = "success") {
  showToast(message, tone);
}

export function registrarBotoesDaAgenda() {
  document.getElementById("google-calendar-connect-button").addEventListener("click", async () => {
    try {
      const response = await apiRequest("/api/admin/google-calendar/auth-url");
      window.location.assign(response.data.url);
    } catch (error) {
      setGcalActionFeedback(error.message, "error");
    }
  });

  document.getElementById("google-calendar-disconnect-button").addEventListener("click", async () => {
    try {
      await apiRequest("/api/admin/google-calendar/disconnect", { method: "POST" });
      await Promise.all([loadPlatformSettings(), loadGoogleCalendarStatus()]);
      setGcalActionFeedback("Google Calendar desconectado.", "success");
    } catch (error) {
      setGcalActionFeedback(error.message, "error");
    }
  });

  document.getElementById("google-calendar-test-button").addEventListener("click", async () => {
    try {
      const response = await apiRequest("/api/admin/google-calendar/test-connection", {
        method: "POST"
      });
      setGcalActionFeedback(
        `Conexão confirmada. ${response.data.calendarsCount} calendário(s) disponível(is).`,
        "success"
      );
    } catch (error) {
      setGcalActionFeedback(error.message, "error");
    }
  });

  document.getElementById("google-calendar-reprocess-button").addEventListener("click", async () => {
    try {
      const response = await apiRequest("/api/admin/google-calendar/reprocess-failures", {
        method: "POST"
      });
      await Promise.all([loadSessions(), loadGoogleCalendarStatus()]);
      setGcalActionFeedback(
        `Reprocessamento concluído: ${response.data.processed} sessão(ões) processada(s).`,
        "success"
      );
    } catch (error) {
      setGcalActionFeedback(error.message, "error");
    }
  });

  document.getElementById("copy-scheduling-link-dashboard").addEventListener("click", async () => {
    try {
      await copyText(
        state.platformSettings?.schedulingUrl,
        "Link de agendamento copiado."
      );
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  document.getElementById("copy-scheduling-link-agenda").addEventListener("click", async () => {
    try {
      await copyText(
        state.platformSettings?.schedulingUrl,
        "Link de agendamento copiado."
      );
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
}
