import { state } from "./state.js";
import { setStatus } from "./ui.js";
import { apiRequest } from "./api.js";
import { resetLeadForm } from "./leads.js";
import { resetMessageForm } from "./messages.js";
import { resetPatientForm } from "./patients.js";
import { resetSessionForm } from "./sessions.js";

export const panelMeta = {
  dashboard: {
    title: "Dashboard",
    description: "Resumo rápido de contatos, pacientes, sessões e financeiro."
  },
  leads: {
    title: "Contatos",
    description: "Cadastro e acompanhamento de interessados antes de virarem pacientes."
  },
  patients: {
    title: "Pacientes",
    description: "Cadastro administrativo simples, sem prontuário clínico."
  },
  sessions: {
    title: "Sessões",
    description: "Controle administrativo de agenda, status e pagamentos."
  },
  finance: {
    title: "Financeiro",
    description: "Resumo mensal baseado nas sessões cadastradas."
  },
  messages: {
    title: "Mensagens",
    description: "Modelos prontos com variáveis seguras para atendimento e cobrança."
  },
  agenda: {
    title: "Agenda",
    description: "Links externos de agendamento, sessão e política de cancelamento."
  },
  site: {
    title: "Site",
    description: "Edição do conteúdo público, imagens e SEO."
  },
  audit: {
    title: "Auditoria",
    description: "Rastro administrativo das ações mais sensíveis do painel."
  },
  settings: {
    title: "Configurações",
    description: "Diretrizes operacionais, checklist de produção e lembretes de uso seguro."
  },
  clinical: {
    title: "Prontuário",
    description: "Anamnese estruturada e evoluções clínicas criptografadas do paciente."
  }
};

const navButtons = Array.from(document.querySelectorAll("[data-panel-trigger]"));
const panels = Array.from(document.querySelectorAll("[data-panel]"));

/* ── Folha "Mais" (celular): dá acesso às dez áreas ── */
const folhaAreas = document.getElementById("sheet-areas");
const folhaFundo = document.getElementById("sheet-backdrop");
const botaoMais = document.getElementById("nav-mais");

function fecharFolhaAreas() {
  if (!folhaAreas) return;
  folhaAreas.hidden = true;
  folhaFundo.hidden = true;
  botaoMais?.setAttribute("aria-expanded", "false");
  botaoMais?.classList.remove("is-active");
}

function abrirFolhaAreas() {
  if (!folhaAreas) return;
  folhaAreas.hidden = false;
  folhaFundo.hidden = false;
  botaoMais?.setAttribute("aria-expanded", "true");
  botaoMais?.classList.add("is-active");
}

export function registrarFolhaDeAreas() {
  botaoMais?.addEventListener("click", () => {
    if (folhaAreas.hidden) {
      abrirFolhaAreas();
    } else {
      fecharFolhaAreas();
    }
  });

  folhaFundo?.addEventListener("click", fecharFolhaAreas);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      fecharFolhaAreas();
    }
  });
}

export function openPanel(panelName, options = {}) {
  state.selectedPanel = panelName;
  panels.forEach((panel) => {
    const isCurrent = panel.dataset.panel === panelName;
    panel.hidden = !isCurrent;
    panel.classList.toggle("is-active", isCurrent);
  });

  // A mesma marcação serve à barra lateral, à barra inferior do celular e à
  // folha "Mais" — os três usam data-panel-trigger.
  navButtons.forEach((button) => {
    const isCurrent = button.dataset.panelTrigger === panelName;
    button.classList.toggle("is-active", isCurrent);
    if (isCurrent) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  });

  fecharFolhaAreas();

  // O título de cada área agora vive dentro da própria tela; panelMeta segue
  // servindo ao título do documento e à validação do parâmetro ?panel=.
  const meta = panelMeta[panelName] || panelMeta.dashboard;
  document.title = `Admin | ${meta.title}`;

  if (options.scrollIntoView && window.matchMedia("(max-width: 920px)").matches) {
    const main = document.querySelector(".admin-main");
    if (main) {
      const top = Math.max(main.getBoundingClientRect().top + window.scrollY - 12, 0);
      window.scrollTo({
        top,
        behavior: "auto"
      });
    }
  }
}

function preparePanelShortcut(panelName) {
  if (panelName === "leads") {
    resetLeadForm();
  }
  if (panelName === "patients") {
    resetPatientForm();
  }
  if (panelName === "sessions") {
    resetSessionForm();
  }
  if (panelName === "messages") {
    resetMessageForm();
  }
}

export function registrarNavegacao() {
  navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      openPanel(button.dataset.panelTrigger, { scrollIntoView: true });
    });
  });

  document.querySelectorAll("[data-open-panel]").forEach((button) => {
    button.addEventListener("click", () => {
      preparePanelShortcut(button.dataset.openPanel);
      openPanel(button.dataset.openPanel, { scrollIntoView: true });
    });
  });
}

async function sair() {
  try {
    await apiRequest("/api/admin/logout", { method: "POST" });
    window.location.assign("/admin/login");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

export function registrarSaida() {
  // Dois pontos de saída: rodapé da barra lateral (desktop) e folha "Mais".
  document.getElementById("logout-button").addEventListener("click", sair);
  document.getElementById("logout-button-mobile")?.addEventListener("click", sair);
}
