const state = {
  content: null,
  allowedHelpIcons: [],
  dashboardSummary: null,
  leads: [],
  leadFilters: { search: "", status: "" },
  patients: [],
  // Lista completa de pacientes, sem filtro. Os seletores de Sessões,
  // Financeiro e Prontuário se alimentam daqui — usar a lista filtrada da
  // tabela de Pacientes fazia uma busca naquela tela esvaziar os seletores
  // do sistema inteiro.
  allPatients: [],
  patientFilters: { search: "", status: "" },
  sessions: [],
  sessionFilters: { patientId: "", status: "", paymentStatus: "", dateFrom: "", dateTo: "" },
  finance: null,
  receipts: [],
  financeFilters: {
    month: String(new Date().getMonth() + 1),
    year: String(new Date().getFullYear()),
    patientId: "",
    paymentStatus: ""
  },
  // Regime de apuração da lista de recibos. Competência (mês da sessão) é o
  // padrão: o recibo de um atendimento de junho pertence a junho, mesmo que o
  // pagamento entre depois.
  receiptBasis: "competencia",
  messageTemplates: [],
  messageFilters: { search: "", category: "" },
  auditLogs: {
    items: [],
    total: 0,
    page: 1,
    pageSize: 20
  },
  auditFilters: {
    action: "",
    entityType: "",
    date: "",
    adminEmail: "",
    page: 1,
    pageSize: 20
  },
  platformSettings: null,
  securityStatus: null,
  googleCalendarStatus: null,
  googleCalendars: [],
  pendingLeadConversion: null,
  selectedPanel: "dashboard",
  siteBlock: "home",
  siteDirty: new Set(),
  clinical: {
    patientId: null,
    tab: "resumo",
    summary: null,
    intake: null,
    intakeTemplate: null,
    blocks: {},
    documents: [],
    sectionIndex: { intake: 0, contract: 0, plan: 0 },
    evolutions: []
  }
};

const panelMeta = {
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

const labelMaps = {
  leadSource: {
    site: "Site",
    instagram: "Instagram",
    indicacao: "Indicação",
    whatsapp: "WhatsApp",
    outro: "Outro"
  },
  leadInterest: {
    adulto: "Adulto",
    adolescente: "Adolescente",
    jovem_adulto: "Jovem adulto",
    responsavel_adolescente: "Responsável de adolescente",
    outro: "Outro"
  },
  leadStatus: {
    novo: "Novo",
    contato_realizado: "Contato realizado",
    conversa_agendada: "Conversa agendada",
    aguardando_retorno: "Aguardando retorno",
    virou_paciente: "Virou paciente",
    perdido: "Perdido"
  },
  preferredPeriod: {
    manha: "Manhã",
    tarde: "Tarde",
    noite: "Noite",
    sabado: "Sábado",
    flexivel: "Flexível"
  },
  patientType: {
    adulto: "Adulto",
    adolescente: "Adolescente",
    jovem_adulto: "Jovem adulto"
  },
  patientModality: {
    online: "Online",
    presencial: "Presencial",
    hibrido: "Híbrido"
  },
  patientStatus: {
    ativo: "Ativo",
    pausado: "Pausado",
    encerrado: "Encerrado"
  },
  sessionStatus: {
    agendada: "Agendada",
    realizada: "Realizada",
    falta: "Falta",
    cancelada: "Cancelada",
    remarcada: "Remarcada"
  },
  paymentStatus: {
    pendente: "Pendente",
    pago: "Pago",
    isento: "Isento",
    cancelado: "Cancelado"
  },
  paymentMethod: {
    pix: "Pix",
    dinheiro: "Dinheiro",
    cartao: "Cartão",
    plataforma: "Plataforma",
    outro: "Outro"
  },
  messageCategory: {
    novo_contato: "Novo contato",
    envio_valor: "Envio de valor",
    confirmacao_sessao: "Confirmação de sessão",
    lembrete_sessao: "Lembrete de sessão",
    reagendamento: "Reagendamento",
    cobranca: "Cobrança",
    contrato: "Contrato",
    adolescente_responsavel: "Responsável de adolescente",
    retorno_ferias: "Retorno de férias",
    outro: "Outro"
  }
};

const helpCardsList = document.getElementById("help-cards-list");
const helpCardTemplate = document.getElementById("help-card-template");
const socialLinksList = document.getElementById("social-links-list");
const socialLinkTemplate = document.getElementById("social-link-template");
const navButtons = Array.from(document.querySelectorAll("[data-panel-trigger]"));
const panels = Array.from(document.querySelectorAll("[data-panel]"));

function escapeSelector(value) {
  return value.replace(/"/g, '\\"');
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number(value || 0));
}

// Fuso da clínica (Brasil). Horários são sempre exibidos/editados neste fuso,
// independentemente do fuso do dispositivo, para evitar deslocamento de horas.
const CLINIC_TIME_ZONE = "America/Sao_Paulo";

function formatDate(value) {
  if (!value) {
    return "—";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeZone: CLINIC_TIME_ZONE
  }).format(parsed);
}

function formatDateTime(value) {
  if (!value) {
    return "—";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: CLINIC_TIME_ZONE
  }).format(parsed);
}

function formatDateInputValue(value) {
  if (!value) {
    return "";
  }
  return value.slice(0, 10);
}

function formatDateTimeInputValue(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  // Converte o instante UTC para o relógio de parede do fuso da clínica
  // (America/Sao_Paulo) no formato YYYY-MM-DDTHH:MM exigido pelo datetime-local.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CLINIC_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(date);

  const map = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }

  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`;
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

function renderChip(kind, value, label) {
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

function showToast(message, tone = "success", duration = 3600) {
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

function setStatus(message, tone = "success") {
  showToast(message, tone);
}

function clearStatus() {
  /* noop — toasts auto-dismiss */
}

function setFormFeedback(form, message, tone = "success") {
  const feedback = form.querySelector(".form-feedback");
  if (!feedback) {
    return;
  }

  feedback.hidden = false;
  feedback.dataset.tone = tone;
  feedback.textContent = message;
}

function clearFormFeedback(form) {
  const feedback = form.querySelector(".form-feedback");
  if (!feedback) {
    return;
  }

  feedback.hidden = true;
  feedback.textContent = "";
  feedback.dataset.tone = "";
}

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


function buildReceiptDeliveryMessage(receipt) {
  return `Olá. Segue o recibo referente ao atendimento psicológico realizado em ${formatDate(
    receipt.sessionDate
  )}.`;
}

function formatAuditMetadata(metadata = {}) {
  const entries = Object.entries(metadata || {});
  if (!entries.length) {
    return "—";
  }

  return entries
    .map(([key, value]) => {
      const formattedValue = Array.isArray(value)
        ? value.join(", ")
        : value && typeof value === "object"
          ? JSON.stringify(value)
          : value;
      return `${key}: ${formattedValue}`;
    })
    .join(" · ");
}

function formatBooleanStatus(value) {
  return value ? "Em conformidade" : "Pendente";
}

// A auditoria usa data compacta, sem vírgula: cabe na coluna de largura fixa
// sem quebrar em duas linhas.
// Data e hora separadas por ponto médio, como o protótipo.
function formatDataHora(value) {
  if (!value) return "—";
  return formatDateTime(value).replace(", ", " · ");
}

function formatAuditDateTime(value) {
  if (!value) return "—";
  return formatDateTime(value).replace(", ", " ");
}

function renderAuditPanel() {
  const lista = document.getElementById("audit-list");
  const empty = document.getElementById("audit-empty");
  const paginationText = document.getElementById("audit-pagination-text");
  const prevButton = document.getElementById("audit-prev-page");
  const nextButton = document.getElementById("audit-next-page");
  const auditState = state.auditLogs || { items: [], total: 0, page: 1, pageSize: 20 };
  const totalPages = Math.max(
    1,
    Math.ceil(Number(auditState.total || 0) / Number(auditState.pageSize || 20))
  );

  lista.innerHTML = auditState.items
    .map((log) => {
      const metadados = formatAuditMetadata(log.metadata);
      const conteudo = `
        <span class="auditoria-data">${escapeHtml(formatAuditDateTime(log.createdAt))}</span>
        <span class="chip chip-neutro">${escapeHtml(log.action || "—")}</span>
        <span class="auditoria-entidade">${escapeHtml(log.entityType || "—")}${
          log.entityId ? ` #${escapeHtml(String(log.entityId))}` : ""
        }</span>
        <span class="auditoria-resumo">${escapeHtml(log.summary || "—")}</span>
        <!-- A API já devolvia adminEmail e o filtro por autor existia, mas a
             linha nunca dizia quem fez a ação. -->
        <span class="auditoria-autor">${escapeHtml(log.adminEmail || "sistema")}</span>
      `;

      // Com metadados a linha inteira vira o gatilho de <details>; sem eles,
      // é só uma linha.
      return metadados
        ? `<details class="auditoria-item">
             <summary class="auditoria-linha">
               ${conteudo}
               <span class="auditoria-ver">ver metadados</span>
             </summary>
             <pre>${escapeHtml(metadados)}</pre>
           </details>`
        : `<div class="auditoria-item"><div class="auditoria-linha">${conteudo}</div></div>`;
    })
    .join("");

  const filtroAtivo = Boolean(
    state.auditFilters.action ||
      state.auditFilters.entityType ||
      state.auditFilters.date ||
      state.auditFilters.adminEmail
  );

  atualizarLimparFiltros("audit-filters-form", filtroAtivo);

  empty.hidden = auditState.items.length > 0;
  empty.innerHTML = filtroAtivo
    ? `<h3>Nenhum evento com esse filtro</h3>
       <p>Nenhuma ação registrada corresponde aos critérios escolhidos.</p>
       <button class="btn btn-secondary btn-compacto" type="button" data-reset-filter="audit">Limpar filtros</button>`
    : `<h3>Nenhum evento registrado</h3>
       <p>As ações administrativas aparecem aqui conforme forem acontecendo.</p>`;

  paginationText.textContent = `Página ${auditState.page} de ${totalPages} · ${auditState.total} registro(s)`;
  prevButton.disabled = auditState.page <= 1;
  nextButton.disabled = auditState.page >= totalPages;
}

function renderSecurityStatus() {
  const container = document.getElementById("security-status-list");
  const status = state.securityStatus || {};
  const labels = {
    nodeEnvProduction: "NODE_ENV=production",
    dataProviderPostgres: "DATA_PROVIDER=postgres",
    storageProviderSupabase: "STORAGE_PROVIDER=supabase",
    databaseUrlConfigured: "DATABASE_URL configurada",
    supabaseUrlConfigured: "SUPABASE_URL configurada",
    supabaseServiceRoleKeyConfigured: "SUPABASE_SERVICE_ROLE_KEY configurada",
    supabaseStorageBucketConfigured: "SUPABASE_STORAGE_BUCKET configurado",
    supabasePrivateStorageBucketConfigured: "SUPABASE_PRIVATE_STORAGE_BUCKET configurado",
    sessionSecretConfiguredAndNonDefault: "SESSION_SECRET configurado e não default",
    authCookieSecretConfiguredAndNonDefault: "AUTH_COOKIE_SECRET configurado e não default",
    adminPasswordHashConfigured: "ADMIN_PASSWORD_HASH configurado",
    adminInitialPasswordAbsentInProduction: "ADMIN_INITIAL_PASSWORD ausente em produção",
    tokenEncryptionKeyConfigured: "TOKEN_ENCRYPTION_KEY configurado",
    googleClientIdConfigured: "GOOGLE_CLIENT_ID configurado",
    googleClientSecretConfigured: "GOOGLE_CLIENT_SECRET configurado",
    googleRedirectUriConfigured: "GOOGLE_REDIRECT_URI configurado",
    siteUrlConfigured: "SITE_URL configurado",
    runDatabaseMigrationsOnBootRecommendedFalse: "RUN_DATABASE_MIGRATIONS_ON_BOOT=false"
  };

  container.innerHTML = Object.entries(labels)
    .map(
      ([key, label]) => `
        <article class="admin-security-item${status[key] ? "" : " is-pendente"}">
          <span class="glifo" aria-hidden="true">${status[key] ? "✓" : "✕"}</span>
          <span style="flex:1">${escapeHtml(label)}</span>
          <span style="font-size:11.5px;font-weight:600">${formatBooleanStatus(status[key])}</span>
        </article>
      `
    )
    .join("");
}

async function getReceiptById(receiptId) {
  const existing = state.receipts.find((item) => String(item.id) === String(receiptId));
  if (existing) {
    return existing;
  }

  const response = await apiRequest(`/api/admin/receipts/${receiptId}`);
  return response.data;
}

function clearFieldErrors(form) {
  form.querySelectorAll(".field-error").forEach((node) => {
    node.hidden = true;
    node.textContent = "";
  });

  form.querySelectorAll(".field.has-error").forEach((field) => {
    field.classList.remove("has-error");
  });

  form.querySelectorAll("[aria-invalid='true']").forEach((field) => {
    field.removeAttribute("aria-invalid");
  });
}

function ensureFieldErrorNode(fieldWrapper) {
  let node = fieldWrapper.querySelector(".field-error");
  if (node) {
    return node;
  }

  node = document.createElement("div");
  node.className = "field-error";
  node.hidden = true;
  fieldWrapper.appendChild(node);
  return node;
}

function applyFieldErrors(form, fieldErrors = {}) {
  Object.entries(fieldErrors || {}).forEach(([fieldName, messages]) => {
    const field = getFormField(form, fieldName);
    if (!field || !Array.isArray(messages) || !messages.length) {
      return;
    }

    const fieldWrapper = field.closest(".field");
    if (!fieldWrapper) {
      return;
    }

    fieldWrapper.classList.add("has-error");
    field.setAttribute("aria-invalid", "true");

    const errorNode = ensureFieldErrorNode(fieldWrapper);
    errorNode.hidden = false;
    errorNode.textContent = messages[0];
  });
}

function clearFieldErrorForInput(input) {
  const fieldWrapper = input.closest(".field");
  if (!fieldWrapper) {
    return;
  }

  fieldWrapper.classList.remove("has-error");
  input.removeAttribute("aria-invalid");

  const errorNode = fieldWrapper.querySelector(".field-error");
  if (!errorNode) {
    return;
  }

  errorNode.hidden = true;
  errorNode.textContent = "";
}

function buildErrorMessage(error) {
  if (!error) {
    return "Ocorreu um erro inesperado.";
  }

  if (error.name === "AbortError") {
    return "A operação demorou mais do que o esperado. Tente novamente.";
  }

  if (error.details?.formErrors?.length) {
    return error.details.formErrors[0];
  }

  const fieldErrors = Object.values(error.details?.fieldErrors || {}).flat().filter(Boolean);
  if (fieldErrors.length) {
    return fieldErrors[0];
  }

  return error.message || "Ocorreu um erro inesperado.";
}

function setFormBusy(form, isBusy, busyText) {
  // Limpa timer de "aguardando servidor" anterior
  if (form._slowServerTimer) {
    window.clearTimeout(form._slowServerTimer);
    form._slowServerTimer = null;
  }

  // Em formulários dentro de drawer o botão de enviar fica no rodapé, fora do
  // <form>, associado por atributo form="…".
  const externos = form.id
    ? Array.from(document.querySelectorAll(`button[form="${form.id}"]`))
    : [];

  const controls = [...form.querySelectorAll("input, textarea, select, button"), ...externos];
  controls.forEach((control) => {
    control.disabled = isBusy;
  });

  const submitButton =
    form.querySelector('button[type="submit"]') ||
    externos.find((botao) => botao.type === "submit");
  if (submitButton) {
    submitButton.dataset.originalText = submitButton.dataset.originalText || submitButton.textContent;
    submitButton.textContent = isBusy ? busyText : submitButton.dataset.originalText;

    if (isBusy) {
      // Se demorar mais de 10 s, avisa que está aguardando o servidor
      form._slowServerTimer = window.setTimeout(() => {
        if (submitButton.disabled) {
          submitButton.textContent = "Aguardando servidor…";
        }
      }, 10000);
    }
  }
}

/**
 * Executa uma requisição de mutação com retry automático em caso de
 * AbortError (timeout / cold start do servidor).
 *
 * O retry só vale para métodos idempotentes. Um POST que estourou o tempo do
 * lado do cliente pode ter sido concluído no servidor: repetir criava um
 * segundo paciente, uma segunda sessão, uma segunda evolução. Nesses casos é
 * melhor avisar e deixar a pessoa conferir antes de tentar de novo.
 */
const METODOS_IDEMPOTENTES = ["PUT", "DELETE", "PATCH", "GET"];

async function runMutation(url, options = {}) {
  const metodo = String(options.method || "GET").toUpperCase();
  try {
    return await apiRequest(url, options);
  } catch (error) {
    if (error.name !== "AbortError") throw error;

    if (!METODOS_IDEMPOTENTES.includes(metodo)) {
      const aviso = new Error(
        "O servidor demorou a responder e não dá para saber se o registro foi criado. Atualize a lista antes de tentar de novo, para não duplicar."
      );
      aviso.name = "TimeoutIndeterminado";
      throw aviso;
    }

    showToast("Servidor demorou a responder. Tentando novamente…", "warning");
    await new Promise((resolve) => window.setTimeout(resolve, 3000));
    return apiRequest(url, options);
  }
}

function isSafeImagePath(value) {
  if (/^\/(assets|uploads)\/[A-Za-z0-9/_\-.]+$/.test(value) && !value.includes("..")) {
    return true;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch (error) {
    return false;
  }
}

function isSafeLink(value) {
  if (!value) {
    return true;
  }

  if (value.startsWith("#")) {
    return /^#[A-Za-z0-9_-]+$/.test(value);
  }

  if (value.startsWith("/")) {
    return /^\/[A-Za-z0-9/_\-?.=&%]+$/.test(value) && !value.includes("..");
  }

  try {
    const parsed = new URL(value);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol);
  } catch (error) {
    return false;
  }
}

function toQueryString(params) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== "" && value !== null && typeof value !== "undefined") {
      searchParams.set(key, String(value));
    }
  });
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

async function apiRequest(url, options = {}) {
  const controller = new AbortController();
  const { timeoutMs = 30000, headers = {}, ...requestOptions } = options;
  const timer = window.setTimeout(
    () => controller.abort(new DOMException("Servidor demorou para responder. Tente novamente em alguns segundos.", "AbortError")),
    timeoutMs
  );

  try {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-store",
        Pragma: "no-cache",
        ...(requestOptions.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...headers
      },
      ...requestOptions,
      signal: controller.signal
    });

    let payload = {};
    const rawText = await response.text();
    if (rawText) {
      try {
        payload = JSON.parse(rawText);
      } catch (error) {
        payload = {};
      }
    }

    if (!response.ok || payload.ok === false) {
      // Sessão expirada ou revogada: sem isso o painel ficava travado, com
      // todas as ações falhando e nenhum caminho visível de volta.
      if (response.status === 401) {
        window.location.assign("/admin/login");
      }

      const requestError = new Error(
        payload.error || `Falha na requisição (${response.status}).`
      );
      requestError.status = response.status;
      requestError.details = payload.details || null;
      throw requestError;
    }

    return payload;
  } finally {
    window.clearTimeout(timer);
  }
}

async function refreshAfterMutation(loaders = []) {
  const results = await Promise.allSettled([...loaders, loadAuditLogs()]);
  return results.filter((result) => result.status === "rejected");
}

function buildRefreshWarning(savedMessage, failures) {
  if (!failures.length) {
    return savedMessage;
  }

  return `${savedMessage} Os dados foram salvos, mas a tela não atualizou automaticamente. Recarregue a página.`;
}

async function copyText(text, successMessage) {
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

// "Limpar filtros" só existe quando há filtro para limpar.
function atualizarLimparFiltros(formId, ativo) {
  const botao = document.querySelector(`#${formId} .admin-limpar-filtros`);
  if (botao) botao.hidden = !ativo;
}

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

function openPanel(panelName, options = {}) {
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

function fillForm(form, values) {
  Object.entries(values).forEach(([key, value]) => {
    const field = form.elements.namedItem(key);
    if (!field) {
      return;
    }

    if (field.type === "checkbox") {
      field.checked = Boolean(value);
      return;
    }

    field.value = value ?? "";
  });

  refreshPreviews(form);
}

function getEntityIdField(form) {
  return form.elements.namedItem("id");
}

function getFormField(form, name) {
  return form.elements.namedItem(name);
}

function getFormValue(form, name) {
  const field = getFormField(form, name);
  return field ? field.value : "";
}

function getFormChecked(form, name) {
  const field = getFormField(form, name);
  return Boolean(field && field.checked);
}

function leadRequiresGuardian(lead) {
  return ["adolescente", "responsavel_adolescente"].includes(lead?.interest);
}

function applySessionPatientDefaults(patient) {
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

function refreshPreviewFromInput(input) {
  const scope = input.closest(".upload-block") || input.closest(".admin-nested-card") || input.form;
  const preview = scope.querySelector(`[data-preview-target="${escapeSelector(input.name)}"]`);

  if (!preview) {
    return;
  }

  if (input.value && isSafeImagePath(input.value)) {
    preview.src = input.value;
    preview.hidden = false;
  } else {
    preview.hidden = true;
    preview.removeAttribute("src");
  }
}

function refreshPreviews(scope) {
  scope.querySelectorAll('input[readonly][name]').forEach((input) => {
    refreshPreviewFromInput(input);
  });
}

function createHelpCard(card = {}) {
  const fragment = helpCardTemplate.content.cloneNode(true);
  const article = fragment.querySelector(".admin-nested-card");
  const iconSelect = article.querySelector('select[name="assetValue"]');

  state.allowedHelpIcons.forEach((iconName) => {
    const option = document.createElement("option");
    option.value = iconName;
    option.textContent = iconName;
    iconSelect.appendChild(option);
  });

  article.querySelector('input[name="sortOrder"]').value = card.sortOrder || helpCardsList.children.length + 1;
  article.querySelector('input[name="title"]').value = card.title || "";
  article.querySelector('textarea[name="description"]').value = card.description || "";

  const assetTypeSelect = article.querySelector('select[name="assetType"]');
  const imageUrlField = article.querySelector('input[name="assetImageUrl"]');
  const iconField = article.querySelector(".help-icon-field");
  const imageBlock = article.querySelector(".help-image-block");

  assetTypeSelect.value = card.assetType || "icon";

  if (assetTypeSelect.value === "image") {
    imageUrlField.value = card.assetValue || "";
    iconSelect.value = state.allowedHelpIcons[0] || "wind";
    iconField.hidden = true;
    imageBlock.hidden = false;
  } else {
    iconSelect.value = card.assetValue || state.allowedHelpIcons[0] || "wind";
    imageUrlField.value = "";
    iconField.hidden = false;
    imageBlock.hidden = true;
  }

  refreshPreviews(article);
  return article;
}

function createSocialLink(link = {}) {
  const fragment = socialLinkTemplate.content.cloneNode(true);
  const article = fragment.querySelector(".admin-nested-card");

  article.querySelector('select[name="platform"]').value = link.platform || "instagram";
  article.querySelector('input[name="label"]').value = link.label || "";
  article.querySelector('input[name="url"]').value = link.url || "";

  return article;
}

/* ── Site: dez blocos independentes, um em edição por vez ── */
const siteBlocos = () => Array.from(document.querySelectorAll("[data-site-block]"));

function marcarBlocoSujo(chave, sujo) {
  if (sujo) {
    state.siteDirty.add(chave);
  } else {
    state.siteDirty.delete(chave);
  }
  renderSiteIndex();
}

function abrirBlocoSite(chave) {
  state.siteBlock = chave;
  siteBlocos().forEach((bloco) => {
    bloco.hidden = bloco.dataset.siteBlock !== chave;
  });
  renderSiteIndex();
}

function renderSiteIndex() {
  const indice = document.getElementById("site-indice");
  if (!indice) return;

  indice.innerHTML = siteBlocos()
    .map((bloco) => {
      const chave = bloco.dataset.siteBlock;
      const sujo = state.siteDirty.has(chave);
      return `<button class="admin-site-indice-item${
        chave === state.siteBlock ? " is-active" : ""
      }" type="button" data-action="go-site-block" data-block="${escapeHtml(chave)}">
        ${sujo ? '<span class="admin-site-ponto" aria-hidden="true"></span>' : ""}
        ${escapeHtml(bloco.dataset.siteLabel)}
      </button>`;
    })
    .join("");

  // Selo por bloco.
  siteBlocos().forEach((bloco) => {
    const chave = bloco.dataset.siteBlock;
    const selo = bloco.querySelector("[data-site-selo]");
    if (!selo) return;
    const sujo = state.siteDirty.has(chave);
    selo.classList.toggle("is-sujo", sujo);
    selo.textContent = sujo ? "◐ alterações não salvas" : "● salvo";
  });

  // Resumo do conjunto embutido no subtítulo da tela.
  const total = state.siteDirty.size;
  const texto = document.getElementById("site-resumo-texto");
  if (texto) {
    texto.textContent = total
      ? `${total} bloco${total > 1 ? "s" : ""} com alterações não salvas.`
      : "Tudo salvo.";
    texto.classList.toggle("tem-pendencia", total > 0);
  }
}


// Cada bloco sabe se repovoar sozinho. Repovoar tudo depois de salvar um único
// bloco apagaria as edições ainda não salvas dos outros — e o índice passaria a
// sinalizar pendência em blocos que acabaram de ser zerados.
const PREENCHE_BLOCO_SITE = {
  home: () => fillForm(document.getElementById("home-form"), state.content.home || {}),
  about: () => fillForm(document.getElementById("about-form"), state.content.about || {}),
  aboutPanel: () =>
    fillForm(document.getElementById("about-panel-form"), state.content.aboutPanel || {}),
  work: () => fillForm(document.getElementById("work-form"), state.content.work || {}),
  attendance: () =>
    fillForm(document.getElementById("attendance-form"), state.content.attendance || {}),
  closing: () => fillForm(document.getElementById("closing-form"), state.content.closing || {}),
  seo: () => fillForm(document.getElementById("seo-form"), state.content.seo || {}),
  footer: () => fillForm(document.getElementById("footer-form"), state.content.footer || {}),
  help: () => {
    const helpForm = document.getElementById("help-form");
    helpForm.elements.namedItem("eyebrow").value = state.content.help?.eyebrow || "";
    helpForm.elements.namedItem("title").value = state.content.help?.title || "";
    helpCardsList.innerHTML = "";
    (state.content.help?.cards || []).forEach((card) => {
      helpCardsList.appendChild(createHelpCard(card));
    });
  },
  contact: () => {
    fillForm(document.getElementById("contact-form"), {
      title: state.content.contact?.title,
      text: state.content.contact?.text,
      whatsappNumber: state.content.contact?.whatsappNumber,
      whatsappMessage: state.content.contact?.whatsappMessage
    });
    socialLinksList.innerHTML = "";
    (state.content.contact?.socialLinks || []).forEach((link) => {
      socialLinksList.appendChild(createSocialLink(link));
    });
  }
};

function preencherBlocoSite(chave) {
  PREENCHE_BLOCO_SITE[chave]?.();
}

// Marca o mês corrente no filtro do financeiro.
function marcarMesAtual() {
  const select = document.querySelector('#finance-filters-form select[name="month"]');
  if (!select) return;
  const mesAtual = Number(
    new Intl.DateTimeFormat("pt-BR", { month: "numeric", timeZone: CLINIC_TIME_ZONE }).format(new Date())
  );
  Array.from(select.options).forEach((opcao) => {
    const base = opcao.dataset.base || opcao.textContent;
    opcao.dataset.base = base;
    opcao.textContent = Number(opcao.value) === mesAtual ? `${base} · atual` : base;
  });
}

function populateSiteForms() {
  Object.keys(PREENCHE_BLOCO_SITE).forEach(preencherBlocoSite);
  state.siteDirty.clear();
  abrirBlocoSite(state.siteBlock);
}

// Os campos de responsável só existem para adolescente: aparecem e somem
// conforme o tipo escolhido, e ficam obrigatórios quando visíveis.
function updateGuardianFieldsState() {
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

/* ── Drawers de cadastro/edição ── */
const MODOS_DRAWER = {
  criar: { classe: "is-criando", texto: "＋ Criando novo" },
  editar: { classe: "is-editando", texto: "✎ Editando — nada é salvo até confirmar" }
};

// Aceita tanto "patient" (-> patient-drawer) quanto o id direto de uma folha.
function elementoSobreposicao(nome) {
  return document.getElementById(`${nome}-drawer`) || document.getElementById(nome);
}

function abrirDrawer(nome, modo = "criar") {
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

function fecharDrawer(nome) {
  const drawer = elementoSobreposicao(nome);
  if (!drawer) return;
  drawer.hidden = true;
  if (!document.querySelector(".admin-overlay:not([hidden])")) {
    document.body.style.overflow = "";
  }
}

document.addEventListener("click", (event) => {
  // Descartar restaura o bloco ao último estado salvo.
  const descartar = event.target.closest("[data-discard-block]");
  if (descartar) {
    const chave = descartar.dataset.discardBlock;
    if (state.siteDirty.has(chave) && !window.confirm("Descartar as alterações deste bloco?")) {
      return;
    }
    preencherBlocoSite(chave);
    marcarBlocoSujo(chave, false);
    setStatus("Alterações descartadas.", "info");
    return;
  }

  const fechar = event.target.closest("[data-close-drawer]");
  if (fechar) {
    fecharDrawer(fechar.dataset.closeDrawer);
    return;
  }
  // Clique no fundo (fora do painel) também fecha.
  if (event.target.classList?.contains("admin-overlay")) {
    event.target.hidden = true;
    if (!document.querySelector(".admin-overlay:not([hidden])")) {
      document.body.style.overflow = "";
    }
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  document.querySelectorAll(".admin-overlay:not([hidden])").forEach((drawer) => {
    drawer.hidden = true;
  });
  document.body.style.overflow = "";
});

function resetLeadForm() {
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

function resetPatientForm() {
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

function resetSessionForm() {
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

function resetMessageForm() {
  const form = document.getElementById("message-form");
  form.reset();
  getEntityIdField(form).value = "";
  getFormField(form, "isActive").checked = true;
  document.getElementById("message-form-title").textContent = "Novo modelo";
  clearFormFeedback(form);
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

// Busca um paciente por id na lista COMPLETA. Procurar em state.patients (que
// é a lista filtrada da tela Pacientes) fazia o cadastro sumir de outras telas
// assim que houvesse uma busca ativa ali.
function acharPaciente(id) {
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

function renderDashboardSummary() {
  const summary = state.dashboardSummary || {};
  document.getElementById("summary-new-leads").textContent = summary.newLeads ?? 0;

  // O selo ao lado de Contatos na barra lateral existia no HTML e no CSS, mas
  // nada o preenchia — quem abria o painel não via que havia contato novo.
  const badge = document.getElementById("nav-badge-leads");
  if (badge) {
    const novos = Number(summary.newLeads ?? 0);
    badge.hidden = novos <= 0;
    badge.textContent = novos > 99 ? "99+" : String(novos);
  }
  document.getElementById("summary-active-patients").textContent = summary.activePatients ?? 0;
  document.getElementById("summary-sessions-week").textContent = summary.sessionsThisWeek ?? 0;
  document.getElementById("summary-pending-payments").textContent = summary.pendingPayments ?? 0;
  document.getElementById("summary-month-revenue").textContent = formatCurrency(
    summary.monthRevenue || 0
  );
  document.getElementById("summary-month-pending").textContent = formatCurrency(
    summary.monthPending || 0
  );

  const agora = new Date();
  const hora = Number(
    new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hour12: false, timeZone: CLINIC_TIME_ZONE }).format(agora)
  );
  const saudacao = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
  document.getElementById("dashboard-saudacao").textContent = `${saudacao}, Marina.`;

  // A data vem com iniciais maiúsculas, como no protótipo.
  const dataLonga = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    timeZone: CLINIC_TIME_ZONE
  }).format(agora);
  document.getElementById("dashboard-hoje").textContent = dataLonga.replace(
    /(^|[\s-])([a-zà-ú])/g,
    (_, antes, letra) => antes + letra.toUpperCase()
  );

  // Intervalo da semana corrente (segunda a domingo) sob os "Sessões na semana".
  const diaSemana = (agora.getDay() + 6) % 7;
  const inicioSemana = new Date(agora);
  inicioSemana.setDate(agora.getDate() - diaSemana);
  const fimSemana = new Date(inicioSemana);
  fimSemana.setDate(inicioSemana.getDate() + 6);
  const diaMes = (d) =>
    new Intl.DateTimeFormat("pt-BR", { day: "numeric", timeZone: CLINIC_TIME_ZONE }).format(d);
  const mesLongo = (d) =>
    new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: CLINIC_TIME_ZONE }).format(d);
  document.getElementById("summary-week-range").textContent =
    `${diaMes(inicioSemana)}–${diaMes(fimSemana)} de ${mesLongo(fimSemana)}`;
  document.getElementById("summary-month-label").textContent = `${mesLongo(agora)} · confirmado`;

  const lista = document.getElementById("dashboard-upcoming-list");
  const empty = document.getElementById("dashboard-upcoming-empty");
  const items = summary.upcomingSessions || [];

  lista.innerHTML = items
    .map(
      (session) => `
        <div class="admin-linha">
          <strong>${escapeHtml(session.patientName)}</strong>
          <span class="mono texto-secundario">${escapeHtml(formatDateTime(session.scheduledAt))}</span>
          ${renderChip("session", session.status, labelMaps.sessionStatus[session.status])}
          ${renderChip("payment", session.paymentStatus, labelMaps.paymentStatus[session.paymentStatus])}
        </div>
      `
    )
    .join("");
  lista.hidden = items.length === 0;
  empty.hidden = items.length > 0;
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

function buildReceiptActionButtons(item) {
  if (item.paymentStatus !== "pago") {
    return "";
  }

  if (item.receiptId) {
    return `
      <button class="btn btn-secondary btn-compacto" type="button" data-action="download-receipt" data-id="${item.receiptId}">Baixar recibo</button>
      <button class="btn btn-secondary btn-compacto" type="button" data-action="copy-receipt-message" data-id="${item.receiptId}">Copiar mensagem</button>
    `;
  }

  return `
    <button class="btn btn-secondary btn-compacto" type="button" data-action="generate-receipt" data-id="${item.id}">Gerar recibo</button>
  `;
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

function renderFinancePanel() {
  const finance = state.finance || {
    summary: {
      totalReceived: 0,
      totalPending: 0,
      completedSessions: 0,
      pendingPayments: 0
    },
    pendingPayments: [],
    receivedPayments: []
  };

  document.getElementById("finance-total-received").textContent = formatCurrency(
    finance.summary.totalReceived
  );
  document.getElementById("finance-total-pending").textContent = formatCurrency(
    finance.summary.totalPending
  );
  document.getElementById("finance-completed-sessions").textContent =
    finance.summary.completedSessions;
  document.getElementById("finance-pending-count").textContent =
    finance.summary.pendingPayments;

  const pendingList = document.getElementById("finance-pending-list");
  const pendingEmpty = document.getElementById("finance-pending-empty");
  pendingList.innerHTML = finance.pendingPayments
    .map(
      (session) => `
        <div class="admin-linha">
          <strong>${escapeHtml(session.patientName)}</strong>
          <span class="mono texto-secundario">${escapeHtml(formatDateTime(session.scheduledAt))}</span>
          <span class="valor">${escapeHtml(formatCurrency(session.price))}</span>
          <button class="btn btn-primary btn-compacto" type="button" data-action="paid-session" data-id="${session.id}">Marcar como pago</button>
        </div>
      `
    )
    .join("");
  pendingList.hidden = finance.pendingPayments.length === 0;
  pendingEmpty.hidden = finance.pendingPayments.length > 0;

  const receivedList = document.getElementById("finance-received-list");
  const receivedEmpty = document.getElementById("finance-received-empty");
  receivedList.innerHTML = finance.receivedPayments
    .map(
      (session) => `
        <div class="admin-linha">
          <strong>${escapeHtml(session.patientName)}</strong>
          <span class="mono texto-secundario">${escapeHtml(formatDateTime(session.paidAt || session.scheduledAt))}</span>
          <span class="texto-apoio">${escapeHtml(
            labelMaps.paymentMethod[session.paymentMethod] || session.paymentMethod
          )}</span>
          <span class="valor">${escapeHtml(formatCurrency(session.price))}</span>
          ${buildReceiptActionButtons(session)}
        </div>
      `
    )
    .join("");
  receivedList.hidden = finance.receivedPayments.length === 0;
  receivedEmpty.hidden = finance.receivedPayments.length > 0;

  const receiptsList = document.getElementById("finance-receipts-list");
  const receiptsEmpty = document.getElementById("finance-receipts-empty");
  receiptsList.innerHTML = state.receipts
    .map(
      (receipt) => `
        <div class="admin-linha">
          <strong>
            <span class="mono" style="color:var(--verde)">${escapeHtml(receipt.receiptNumber)}</span>
            ${escapeHtml(receipt.patientName)}
          </strong>
          <!-- A data mostrada acompanha o regime escolhido: em competência é a
               do atendimento, em caixa é a do pagamento. Mostrar sempre a de
               pagamento fazia a lista contradizer o próprio filtro. -->
          <span class="mono texto-secundario">${escapeHtml(
            formatDate(state.receiptBasis === "caixa" ? receipt.paymentDate : receipt.sessionDate)
          )}</span>
          <span class="valor">${escapeHtml(formatCurrency(receipt.amount))}</span>
          <button class="btn btn-secondary btn-compacto" type="button" data-action="download-receipt" data-id="${receipt.id}">⤓ Baixar PDF</button>
          <button class="btn btn-secondary btn-compacto" type="button" data-action="copy-receipt-message" data-id="${receipt.id}">⧉ Copiar mensagem</button>
        </div>
      `
    )
    .join("");
  receiptsList.hidden = state.receipts.length === 0;
  receiptsEmpty.hidden = state.receipts.length > 0;
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

function syncFilterForms() {
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

function serializeHelpCards() {
  return Array.from(helpCardsList.children).map((cardEl, index) => {
    const assetType = cardEl.querySelector('select[name="assetType"]').value;
    const iconValue = cardEl.querySelector('select[name="assetValue"]').value;
    const imageValue = cardEl.querySelector('input[name="assetImageUrl"]').value;
    return {
      sortOrder: Number(cardEl.querySelector('input[name="sortOrder"]').value || index + 1),
      title: cardEl.querySelector('input[name="title"]').value.trim(),
      description: cardEl.querySelector('textarea[name="description"]').value.trim(),
      assetType,
      assetValue: assetType === "image" ? imageValue : iconValue
    };
  });
}

function serializeSocialLinks() {
  return Array.from(socialLinksList.children).map((linkEl) => ({
    platform: linkEl.querySelector('select[name="platform"]').value,
    label: linkEl.querySelector('input[name="label"]').value.trim(),
    url: linkEl.querySelector('input[name="url"]').value.trim()
  }));
}

function validateHomePayload(payload) {
  if (!payload.title || !payload.subtitle || !payload.body) {
    throw new Error("Preencha os campos obrigatórios da Home.");
  }
  if (!isSafeLink(payload.ctaUrl)) {
    throw new Error("CTA da Home deve ser uma âncora, rota relativa ou URL válida.");
  }
  if (!isSafeImagePath(payload.imageUrl)) {
    throw new Error("Imagem principal inválida.");
  }
}

function validateAboutPayload(payload) {
  if (!payload.title || !payload.content) {
    throw new Error("Preencha os campos obrigatórios de Sobre.");
  }
}

function validateAboutPanelPayload(payload) {
  if (!payload.title || !payload.note) {
    throw new Error("Preencha os campos obrigatórios do painel Sobre.");
  }
}

function validateWorkPayload(payload) {
  if (!payload.lead || !payload.body) {
    throw new Error("Preencha os textos da seção de metodologia.");
  }
}

function validateAttendancePayload(payload) {
  if (!payload.lead || !payload.ctaLabel) {
    throw new Error("Preencha os campos obrigatórios da seção Atendimento.");
  }
}

function validateClosingPayload(payload) {
  if (!payload.titlePrefix || !payload.titleEmphasis || !payload.body || !payload.ctaLabel) {
    throw new Error("Preencha os campos obrigatórios da seção final.");
  }
}

function validateHelpPayload(payload) {
  if (!payload.cards.length) {
    throw new Error("Adicione ao menos um card.");
  }

  payload.cards.forEach((card, index) => {
    if (!card.title || !card.description) {
      throw new Error(`Card ${index + 1} está incompleto.`);
    }
    if (card.assetType === "icon" && !state.allowedHelpIcons.includes(card.assetValue)) {
      throw new Error(`Card ${index + 1} possui ícone inválido.`);
    }
    if (card.assetType === "image" && !isSafeImagePath(card.assetValue)) {
      throw new Error(`Card ${index + 1} precisa de uma imagem válida.`);
    }
  });
}

function validateContactPayload(payload) {
  payload.socialLinks.forEach((link, index) => {
    if (link.url && !isSafeLink(link.url)) {
      throw new Error(`Link social ${index + 1} é inválido.`);
    }
  });
}

function validateSeoPayload(payload) {
  if (!isSafeImagePath(payload.shareImageUrl)) {
    throw new Error("Imagem de compartilhamento inválida.");
  }
}

function validateFooterPayload(payload) {
  if (!payload.note || !payload.metaText) {
    throw new Error("Preencha os textos institucionais do rodapé.");
  }
}

async function handleSiteSave(event, section, serializer, validator, successMessage) {
  event.preventDefault();
  const form = event.currentTarget;
  clearStatus();
  clearFormFeedback(form);
  clearFieldErrors(form);

  if (!form.reportValidity()) {
    return;
  }

  try {
    const payload = serializer(form);
    validator(payload);
    setFormBusy(form, true, "Salvando...");
    const response = await apiRequest(`/api/admin/content/${section}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    state.content = response.data;
    // Só o bloco salvo é repovoado (com o que o servidor normalizou). Os demais
    // ficam intactos, preservando edições ainda não salvas.
    preencherBlocoSite(section);
    marcarBlocoSujo(section, false);
    setFormFeedback(form, successMessage, "success");
    setStatus(successMessage, "success");
  } catch (error) {
    applyFieldErrors(form, error.details?.fieldErrors);
    setFormFeedback(form, buildErrorMessage(error), "error");
  } finally {
    setFormBusy(form, false);
  }
}

async function handleUpload(fileInput) {
  const file = fileInput.files[0];
  if (!file) {
    return;
  }

  const allowedExtensions = [".jpg", ".jpeg", ".png", ".webp"];
  const name = file.name.toLowerCase();
  if (!allowedExtensions.some((extension) => name.endsWith(extension))) {
    throw new Error("Formato inválido. Use jpg, jpeg, png ou webp.");
  }

  if (file.size > 3 * 1024 * 1024) {
    throw new Error("Arquivo excede o limite de 3 MB.");
  }

  const scope = fileInput.closest(".upload-block") || fileInput.closest(".admin-nested-card");
  const targetName = fileInput.dataset.uploadTarget;
  const targetInput = scope.querySelector(`[name="${escapeSelector(targetName)}"]`);

  const formData = new FormData();
  formData.append("image", file);

  setStatus("Enviando imagem...", "success");
  const response = await apiRequest("/api/admin/uploads", {
    method: "POST",
    body: formData,
    timeoutMs: 30000
  });

  targetInput.value = response.data.url;
  refreshPreviewFromInput(targetInput);
  setStatus("Imagem enviada com sucesso.", "success");
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

function readMessageFormPayload(form) {
  return {
    title: getFormValue(form, "title").trim(),
    category: getFormValue(form, "category"),
    body: getFormValue(form, "body").trim(),
    isActive: getFormChecked(form, "isActive")
  };
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

async function loadContent() {
  const response = await apiRequest("/api/admin/content");
  state.content = response.data;
  state.allowedHelpIcons = response.meta.allowedHelpIcons || [];
  populateSiteForms();
}

async function loadDashboardSummary() {
  const response = await apiRequest("/api/admin/dashboard-summary");
  state.dashboardSummary = response.data;
  renderDashboardSummary();
}

async function loadLeads() {
  const response = await apiRequest(`/api/admin/leads${toQueryString(state.leadFilters)}`);
  state.leads = response.data.items || [];
  renderLeadsTable();
}

async function loadPatients() {
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

async function loadSessions() {
  const response = await apiRequest(`/api/admin/sessions${toQueryString(state.sessionFilters)}`);
  state.sessions = response.data.items || [];
  renderSessionsTable();
}

async function loadFinance() {
  const response = await apiRequest(
    `/api/admin/finance/summary${toQueryString(state.financeFilters)}`
  );
  state.finance = response.data;
  renderFinancePanel();
}

async function loadReceipts() {
  const response = await apiRequest(
    `/api/admin/receipts${toQueryString({
      month: state.financeFilters.month,
      year: state.financeFilters.year,
      patientId: state.financeFilters.patientId,
      basis: state.receiptBasis
    })}`
  );
  state.receipts = response.data.items || [];
  renderFinancePanel();
}

async function loadMessageTemplates() {
  const response = await apiRequest(
    `/api/admin/message-templates${toQueryString(state.messageFilters)}`
  );
  state.messageTemplates = response.data.items || [];
  renderMessageTemplatesTable();
}

async function loadAuditLogs() {
  const response = await apiRequest(`/api/admin/audit-logs${toQueryString(state.auditFilters)}`);
  state.auditLogs = response.data;
  renderAuditPanel();
}

async function loadPlatformSettings() {
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

async function loadGoogleCalendarStatus() {
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

async function loadSecurityStatus() {
  const response = await apiRequest("/api/admin/security/status");
  state.securityStatus = response.data;
  renderSecurityStatus();
}

async function loadAllData(isRetry = false) {
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

document.getElementById("add-help-card").addEventListener("click", () => {
  helpCardsList.appendChild(createHelpCard());
  marcarBlocoSujo("help", true);
});

document.getElementById("add-social-link").addEventListener("click", () => {
  socialLinksList.appendChild(createSocialLink());
  marcarBlocoSujo("contact", true);
});

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

document.addEventListener("click", async (event) => {
  // Resolve a ação no próprio alvo (comportamento original) e, só quando ele
  // não carrega data-action, no ancestral mais próximo — permite botões com
  // conteúdo aninhado (cards de atalho do prontuário).
  const actionSource = event.target.dataset.action
    ? event.target
    : event.target.closest("[data-action]");
  const { action, id } = actionSource ? actionSource.dataset : {};

  if (event.target.matches('[data-action="remove-help-card"]')) {
    event.target.closest(".admin-nested-card").remove();
    marcarBlocoSujo("help", true);
    return;
  }

  if (event.target.matches('[data-action="remove-social-link"]')) {
    event.target.closest(".admin-nested-card").remove();
    marcarBlocoSujo("contact", true);
    return;
  }

  if (event.target.matches('[data-action="remove-intake-question"]')) {
    event.target.closest(".anamnese-item")?.remove();
    return;
  }

  if (event.target.matches('[data-action="toggle-intake-question"]')) {
    toggleIntakeQuestion(event.target.closest(".anamnese-item"));
    return;
  }

  try {
    switch (action) {
      case "open-clinical": {
        await openClinical(id);
        break;
      }
      case "back-to-patients": {
        openPanel("patients");
        break;
      }
      case "export-clinical-record": {
        if (state.clinical.patientId) {
          window.open(
            `/api/admin/patients/${state.clinical.patientId}/clinical-record/export.pdf`,
            "_blank"
          );
        }
        break;
      }
      case "save-intake": {
        await saveIntake();
        break;
      }
      case "complete-intake": {
        if (!state.clinical.intake) return;
        if (!window.confirm("Concluir a anamnese? Após concluída ela não pode ser editada diretamente.")) return;
        await apiRequest(`/api/admin/intakes/${state.clinical.intake.id}/complete`, { method: "POST" });
        await loadIntake();
        await loadClinicalRecord();
        setStatus("Anamnese concluída.", "success");
        break;
      }
      case "lock-intake": {
        if (!state.clinical.intake) return;
        if (!window.confirm("Bloquear a anamnese? Registros bloqueados não podem ser editados — só por nova versão/adendo.")) return;
        await apiRequest(`/api/admin/intakes/${state.clinical.intake.id}/lock`, { method: "POST" });
        await loadIntake();
        await loadClinicalRecord();
        setStatus("Anamnese bloqueada.", "success");
        break;
      }
      case "export-intake": {
        if (state.clinical.intake) {
          window.open(`/api/admin/intakes/${state.clinical.intake.id}/export.pdf`, "_blank");
        }
        break;
      }
      case "add-question": {
        addIntakeQuestion(actionSource.dataset.form || "intake", actionSource.dataset.section);
        break;
      }
      case "open-clinical-record": {
        await openClinicalRecordForPatient();
        break;
      }
      case "close-clinical-record": {
        openCloseRecordDialog();
        break;
      }
      case "confirm-close-record": {
        await confirmCloseRecord();
        break;
      }
      case "reopen-clinical-record": {
        await reopenClinicalRecord();
        break;
      }
      case "save-block": {
        await saveBlock(actionSource.dataset.form);
        break;
      }
      case "complete-block": {
        if (
          !window.confirm(
            "Concluir este bloco? Depois de concluído ele não pode ser editado diretamente."
          )
        )
          return;
        await completeBlock(actionSource.dataset.form);
        break;
      }
      case "lock-block": {
        if (
          !window.confirm(
            "Bloquear este bloco? Registros bloqueados não podem ser editados — a correção passa a ser por nova versão."
          )
        )
          return;
        await lockBlock(actionSource.dataset.form);
        break;
      }
      case "export-block": {
        exportBlock(actionSource.dataset.form);
        break;
      }
      case "new-document": {
        await switchClinicalTab("documentos");
        openDocumentForm();
        break;
      }
      case "cancel-document-form": {
        closeDocumentForm();
        break;
      }
      case "download-document": {
        window.open(`/api/admin/clinical-documents/${id}/download`, "_blank");
        break;
      }
      case "revoke-document": {
        await revokeDocument(id);
        break;
      }
      case "new-evolution": {
        await openEvolutionForm({ mode: "create" });
        break;
      }
      case "go-intake": {
        await switchClinicalTab("anamnese");
        break;
      }
      case "go-section": {
        mostrarSecao(
          actionSource.dataset.form || "intake",
          Number(actionSource.dataset.index) || 0
        );
        break;
      }
      case "go-site-block": {
        abrirBlocoSite(actionSource.dataset.block);
        break;
      }
      case "go-evolutions": {
        await switchClinicalTab("evolucoes");
        break;
      }
      case "go-new-evolution": {
        await switchClinicalTab("evolucoes");
        await openEvolutionForm({ mode: "create" });
        document.getElementById("clinical-evolution-form").scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
        break;
      }
      case "cancel-evolution-form": {
        hideEvolutionForm();
        break;
      }
      case "view-evolution": {
        await openEvolutionModal(id);
        break;
      }
      case "edit-evolution": {
        await openEvolutionForm({ mode: "edit", evolutionId: id });
        break;
      }
      case "export-evolution": {
        window.open(`/api/admin/evolutions/${id}/export.pdf`, "_blank");
        break;
      }
      case "sign-evolution": {
        if (!window.confirm("Assinar esta evolução? Após assinada não poderá ser editada diretamente.")) return;
        await apiRequest(`/api/admin/evolutions/${id}/sign`, { method: "POST" });
        closeEvolutionModal();
        await loadEvolutions();
        await loadClinicalRecord();
        setStatus("Evolução assinada.", "success");
        break;
      }
      case "lock-evolution": {
        if (!window.confirm("Bloquear esta evolução? Registros bloqueados não podem ser editados.")) return;
        await apiRequest(`/api/admin/evolutions/${id}/lock`, { method: "POST" });
        closeEvolutionModal();
        await loadEvolutions();
        await loadClinicalRecord();
        setStatus("Evolução bloqueada.", "success");
        break;
      }
      case "addendum-evolution": {
        closeEvolutionModal();
        openEvolutionForm({ mode: "addendum", evolutionId: id });
        break;
      }
      case "close-evolution-modal": {
        closeEvolutionModal();
        break;
      }
      case "edit-lead": {
        const lead = state.leads.find((item) => String(item.id) === id);
        if (!lead) return;
        const form = document.getElementById("lead-form");
        fillForm(form, lead);
        getEntityIdField(form).value = lead.id;
        document.getElementById("lead-form-title").textContent = `Editar contato #${lead.id}`;
        openPanel("leads");
        abrirDrawer("lead", "editar");
        break;
      }
      case "delete-lead": {
        if (!window.confirm("Excluir este contato?")) return;
        await apiRequest(`/api/admin/leads/${id}`, { method: "DELETE" });
        await Promise.all([loadLeads(), loadDashboardSummary()]);
        resetLeadForm();
        setStatus("Contato excluído com sucesso.", "success");
        break;
      }
      case "convert-lead": {
        const lead = state.leads.find((item) => String(item.id) === id);
        if (!lead) return;
        if (leadRequiresGuardian(lead)) {
          startLeadConversion(lead);
          setStatus("Conversão assistida iniciada no formulário de paciente.", "success");
          break;
        }
        if (!window.confirm("Converter este contato em paciente?")) return;
        await apiRequest(`/api/admin/leads/${id}/convert-to-patient`, { method: "POST" });
        await Promise.all([loadLeads(), loadPatients(), loadDashboardSummary()]);
        resetPatientForm();
        openPanel("patients");
        setStatus("Contato convertido em paciente.", "success");
        break;
      }
      case "edit-patient": {
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
        break;
      }
      case "new-patient": {
        resetPatientForm();
        openPanel("patients");
        abrirDrawer("patient", "criar");
        break;
      }
      case "new-lead": {
        resetLeadForm();
        openPanel("leads");
        abrirDrawer("lead", "criar");
        break;
      }
      case "new-session": {
        resetSessionForm();
        openPanel("sessions");
        abrirDrawer("session", "criar");
        break;
      }
      case "new-message": {
        resetMessageForm();
        openPanel("messages");
        abrirDrawer("message", "criar");
        break;
      }
      case "open-session-sheet": {
        abrirFichaSessao(id);
        break;
      }
      case "insert-variable": {
        inserirVariavel(actionSource.dataset.variable);
        break;
      }
      case "delete-patient": {
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
        break;
      }
      case "edit-session": {
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
        break;
      }
      case "reschedule-session": {
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
        break;
      }
      case "done-session": {
        fecharDrawer("session-sheet");
        await apiRequest(`/api/admin/sessions/${id}/mark-done`, { method: "POST" });
        await Promise.all([loadSessions(), loadFinance(), loadDashboardSummary()]);
        setStatus("Sessão marcada como realizada.", "success");
        break;
      }
      case "missed-session": {
        fecharDrawer("session-sheet");
        await apiRequest(`/api/admin/sessions/${id}/mark-missed`, { method: "POST" });
        await Promise.all([loadSessions(), loadFinance(), loadDashboardSummary()]);
        setStatus("Sessão marcada como falta.", "success");
        break;
      }
      case "paid-session": {
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
        break;
      }
      case "generate-receipt": {
        const response = await apiRequest(`/api/admin/sessions/${id}/receipt`, {
          method: "POST",
          body: JSON.stringify({})
        });
        await Promise.all([loadSessions(), loadFinance(), loadReceipts()]);
        setStatus(
          response.meta?.reused ? "Recibo já existente carregado." : "Recibo gerado com sucesso.",
          "success"
        );
        break;
      }
      case "download-receipt": {
        window.open(`/api/admin/receipts/${id}/download`, "_blank");
        break;
      }
      case "copy-receipt-message": {
        const receipt = await getReceiptById(id);
        await copyText(
          buildReceiptDeliveryMessage(receipt),
          "Mensagem de envio do recibo copiada."
        );
        break;
      }
      case "retry-google-sync": {
        await apiRequest(`/api/admin/sessions/${id}/retry-google-sync`, { method: "POST" });
        await Promise.all([loadSessions(), loadGoogleCalendarStatus()]);
        setStatus("Sincronização da sessão reenviada ao Google Calendar.", "success");
        break;
      }
      case "cancel-session": {
        fecharDrawer("session-sheet");
        if (!window.confirm("Cancelar esta sessão?")) return;
        await apiRequest(`/api/admin/sessions/${id}/cancel`, { method: "POST" });
        await Promise.all([loadSessions(), loadFinance(), loadReceipts(), loadDashboardSummary()]);
        setStatus("Sessão cancelada.", "success");
        break;
      }
      case "delete-session": {
        fecharDrawer("session-sheet");
        if (!window.confirm("Excluir esta sessão?")) return;
        await apiRequest(`/api/admin/sessions/${id}`, { method: "DELETE" });
        await Promise.all([loadSessions(), loadFinance(), loadReceipts(), loadDashboardSummary()]);
        resetSessionForm();
        setStatus("Sessão excluída com sucesso.", "success");
        break;
      }
      case "edit-message": {
        const template = state.messageTemplates.find((item) => String(item.id) === id);
        if (!template) return;
        const form = document.getElementById("message-form");
        fillForm(form, template);
        getEntityIdField(form).value = template.id;
        getFormField(form, "isActive").checked = Boolean(template.isActive);
        document.getElementById("message-form-title").textContent = `Editar modelo #${template.id}`;
        openPanel("messages");
        abrirDrawer("message", "editar");
        break;
      }
      case "copy-message": {
        const template = state.messageTemplates.find((item) => String(item.id) === id);
        if (!template) return;
        openCopyMessageModal(template);
        break;
      }
      case "delete-message": {
        if (!window.confirm("Excluir este modelo?")) return;
        await apiRequest(`/api/admin/message-templates/${id}`, { method: "DELETE" });
        await loadMessageTemplates();
        resetMessageForm();
        setStatus("Modelo excluído com sucesso.", "success");
        break;
      }
      default:
        break;
    }
  } catch (error) {
    setStatus(error.message, "error");
  }
});

// Digitar realimenta os contadores por seção e a barra de progresso — do
// formulário em que se está digitando, não dos três.
document.addEventListener("input", (event) => {
  if (event.target.classList?.contains("anamnese-resposta")) {
    const raiz = event.target.closest("[data-form]");
    if (raiz?.dataset.form) {
      atualizarIndiceSecoes(raiz.dataset.form);
    }
  }

  // Qualquer edição dentro de um bloco do site o marca como não salvo.
  const bloco = event.target.closest?.("[data-site-block]");
  if (bloco && !state.siteDirty.has(bloco.dataset.siteBlock)) {
    marcarBlocoSujo(bloco.dataset.siteBlock, true);
  }

  // Contador do corpo da mensagem.
  if (event.target.matches?.('#message-form textarea[name="body"]')) {
    const contador = document.getElementById("message-body-count");
    if (contador) contador.textContent = `${event.target.value.length}/2500`;
  }
});

document.addEventListener("change", async (event) => {
  const target = event.target;

  if (target.matches(".field input, .field textarea, .field select")) {
    clearFieldErrorForInput(target);
  }

  const blocoSite = target.closest?.("[data-site-block]");
  if (blocoSite) {
    marcarBlocoSujo(blocoSite.dataset.siteBlock, true);
  }

  if (target.matches('input[type="file"][data-upload-target]')) {
    try {
      await handleUpload(target);
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      target.value = "";
    }
  }

  if (target.matches('select[name="assetType"]')) {
    const cardEl = target.closest(".admin-nested-card");
    const iconField = cardEl.querySelector(".help-icon-field");
    const imageBlock = cardEl.querySelector(".help-image-block");
    const isImage = target.value === "image";
    iconField.hidden = isImage;
    imageBlock.hidden = !isImage;
  }

  if (target.matches('input[readonly][name]')) {
    refreshPreviewFromInput(target);
  }

  if (target.matches('#patient-form select[name="patientType"]')) {
    updateGuardianFieldsState();
  }

  if (target.matches('#patient-form input[name="birthDate"]')) {
    const ageField = document.querySelector('#patient-form input[name="age"]');
    if (target.value) {
      // new Date("2000-06-15") é interpretado como meia-noite UTC, mas
      // getDate()/getMonth() devolvem valores locais: em UTC-3 o dia voltava
      // um, e na véspera do aniversário a idade já aparecia somada. Lemos as
      // partes direto do texto, que é o que a pessoa digitou.
      const [anoNasc, mesNasc, diaNasc] = target.value.split("-").map(Number);
      const today = new Date();
      let age = today.getFullYear() - anoNasc;
      const monthDiff = today.getMonth() + 1 - mesNasc;
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < diaNasc)) {
        age -= 1;
      }
      if (age >= 0 && age <= 120) {
        ageField.value = String(age);
        ageField.readOnly = true;
        ageField.title = "Calculado automaticamente a partir da data de nascimento";
      }
    } else {
      ageField.readOnly = false;
      ageField.title = "";
    }
  }

  if (target.matches('#session-form select[name="patientId"]')) {
    const patient = acharPaciente(target.value);
    applySessionPatientDefaults(patient);
  }
});

async function sair() {
  try {
    await apiRequest("/api/admin/logout", { method: "POST" });
    window.location.assign("/admin/login");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

// Dois pontos de saída: rodapé da barra lateral (desktop) e folha "Mais".
document.getElementById("logout-button").addEventListener("click", sair);
document.getElementById("logout-button-mobile")?.addEventListener("click", sair);

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

document.addEventListener("input", (event) => {
  const target = event.target;
  if (target.matches(".field input, .field textarea")) {
    clearFieldErrorForInput(target);
  }
});

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

function setGcalActionFeedback(message, tone = "success") {
  showToast(message, tone);
}

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

document.getElementById("finance-export-button").addEventListener("click", () => {
  window.open(`/api/admin/finance/export.csv${toQueryString(state.financeFilters)}`, "_blank");
});

document.getElementById("audit-prev-page").addEventListener("click", async () => {
  if (state.auditFilters.page <= 1) {
    return;
  }

  state.auditFilters.page -= 1;
  await loadAuditLogs().catch((error) => setStatus(error.message, "error"));
});

document.getElementById("audit-next-page").addEventListener("click", async () => {
  const totalPages = Math.max(
    1,
    Math.ceil(Number(state.auditLogs.total || 0) / Number(state.auditLogs.pageSize || 20))
  );
  if (state.auditFilters.page >= totalPages) {
    return;
  }

  state.auditFilters.page += 1;
  await loadAuditLogs().catch((error) => setStatus(error.message, "error"));
});


document.getElementById("home-form").addEventListener("submit", (event) =>
  handleSiteSave(
    event,
    "home",
    (form) => ({
      eyebrow: getFormValue(form, "eyebrow").trim(),
      title: getFormValue(form, "title").trim(),
      subtitle: getFormValue(form, "subtitle").trim(),
      body: getFormValue(form, "body").trim(),
      ctaLabel: getFormValue(form, "ctaLabel").trim(),
      ctaUrl: getFormValue(form, "ctaUrl").trim(),
      imageUrl: getFormValue(form, "imageUrl").trim(),
      imageAlt: getFormValue(form, "imageAlt").trim()
    }),
    validateHomePayload,
    "Home salva com sucesso."
  )
);

document.getElementById("about-form").addEventListener("submit", (event) =>
  handleSiteSave(
    event,
    "about",
    (form) => ({
      eyebrow: getFormValue(form, "eyebrow").trim(),
      title: getFormValue(form, "title").trim(),
      content: getFormValue(form, "content").trim()
    }),
    validateAboutPayload,
    "Seção Sobre salva com sucesso."
  )
);

document.getElementById("about-panel-form").addEventListener("submit", (event) =>
  handleSiteSave(
    event,
    "aboutPanel",
    (form) => ({
      eyebrow: getFormValue(form, "eyebrow").trim(),
      title: getFormValue(form, "title").trim(),
      note: getFormValue(form, "note").trim(),
      item1Label: getFormValue(form, "item1Label").trim(),
      item1Value: getFormValue(form, "item1Value").trim(),
      item2Label: getFormValue(form, "item2Label").trim(),
      item2Value: getFormValue(form, "item2Value").trim(),
      item3Label: getFormValue(form, "item3Label").trim(),
      item3Value: getFormValue(form, "item3Value").trim(),
      item4Label: getFormValue(form, "item4Label").trim(),
      item4Value: getFormValue(form, "item4Value").trim()
    }),
    validateAboutPanelPayload,
    "Painel do Sobre salvo com sucesso."
  )
);

document.getElementById("help-form").addEventListener("submit", (event) =>
  handleSiteSave(
    event,
    "help",
    (form) => ({
      eyebrow: getFormValue(form, "eyebrow").trim(),
      title: getFormValue(form, "title").trim(),
      cards: serializeHelpCards()
    }),
    validateHelpPayload,
    "Cards salvos com sucesso."
  )
);

document.getElementById("work-form").addEventListener("submit", (event) =>
  handleSiteSave(
    event,
    "work",
    (form) => ({
      eyebrow: getFormValue(form, "eyebrow").trim(),
      titlePrefix: getFormValue(form, "titlePrefix").trim(),
      titleEmphasis: getFormValue(form, "titleEmphasis").trim(),
      titleSuffix: getFormValue(form, "titleSuffix").trim(),
      lead: getFormValue(form, "lead").trim(),
      body: getFormValue(form, "body").trim(),
      pillar1Number: getFormValue(form, "pillar1Number").trim(),
      pillar1Title: getFormValue(form, "pillar1Title").trim(),
      pillar1Description: getFormValue(form, "pillar1Description").trim(),
      pillar2Number: getFormValue(form, "pillar2Number").trim(),
      pillar2Title: getFormValue(form, "pillar2Title").trim(),
      pillar2Description: getFormValue(form, "pillar2Description").trim(),
      pillar3Number: getFormValue(form, "pillar3Number").trim(),
      pillar3Title: getFormValue(form, "pillar3Title").trim(),
      pillar3Description: getFormValue(form, "pillar3Description").trim()
    }),
    validateWorkPayload,
    "Seção de metodologia salva com sucesso."
  )
);

document.getElementById("attendance-form").addEventListener("submit", (event) =>
  handleSiteSave(
    event,
    "attendance",
    (form) => ({
      eyebrow: getFormValue(form, "eyebrow").trim(),
      titlePrefix: getFormValue(form, "titlePrefix").trim(),
      titleEmphasis: getFormValue(form, "titleEmphasis").trim(),
      lead: getFormValue(form, "lead").trim(),
      ctaLabel: getFormValue(form, "ctaLabel").trim(),
      feature1Title: getFormValue(form, "feature1Title").trim(),
      feature1Description: getFormValue(form, "feature1Description").trim(),
      feature2Title: getFormValue(form, "feature2Title").trim(),
      feature2Description: getFormValue(form, "feature2Description").trim(),
      feature3Title: getFormValue(form, "feature3Title").trim(),
      feature3Description: getFormValue(form, "feature3Description").trim()
    }),
    validateAttendancePayload,
    "Seção de atendimento salva com sucesso."
  )
);

document.getElementById("closing-form").addEventListener("submit", (event) =>
  handleSiteSave(
    event,
    "closing",
    (form) => ({
      titlePrefix: getFormValue(form, "titlePrefix").trim(),
      titleEmphasis: getFormValue(form, "titleEmphasis").trim(),
      body: getFormValue(form, "body").trim(),
      ctaLabel: getFormValue(form, "ctaLabel").trim()
    }),
    validateClosingPayload,
    "Fechamento salvo com sucesso."
  )
);

document.getElementById("contact-form").addEventListener("submit", (event) =>
  handleSiteSave(
    event,
    "contact",
    (form) => ({
      title: getFormValue(form, "title").trim(),
      text: getFormValue(form, "text").trim(),
      whatsappNumber: getFormValue(form, "whatsappNumber").trim(),
      whatsappMessage: getFormValue(form, "whatsappMessage").trim(),
      socialLinks: serializeSocialLinks()
    }),
    validateContactPayload,
    "Contato salvo com sucesso."
  )
);

document.getElementById("seo-form").addEventListener("submit", (event) =>
  handleSiteSave(
    event,
    "seo",
    (form) => ({
      title: getFormValue(form, "title").trim(),
      description: getFormValue(form, "description").trim(),
      shareImageUrl: getFormValue(form, "shareImageUrl").trim()
    }),
    validateSeoPayload,
    "SEO salvo com sucesso."
  )
);

document.getElementById("footer-form").addEventListener("submit", (event) =>
  handleSiteSave(
    event,
    "footer",
    (form) => ({
      note: getFormValue(form, "note").trim(),
      metaText: getFormValue(form, "metaText").trim()
    }),
    validateFooterPayload,
    "Rodapé salvo com sucesso."
  )
);

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
// ── End copy-message modal ──────────────────────────────────────────────────

// ── Prontuário clínico ───────────────────────────────────────────────────────
let clinicalCustomCounter = 0;

async function openClinical(patientId) {
  const patient = state.patients.find((item) => String(item.id) === String(patientId));
  state.clinical = {
    patientId: Number(patientId),
    tab: "resumo",
    summary: null,
    intake: null,
    intakeTemplate: null,
    blocks: {},
    documents: [],
    sectionIndex: { intake: 0, contract: 0, plan: 0 },
    evolutions: [],
    patient: patient || null
  };
  // O formulário da anamnese vive no DOM e é dele que a coleta lê.
  // Trocar de paciente sem limpá-lo deixava as respostas do anterior na tela:
  // se a carga da nova anamnese falhasse, salvar gravaria o conteúdo de uma
  // pessoa no prontuário de outra.
  limparFormulariosDeSecoes();

  openPanel("clinical", { scrollIntoView: true });
  setClinicalTab("resumo");
  await loadClinicalRecord();
}

function limparFormulariosDeSecoes() {
  for (const formKey of Object.keys(FORMULARIOS_SECOES)) {
    const { raiz } = refsFormulario(formKey);
    if (!raiz) continue;
    raiz.innerHTML = "";
    raiz.dataset.patientId = "";
  }
}

function renderClinicalPatientCard() {
  const card = document.getElementById("clinical-patient-card");
  const patient = state.clinical.summary?.patient || state.clinical.patient;
  if (!patient) {
    card.innerHTML = "";
    return;
  }
  const partes = [
    patient.phone ? `<span class="mono">${escapeHtml(patient.phone)}</span>` : "",
    patient.email ? `<span>${escapeHtml(patient.email)}</span>` : "",
    `<span>${escapeHtml(labelMaps.patientType[patient.patientType] || patient.patientType)} · ${escapeHtml(
      labelMaps.patientModality[patient.modality] || patient.modality
    )} · em acompanhamento desde ${escapeHtml(formatDate(patient.createdAt))}</span>`
  ].filter(Boolean);

  card.innerHTML = partes.join("");
}

function setClinicalTab(tab) {
  state.clinical.tab = tab;
  document.querySelectorAll("[data-clinical-tab]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.clinicalTab === tab);
  });
  document.querySelectorAll("[data-clinical-panel]").forEach((panel) => {
    const isCurrent = panel.dataset.clinicalPanel === tab;
    panel.hidden = !isCurrent;
    panel.classList.toggle("is-active", isCurrent);
  });
}

async function switchClinicalTab(tab) {
  setClinicalTab(tab);
  if (tab === "anamnese" && !state.clinical.intake && !state.clinical.intakeTemplate) {
    await loadIntake();
  } else if (tab === "anamnese" && !formularioJaRenderizadoParaPacienteAtual("intake")) {
    renderIntake();
  }

  // Contrato e plano seguem a mesma regra da anamnese: só recarregam se o
  // formulário na tela ainda não for o deste paciente. Recarregar sempre
  // jogaria fora o que foi digitado e não salvo ao trocar de aba.
  for (const [aba, formKey] of [["contrato", "contract"], ["plano", "plan"]]) {
    if (tab !== aba) continue;
    if (!state.clinical.blocks?.[formKey]) {
      await loadBlock(formKey);
    } else if (!formularioJaRenderizadoParaPacienteAtual(formKey)) {
      renderBlock(formKey);
    }
  }

  if (tab === "evolucoes") {
    await loadEvolutions();
  }
  if (tab === "documentos") {
    await loadDocuments();
  }
  atualizarAcoesDeCriacaoDoCofre();
}

// Prontuário encerrado não recebe registro novo: os botões de criar somem
// em vez de levar a um 409 depois de a pessoa já ter digitado.
function atualizarAcoesDeCriacaoDoCofre() {
  const encerrado = state.clinical.summary?.record?.status === "closed";
  for (const seletor of ['[data-action="new-evolution"]', '[data-action="new-document"]']) {
    document.querySelectorAll(`.cofre ${seletor}`).forEach((botao) => {
      botao.hidden = encerrado;
    });
  }
}

async function loadClinicalRecord() {
  if (!state.clinical.patientId) return;

  // Trocar de paciente mantinha na tela o cartão e o resumo do anterior até a
  // resposta chegar. Num prontuário, ver dado de outra pessoa — ainda que por
  // um instante — não é aceitável.
  if (String(state.clinical.summary?.patient?.id || "") !== String(state.clinical.patientId)) {
    state.clinical.summary = null;
    renderClinicalPatientCard();
    renderRecordHeader();
    renderClinicalSummary();
  }
  const response = await apiRequest(
    `/api/admin/patients/${state.clinical.patientId}/clinical-record`
  );
  state.clinical.summary = response.data;
  renderClinicalPatientCard();
  renderRecordHeader();
  renderClinicalSummary();
  atualizarAcoesDeCriacaoDoCofre();
}

function describeIntakeStatus(intake) {
  if (!intake) return "Ausente";
  return intake.statusLabel || intake.status;
}

function renderClinicalSummary() {
  const container = document.getElementById("clinical-summary");
  const resumo = state.clinical.summary;
  if (!resumo) {
    container.innerHTML = "<p class=\"field-help\">Carregando…</p>";
    return;
  }

  const patient = resumo.patient;
  const record = resumo.record;

  // Sem prontuário aberto não há o que resumir: a tela oferece o ato que
  // faltava — abrir o registro.
  if (!record) {
    container.innerHTML = `
      <div class="cofre-proximo">
        <div>
          <div class="rotulo-micro">Próximo passo</div>
          <h3>Abra o prontuário</h3>
          <p>
            O prontuário reúne contrato e consentimento, plano terapêutico, anamnese,
            evolução de cada atendimento, documentos emitidos e o encerramento do caso.
            Abrir dá número ao registro e começa o acompanhamento.
          </p>
        </div>
        <div class="inline-actions">
          <button class="btn btn-primary btn-compacto" type="button" data-action="open-clinical-record">Abrir prontuário</button>
        </div>
      </div>
    `;
    atualizarContadoresDoCofre(resumo);
    return;
  }

  const intakeStatus = describeIntakeStatus(resumo.intake);
  const latest = resumo.latestEvolution;
  const encerrado = record.status === "closed";

  const timeline = (resumo.timeline || [])
    .map(
      (entry) => `
        <li>
          <span class="cofre-timeline-data">${escapeHtml(formatAuditDateTime(entry.date))}</span>
          <span>${escapeHtml(entry.label)}</span>
          ${
            entry.status
              ? `<span class="cofre-timeline-estado is-menor">${renderChip(
                  chipDaTimeline(entry),
                  entry.status,
                  rotuloDoEstado(entry)
                )}</span>`
              : ""
          }
        </li>
      `
    )
    .join("");

  const proximo = proximoPassoDoProntuario(resumo);
  const chipAnamnese = resumo.intake
    ? renderChip("intake", resumo.intake.status, resumo.intake.statusLabel || intakeStatus)
    : "";
  const evolutionsCount = Number(resumo.evolutionsCount) || 0;

  container.innerHTML = `
    <div class="cofre-proximo">
      <div>
        <div class="rotulo-micro">Próximo passo</div>
        <h3>${escapeHtml(proximo.titulo)}</h3>
        <p>${escapeHtml(proximo.ajuda)}</p>
      </div>
      <div class="inline-actions">
        ${proximo.acoes}
      </div>
    </div>

    <div class="cofre-estatisticas">
      <button class="cofre-estatistica" type="button" data-clinical-goto="contrato">
        <span class="rotulo-micro">Contrato</span>
        <strong>${
          resumo.blocks?.contract
            ? renderChip("intake", resumo.blocks.contract.status, resumo.blocks.contract.statusLabel)
            : "Não registrado"
        }</strong>
        <span class="cofre-estatistica-hint">${resumo.blocks?.contract ? "Abrir" : "Registrar"}</span>
      </button>
      <button class="cofre-estatistica" type="button" data-clinical-goto="plano">
        <span class="rotulo-micro">Plano terapêutico</span>
        <strong>${
          resumo.blocks?.plan
            ? renderChip("intake", resumo.blocks.plan.status, resumo.blocks.plan.statusLabel)
            : "Não registrado"
        }</strong>
        <span class="cofre-estatistica-hint">${resumo.blocks?.plan ? "Abrir" : "Registrar"}</span>
      </button>
      <button class="cofre-estatistica" type="button" data-clinical-goto="anamnese">
        <span class="rotulo-micro">Anamnese</span>
        <strong>${chipAnamnese || escapeHtml(intakeStatus)}</strong>
        <span class="cofre-estatistica-hint">${resumo.intake ? "Abrir" : "Criar agora"}</span>
      </button>
      <button class="cofre-estatistica" type="button" data-clinical-goto="evolucoes">
        <span class="rotulo-micro">Evoluções</span>
        <strong>${escapeHtml(String(evolutionsCount))}</strong>
        <span class="cofre-estatistica-hint">${evolutionsCount ? "Ver todas" : "Registrar a primeira"}</span>
      </button>
      <button class="cofre-estatistica" type="button" data-clinical-goto="documentos">
        <span class="rotulo-micro">Documentos</span>
        <strong>${escapeHtml(String(Number(resumo.documentsCount) || 0))}</strong>
        <span class="cofre-estatistica-hint">${resumo.documentsCount ? "Ver todos" : "Emitir"}</span>
      </button>
      <article class="cofre-estatistica">
        <span class="rotulo-micro">Última evolução</span>
        <strong>${latest ? escapeHtml(formatDate(latest.evolutionDate)) : "—"}</strong>
      </article>
    </div>

    <h2 class="cofre-titulo-secao">Histórico do prontuário</h2>
    <div class="cofre-cartao">
      ${
        timeline
          ? `<ul class="cofre-timeline">${timeline}</ul>`
          : `<p class="field-help" style="margin-top:8px">Nenhum registro ainda. Use os botões acima para começar.</p>`
      }
    </div>
  `;

  atualizarContadoresDoCofre(resumo);
}

// A cadeia do prontuário: contrato, plano, anamnese, primeiro atendimento.
// Antes o próximo passo olhava só a anamnese, e por isso o registro parecia
// começar e terminar nela.
function proximoPassoDoProntuario(resumo) {
  const acao = (rotulo, aba) =>
    `<button class="btn btn-primary btn-compacto" type="button" data-clinical-goto="${aba}">${rotulo}</button>`;

  if (resumo.record?.status === "closed") {
    return {
      titulo: "Prontuário encerrado",
      ajuda:
        "O caso foi encerrado e o registro está em leitura. Reabra o prontuário para retomar o acompanhamento.",
      acoes: `<button class="btn btn-secondary btn-compacto" type="button" data-action="export-clinical-record">Exportar em PDF</button>`
    };
  }

  if (!resumo.blocks?.contract) {
    return {
      titulo: "Registre o contrato",
      ajuda:
        "O que foi combinado e o que foi explicado sobre sigilo abre o acompanhamento. O contrato sai em PDF para assinatura.",
      acoes: acao("Registrar contrato", "contrato")
    };
  }

  if (!resumo.intake) {
    return {
      titulo: "Comece pela anamnese",
      ajuda:
        "A anamnese é o retrato da chegada. Depois dela, registre uma evolução a cada atendimento.",
      acoes: acao("Criar anamnese", "anamnese")
    };
  }

  if (!resumo.blocks?.plan) {
    return {
      titulo: "Defina o plano terapêutico",
      ajuda: "Foco do trabalho e objetivos combinados, revisáveis ao longo do acompanhamento.",
      acoes: acao("Registrar plano", "plano")
    };
  }

  if (!Number(resumo.evolutionsCount)) {
    return {
      titulo: "Registre a primeira evolução",
      ajuda: "Cada atendimento vira uma evolução clínica, com data e conteúdo criptografado.",
      acoes: acao("Nova evolução", "evolucoes")
    };
  }

  return {
    titulo: "Prontuário em andamento",
    ajuda:
      "Registre uma evolução a cada atendimento, revise o plano quando o foco mudar e encerre o caso quando ele terminar.",
    acoes: acao("Nova evolução", "evolucoes")
  };
}

// A linha do tempo mistura blocos, anamnese, evoluções e documentos: cada um
// tem seu próprio conjunto de estados.
function chipDaTimeline(entry) {
  if (entry.type === "document") return "document";
  if (entry.type === "block") return "intake";
  if (entry.type === "evolution") return "evolution";
  return "intake";
}

function rotuloDoEstado(entry) {
  if (entry.type === "document") {
    return entry.status === "revoked" ? "Revogado" : "Emitido";
  }
  if (entry.type === "evolution") {
    return EVOLUTION_STATUS_LABELS[entry.status] || entry.status;
  }
  return BLOCK_STATUS_LABELS[entry.status] || entry.status;
}

const BLOCK_STATUS_LABELS = {
  draft: "Rascunho",
  completed: "Concluído",
  locked: "Bloqueado"
};

function atualizarContadoresDoCofre(resumo) {
  const contadores = {
    "clinical-tab-contrato": resumo.blocks?.contract ? "●" : "",
    "clinical-tab-plano": resumo.blocks?.plan ? "●" : "",
    "clinical-tab-anamnese": resumo.intake ? "●" : "",
    "clinical-tab-evolucoes": Number(resumo.evolutionsCount)
      ? String(resumo.evolutionsCount)
      : "",
    "clinical-tab-documentos": Number(resumo.documentsCount)
      ? String(resumo.documentsCount)
      : ""
  };
  for (const [id, valor] of Object.entries(contadores)) {
    const el = document.getElementById(id);
    if (el) el.textContent = valor;
  }
}

async function loadIntake() {
  if (!state.clinical.patientId) return;
  const response = await apiRequest(`/api/admin/patients/${state.clinical.patientId}/intake`);
  state.clinical.intake = response.data.intake;
  state.clinical.intakeTemplate = response.data.template;
  renderIntake();
}

function getIntakeWorkingPayload() {
  if (state.clinical.intake?.payload) {
    return state.clinical.intake.payload;
  }
  return state.clinical.intakeTemplate || { sections: [] };
}

// Anamnese, contrato e plano usam o mesmo formulário de seções, mas cada um no
// seu container. As funções abaixo leem e escrevem SEMPRE a partir da raiz do
// formulário: com querySelectorAll no documento inteiro, salvar o contrato
// varreria também os campos da anamnese e do plano.
const FORMULARIOS_SECOES = {
  intake: { prefixo: "intake", rotulo: "Anamnese" },
  contract: { prefixo: "contract", rotulo: "Contrato e consentimento" },
  plan: { prefixo: "plan", rotulo: "Plano terapêutico" }
};

function refsFormulario(formKey) {
  const prefixo = FORMULARIOS_SECOES[formKey]?.prefixo || formKey;
  return {
    formKey,
    raiz: document.getElementById(`clinical-${prefixo}-sections`),
    indice: document.getElementById(`clinical-${prefixo}-index`),
    progressoWrap: document.getElementById(`clinical-${prefixo}-progress-wrap`),
    progresso: document.getElementById(`clinical-${prefixo}-progress`),
    progressoBarra: document.getElementById(`clinical-${prefixo}-progress-bar`),
    progressoTexto: document.getElementById(`clinical-${prefixo}-progress-text`),
    status: document.getElementById(`clinical-${prefixo}-status`),
    ajuda: document.getElementById(`clinical-${prefixo}-help`),
    acoes: document.getElementById(`clinical-${prefixo}-actions`)
  };
}

function secaoAtual(formKey) {
  return state.clinical.sectionIndex?.[formKey] || 0;
}

function definirSecaoAtual(formKey, indice) {
  if (!state.clinical.sectionIndex) {
    state.clinical.sectionIndex = {};
  }
  state.clinical.sectionIndex[formKey] = indice;
}

// O formulário montado no DOM é a verdade em edição: a coleta lê dele, não do
// state. Se já existe formulário deste paciente na tela, uma nova renderização
// jogaria fora tudo que foi digitado e ainda não salvo.
function formularioJaRenderizadoParaPacienteAtual(formKey) {
  const { raiz } = refsFormulario(formKey);
  return Boolean(
    raiz &&
      raiz.children.length > 0 &&
      raiz.dataset.patientId === String(state.clinical.patientId || "")
  );
}

function renderIntake() {
  const statusEl = document.getElementById("clinical-intake-status");
  const helpEl = document.getElementById("clinical-intake-help");
  const actionsEl = document.getElementById("clinical-intake-actions");
  const sectionsEl = document.getElementById("clinical-intake-sections");
  const intake = state.clinical.intake;
  const encerrado =
    intake?.recordClosed === true ||
    state.clinical.summary?.record?.status === "closed";
  const editable = intake ? intake.editable : !encerrado;

  statusEl.textContent = intake
    ? `Status: ${intake.statusLabel || intake.status}`
    : "Anamnese ainda não criada";

  // Um rascunho pode ficar não editável por três motivos diferentes — janela
  // vencida, registro concluído e prontuário encerrado —, e dar o motivo
  // errado manda a pessoa para uma saída que não existe.
  const janelaExpirada = Boolean(intake) && intake.status === "draft" && !editable && !encerrado;

  helpEl.textContent = encerrado
    ? "Prontuário encerrado: este registro está em leitura. Reabra o prontuário para retomar."
    : janelaExpirada
      ? "A janela de edição desta anamnese já fechou. Conclua a anamnese para encerrá-la, ou registre o que mudou como evolução."
      : !editable
        ? "Registro concluído ou bloqueado: não pode ser editado diretamente."
        : intake
          ? "Preencha as respostas. Perguntas padrão não podem ser excluídas; você pode adicionar perguntas personalizadas."
          : "Preencha o que já souber e salve — a anamnese é criada como rascunho e pode ser completada depois.";

  const actions = [];
  if (editable) {
    actions.push(
      `<button class="btn btn-primary btn-compacto" type="button" data-action="save-intake">${
        intake ? "Salvar rascunho" : "Criar anamnese"
      }</button>`
    );
    if (intake) {
      actions.push(
        '<button class="btn btn-secondary btn-compacto" type="button" data-action="complete-intake">Concluir</button>',
        '<button class="btn btn-secondary btn-compacto" type="button" data-action="lock-intake">Bloquear</button>'
      );
    }
  } else if (janelaExpirada) {
    // Rascunho fora da janela não pode mais ser editado, mas o servidor ainda
    // aceita concluir e bloquear. Sem estes botões o registro ficava sem saída.
    actions.push(
      '<button class="btn btn-secondary btn-compacto" type="button" data-action="complete-intake">Concluir</button>',
      '<button class="btn btn-secondary btn-compacto" type="button" data-action="lock-intake">Bloquear</button>'
    );
  } else if (intake && intake.status === "completed" && !encerrado) {
    actions.push(
      '<button class="btn btn-secondary btn-compacto" type="button" data-action="lock-intake">Bloquear</button>'
    );
  }
  if (intake) {
    actions.push(
      '<button class="btn btn-secondary btn-compacto" type="button" data-action="export-intake">Exportar PDF</button>'
    );
  }
  actionsEl.innerHTML = actions.join("");

  const payload = getIntakeWorkingPayload();
  const sections = payload.sections || [];

  // São ~26 campos de texto. Para não virar um paredão, mostramos uma seção
  // por vez — mas todas continuam no DOM (apenas ocultas), porque é do DOM que
  // a coleta lê as respostas ao salvar.
  if (secaoAtual("intake") >= sections.length) {
    definirSecaoAtual("intake", 0);
  }
  const atual = secaoAtual("intake");

  sectionsEl.innerHTML = sections
    .map((section, indice) => renderIntakeSection("intake", section, editable, indice !== atual))
    .join("");
  sectionsEl.dataset.patientId = String(state.clinical.patientId || "");

  renderSectionsIndex("intake", sections, atual);
}


// Trocar de seção NUNCA re-renderiza: o DOM guarda as respostas ainda não
// salvas e é dele que a coleta lê. Só alternamos a visibilidade.
function mostrarSecao(formKey, indice) {
  definirSecaoAtual(formKey, indice);
  const refs = refsFormulario(formKey);
  if (!refs.raiz) return;

  refs.raiz.querySelectorAll(".anamnese-secao").forEach((secao, i) => {
    secao.hidden = i !== indice;
  });

  atualizarIndiceSecoes(formKey);
  refs.raiz.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// Recalcula contadores e progresso a partir do DOM, sem tocar nas respostas.
function atualizarIndiceSecoes(formKey) {
  const sections =
    formKey === "intake"
      ? getIntakeWorkingPayload().sections || []
      : getBlockWorkingPayload(formKey).sections || [];
  renderSectionsIndex(formKey, sections, secaoAtual(formKey));
}

// Conta respostas preenchidas por seção lendo o DOM (o que está em tela é a
// verdade em edição), com o payload como origem antes da primeira renderização.
function contarSecao(raiz, section, indice) {
  const secaoEl = raiz ? raiz.querySelectorAll(".anamnese-secao")[indice] : null;
  const itens = (section.items || []).filter((item) => item.hidden !== true);
  const total = itens.length;

  if (!secaoEl) {
    return { preenchidas: itens.filter((item) => String(item.answer || "").trim()).length, total };
  }

  const respostas = Array.from(secaoEl.querySelectorAll(".anamnese-resposta"));
  return { preenchidas: respostas.filter((el) => el.value.trim()).length, total };
}

function renderSectionsIndex(formKey, sections, atual) {
  const refs = refsFormulario(formKey);
  const indiceEl = refs.indice;
  const wrap = refs.progressoWrap;
  const barra = refs.progresso;
  const barraWrap = refs.progressoBarra;
  const texto = refs.progressoTexto;
  if (!indiceEl) return;

  let preenchidasTotal = 0;
  let camposTotal = 0;

  indiceEl.innerHTML = sections
    .map((section, indice) => {
      const { preenchidas, total } = contarSecao(refs.raiz, section, indice);
      preenchidasTotal += preenchidas;
      camposTotal += total;
      return `<button class="anamnese-indice-item${
        indice === atual ? " is-active" : ""
      }" type="button" data-action="go-section" data-form="${formKey}" data-index="${indice}">
        ${indice + 1} · ${escapeHtml(section.title)}
        <span class="anamnese-indice-contador">${preenchidas}/${total}</span>
      </button>`;
    })
    .join("");

  const pct = camposTotal ? Math.round((preenchidasTotal / camposTotal) * 100) : 0;
  wrap.hidden = false;
  barra.style.width = `${pct}%`;
  barraWrap.setAttribute("aria-valuenow", String(pct));
  texto.textContent = `${preenchidasTotal} de ${camposTotal} preenchidas`;
}

function renderIntakeItem(item, editable) {
  const isDefault = Boolean(item.isDefault);
  const isHidden = item.hidden === true;
  const labelMarkup = isDefault
    ? `<span class="anamnese-item-titulo">${escapeHtml(item.label)}</span>`
    : `<input class="anamnese-item-label-input" type="text" value="${escapeHtml(
        item.label || ""
      )}" maxlength="200" placeholder="Pergunta personalizada" ${editable ? "" : "disabled"}>`;

  let actionButton = "";
  if (editable) {
    if (isDefault) {
      // Perguntas padrão não podem ser excluídas, mas podem ser ocultadas.
      actionButton = `<button class="anamnese-item-acao" type="button" data-action="toggle-intake-question">${
        isHidden ? "Reexibir" : "Ocultar"
      }</button>`;
    } else {
      actionButton =
        '<button class="anamnese-item-acao" type="button" data-action="remove-intake-question">Remover</button>';
    }
  }

  const textarea = isHidden
    ? ""
    // maxlength espelha o limite do intakeItemSchema (8000). Sem ele, passar
      // do limite só aparecia como "Dados inválidos." ao salvar a anamnese
      // inteira, sem dizer qual resposta estourou.
    : `<textarea class="anamnese-resposta" rows="2" maxlength="8000" placeholder="Resposta..." ${
        editable ? "" : "disabled"
      }>${escapeHtml(item.answer || "")}</textarea>`;

  return `
    <div class="anamnese-item${isHidden ? " is-hidden" : ""}" data-item-id="${escapeHtml(
    item.id || ""
  )}" data-default="${isDefault ? "true" : "false"}" data-hidden="${
    isHidden ? "true" : "false"
  }" data-label="${escapeHtml(item.label || "")}" data-answer="${escapeHtml(item.answer || "")}">
      <div class="anamnese-item-head">
        ${labelMarkup}
        ${actionButton}
      </div>
      ${textarea}
    </div>
  `;
}

function renderIntakeSection(formKey, section, editable, oculta = false) {
  const items = (section.items || []).map((item) => renderIntakeItem(item, editable)).join("");
  const addButton = editable
    ? `<button class="btn btn-secondary btn-compacto" type="button" data-action="add-question" data-form="${escapeHtml(
        formKey
      )}" data-section="${escapeHtml(section.id)}">＋ Adicionar pergunta</button>`
    : "";
  return `
    <section class="anamnese-secao" ${oculta ? "hidden" : ""} data-section-id="${escapeHtml(
      section.id
    )}" data-section-title="${escapeHtml(section.title)}" data-default="${
    section.isDefault ? "true" : "false"
  }">
      <div class="anamnese-secao-head">
        <h4>${escapeHtml(section.title)}</h4>
        ${addButton}
      </div>
      <div class="anamnese-itens">${items}</div>
    </section>
  `;
}

// O contador zera a cada carregamento da página, então sozinho ele repetia
// ids de perguntas que já existiam na anamnese — e o id repetido fazia a
// pergunta nova sumir ao salvar. Olha o que já está na tela antes de escolher.
function nextCustomQuestionId() {
  const existentes = new Set(
    Array.from(document.querySelectorAll(".anamnese-item")).map((el) => el.dataset.itemId)
  );
  do {
    clinicalCustomCounter += 1;
  } while (existentes.has(`custom_${clinicalCustomCounter}`));
  return `custom_${clinicalCustomCounter}`;
}

function addIntakeQuestion(formKey, sectionId) {
  const { raiz } = refsFormulario(formKey);
  const sectionEl = raiz?.querySelector(
    `.anamnese-secao[data-section-id="${CSS.escape(sectionId)}"] .anamnese-itens`
  );
  if (!sectionEl) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = renderIntakeItem(
    { id: nextCustomQuestionId(), label: "", answer: "", isDefault: false },
    true
  );
  sectionEl.appendChild(wrapper.firstElementChild);
}

function toggleIntakeQuestion(itemEl) {
  if (!itemEl) return;
  const currentlyHidden = itemEl.dataset.hidden === "true";
  const textarea = itemEl.querySelector(".anamnese-resposta");
  const answer = textarea ? textarea.value : itemEl.dataset.answer || "";
  const rebuilt = {
    id: itemEl.dataset.itemId,
    label: itemEl.dataset.label,
    answer,
    isDefault: itemEl.dataset.default === "true",
    hidden: !currentlyHidden
  };
  const wrapper = document.createElement("div");
  wrapper.innerHTML = renderIntakeItem(rebuilt, true);
  itemEl.replaceWith(wrapper.firstElementChild);
}

function collectSectionsPayload(raiz) {
  if (!raiz) {
    return { sections: [] };
  }
  const sections = Array.from(raiz.querySelectorAll(".anamnese-secao")).map(
    (sectionEl) => {
      const items = Array.from(sectionEl.querySelectorAll(".anamnese-item")).map((itemEl) => {
        const isDefault = itemEl.dataset.default === "true";
        const hidden = itemEl.dataset.hidden === "true";
        const labelInput = itemEl.querySelector(".anamnese-item-label-input");
        const label = isDefault ? itemEl.dataset.label : labelInput ? labelInput.value : "";
        const textarea = itemEl.querySelector(".anamnese-resposta");
        // Itens ocultos não renderizam textarea: preserva a resposta via data-answer.
        const answer = textarea ? textarea.value : itemEl.dataset.answer || "";
        return {
          id: itemEl.dataset.itemId,
          label,
          answer,
          isDefault,
          hidden
        };
      });
      return {
        id: sectionEl.dataset.sectionId,
        title: sectionEl.dataset.sectionTitle,
        isDefault: sectionEl.dataset.default === "true",
        items
      };
    }
  );
  return { sections };
}

async function saveIntake() {
  const sectionsEl = document.getElementById("clinical-intake-sections");
  const donoDoFormulario = sectionsEl ? sectionsEl.dataset.patientId : "";
  // Rede de segurança: mesmo que algum caminho deixe o formulário de outro
  // paciente na tela, nada é gravado sob o prontuário errado.
  if (donoDoFormulario !== String(state.clinical.patientId || "")) {
    setStatus(
      "A anamnese aberta não é a deste paciente. Recarregue a aba antes de salvar.",
      "error"
    );
    return;
  }

  const payload = collectSectionsPayload(document.getElementById("clinical-intake-sections"));
  if (state.clinical.intake) {
    await apiRequest(`/api/admin/intakes/${state.clinical.intake.id}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  } else {
    await apiRequest(`/api/admin/patients/${state.clinical.patientId}/intake`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }
  await loadIntake();
  await loadClinicalRecord();
  setStatus("Anamnese salva.", "success");
}

// ── Contrato e plano terapêutico ─────────────────────────────────────────────
function recordId() {
  return state.clinical.summary?.record?.id || null;
}

function getBlockWorkingPayload(formKey) {
  const bloco = state.clinical.blocks?.[formKey];
  if (bloco?.block?.payload) {
    return bloco.block.payload;
  }
  return bloco?.template || { sections: [] };
}

async function loadBlock(formKey) {
  const id = recordId();
  if (!id) return;
  const response = await apiRequest(`/api/admin/clinical-records/${id}/blocks/${formKey}`);

  // Mesma guarda da anamnese: se a resposta chegou depois de a tela já ter
  // trocado de paciente, ela é descartada. Num prontuário, mostrar dado de
  // outra pessoa é o pior defeito possível.
  if (String(response.data.record?.patientId || "") !== String(state.clinical.patientId || "")) {
    return;
  }

  state.clinical.blocks[formKey] = response.data;
  renderBlock(formKey);
}

function renderBlock(formKey) {
  const refs = refsFormulario(formKey);
  if (!refs.raiz) return;

  const dados = state.clinical.blocks?.[formKey];
  const bloco = dados?.block || null;
  const prontuarioAberto = state.clinical.summary?.record?.status !== "closed";
  const editable = bloco ? bloco.editable : prontuarioAberto;
  const rotulo = FORMULARIOS_SECOES[formKey]?.rotulo || formKey;

  refs.status.textContent = bloco
    ? `Situação: ${bloco.statusLabel || bloco.status}`
    : `${rotulo} ainda não registrado`;

  refs.ajuda.textContent = !prontuarioAberto
    ? "Prontuário encerrado: este registro está em leitura. Reabra o prontuário para retomar."
    : !editable
      ? "Registro concluído ou bloqueado: não pode ser editado diretamente."
      : formKey === "contract"
        ? "Registre o que foi combinado e o que foi explicado sobre sigilo. O contrato sai em PDF para assinatura."
        : "O plano muda ao longo do acompanhamento. Revise sempre que o foco do trabalho mudar.";

  const acoes = [];
  if (editable) {
    acoes.push(
      `<button class="btn btn-primary btn-compacto" type="button" data-action="save-block" data-form="${formKey}">${
        bloco ? "Salvar rascunho" : `Criar ${rotulo.toLowerCase()}`
      }</button>`
    );
    if (bloco) {
      acoes.push(
        `<button class="btn btn-secondary btn-compacto" type="button" data-action="complete-block" data-form="${formKey}">Concluir</button>`,
        `<button class="btn btn-secondary btn-compacto" type="button" data-action="lock-block" data-form="${formKey}">Bloquear</button>`
      );
    }
  } else if (bloco && bloco.status === "completed" && prontuarioAberto) {
    acoes.push(
      `<button class="btn btn-secondary btn-compacto" type="button" data-action="lock-block" data-form="${formKey}">Bloquear</button>`
    );
  }
  if (bloco) {
    acoes.push(
      `<button class="btn btn-secondary btn-compacto" type="button" data-action="export-block" data-form="${formKey}">Exportar PDF</button>`
    );
  }
  refs.acoes.innerHTML = acoes.join("");

  const sections = getBlockWorkingPayload(formKey).sections || [];
  if (secaoAtual(formKey) >= sections.length) {
    definirSecaoAtual(formKey, 0);
  }
  const atual = secaoAtual(formKey);

  refs.raiz.innerHTML = sections
    .map((section, indice) => renderIntakeSection(formKey, section, editable, indice !== atual))
    .join("");
  refs.raiz.dataset.patientId = String(state.clinical.patientId || "");

  renderSectionsIndex(formKey, sections, atual);
}

async function saveBlock(formKey) {
  const id = recordId();
  if (!id) return;
  const { raiz } = refsFormulario(formKey);

  // Rede de segurança: mesmo que algum caminho deixe o formulário de outro
  // paciente na tela, nada é gravado sob o prontuário errado.
  if (!raiz || raiz.dataset.patientId !== String(state.clinical.patientId || "")) {
    setStatus(
      "O formulário aberto não é o deste paciente. Recarregue a aba antes de salvar.",
      "error"
    );
    return;
  }

  await apiRequest(`/api/admin/clinical-records/${id}/blocks/${formKey}`, {
    method: "PUT",
    body: JSON.stringify(collectSectionsPayload(raiz))
  });
  await loadBlock(formKey);
  await loadClinicalRecord();
  setStatus(`${FORMULARIOS_SECOES[formKey]?.rotulo || formKey} salvo.`, "success");
}

async function completeBlock(formKey) {
  const id = recordId();
  if (!id) return;
  await apiRequest(`/api/admin/clinical-records/${id}/blocks/${formKey}/complete`, {
    method: "POST"
  });
  await loadBlock(formKey);
  await loadClinicalRecord();
  setStatus("Bloco concluído.", "success");
}

async function lockBlock(formKey) {
  const id = recordId();
  if (!id) return;
  await apiRequest(`/api/admin/clinical-records/${id}/blocks/${formKey}/lock`, { method: "POST" });
  await loadBlock(formKey);
  await loadClinicalRecord();
  setStatus("Bloco bloqueado.", "success");
}

function exportBlock(formKey) {
  const id = recordId();
  if (!id) return;
  window.open(`/api/admin/clinical-records/${id}/blocks/${formKey}/export.pdf`, "_blank");
}

// ── Documentos emitidos ──────────────────────────────────────────────────────
const DOCUMENT_TYPE_LABELS = {
  attendance_declaration: "Declaração de comparecimento",
  psychological_certificate: "Atestado psicológico",
  report: "Relatório psicológico",
  opinion: "Parecer psicológico",
  referral: "Encaminhamento"
};

async function loadDocuments() {
  const id = recordId();
  if (!id) {
    state.clinical.documents = [];
    renderDocuments();
    return;
  }
  const response = await apiRequest(`/api/admin/clinical-records/${id}/documents`);
  state.clinical.documents = response.data || [];
  renderDocuments();
}

function renderDocuments() {
  const lista = document.getElementById("clinical-documents-list");
  const vazio = document.getElementById("clinical-documents-empty");
  if (!lista || !vazio) return;

  const documentos = state.clinical.documents || [];
  lista.innerHTML = documentos
    .map(
      (documento) => `
        <article class="admin-registro${documento.status === "revoked" ? " is-revogado" : ""}">
          <div>
            <div class="admin-registro-titulo">
              ${escapeHtml(documento.documentTypeLabel || DOCUMENT_TYPE_LABELS[documento.documentType] || documento.documentType)}
              <span class="mono">${escapeHtml(documento.documentNumber)}</span>
              ${renderChip("document", documento.status, documento.statusLabel)}
            </div>
            <div class="admin-registro-linha">
              <span>${escapeHtml(formatDate(documento.issuedAt))}</span>
              ${documento.title ? `<span>·</span><span>${escapeHtml(documento.title)}</span>` : ""}
            </div>
            ${
              documento.status === "revoked" && documento.revokeReason
                ? `<div class="admin-registro-linha"><span>Revogado: ${escapeHtml(documento.revokeReason)}</span></div>`
                : ""
            }
          </div>
          <div class="admin-registro-acoes">
            <button class="btn btn-secondary btn-compacto" type="button" data-action="download-document" data-id="${documento.id}">Baixar PDF</button>
            ${
              documento.status === "issued"
                ? `<button class="btn btn-secondary btn-compacto" type="button" data-action="revoke-document" data-id="${documento.id}">Revogar</button>`
                : ""
            }
          </div>
        </article>
      `
    )
    .join("");

  vazio.hidden = documentos.length > 0;
  vazio.innerHTML = `<h3>Nenhum documento emitido</h3>
     <p>Declaração, atestado, relatório, parecer e encaminhamento saem daqui, numerados e em PDF.</p>
     <button class="btn btn-primary btn-compacto" type="button" data-action="new-document">＋ Emitir documento</button>`;

  const contador = document.getElementById("clinical-tab-documentos");
  if (contador) {
    contador.textContent = documentos.length ? String(documentos.length) : "";
  }
}

function openDocumentForm() {
  const form = document.getElementById("clinical-document-form");
  if (!form) return;
  form.reset();
  form.hidden = false;
  form.querySelector('[name="documentType"]').focus();
  form.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function closeDocumentForm() {
  const form = document.getElementById("clinical-document-form");
  if (!form) return;
  form.hidden = true;
  form.reset();
}

async function issueDocument() {
  const id = recordId();
  if (!id) return;
  const form = document.getElementById("clinical-document-form");
  const dados = Object.fromEntries(new FormData(form).entries());

  await apiRequest(`/api/admin/clinical-records/${id}/documents`, {
    method: "POST",
    body: JSON.stringify({
      documentType: dados.documentType,
      title: dados.title || "",
      addressee: dados.addressee || "",
      purpose: dados.purpose || "",
      validUntil: dados.validUntil || "",
      body: dados.body || ""
    })
  });

  closeDocumentForm();
  await loadDocuments();
  await loadClinicalRecord();
  setStatus("Documento emitido.", "success");
}

async function revokeDocument(documentId) {
  const motivo = window.prompt("Por que este documento está sendo revogado?");
  if (motivo === null) return;
  if (!motivo.trim()) {
    setStatus("Informe o motivo da revogação.", "error");
    return;
  }
  await apiRequest(`/api/admin/clinical-documents/${documentId}/revoke`, {
    method: "POST",
    body: JSON.stringify({ reason: motivo.trim() })
  });
  await loadDocuments();
  await loadClinicalRecord();
  setStatus("Documento revogado. O registro continua no prontuário.", "success");
}

// ── Abertura, encerramento e reabertura ──────────────────────────────────────
async function openClinicalRecordForPatient() {
  if (!state.clinical.patientId) return;
  await apiRequest(`/api/admin/patients/${state.clinical.patientId}/clinical-record`, {
    method: "POST"
  });
  await loadClinicalRecord();
  setStatus("Prontuário aberto.", "success");
}

function openCloseRecordDialog() {
  const modal = document.getElementById("clinical-close-modal");
  const form = document.getElementById("clinical-close-form");
  if (!modal || !form) return;
  form.reset();
  modal.showModal();
}

async function confirmCloseRecord() {
  const id = recordId();
  if (!id) return;
  const form = document.getElementById("clinical-close-form");
  const dados = Object.fromEntries(new FormData(form).entries());

  // Os campos do diálogo são exatamente os itens do template de encerramento.
  const items = [
    "synthesis",
    "reached_goals",
    "pending_goals",
    "guidance",
    "referral",
    "return_terms"
  ].map((id) => ({ id, answer: dados[id] || "" }));

  await apiRequest(`/api/admin/clinical-records/${id}/close`, {
    method: "POST",
    body: JSON.stringify({
      closingReason: dados.closingReason,
      sections: [{ id: "closing", items }]
    })
  });

  document.getElementById("clinical-close-modal")?.close();
  descartarAbasDoCofre();
  await loadClinicalRecord();
  await refreshClinicalTab();
  setStatus("Prontuário encerrado.", "success");
}

async function reopenClinicalRecord() {
  const id = recordId();
  if (!id) return;
  const motivo = window.prompt("Por que o prontuário está sendo reaberto?");
  if (motivo === null) return;
  if (motivo.trim().length < 3) {
    setStatus("Explique por que o prontuário está sendo reaberto.", "error");
    return;
  }
  await apiRequest(`/api/admin/clinical-records/${id}/reopen`, {
    method: "POST",
    body: JSON.stringify({ reason: motivo.trim() })
  });
  descartarAbasDoCofre();
  await loadClinicalRecord();
  await refreshClinicalTab();
  setStatus("Prontuário reaberto.", "success");
}

// Encerrar e reabrir mudam o que cada aba permite. As abas já montadas no
// DOM não são re-renderizadas — é assim que rascunho não salvo sobrevive à
// troca de aba —, e por isso seguiam oferecendo Salvar e Concluir num
// prontuário encerrado. Descartar o que está em cache faz cada aba voltar do
// servidor já no estado certo. O rascunho não salvo se perde, e é o correto:
// o servidor recusaria salvá-lo de qualquer forma.
function descartarAbasDoCofre() {
  state.clinical.blocks = {};
  state.clinical.intake = null;
  state.clinical.intakeTemplate = null;
  limparFormulariosDeSecoes();
}

// Depois de encerrar ou reabrir, a aba em que se está precisa refletir o novo
// estado — os botões de edição somem ou voltam.
async function refreshClinicalTab() {
  const tab = state.clinical.tab;
  if (tab === "contrato") await loadBlock("contract");
  else if (tab === "plano") await loadBlock("plan");
  else if (tab === "anamnese") await loadIntake();
  else if (tab === "evolucoes") await loadEvolutions();
  else if (tab === "documentos") await loadDocuments();
}

// Cabeçalho do cofre: número do prontuário, situação e as ações do registro.
function renderRecordHeader() {
  const acoesEl = document.getElementById("clinical-record-actions");
  const faixaEl = document.getElementById("clinical-record-closed-banner");
  const nomeEl = document.getElementById("clinical-patient-name");
  if (!acoesEl) return;

  const record = state.clinical.summary?.record || null;
  const patient = state.clinical.summary?.patient || state.clinical.patient;

  if (nomeEl && patient) {
    nomeEl.innerHTML = `${escapeHtml(patient.fullName)}${
      record
        ? ` <span class="cofre-numero mono">${escapeHtml(record.recordNumber)}</span>${renderChip(
            "record",
            record.status,
            record.statusLabel
          )}`
        : ""
    }`;
  }

  const acoes = [];
  if (!record) {
    acoes.push(
      '<button class="btn btn-primary" type="button" data-action="open-clinical-record">Abrir prontuário</button>'
    );
  } else {
    acoes.push(
      '<button class="btn btn-secondary" type="button" data-action="export-clinical-record">Exportar prontuário em PDF</button>'
    );
    acoes.push(
      record.status === "closed"
        ? '<button class="btn btn-secondary" type="button" data-action="reopen-clinical-record">Reabrir prontuário</button>'
        : '<button class="btn btn-secondary" type="button" data-action="close-clinical-record">Encerrar prontuário</button>'
    );
  }
  acoesEl.innerHTML = acoes.join("");

  if (faixaEl) {
    const encerrado = record && record.status === "closed";
    faixaEl.hidden = !encerrado;
    faixaEl.innerHTML = encerrado
      ? `<span class="glifo" aria-hidden="true">◆</span>
         <span><strong>Prontuário encerrado em ${escapeHtml(
           formatDate(record.closedAt)
         )} — ${escapeHtml(record.closingReasonLabel || "")}.</strong>
         O registro está em leitura. Correções entram como adendo; para retomar o acompanhamento, reabra o prontuário.</span>`
      : "";
  }
}

const EVOLUTION_STATUS_LABELS = {
  draft: "Rascunho",
  signed: "Assinada",
  locked: "Bloqueada",
  amended: "Retificada"
};

async function loadEvolutions() {
  if (!state.clinical.patientId) return;
  const response = await apiRequest(
    `/api/admin/patients/${state.clinical.patientId}/evolutions`
  );
  state.clinical.evolutions = response.data.items;
  renderEvolutions();
}

function buildEvolutionActions(evolution) {
  const actions = [
    `<button class="btn btn-secondary btn-compacto" type="button" data-action="view-evolution" data-id="${evolution.id}">Ver</button>`
  ];
  // Editar depende do status, da janela de tempo E do prontuário estar aberto
  // — o servidor recusa nos três casos, e oferecer o botão só levava a um erro
  // depois de digitar.
  const janelaAberta =
    !evolution.editableUntil || new Date(evolution.editableUntil).getTime() > Date.now();
  const encerrado =
    evolution.recordClosed === true ||
    state.clinical.summary?.record?.status === "closed";

  if (evolution.status === "draft" && !encerrado) {
    if (janelaAberta) {
      actions.push(
        `<button class="btn btn-secondary btn-compacto" type="button" data-action="edit-evolution" data-id="${evolution.id}">Editar</button>`
      );
    }
    actions.push(
      `<button class="btn btn-secondary btn-compacto" type="button" data-action="sign-evolution" data-id="${evolution.id}">Assinar</button>`
    );
  }
  if (evolution.status !== "locked") {
    actions.push(
      `<button class="btn btn-secondary btn-compacto" type="button" data-action="addendum-evolution" data-id="${evolution.id}">Adendo</button>`,
      `<button class="btn btn-secondary btn-compacto" type="button" data-action="lock-evolution" data-id="${evolution.id}">Bloquear</button>`
    );
  }
  actions.push(
    `<button class="btn btn-secondary btn-compacto" type="button" data-action="export-evolution" data-id="${evolution.id}">PDF</button>`
  );
  return actions.join("");
}

function renderEvolutions() {
  const list = document.getElementById("clinical-evolutions-list");
  const empty = document.getElementById("clinical-evolutions-empty");
  const items = state.clinical.evolutions || [];

  empty.hidden = items.length > 0;
  empty.innerHTML = `<h3>Nenhuma evolução registrada</h3>
    <p>Cada atendimento vira um registro clínico com data, tipo e conteúdo criptografado.</p>
    <button class="btn btn-primary btn-compacto" type="button" data-action="new-evolution">＋ Nova evolução</button>`;

  // Adendos apontam para o registro que corrigem, e o original mostra que foi
  // corrigido — a relação precisa estar visível nos dois sentidos.
  const porId = new Map(items.map((item) => [item.id, item]));
  const adendoDe = new Map();
  items.forEach((item) => {
    if (item.parentEvolutionId) adendoDe.set(item.parentEvolutionId, item);
  });

  list.innerHTML = items
    .map((evolution) => {
      const pai = evolution.parentEvolutionId ? porId.get(evolution.parentEvolutionId) : null;
      const correcao = adendoDe.get(evolution.id);
      const notas = [];
      if (evolution.parentEvolutionId) {
        notas.push(
          `↳ retifica a evolução de ${escapeHtml(
            pai ? formatDate(pai.evolutionDate) : `#${evolution.parentEvolutionId}`
          )}`
        );
      }
      if (correcao) {
        notas.push(`corrigida pelo adendo de ${escapeHtml(formatDate(correcao.evolutionDate))}`);
      }

      return `
        <article class="evolucao is-${escapeHtml(evolution.status)}">
          <div class="evolucao-corpo">
            <div class="evolucao-quando">${escapeHtml(formatDateTime(evolution.evolutionDate))}</div>
            <div class="evolucao-titulo">
              ${escapeHtml(evolution.evolutionTypeLabel || evolution.evolutionType)}
              ${evolution.title ? `· ${escapeHtml(evolution.title)}` : ""}
              ${renderChip(
                "evolution",
                evolution.status,
                evolution.statusLabel || EVOLUTION_STATUS_LABELS[evolution.status] || evolution.status
              )}
            </div>
            ${
              evolution.sessionId
                ? `<div class="evolucao-vinculo"><span>sessão vinculada #${escapeHtml(
                    String(evolution.sessionId)
                  )}</span></div>`
                : ""
            }
            ${
              evolution.status === "draft" && evolution.editableUntil
                ? `<div class="evolucao-vinculo"><span class="evolucao-janela">◐ janela de edição aberta até ${escapeHtml(
                    formatDataHora(evolution.editableUntil)
                  )}</span></div>`
                : ""
            }
            ${notas.length ? `<div class="evolucao-nota">${notas.join(" · ")}</div>` : ""}
          </div>
          <div class="admin-registro-acoes">${buildEvolutionActions(evolution)}</div>
        </article>
      `;
    })
    .join("");
}

async function populateEvolutionSessionSelect(selectedSessionId) {
  const select = document.querySelector("#clinical-evolution-form select[name=\"sessionId\"]");
  if (!select) return;
  let sessions = [];
  try {
    const response = await apiRequest(
      `/api/admin/sessions?patientId=${state.clinical.patientId}`
    );
    sessions = response.data.items || [];
  } catch (error) {
    sessions = [];
  }
  select.innerHTML =
    '<option value="">Sem sessão vinculada</option>' +
    sessions
      .map(
        (session) =>
          `<option value="${session.id}">${escapeHtml(
            formatDateTime(session.scheduledAt)
          )} · ${escapeHtml(formatCurrency(session.price))}</option>`
      )
      .join("");
  if (selectedSessionId) {
    select.value = String(selectedSessionId);
  }
}

function setEvolutionFormFeedback(message) {
  const feedback = document.querySelector("#clinical-evolution-form .form-feedback");
  if (!feedback) return;
  feedback.textContent = message || "";
  feedback.hidden = !message;
}

async function openEvolutionForm({ mode, evolutionId }) {
  const form = document.getElementById("clinical-evolution-form");
  form.reset();
  setEvolutionFormFeedback("");
  form.dataset.mode = mode;
  form.elements.id.value = "";
  form.elements.parentId.value = "";
  const typeField = form.elements.evolutionType;
  const sessionField = form.elements.sessionId;
  const dateField = form.elements.evolutionDate;

  if (mode === "create") {
    await populateEvolutionSessionSelect("");
    dateField.value = formatDateTimeInputValue(new Date().toISOString());
    typeField.disabled = false;
    sessionField.disabled = false;
    dateField.disabled = false;
  } else if (mode === "edit") {
    const response = await apiRequest(`/api/admin/evolutions/${evolutionId}`);
    const detail = response.data;
    await populateEvolutionSessionSelect(detail.sessionId || "");
    form.elements.id.value = detail.id;
    typeField.value = detail.evolutionType;
    dateField.value = formatDateTimeInputValue(detail.evolutionDate);
    form.elements.title.value = detail.title || "";
    form.elements.content.value = detail.content || "";
    typeField.disabled = false;
    sessionField.disabled = false;
    dateField.disabled = false;
  } else if (mode === "addendum") {
    form.elements.parentId.value = evolutionId;
    typeField.value = "session";
    typeField.disabled = true;
    sessionField.disabled = true;
    dateField.disabled = true;
    setEvolutionFormFeedback(
      "Adendo/retificação: o registro original será marcado como retificado e mantido intacto."
    );
  }

  form.hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function hideEvolutionForm() {
  const form = document.getElementById("clinical-evolution-form");
  form.hidden = true;
  form.reset();
  setEvolutionFormFeedback("");
}

async function submitEvolutionForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const mode = form.dataset.mode || "create";
  const content = form.elements.content.value;
  const title = form.elements.title.value;

  try {
    if (mode === "addendum") {
      const parentId = form.elements.parentId.value;
      if (!content.trim()) {
        setEvolutionFormFeedback("Informe o conteúdo do adendo/retificação.");
        return;
      }
      await apiRequest(`/api/admin/evolutions/${parentId}/addendum`, {
        method: "POST",
        body: JSON.stringify({ content, title, evolutionType: "addendum" })
      });
      setStatus("Adendo/retificação registrado.", "success");
    } else if (mode === "edit") {
      const id = form.elements.id.value;
      await apiRequest(`/api/admin/evolutions/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          content,
          title,
          sessionId: form.elements.sessionId.value || "",
          evolutionType: form.elements.evolutionType.value,
          // Valor cru: quem interpreta o fuso é o servidor, no fuso da clínica.
          evolutionDate: form.elements.evolutionDate.value || ""
        })
      });
      setStatus("Evolução atualizada.", "success");
    } else {
      await apiRequest("/api/admin/evolutions", {
        method: "POST",
        body: JSON.stringify({
          patientId: state.clinical.patientId,
          sessionId: form.elements.sessionId.value || "",
          evolutionType: form.elements.evolutionType.value,
          title,
          // Valor cru: quem interpreta o fuso é o servidor, no fuso da clínica.
          evolutionDate: form.elements.evolutionDate.value || "",
          content
        })
      });
      setStatus("Evolução criada.", "success");
    }
    hideEvolutionForm();
    await loadEvolutions();
    await loadClinicalRecord();
  } catch (error) {
    setEvolutionFormFeedback(error.message);
  }
}

const clinicalEvolutionModal = document.getElementById("clinical-evolution-modal");

async function openEvolutionModal(evolutionId) {
  const response = await apiRequest(`/api/admin/evolutions/${evolutionId}`);
  const detail = response.data;
  document.getElementById("clinical-evolution-modal-eyebrow").textContent =
    detail.evolutionTypeLabel || detail.evolutionType;
  document.getElementById("clinical-evolution-modal-title").textContent =
    detail.title || formatDateTime(detail.evolutionDate);
  document.getElementById("clinical-evolution-modal-status").textContent =
    EVOLUTION_STATUS_LABELS[detail.status] || detail.status;
  document.getElementById("clinical-evolution-modal-content").textContent = detail.content || "—";
  document.getElementById("clinical-evolution-modal-actions").innerHTML =
    buildEvolutionActions(detail);
  if (typeof clinicalEvolutionModal.showModal === "function") {
    clinicalEvolutionModal.showModal();
  }
}

function closeEvolutionModal() {
  if (clinicalEvolutionModal?.open) {
    clinicalEvolutionModal.close();
  }
}

// Os atalhos do resumo (cartões e botões de próximo passo) levam à aba.
document.addEventListener("click", (event) => {
  const atalho = event.target.closest?.("[data-clinical-goto]");
  if (!atalho) return;
  switchClinicalTab(atalho.dataset.clinicalGoto).catch((error) =>
    setStatus(error.message, "error")
  );
});

document.querySelectorAll("[data-clinical-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    switchClinicalTab(button.dataset.clinicalTab).catch((error) => setStatus(error.message, "error"));
  });
});

document
  .getElementById("clinical-evolution-form")
  .addEventListener("submit", submitEvolutionForm);

document
  .getElementById("clinical-document-form")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await issueDocument();
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
// ── End prontuário clínico ───────────────────────────────────────────────────

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
