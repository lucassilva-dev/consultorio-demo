const { z } = require("zod");

// O produto é PT-BR por diretriz de marca, mas as mensagens padrão do zod
// chegavam em inglês na tela ("String must contain at least 2 character(s)").
// Este mapa cobre o caso genérico; mensagens específicas continuam valendo.
z.setErrorMap((issue, ctx) => {
  if (issue.code === z.ZodIssueCode.invalid_type) {
    if (issue.received === "undefined" || issue.received === "null") {
      return { message: "Campo obrigatório." };
    }
    return { message: "Formato inválido." };
  }

  if (issue.code === z.ZodIssueCode.too_small) {
    if (issue.type === "string") {
      return {
        message:
          issue.minimum === 1
            ? "Campo obrigatório."
            : `Informe ao menos ${issue.minimum} caracteres.`
      };
    }
    return { message: `Valor mínimo: ${issue.minimum}.` };
  }

  if (issue.code === z.ZodIssueCode.too_big) {
    if (issue.type === "string") {
      return { message: `Use no máximo ${issue.maximum} caracteres.` };
    }
    return { message: `Valor máximo: ${issue.maximum}.` };
  }

  if (issue.code === z.ZodIssueCode.invalid_enum_value) {
    return { message: "Opção inválida." };
  }

  if (issue.code === z.ZodIssueCode.invalid_string) {
    return { message: "Formato inválido." };
  }

  return { message: ctx.defaultError };
});
const { AppError } = require("./errors");
const { isSafeImagePath, isSafeLink, normalizeWhatsappNumber } = require("./urls");
const { normalizeDateTimeToIso } = require("./clinic-time");
const {
  LEAD_INTERESTS,
  LEAD_PREFERRED_PERIODS,
  LEAD_SOURCES,
  LEAD_STATUSES,
  MESSAGE_TEMPLATE_CATEGORIES,
  MESSAGE_TEMPLATE_VARIABLES,
  PATIENT_MODALITIES,
  PATIENT_STATUSES,
  PATIENT_TYPES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  SESSION_STATUSES,
  WEEKDAY_OPTIONS,
  RECORD_BLOCK_TYPES,
  RECORD_CLOSING_REASONS,
  CLINICAL_DOCUMENT_TYPES
} = require("./clinic-options");

const EVOLUTION_TYPES = [
  "session",
  "initial",
  "guardian_contact",
  "referral",
  "closing",
  "addendum",
  "correction",
  "other"
];


function safeImagePathSchema(fieldLabel, runtimeConfig) {
  return z
    .string()
    .min(1, `${fieldLabel} é obrigatório.`)
    .refine(
      (value) =>
        isSafeImagePath(value, {
          externalImagePrefixes: runtimeConfig.allowedExternalImagePrefixes
        }),
      `${fieldLabel} deve apontar para uma imagem permitida.`
    );
}

function safeLinkSchema(fieldLabel) {
  return z
    .string()
    .trim()
    .refine(isSafeLink, `${fieldLabel} deve ser um link válido, relativo ou âncora.`);
}

function optionalLinkSchema(fieldLabel) {
  return z
    .string()
    .trim()
    .refine((value) => !value || isSafeLink(value), `${fieldLabel} deve ser um link válido.`);
}

function optionalEmailSchema(fieldLabel) {
  return z
    .string()
    .trim()
    .max(160)
    .refine(
      (value) => !value || z.string().email().safeParse(value).success,
      `${fieldLabel} deve ser um e-mail válido.`
    );
}

function optionalIntegerSchema(fieldLabel, { min = 0, max = 150 } = {}) {
  return z
    .union([z.string(), z.number(), z.null(), z.undefined()])
    .transform((value) => {
      if (value === "" || value === null || typeof value === "undefined") {
        return null;
      }

      return Number(value);
    })
    .refine(
      (value) => value === null || (Number.isInteger(value) && value >= min && value <= max),
      `${fieldLabel} deve ser um número inteiro válido.`
    );
}

// Valor monetário com no máximo dois decimais. A coluna é REAL no SQLite e
// NUMERIC(10,2) no Postgres: sem arredondar aqui, o mesmo 180.005 era gravado
// como 180.005 em desenvolvimento e 180.01 em produção.
function moneySchema(fieldLabel) {
  return z
    .union([z.string(), z.number()])
    .transform((value) => Number(value))
    .refine(
      (value) => Number.isFinite(value) && value >= 0 && value <= 99999,
      `${fieldLabel} deve ser um valor válido.`
    )
    .transform((value) => Math.round(value * 100) / 100);
}

function optionalDateSchema(fieldLabel) {
  return z
    .string()
    .trim()
    .refine(
      (value) =>
        !value ||
        (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
          !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))),
      `${fieldLabel} deve estar no formato YYYY-MM-DD.`
    );
}

function optionalTimeSchema(fieldLabel) {
  return z
    .string()
    .trim()
    .refine(
      (value) => !value || /^([01]\d|2[0-3]):([0-5]\d)$/.test(value),
      `${fieldLabel} deve estar no formato HH:MM.`
    );
}

function requiredDateTimeSchema(fieldLabel) {
  return z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(Date.parse(value)), `${fieldLabel} deve ser uma data válida.`)
    .transform((value) => normalizeDateTimeToIso(value));
}

function optionalDateTimeSchema(fieldLabel) {
  return z
    .string()
    .trim()
    .refine(
      (value) => !value || !Number.isNaN(Date.parse(value)),
      `${fieldLabel} deve ser uma data válida.`
    )
    .transform((value) => (value ? normalizeDateTimeToIso(value) : ""));
}

function booleanInputSchema() {
  return z
    .union([z.boolean(), z.string(), z.number()])
    .transform((value) => {
      if (typeof value === "boolean") {
        return value;
      }
      if (typeof value === "number") {
        return value === 1;
      }
      return value === "true" || value === "1" || value === "on";
    });
}

function hasOnlyAllowedTemplateVariables(body) {
  const matches = body.match(/\{[^}]+\}/g) || [];
  return matches.every((token) => MESSAGE_TEMPLATE_VARIABLES.includes(token));
}

function buildSchemas(runtimeConfig) {
  const homeSchema = z.object({
    eyebrow: z.string().min(2).max(80),
    title: z.string().min(2).max(80),
    subtitle: z.string().min(2).max(80),
    body: z.string().min(20).max(600),
    ctaLabel: z.string().min(2).max(80),
    ctaUrl: safeLinkSchema("CTA da home"),
    imageUrl: safeImagePathSchema("Imagem principal", runtimeConfig),
    imageAlt: z.string().min(2).max(140)
  });

  const aboutSchema = z.object({
    eyebrow: z.string().min(2).max(80),
    title: z.string().min(2).max(120),
    content: z.string().min(30).max(2500)
  });

  const aboutPanelSchema = z.object({
    eyebrow: z.string().min(2).max(80),
    title: z.string().min(2).max(120),
    note: z.string().min(10).max(400),
    item1Label: z.string().min(2).max(40),
    item1Value: z.string().min(2).max(140),
    item2Label: z.string().min(2).max(40),
    item2Value: z.string().min(2).max(140),
    item3Label: z.string().min(2).max(40),
    item3Value: z.string().min(2).max(140),
    item4Label: z.string().min(2).max(40),
    item4Value: z.string().min(2).max(140)
  });

  const helpCardSchema = z
    .object({
      title: z.string().min(2).max(120),
      description: z.string().min(10).max(300),
      assetType: z.enum(["icon", "image"]),
      assetValue: z.string().min(1).max(255),
      sortOrder: z.number().int().min(1).max(99)
    })
    .superRefine((card, ctx) => {
      if (card.assetType === "icon" && !runtimeConfig.allowedHelpIcons.includes(card.assetValue)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Ícone inválido para card.",
          path: ["assetValue"]
        });
      }

      // Precisa das mesmas prefixes externas que safeImagePathSchema usa: sem
      // elas, a URL do Supabase devolvida pelo upload é rejeitada, e em
      // produção não há como salvar um card com imagem.
      if (
        card.assetType === "image" &&
        !isSafeImagePath(card.assetValue, {
          externalImagePrefixes: runtimeConfig.allowedExternalImagePrefixes
        })
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Imagem inválida para card.",
          path: ["assetValue"]
        });
      }
    });

  const helpSchema = z.object({
    eyebrow: z.string().min(2).max(80),
    title: z.string().min(2).max(120),
    cards: z.array(helpCardSchema).min(1).max(12)
  });

  const socialLinkSchema = z.object({
    platform: z.string().min(2).max(24),
    label: z.string().min(2).max(60),
    url: safeLinkSchema("Link social")
  });

  const contactSchema = z.object({
    title: z.string().min(2).max(80),
    text: z.string().min(10).max(1000),
    whatsappNumber: z
      .string()
      .transform(normalizeWhatsappNumber)
      .refine((value) => value === "" || (value.length >= 10 && value.length <= 15), {
        message: "Número de WhatsApp inválido."
      }),
    whatsappMessage: z.string().min(5).max(300),
    socialLinks: z.array(socialLinkSchema).max(6)
  });

  const seoSchema = z.object({
    title: z.string().min(5).max(70),
    description: z.string().min(20).max(180),
    shareImageUrl: safeImagePathSchema("Imagem de compartilhamento", runtimeConfig)
  });

  const workSchema = z.object({
    eyebrow: z.string().min(2).max(80),
    titlePrefix: z.string().min(2).max(80),
    titleEmphasis: z.string().min(1).max(40),
    titleSuffix: z.string().min(2).max(80),
    lead: z.string().min(20).max(500),
    body: z.string().min(20).max(500),
    pillar1Number: z.string().min(1).max(8),
    pillar1Title: z.string().min(2).max(80),
    pillar1Description: z.string().min(10).max(240),
    pillar2Number: z.string().min(1).max(8),
    pillar2Title: z.string().min(2).max(80),
    pillar2Description: z.string().min(10).max(240),
    pillar3Number: z.string().min(1).max(8),
    pillar3Title: z.string().min(2).max(80),
    pillar3Description: z.string().min(10).max(240)
  });

  const attendanceSchema = z.object({
    eyebrow: z.string().min(2).max(80),
    titlePrefix: z.string().min(2).max(80),
    titleEmphasis: z.string().min(2).max(40),
    lead: z.string().min(20).max(400),
    ctaLabel: z.string().min(2).max(80),
    feature1Title: z.string().min(2).max(120),
    feature1Description: z.string().min(10).max(240),
    feature2Title: z.string().min(2).max(120),
    feature2Description: z.string().min(10).max(240),
    feature3Title: z.string().min(2).max(120),
    feature3Description: z.string().min(10).max(240)
  });

  const closingSchema = z.object({
    titlePrefix: z.string().min(2).max(120),
    titleEmphasis: z.string().min(2).max(120),
    body: z.string().min(20).max(500),
    ctaLabel: z.string().min(2).max(80)
  });

  const footerSchema = z.object({
    note: z.string().min(20).max(400),
    metaText: z.string().min(2).max(120)
  });

  const loginSchema = z.object({
    email: z.string().email().max(160),
    password: z.string().min(8).max(256)
  });

  const leadSchema = z.object({
    name: z.string().min(2).max(120),
    phone: z.string().min(8).max(30),
    email: optionalEmailSchema("E-mail"),
    age: optionalIntegerSchema("Idade", { min: 0, max: 120 }),
    source: z.enum(LEAD_SOURCES),
    interest: z.enum(LEAD_INTERESTS),
    status: z.enum(LEAD_STATUSES),
    preferredPeriod: z.enum(LEAD_PREFERRED_PERIODS),
    administrativeNote: z.string().max(400)
  });

  const patientSchema = z
    .object({
      fullName: z.string().min(2).max(140),
      preferredName: z.string().max(80),
      birthDate: optionalDateSchema("Data de nascimento"),
      age: optionalIntegerSchema("Idade", { min: 0, max: 120 }),
      phone: z.string().max(30).refine(
        (v) => !v || v.length >= 8,
        "Telefone deve ter ao menos 8 caracteres."
      ),
      email: optionalEmailSchema("E-mail"),
      patientType: z.enum(PATIENT_TYPES),
      guardianName: z.string().max(120),
      guardianPhone: z.string().max(30).refine(
        (v) => !v || v.length >= 8,
        "Telefone do responsável deve ter ao menos 8 caracteres."
      ),
      sessionPrice: moneySchema("Valor da sessão"),
      defaultWeekday: z.enum(["", ...WEEKDAY_OPTIONS]),
      defaultTime: optionalTimeSchema("Horário padrão"),
      modality: z.enum(PATIENT_MODALITIES),
      status: z.enum(PATIENT_STATUSES),
      administrativeNote: z.string().max(400)
    })
    .superRefine((value, ctx) => {
      if (value.patientType === "adolescente") {
        if (!value.guardianName) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Informe o nome do responsável para paciente adolescente.",
            path: ["guardianName"]
          });
        }

        if (!value.guardianPhone) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Informe o telefone do responsável para paciente adolescente.",
            path: ["guardianPhone"]
          });
        }
      }
    });

  const sessionSchema = z.object({
    patientId: z.coerce.number().int().positive(),
    scheduledAt: requiredDateTimeSchema("Data da sessão"),
    durationMinutes: z.coerce.number().int().min(30).max(240),
    status: z.enum(SESSION_STATUSES),
    paymentStatus: z.enum(PAYMENT_STATUSES),
    price: moneySchema("Valor da sessão"),
    paymentMethod: z.enum(PAYMENT_METHODS),
    paidAt: optionalDateTimeSchema("Data de pagamento"),
    meetingUrl: optionalLinkSchema("Link da sessão"),
    administrativeNote: z.string().max(400)
  });

  const sessionPaymentSchema = z.object({
    // Opcional de propósito: quando não vem, a forma de pagamento já
    // registrada na sessão é preservada em vez de virar Pix.
    paymentMethod: z.enum(PAYMENT_METHODS).optional(),
    paidAt: optionalDateTimeSchema("Data de pagamento")
  });

  const messageTemplateSchema = z.object({
    title: z.string().min(2).max(120),
    category: z.enum(MESSAGE_TEMPLATE_CATEGORIES),
    body: z
      .string()
      .min(20)
      .max(2500)
      .refine(
        hasOnlyAllowedTemplateVariables,
        "O modelo usa variáveis não permitidas."
      ),
    isActive: booleanInputSchema()
  });

  const optionalRecordIdSchema = z
    .union([z.string(), z.number(), z.null(), z.undefined()])
    .transform((value) => {
      if (value === "" || value === null || typeof value === "undefined") {
        return null;
      }
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    });

  const intakeItemSchema = z.object({
    id: z.string().max(80).optional(),
    label: z.string().max(200).optional(),
    answer: z.string().max(8000).optional(),
    isDefault: z.boolean().optional(),
    hidden: z.boolean().optional()
  });

  const intakeSectionSchema = z.object({
    id: z.string().max(80).optional(),
    title: z.string().max(160).optional(),
    isDefault: z.boolean().optional(),
    items: z.array(intakeItemSchema).max(80).optional()
  });

  const intakePayloadSchema = z.object({
    sections: z.array(intakeSectionSchema).max(40)
  });

  // Contrato, plano e encerramento têm o mesmo formato da anamnese, então
  // reaproveitam a validação de seções.
  const recordBlockPayloadSchema = z.object({
    sections: z.array(intakeSectionSchema).max(40),
    changeReason: z.string().max(300).optional().default("")
  });

  const recordCloseSchema = z.object({
    closingReason: z.enum(RECORD_CLOSING_REASONS),
    sections: z.array(intakeSectionSchema).max(40).optional().default([])
  });

  const recordReopenSchema = z.object({
    reason: z.string().min(3, "Explique por que o prontuário está sendo reaberto.").max(300)
  });

  const clinicalDocumentSchema = z.object({
    documentType: z.enum(CLINICAL_DOCUMENT_TYPES),
    title: z.string().max(160).optional().default(""),
    addressee: z.string().max(200).optional().default(""),
    purpose: z.string().max(500).optional().default(""),
    validUntil: z.string().max(80).optional().default(""),
    body: z.string().min(1, "Informe o conteúdo do documento.").max(20000)
  });

  const documentRevokeSchema = z.object({
    reason: z.string().min(3, "Informe o motivo da revogação.").max(500)
  });

  const evolutionCreateSchema = z.object({
    patientId: z.coerce.number().int().positive(),
    sessionId: optionalRecordIdSchema,
    evolutionDate: z.string().trim().max(40).optional().default(""),
    evolutionType: z.enum(EVOLUTION_TYPES).optional().default("session"),
    title: z.string().max(160).optional().default(""),
    content: z.string().max(20000).optional().default("")
  });

  const evolutionUpdateSchema = z.object({
    evolutionDate: z.string().trim().max(40).optional().default(""),
    // O formulário deixa trocar a sessão vinculada; o schema precisa aceitar,
    // senão a troca some antes mesmo de chegar ao serviço.
    sessionId: optionalRecordIdSchema.optional(),
    evolutionType: z.enum(EVOLUTION_TYPES).optional(),
    title: z.string().max(160).optional(),
    content: z.string().max(20000).optional()
  });

  const evolutionAddendumSchema = z.object({
    evolutionType: z.enum(["addendum", "correction"]).optional().default("addendum"),
    title: z.string().max(160).optional().default(""),
    content: z.string().min(1, "Informe o conteúdo do adendo.").max(20000)
  });

  const platformSettingsSchema = z.object({
    schedulingUrl: optionalLinkSchema("Link de agendamento"),
    schedulingLabel: z.string().min(2).max(80),
    meetingDefaultUrl: optionalLinkSchema("Link padrão da sessão"),
    cancellationPolicyText: z.string().min(10).max(500),
    showSchedulingButton: booleanInputSchema(),
    professionalName: z.string().max(140),
    crp: z.string().max(60),
    professionalDocument: z.string().max(60),
    receiptCity: z.string().max(80),
    receiptFooterText: z.string().max(300),
    googleCalendarEnabled: booleanInputSchema(),
    googleCalendarId: z.string().min(2).max(255),
    googleCalendarCreateMeet: booleanInputSchema(),
    googleCalendarReminderMinutes: z.coerce.number().int().min(0).max(40320),
    googleCalendarSendUpdates: booleanInputSchema()
  });

  return {
    homeSchema,
    aboutSchema,
    aboutPanelSchema,
    helpSchema,
    workSchema,
    attendanceSchema,
    closingSchema,
    contactSchema,
    seoSchema,
    footerSchema,
    loginSchema,
    leadSchema,
    patientSchema,
    sessionSchema,
    sessionPaymentSchema,
    messageTemplateSchema,
    platformSettingsSchema,
    intakePayloadSchema,
    recordBlockPayloadSchema,
    recordCloseSchema,
    recordReopenSchema,
    clinicalDocumentSchema,
    documentRevokeSchema,
    evolutionCreateSchema,
    evolutionUpdateSchema,
    evolutionAddendumSchema
  };
}

// error.flatten() agrupa apenas por issue.path[0]: um erro dentro de
// cards[2].title virava a chave "cards", sem índice, e o painel não
// conseguia destacar o campo — a pessoa via uma frase solta e nenhuma pista
// de onde estava o problema. Aqui a chave carrega o caminho inteiro, e o
// resumo diz em que item o erro está.
function buildFieldErrors(issues = []) {
  const fieldErrors = {};
  const formErrors = [];

  for (const issue of issues) {
    if (!issue.path || issue.path.length === 0) {
      formErrors.push(issue.message);
      continue;
    }

    const chave = issue.path.join(".");
    fieldErrors[chave] = fieldErrors[chave] || [];
    fieldErrors[chave].push(issue.message);

    // Mantém também a chave de topo, que é o que os formulários simples
    // procuram hoje — assim nada que já funcionava deixa de funcionar.
    const topo = String(issue.path[0]);
    if (topo !== chave) {
      fieldErrors[topo] = fieldErrors[topo] || [];
      fieldErrors[topo].push(`${chave}: ${issue.message}`);
    }
  }

  return { fieldErrors, formErrors };
}

function validateWithSchema(schema, payload) {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const details = buildFieldErrors(parsed.error.issues);
    const primeiro = parsed.error.issues[0];
    const resumo = primeiro?.path?.length
      ? `Dados inválidos em "${primeiro.path.join(".")}": ${primeiro.message}`
      : "Dados inválidos.";
    throw new AppError(resumo, 400, details);
  }
  return parsed.data;
}

module.exports = {
  buildSchemas,
  validateWithSchema
};
