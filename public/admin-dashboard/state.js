export const state = {
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
