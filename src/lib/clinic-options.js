const LEAD_SOURCES = ["site", "instagram", "indicacao", "whatsapp", "outro"];
const LEAD_INTERESTS = [
  "adulto",
  "adolescente",
  "jovem_adulto",
  "responsavel_adolescente",
  "outro"
];
const LEAD_STATUSES = [
  "novo",
  "contato_realizado",
  "conversa_agendada",
  "aguardando_retorno",
  "virou_paciente",
  "perdido"
];
const LEAD_PREFERRED_PERIODS = ["manha", "tarde", "noite", "sabado", "flexivel"];

const PATIENT_TYPES = ["adulto", "adolescente", "jovem_adulto"];
const PATIENT_MODALITIES = ["online", "presencial", "hibrido"];
const PATIENT_STATUSES = ["ativo", "pausado", "encerrado"];
const WEEKDAY_OPTIONS = [
  "segunda",
  "terca",
  "quarta",
  "quinta",
  "sexta",
  "sabado",
  "domingo"
];

const SESSION_STATUSES = ["agendada", "realizada", "falta", "cancelada", "remarcada"];
const PAYMENT_STATUSES = ["pendente", "pago", "isento", "cancelado"];
const PAYMENT_METHODS = ["pix", "dinheiro", "cartao", "plataforma", "outro"];
const GOOGLE_CALENDAR_SYNC_STATUSES = ["pending", "synced", "failed", "skipped"];

const MESSAGE_TEMPLATE_CATEGORIES = [
  "novo_contato",
  "envio_valor",
  "confirmacao_sessao",
  "lembrete_sessao",
  "reagendamento",
  "cobranca",
  "contrato",
  "adolescente_responsavel",
  "retorno_ferias",
  "outro"
];

const MESSAGE_TEMPLATE_VARIABLES = [
  "{nome}",
  "{primeiro_nome}",
  "{data}",
  "{horario}",
  "{valor}",
  "{link_agendamento}",
  "{link_sessao}",
  "{nome_responsavel}"
];

const OPTION_LABELS = {
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
  weekday: {
    segunda: "Segunda",
    terca: "Terça",
    quarta: "Quarta",
    quinta: "Quinta",
    sexta: "Sexta",
    sabado: "Sábado",
    domingo: "Domingo"
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


// Ações e entidades que o sistema realmente grava na auditoria. Ficam aqui para
// os filtros do painel oferecerem exatamente os valores que a consulta compara
// por igualdade — antes eram caixas de texto livre e nunca casavam.
const AUDIT_ACTIONS = [
  "clinical_evolution_addendum_created",
  "clinical_evolution_created",
  "clinical_evolution_exported",
  "clinical_evolution_locked",
  "clinical_evolution_signed",
  "clinical_evolution_updated",
  "clinical_evolution_viewed",
  "clinical_evolutions_listed",
  "clinical_intake_completed",
  "clinical_intake_created",
  "clinical_intake_exported",
  "clinical_intake_locked",
  "clinical_intake_updated",
  "clinical_intake_viewed",
  "clinical_record_destroyed",
  "clinical_record_exported",
  "clinical_record_viewed",
  "finance_csv_exported",
  "google_calendar_connected",
  "google_calendar_disconnected",
  "google_calendar_failures_reprocessed",
  "google_calendar_retry_session_sync",
  "google_calendar_settings_updated",
  "google_calendar_tested",
  "image_uploaded",
  "lead_converted_to_patient",
  "lead_created",
  "lead_deleted",
  "lead_updated",
  "login_failed",
  "login_succeeded",
  "logout",
  "message_template_created",
  "message_template_deleted",
  "message_template_updated",
  "patient_created",
  "patient_deleted",
  "patient_updated",
  "platform_settings_updated",
  "receipt_downloaded",
  "receipt_generated",
  "session_canceled",
  "session_created",
  "session_deleted",
  "session_marked_done",
  "session_marked_missed",
  "session_payment_marked",
  "site_content_updated"
];

const AUDIT_ENTITY_TYPES = [
  "admin_session",
  "clinical_evolution",
  "clinical_intake",
  "clinical_record",
  "finance",
  "google_calendar",
  "image_upload",
  "lead",
  "message_template",
  "patient",
  "platform_settings",
  "receipt",
  "session",
  "site_content"
];

// Listas do prontuário. Vivem aqui, e não em cada serviço, porque cada uma
// aparece também num CHECK do banco e num schema de validação: com três cópias
// soltas, acrescentar um motivo de encerramento passava a exigir lembrar de
// três lugares. O teste "listas do prontuário não divergem" compara estas
// listas com o SQL das duas migrações.
const RECORD_BLOCK_TYPES = ["contract", "plan", "closing"];

const RECORD_CLOSING_REASONS = [
  "discharge",
  "dropout",
  "referral",
  "professional_change",
  "other"
];

const CLINICAL_DOCUMENT_TYPES = [
  "attendance_declaration",
  "psychological_certificate",
  "report",
  "opinion",
  "referral"
];

module.exports = {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  CLINICAL_DOCUMENT_TYPES,
  RECORD_BLOCK_TYPES,
  RECORD_CLOSING_REASONS,
  LEAD_SOURCES,
  LEAD_INTERESTS,
  LEAD_STATUSES,
  LEAD_PREFERRED_PERIODS,
  PATIENT_TYPES,
  PATIENT_MODALITIES,
  PATIENT_STATUSES,
  WEEKDAY_OPTIONS,
  SESSION_STATUSES,
  PAYMENT_STATUSES,
  PAYMENT_METHODS,
  GOOGLE_CALENDAR_SYNC_STATUSES,
  MESSAGE_TEMPLATE_CATEGORIES,
  MESSAGE_TEMPLATE_VARIABLES,
  OPTION_LABELS
};
