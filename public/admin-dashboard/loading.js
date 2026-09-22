import { clearStatus, setStatus } from "./ui.js";
import { loadGoogleCalendarStatus, loadPlatformSettings } from "./agenda.js";
import { loadAuditLogs } from "./audit.js";
import { loadDashboardSummary } from "./dashboard.js";
import { syncFilterForms } from "./filters.js";
import { loadFinance, loadReceipts, marcarMesAtual } from "./finance.js";
import { loadLeads, resetLeadForm } from "./leads.js";
import { loadMessageTemplates, resetMessageForm } from "./messages.js";
import { loadPatients, resetPatientForm } from "./patients.js";
import { loadSessions, resetSessionForm } from "./sessions.js";
import { loadSecurityStatus } from "./settings.js";
import { loadContent } from "./site-content.js";

export async function refreshAfterMutation(loaders = []) {
  const results = await Promise.allSettled([...loaders, loadAuditLogs()]);
  return results.filter((result) => result.status === "rejected");
}

export function buildRefreshWarning(savedMessage, failures) {
  if (!failures.length) {
    return savedMessage;
  }

  return `${savedMessage} Os dados foram salvos, mas a tela não atualizou automaticamente. Recarregue a página.`;
}

export async function loadAllData(isRetry = false) {
  try {
    clearStatus();
    await loadContent();
    await loadPatients();

    // allSettled, não all: com Promise.all, uma única carga que falhasse
    // interrompia todas as outras e o painel abria com telas em branco, sem
    // dizer o que faltou. Aqui cada tela que carregou aparece, e o que falhou
    // é nomeado.
    const cargas = [
      ["Início", loadDashboardSummary],
      ["Contatos", loadLeads],
      ["Sessões", loadSessions],
      ["Financeiro", loadFinance],
      ["Recibos", loadReceipts],
      ["Mensagens", loadMessageTemplates],
      ["Auditoria", loadAuditLogs],
      ["Agenda", loadPlatformSettings],
      ["Google Calendar", loadGoogleCalendarStatus],
      ["Segurança", loadSecurityStatus]
    ];

    const resultados = await Promise.allSettled(cargas.map(([, carregar]) => carregar()));
    const falhou = cargas
      .filter((_, indice) => resultados[indice].status === "rejected")
      .map(([nome]) => nome);

    if (falhou.length) {
      setStatus(
        `Não foi possível carregar: ${falhou.join(", ")}. O restante do painel está disponível.`,
        "error"
      );
    }
    resetLeadForm();
    resetPatientForm();
    resetSessionForm();
    resetMessageForm();
    syncFilterForms();
    marcarMesAtual();
  } catch (error) {
    const isAbortError = error.name === "AbortError";
    if (!isRetry && isAbortError) {
      setStatus("Servidor iniciando após deploy, aguardando e tentando novamente...", "error");
      await new Promise((resolve) => window.setTimeout(resolve, 4000));
      return loadAllData(true);
    }
    setStatus(error.message, "error");
  }
}

async function refreshClinicData() {
  await Promise.all([
    loadDashboardSummary(),
    loadLeads(),
    loadPatients(),
    loadSessions(),
    loadFinance(),
    loadReceipts(),
    loadMessageTemplates(),
    loadAuditLogs(),
    loadPlatformSettings(),
    loadGoogleCalendarStatus(),
    loadSecurityStatus()
  ]);
}
