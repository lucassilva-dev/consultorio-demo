export function escapeSelector(value) {
  return value.replace(/"/g, '\\"');
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Chips de estado: glifo + rótulo + cor. O glifo existe para que o estado
// nunca dependa exclusivamente de cor.
const CHIP_MAP = {
  lead: {
    novo: ["●", "chip-info"],
    contato_realizado: ["◐", "chip-info"],
    conversa_agendada: ["○", "chip-verde"],
    aguardando_retorno: ["◐", "chip-ambar"],
    virou_paciente: ["●", "chip-verde"],
    perdido: ["✕", "chip-neutro"]
  },
  patient: {
    ativo: ["●", "chip-verde"],
    pausado: ["◐", "chip-ambar"],
    encerrado: ["■", "chip-neutro"]
  },
  session: {
    agendada: ["○", "chip-info"],
    realizada: ["●", "chip-verde"],
    falta: ["▲", "chip-ambar"],
    cancelada: ["✕", "chip-neutro"],
    remarcada: ["↻", "chip-info"]
  },
  payment: {
    pendente: ["◐", "chip-ambar"],
    pago: ["●", "chip-verde"],
    isento: ["◇", "chip-neutro"],
    cancelado: ["✕", "chip-neutro"]
  },
  intake: {
    draft: ["◐", "chip-ambar"],
    completed: ["●", "chip-verde"],
    locked: ["■", "chip-neutro"]
  },
  evolution: {
    draft: ["◐", "chip-ambar"],
    signed: ["●", "chip-verde"],
    locked: ["■", "chip-neutro"],
    amended: ["↻", "chip-info"]
  },
  record: {
    open: ["●", "chip-verde"],
    closed: ["■", "chip-neutro"]
  },
  document: {
    issued: ["●", "chip-verde"],
    revoked: ["✕", "chip-neutro"]
  }
};

export function renderChip(kind, value, label) {
  const [glifo, classe] = CHIP_MAP[kind]?.[value] || ["·", "chip-neutro"];
  // "Cancelada" existe em sessao e em pagamento com sentidos diferentes e as
  // duas convivem na mesma linha: o pagamento sempre vai prefixado.
  const texto = kind === "payment" ? `Pgto: ${label || value || "—"}` : label || value || "—";
  return `<span class="chip ${classe}"><span class="chip-glifo" aria-hidden="true">${glifo}</span>${escapeHtml(
    texto
  )}</span>`;
}

/* ── Toast notification system ── */
// Sem warning/danger aqui, um toast de aviso ou de erro caía no glifo de
// sucesso e ficava visualmente idêntico a uma confirmação.
const TOAST_GLIFOS = {
  success: "●",
  info: "◐",
  warning: "◐",
  error: "▲",
  danger: "▲"
};

const toastContainer = (() => {
  let el = document.getElementById("toast-container");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast-container";
    el.className = "admin-toasts";
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  return el;
})();

export function showToast(message, tone = "success", duration = 3600) {
  const toast = document.createElement("div");
  toast.className = "admin-toast";
  toast.dataset.tone = tone;

  const glifo = document.createElement("span");
  glifo.className = "glifo";
  glifo.setAttribute("aria-hidden", "true");
  glifo.textContent = TOAST_GLIFOS[tone] || TOAST_GLIFOS.success;

  const texto = document.createElement("span");
  texto.textContent = message;

  toast.append(glifo, texto);
  toast.addEventListener("click", () => dismissToast(toast));
  toastContainer.appendChild(toast);
  window.setTimeout(() => dismissToast(toast), duration);
}

function dismissToast(toast) {
  if (toast.classList.contains("toast-out")) return;
  toast.classList.add("toast-out");
  toast.addEventListener("animationend", () => toast.remove());
}

export function setStatus(message, tone = "success") {
  showToast(message, tone);
}

export function clearStatus() {
  /* noop — toasts auto-dismiss */
}

export async function copyText(text, successMessage) {
  if (!text) {
    throw new Error("Nenhum texto disponível para copiar.");
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    setStatus(successMessage, "success");
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
  setStatus(successMessage, "success");
}

/* ── Drawers de cadastro/edição ── */
const MODOS_DRAWER = {
  criar: { classe: "is-criando", texto: "＋ Criando novo" },
  editar: { classe: "is-editando", texto: "✎ Editando — nada é salvo até confirmar" }
};

// Aceita tanto "patient" (-> patient-drawer) quanto o id direto de uma folha.
function elementoSobreposicao(nome) {
  return document.getElementById(`${nome}-drawer`) || document.getElementById(nome);
}

export function abrirDrawer(nome, modo = "criar") {
  const drawer = elementoSobreposicao(nome);
  if (!drawer) return;
  const selo = document.getElementById(`${nome}-form-mode`);
  if (selo) {
    const cfg = MODOS_DRAWER[modo] || MODOS_DRAWER.criar;
    selo.className = `admin-selo-modo ${cfg.classe}`;
    selo.textContent = cfg.texto;
  }
  drawer.hidden = false;
  document.body.style.overflow = "hidden";
  drawer.querySelector("input, select, textarea")?.focus();
}

export function fecharDrawer(nome) {
  const drawer = elementoSobreposicao(nome);
  if (!drawer) return;
  drawer.hidden = true;
  if (!document.querySelector(".admin-overlay:not([hidden])")) {
    document.body.style.overflow = "";
  }
}

export function registrarEscNasSobreposicoes() {
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    document.querySelectorAll(".admin-overlay:not([hidden])").forEach((drawer) => {
      drawer.hidden = true;
    });
    document.body.style.overflow = "";
  });
}
