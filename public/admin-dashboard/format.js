export const labelMaps = {
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

export function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number(value || 0));
}

// Fuso da clínica (Brasil). Horários são sempre exibidos/editados neste fuso,
// independentemente do fuso do dispositivo, para evitar deslocamento de horas.
export const CLINIC_TIME_ZONE = "America/Sao_Paulo";

export function formatDate(value) {
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

export function formatDateTime(value) {
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

export function formatDateInputValue(value) {
  if (!value) {
    return "";
  }
  return value.slice(0, 10);
}

export function formatDateTimeInputValue(value) {
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

// A auditoria usa data compacta, sem vírgula: cabe na coluna de largura fixa
// sem quebrar em duas linhas.
// Data e hora separadas por ponto médio, como o protótipo.
export function formatDataHora(value) {
  if (!value) return "—";
  return formatDateTime(value).replace(", ", " · ");
}

export function formatAuditDateTime(value) {
  if (!value) return "—";
  return formatDateTime(value).replace(", ", " ");
}
