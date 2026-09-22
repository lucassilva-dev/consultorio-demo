const DEFAULT_PLATFORM_SETTINGS = {
  schedulingUrl: "",
  schedulingLabel: "Agendar conversa inicial",
  meetingDefaultUrl: "",
  cancellationPolicyText:
    "Remarcações e cancelamentos devem ser combinados com antecedência.",
  showSchedulingButton: false,
  professionalName: "Marina Alves",
  crp: "00/00000",
  professionalDocument: "",
  receiptCity: "",
  receiptFooterText:
    "Este recibo não substitui nota fiscal nem documento fiscal equivalente.",
  googleCalendarEnabled: false,
  googleCalendarId: "primary",
  googleCalendarCreateMeet: false,
  googleCalendarReminderMinutes: 1440,
  googleCalendarSendUpdates: false
};

const DEFAULT_MESSAGE_TEMPLATES = [
  {
    title: "Primeiro retorno para interessado",
    category: "novo_contato",
    body:
      "Olá, {nome}. Recebi sua mensagem e agradeço o contato. Posso te passar as informações iniciais e entender qual é a sua necessidade neste momento.",
    isActive: true
  },
  {
    title: "Envio de valor da sessão",
    category: "envio_valor",
    body:
      "Olá, {nome}. O valor da sessão é {valor}. Se fizer sentido para você, podemos alinhar um horário para a conversa inicial.",
    isActive: true
  },
  {
    title: "Confirmação de sessão",
    category: "confirmacao_sessao",
    body:
      "Olá, {primeiro_nome}. Confirmando nossa sessão em {data}, às {horario}. Se precisar, este é o link de acesso: {link_sessao}.",
    isActive: true
  },
  {
    title: "Lembrete de sessão",
    category: "lembrete_sessao",
    body:
      "Olá, {primeiro_nome}. Passando para lembrar da sua sessão em {data}, às {horario}.",
    isActive: true
  },
  {
    title: "Cobrança educada",
    category: "cobranca",
    body:
      "Olá, {primeiro_nome}. Fiquei com o pagamento da sessão pendente por aqui. Quando puder, me avise após realizar o envio.",
    isActive: true
  },
  {
    title: "Mensagem para responsável de adolescente",
    category: "adolescente_responsavel",
    body:
      "Olá, {nome_responsavel}. Estou entrando em contato para alinhar as informações iniciais sobre o atendimento do adolescente e combinar os próximos passos.",
    isActive: true
  }
];

module.exports = {
  DEFAULT_PLATFORM_SETTINGS,
  DEFAULT_MESSAGE_TEMPLATES
};
