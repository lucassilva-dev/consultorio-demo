const DEFAULT_CONTENT = {
  home: {
    eyebrow: "Psicóloga · CRP 00/00000",
    title: "Marina",
    subtitle: "Alves",
    body: "Um espaço de escuta para compreender sua história, seus vínculos e os caminhos que se repetem na sua vida.",
    ctaLabel: "Agendar atendimento",
    ctaUrl: "#agendar",
    imageUrl: "/assets/portrait-placeholder.svg",
    imageAlt: "Retrato de Marina Alves"
  },
  about: {
    eyebrow: "Sobre mim",
    title: "Oi, eu sou a Marina.",
    content: "Sou psicóloga e atuo a partir da abordagem sistêmica, olhando para a pessoa em relação com sua história, seus vínculos, seus contextos e os padrões que atravessam sua forma de sentir, escolher e se relacionar.\n\nMeu trabalho é construir um espaço seguro de escuta, reflexão e elaboração, para que você possa compreender melhor o que vive e encontrar formas mais leves e possíveis de lidar com suas dificuldades.",
    imageUrl: "/assets/portrait-placeholder.svg",
    imageAlt: "Retrato de Marina Alves"
  },
  aboutPanel: {
    eyebrow: "Prática clínica",
    title: "Escuta, contexto e elaboração.",
    note: "Um processo construído no seu tempo, sem fórmulas prontas e com espaço real para compreender o que hoje pesa.",
    item1Label: "Registro",
    item1Value: "CRP 00/00000",
    item2Label: "Abordagem",
    item2Value: "Sistêmica",
    item3Label: "Modalidade",
    item3Value: "Atendimento online",
    item4Label: "Público",
    item4Value: "Adolescentes, jovens adultos e adultos"
  },
  help: {
    eyebrow: "Como posso te ajudar",
    title: "Temas que costumamos caminhar juntas."
  },
  work: {
    eyebrow: "Minha forma de trabalho",
    titlePrefix: "Olhar para o sintoma",
    titleEmphasis: "e",
    titleSuffix: "para o contexto.",
    lead: "A terapia não olha apenas para um sintoma isolado. Ela considera sua história, suas relações, os lugares que você ocupa e os padrões que podem estar se repetindo.",
    body: "A partir disso, construímos juntas um processo de compreensão, cuidado e mudança possível.",
    pillar1Number: "01",
    pillar1Title: "História",
    pillar1Description: "O que você traz e o que ainda pede para ser nomeado, organizado, compreendido.",
    pillar2Number: "02",
    pillar2Title: "Relações",
    pillar2Description: "Os vínculos que te formaram e os que você constrói hoje, em casa, no afeto e no trabalho.",
    pillar3Number: "03",
    pillar3Title: "Sentidos e possibilidades",
    pillar3Description: "Os caminhos possíveis a partir do que você passou a enxergar com mais clareza."
  },
  attendance: {
    eyebrow: "Atendimento",
    titlePrefix: "Atendimento psicológico",
    titleEmphasis: "online.",
    lead: "De qualquer lugar do Brasil. Sem deslocamento, com a continuidade que um processo terapêutico pede.",
    ctaLabel: "Quero agendar uma conversa",
    feature1Title: "Online com horário agendado",
    feature1Description: "Sessões por videochamada com data e hora marcadas, em ambiente reservado.",
    feature2Title: "Adolescentes, jovens adultos e adultos",
    feature2Description: "Atendimento individual, com escuta adequada para cada momento de vida.",
    feature3Title: "Ético, sigiloso e acolhedor",
    feature3Description: "Espaço protegido pelo sigilo profissional, sem julgamento, no seu tempo."
  },
  closing: {
    titlePrefix: "Talvez você não precise dar conta",
    titleEmphasis: "de tudo sozinha.",
    body: "A terapia pode ser um espaço para organizar o que está confuso, nomear o que pesa e construir novas formas de se relacionar consigo e com o mundo.",
    ctaLabel: "Agendar atendimento pelo WhatsApp"
  },
  contact: {
    title: "Fale comigo",
    text: "Se fizer sentido para você, podemos começar por uma conversa inicial para entender sua necessidade e combinar os próximos passos.",
    whatsappNumber: "5531900000000",
    whatsappMessage: "Olá, gostaria de agendar um atendimento.",
    socialLinks: [
      { platform: "whatsapp", label: "WhatsApp", url: "https://wa.me/5531900000000?text=Ol%C3%A1%2C%20gostaria%20de%20agendar%20um%20atendimento." },
      { platform: "instagram", label: "Instagram", url: "https://www.instagram.com/consultorio.demo/" },
      { platform: "email", label: "E-mail", url: "mailto:contato@exemplo.com" }
    ]
  },
  seo: {
    title: "Marina Alves | Psicóloga",
    description: "Atendimento psicológico online com escuta acolhedora e abordagem sistêmica.",
    shareImageUrl: "/assets/portrait-placeholder.svg"
  },
  footer: {
    note: "Este site não substitui atendimento emergencial ou serviços de urgência. Em caso de crise, procure o CVV (188) ou um serviço de emergência local.",
    metaText: "Atendimento online com agendamento prévio."
  }
};

const DEFAULT_HELP_CARDS = [
  {
    sortOrder: 1,
    title: "Ansiedade e sobrecarga emocional",
    description: "Para os momentos em que tudo parece pesar ao mesmo tempo e o corpo pede uma pausa.",
    assetType: "icon",
    assetValue: "wind"
  },
  {
    sortOrder: 2,
    title: "Relacionamentos e vínculos",
    description: "Para olhar como você ama, escolhe e se posiciona com as pessoas ao seu redor.",
    assetType: "icon",
    assetValue: "users-round"
  },
  {
    sortOrder: 3,
    title: "Autoestima e autoconhecimento",
    description: "Para entender de onde vêm suas escolhas e construir uma relação mais inteira consigo.",
    assetType: "icon",
    assetValue: "circle-dot"
  },
  {
    sortOrder: 4,
    title: "Sexualidade e saúde emocional da mulher",
    description: "Um espaço para falar do que costuma ficar em silêncio, sem julgamento.",
    assetType: "icon",
    assetValue: "flower-2"
  },
  {
    sortOrder: 5,
    title: "Transições de vida e escolhas difíceis",
    description: "Para travessias, fim de ciclo, mudança ou decisão que pedem um lugar de pensar.",
    assetType: "icon",
    assetValue: "compass"
  },
  {
    sortOrder: 6,
    title: "Adolescência e juventude",
    description: "Acompanhamento para quem está construindo identidade, vínculos e direção.",
    assetType: "icon",
    assetValue: "sun"
  }
];

module.exports = {
  DEFAULT_CONTENT,
  DEFAULT_HELP_CARDS
};
