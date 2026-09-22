import { state } from "./state.js";
import { registrarEscNasSobreposicoes, setStatus } from "./ui.js";
import { registrarLimpezaDeErroAoDigitar } from "./forms.js";
import { apiRequest } from "./api.js";
import {
  loadGoogleCalendarStatus,
  registrarBotoesDaAgenda,
  registrarFormulariosDaAgenda
} from "./agenda.js";
import { registrarPaginacaoDaAuditoria } from "./audit.js";
import { registrarFormularioDeDocumento } from "./clinical-documents.js";
import { registrarFormularioDeEvolucao } from "./clinical-evolutions.js";
import { registrarAtalhosDoProntuario } from "./clinical-record.js";
import {
  registrarDescarteEFechamento,
  registrarEntradaGlobal,
  registrarMudancaGlobal,
  registrarRoteadorDeAcoes
} from "./events.js";
import {
  registrarEnvioDosFiltros,
  registrarFiltrosAoVivo,
  registrarLimpezaDosFiltros,
  syncFilterForms
} from "./filters.js";
import { marcarMesAtual, registrarExportacaoDoFinanceiro } from "./finance.js";
import { registrarFormularioDeContato } from "./leads.js";
import { loadAllData } from "./loading.js";
import { registrarFormularioDeMensagem, registrarModalDeCopia } from "./messages.js";
import {
  openPanel,
  panelMeta,
  registrarFolhaDeAreas,
  registrarNavegacao,
  registrarSaida
} from "./navigation.js";
import { registrarFormularioDePaciente } from "./patients.js";
import { registrarFormularioDeSessao } from "./sessions.js";
import { registrarAdicaoDeItensDoSite, registrarFormulariosDoSite } from "./site-content.js";

registrarFiltrosAoVivo();
registrarFolhaDeAreas();
registrarDescarteEFechamento();
registrarEscNasSobreposicoes();
registrarAdicaoDeItensDoSite();
registrarNavegacao();
registrarRoteadorDeAcoes();
registrarEntradaGlobal();
registrarMudancaGlobal();
registrarSaida();
registrarEnvioDosFiltros();
registrarLimpezaDosFiltros();
registrarFormularioDeContato();
registrarLimpezaDeErroAoDigitar();
registrarFormularioDePaciente();
registrarFormularioDeSessao();
registrarFormularioDeMensagem();
registrarFormulariosDaAgenda();
registrarBotoesDaAgenda();
registrarExportacaoDoFinanceiro();
registrarPaginacaoDaAuditoria();
registrarFormulariosDoSite();
registrarModalDeCopia();
registrarAtalhosDoProntuario();
registrarFormularioDeEvolucao();
registrarFormularioDeDocumento();

syncFilterForms();
marcarMesAtual();

const initialSearchParams = new URLSearchParams(window.location.search);
const requestedPanel = initialSearchParams.get("panel");
const justConnectedGoogleCalendar = initialSearchParams.get("googleCalendar") === "connected";
// hasOwnProperty: `?panel=constructor` encontrava uma propriedade herdada de
// Object.prototype, passava na checagem e escondia todos os painéis.
const painelValido =
  requestedPanel && Object.prototype.hasOwnProperty.call(panelMeta, requestedPanel);
openPanel(painelValido ? requestedPanel : "dashboard");

if (justConnectedGoogleCalendar) {
  setStatus("Google Calendar conectado com sucesso.", "success");
  window.history.replaceState({}, "", "/admin/dashboard");
}

loadAllData().then(async () => {
  if (justConnectedGoogleCalendar && state.googleCalendarStatus?.connected) {
    try {
      const currentSettings = state.googleCalendarStatus?.settings || {};
      if (!currentSettings.googleCalendarId || currentSettings.googleCalendarId === "primary") {
        await apiRequest("/api/admin/google-calendar/settings", {
          method: "PUT",
          body: JSON.stringify({
            googleCalendarEnabled: true,
            googleCalendarId: "primary",
            googleCalendarCreateMeet: currentSettings.googleCalendarCreateMeet ?? true,
            googleCalendarReminderMinutes: currentSettings.googleCalendarReminderMinutes ?? 1440,
            googleCalendarSendUpdates: currentSettings.googleCalendarSendUpdates ?? true
          })
        });
        await loadGoogleCalendarStatus();
        setStatus("Google Calendar conectado e configurado automaticamente com o calendário principal.", "success");
      }
    } catch (error) {
      // silently ignore — manual config still possible
    }
  }
});
