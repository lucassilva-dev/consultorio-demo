const helmet = require("helmet");
const express = require("express");
const {
  ensurePostgresAdminSessionSchema,
  ensurePostgresCheckConstraintsSchema,
  ensurePostgresClinicalRecordSchema,
  ensurePostgresClinicalSchema,
  ensurePostgresPhase2Schema,
  ensurePostgresReceiptSequenceSchema,
  ensurePostgresSecurityAuditSchema,
  hasPendingPostgresMigrations,
  runMigrations
} = require("./db/run-migrations");
const { createDatabase, createMigrationDatabase } = require("./db/database");
const { createAdminRepository } = require("./repositories/admin-repository");
const { createClinicRepository } = require("./repositories/clinic-repository");
const { createClinicalRepository } = require("./repositories/clinical-repository");
const { createPhase2Repository } = require("./repositories/phase2-repository");
const { createSiteRepository } = require("./repositories/site-repository");
const {
  buildPatientFromLead,
  getMonthRange,
  leadNeedsGuardianData,
  requiresGuardianForPatientType
} = require("./repositories/clinic-repository-helpers");
const { ensureAdminUser, ensureUploadDirectory } = require("./services/bootstrap");
const { deleteStoredImage } = require("./services/storage");
const { createGoogleCalendarService } = require("./services/google-calendar");
const { createGoogleCalendarSyncService } = require("./services/google-calendar-sync");
const {
  downloadReceiptById,
  generateReceiptForSession
} = require("./services/receipts");
const clinicalService = require("./services/clinical");
const clinicalRecordService = require("./services/clinical-record");
const clinicalDocumentsService = require("./services/clinical-documents");
const { buildSchemas, validateWithSchema } = require("./lib/validation");
const {
  getClinicDateParts,
  normalizeClinicFilterBoundary
} = require("./lib/clinic-time");
const {
  sanitizeDateLike,
  sanitizeHelpCards,
  sanitizeImagePath,
  sanitizeNullableText,
  sanitizeNumericLike,
  sanitizePlainText,
  sanitizeSocialLinks,
  sanitizeTimeLike,
  sanitizeUrlLike
} = require("./lib/sanitize");
const { AppError } = require("./lib/errors");
const { getTokenEncryptionKeyState } = require("./lib/encryption");
const { buildDecoyPasswordRecord, verifyPassword } = require("./lib/password");
const { createLoginThrottle } = require("./lib/login-throttle");
const { enrichPublicContent } = require("./services/public-content");
const { appendAuditLog, sanitizeAuditString } = require("./services/audit");
const {
  createAdminSessionToken,
  serializeAdminSessionCookie,
  serializeClearedAdminSessionCookie
} = require("./lib/admin-session");
const {
  attachAdminUser,
  // Estas duas checam apenas a assinatura e a validade do token. Dentro de
  // registerRoutes elas são envolvidas por guardas que também conferem o
  // contador de sessão no banco (revogação no logout).
  requireAdminApi: requireAdminApiSession,
  requireAdminPage: requireAdminPageSession,
  requireSameOriginForAdminWrites
} = require("./middleware/auth");
const { errorHandler } = require("./middleware/error-handler");
const { createUploadMiddleware, storeUploadedImage } = require("./middleware/upload");
const { renderPublicPage } = require("./views/public-page");
const { renderPrivacyPage } = require("./views/privacy-page");
const { renderAdminLoginPage } = require("./views/admin-login-page");
const { renderAdminDashboardPage } = require("./views/admin-dashboard-page");

function buildRuntimeConfig(baseConfig, overrides = {}) {
  const runtimeConfig = {
    ...baseConfig,
    ...overrides
  };

  if (!overrides.authCookieSecret && overrides.sessionSecret) {
    runtimeConfig.authCookieSecret = overrides.sessionSecret;
  }

  if (
    runtimeConfig.storageProvider === "supabase" &&
    runtimeConfig.supabaseStorageBucket === runtimeConfig.supabasePrivateStorageBucket
  ) {
    throw new AppError(
      "SUPABASE_PRIVATE_STORAGE_BUCKET deve ser diferente de SUPABASE_STORAGE_BUCKET.",
      500
    );
  }

  return runtimeConfig;
}

function createRepositories(db, runtimeConfig) {
  return {
    admins: createAdminRepository(db),
    site: createSiteRepository(db),
    clinic: createClinicRepository(db),
    clinical: createClinicalRepository(db),
    phase2: createPhase2Repository(db, runtimeConfig)
  };
}

function createServices(runtimeConfig, overrides = {}) {
  const googleCalendarApi = overrides.googleCalendarService || createGoogleCalendarService(runtimeConfig);

  return {
    googleCalendarApi,
    googleCalendarSync: createGoogleCalendarSyncService(runtimeConfig, googleCalendarApi)
  };
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function getExternalImageOrigins(runtimeConfig) {
  return Array.from(
    new Set(
      runtimeConfig.allowedExternalImagePrefixes
        .map((prefix) => {
          try {
            return new URL(prefix).origin;
          } catch (error) {
            return "";
          }
        })
        .filter(Boolean)
    )
  );
}

// A barra de ferramentas de preview da Vercel exige origens de terceiro no CSP
// (vercel.live e os websockets do Pusher). Elas não têm por que valer no painel,
// onde o prontuário é aberto: ali a política fica fechada em 'self'.
const ORIGENS_FERRAMENTAS_VERCEL = ["https://vercel.live", "https://vercel.com"];
const WEBSOCKETS_FERRAMENTAS_VERCEL = [
  "wss://ws-us3.pusher.com",
  "wss://sockjs-us3.pusher.com"
];

function buildCspDirectives(runtimeConfig, { permitirFerramentasVercel }) {
  const vercel = permitirFerramentasVercel ? ORIGENS_FERRAMENTAS_VERCEL : [];
  const vercelSockets = permitirFerramentasVercel ? WEBSOCKETS_FERRAMENTAS_VERCEL : [];

  return {
    defaultSrc: ["'self'"],
    connectSrc: ["'self'", ...vercel, ...vercelSockets],
    scriptSrc: ["'self'", ...vercel],
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", ...vercel],
    fontSrc: ["'self'", "https://fonts.gstatic.com", ...vercel],
    imgSrc: [
      "'self'",
      "data:",
      ...vercel,
      ...getExternalImageOrigins(runtimeConfig)
    ],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameSrc: vercel.length ? vercel : ["'none'"],
    frameAncestors: ["'none'"]
  };
}

function applySecurityHeaders(app, runtimeConfig) {
  const cspAdmin = helmet({
    contentSecurityPolicy: {
      directives: buildCspDirectives(runtimeConfig, { permitirFerramentasVercel: false })
    }
  });
  const cspPadrao = helmet({
    contentSecurityPolicy: {
      directives: buildCspDirectives(runtimeConfig, { permitirFerramentasVercel: true })
    }
  });

  app.use((req, res, next) => {
    const ehAdmin =
      req.path.startsWith("/admin") || req.path.startsWith("/api/admin");
    return ehAdmin ? cspAdmin(req, res, next) : cspPadrao(req, res, next);
  });
}

function applyNoStoreHeaders(req, res, next) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  next();
}

function sanitizeSectionPayload(section, body) {
  switch (section) {
    case "home":
      return {
        eyebrow: sanitizePlainText(body.eyebrow),
        title: sanitizePlainText(body.title),
        subtitle: sanitizePlainText(body.subtitle),
        body: sanitizePlainText(body.body),
        ctaLabel: sanitizePlainText(body.ctaLabel),
        ctaUrl: sanitizeUrlLike(body.ctaUrl),
        imageUrl: sanitizeImagePath(body.imageUrl),
        imageAlt: sanitizePlainText(body.imageAlt)
      };
    case "about":
      return {
        eyebrow: sanitizePlainText(body.eyebrow),
        title: sanitizePlainText(body.title),
        content: sanitizePlainText(body.content)
      };
    case "aboutPanel":
      return {
        eyebrow: sanitizePlainText(body.eyebrow),
        title: sanitizePlainText(body.title),
        note: sanitizePlainText(body.note),
        item1Label: sanitizePlainText(body.item1Label),
        item1Value: sanitizePlainText(body.item1Value),
        item2Label: sanitizePlainText(body.item2Label),
        item2Value: sanitizePlainText(body.item2Value),
        item3Label: sanitizePlainText(body.item3Label),
        item3Value: sanitizePlainText(body.item3Value),
        item4Label: sanitizePlainText(body.item4Label),
        item4Value: sanitizePlainText(body.item4Value)
      };
    case "help":
      return {
        eyebrow: sanitizePlainText(body.eyebrow),
        title: sanitizePlainText(body.title),
        cards: sanitizeHelpCards(body.cards)
      };
    case "work":
      return {
        eyebrow: sanitizePlainText(body.eyebrow),
        titlePrefix: sanitizePlainText(body.titlePrefix),
        titleEmphasis: sanitizePlainText(body.titleEmphasis),
        titleSuffix: sanitizePlainText(body.titleSuffix),
        lead: sanitizePlainText(body.lead),
        body: sanitizePlainText(body.body),
        pillar1Number: sanitizePlainText(body.pillar1Number),
        pillar1Title: sanitizePlainText(body.pillar1Title),
        pillar1Description: sanitizePlainText(body.pillar1Description),
        pillar2Number: sanitizePlainText(body.pillar2Number),
        pillar2Title: sanitizePlainText(body.pillar2Title),
        pillar2Description: sanitizePlainText(body.pillar2Description),
        pillar3Number: sanitizePlainText(body.pillar3Number),
        pillar3Title: sanitizePlainText(body.pillar3Title),
        pillar3Description: sanitizePlainText(body.pillar3Description)
      };
    case "attendance":
      return {
        eyebrow: sanitizePlainText(body.eyebrow),
        titlePrefix: sanitizePlainText(body.titlePrefix),
        titleEmphasis: sanitizePlainText(body.titleEmphasis),
        lead: sanitizePlainText(body.lead),
        ctaLabel: sanitizePlainText(body.ctaLabel),
        feature1Title: sanitizePlainText(body.feature1Title),
        feature1Description: sanitizePlainText(body.feature1Description),
        feature2Title: sanitizePlainText(body.feature2Title),
        feature2Description: sanitizePlainText(body.feature2Description),
        feature3Title: sanitizePlainText(body.feature3Title),
        feature3Description: sanitizePlainText(body.feature3Description)
      };
    case "closing":
      return {
        titlePrefix: sanitizePlainText(body.titlePrefix),
        titleEmphasis: sanitizePlainText(body.titleEmphasis),
        body: sanitizePlainText(body.body),
        ctaLabel: sanitizePlainText(body.ctaLabel)
      };
    case "contact":
      return {
        title: sanitizePlainText(body.title),
        text: sanitizePlainText(body.text),
        whatsappNumber: sanitizeNullableText(body.whatsappNumber),
        whatsappMessage: sanitizePlainText(body.whatsappMessage),
        socialLinks: sanitizeSocialLinks(body.socialLinks)
      };
    case "seo":
      return {
        title: sanitizePlainText(body.title),
        description: sanitizePlainText(body.description),
        shareImageUrl: sanitizeImagePath(body.shareImageUrl)
      };
    case "footer":
      return {
        note: sanitizePlainText(body.note),
        metaText: sanitizePlainText(body.metaText)
      };
    default:
      throw new AppError("Seção inválida.", 404);
  }
}

// Imagens referenciadas por uma seção do site. Usado para descobrir quais
// arquivos deixaram de ser referenciados depois de um salvamento.
// Todas as imagens referenciadas pelo site, de qualquer seção.
function todasAsImagensDoSite(bundle = {}) {
  return ["home", "seo", "help"].flatMap((secao) => collectSectionImages(secao, bundle));
}

function collectSectionImages(section, bundle = {}) {
  if (section === "home") {
    return [bundle.home?.imageUrl].filter(Boolean);
  }

  if (section === "seo") {
    return [bundle.seo?.shareImageUrl].filter(Boolean);
  }

  if (section === "help") {
    return (bundle.help?.cards || [])
      .filter((card) => card.assetType === "image")
      .map((card) => card.assetValue)
      .filter(Boolean);
  }

  return [];
}

// isSafeInteger, e não isInteger: 1e30 passa em isInteger e chega ao banco
// como notação científica, que o SQLite ignora silenciosamente e o Postgres
// responde com 500. Aqui vira 400, que é o que de fato aconteceu.
// Campos que o recibo imprime. Alterar qualquer um deles depois da emissão
// desencontra o documento do registro.
function mudaOQueOReciboAfirma(sessaoAtual, payload) {
  return (
    Number(payload.patientId) !== Number(sessaoAtual.patientId) ||
    Number(payload.price) !== Number(sessaoAtual.price) ||
    String(payload.scheduledAt) !== String(sessaoAtual.scheduledAt)
  );
}

function parseEntityId(rawValue, label = "Registro") {
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AppError(`${label} inválido.`, 400);
  }
  return value;
}

// Inteiro vindo da query, preso a uma faixa. Valores como 1e30, Infinity ou
// 99999999 chegavam crus a Date.UTC e ao LIMIT/OFFSET do SQL: o primeiro
// produzia "Invalid time value" e o segundo era recusado pelo driver — os dois
// viravam 500 numa rota que o admin abre só mudando a URL.
function sanitizeBoundedInteger(rawValue, { min, max, fallback }) {
  const texto = sanitizeNumericLike(rawValue);
  if (!texto) {
    return fallback;
  }

  const value = Number(texto);
  if (!Number.isFinite(value)) {
    return fallback;
  }

  const inteiro = Math.trunc(value);
  if (!Number.isSafeInteger(inteiro)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, inteiro));
}

// Filtro por id vindo da query. Valor que não é um id plausível é descartado
// em vez de virar NaN no repositório — o SQLite devolvia lista vazia e o
// Postgres estourava 500 para a mesma entrada.
function sanitizeIdFilter(rawValue) {
  const texto = sanitizeNumericLike(rawValue);
  if (!texto) {
    return "";
  }

  const value = Number(texto);
  return Number.isSafeInteger(value) && value > 0 ? String(value) : "";
}

function sanitizeLeadPayload(body = {}) {
  return {
    name: sanitizePlainText(body.name),
    phone: sanitizePlainText(body.phone),
    email: sanitizeNullableText(body.email),
    age: sanitizeNumericLike(body.age),
    source: sanitizePlainText(body.source),
    interest: sanitizePlainText(body.interest),
    status: sanitizePlainText(body.status),
    preferredPeriod: sanitizePlainText(body.preferredPeriod),
    administrativeNote: sanitizePlainText(body.administrativeNote)
  };
}

function sanitizePatientPayload(body = {}) {
  return {
    fullName: sanitizePlainText(body.fullName),
    preferredName: sanitizePlainText(body.preferredName),
    birthDate: sanitizeDateLike(body.birthDate),
    age: sanitizeNumericLike(body.age),
    phone: sanitizePlainText(body.phone),
    email: sanitizeNullableText(body.email),
    patientType: sanitizePlainText(body.patientType),
    guardianName: sanitizePlainText(body.guardianName),
    guardianPhone: sanitizePlainText(body.guardianPhone),
    sessionPrice: sanitizeNumericLike(body.sessionPrice),
    defaultWeekday: sanitizePlainText(body.defaultWeekday),
    defaultTime: sanitizeTimeLike(body.defaultTime),
    modality: sanitizePlainText(body.modality),
    status: sanitizePlainText(body.status),
    administrativeNote: sanitizePlainText(body.administrativeNote)
  };
}

function sanitizeSessionPayload(body = {}) {
  return {
    patientId: body.patientId,
    scheduledAt: sanitizeDateLike(body.scheduledAt),
    durationMinutes: sanitizeNumericLike(body.durationMinutes),
    status: sanitizePlainText(body.status),
    paymentStatus: sanitizePlainText(body.paymentStatus),
    price: sanitizeNumericLike(body.price),
    paymentMethod: sanitizePlainText(body.paymentMethod),
    paidAt: sanitizeDateLike(body.paidAt),
    meetingUrl: sanitizeUrlLike(body.meetingUrl),
    administrativeNote: sanitizePlainText(body.administrativeNote)
  };
}

function sanitizeMessageTemplatePayload(body = {}) {
  return {
    title: sanitizePlainText(body.title),
    category: sanitizePlainText(body.category),
    body: sanitizePlainText(body.body),
    isActive: body.isActive
  };
}

function sanitizePlatformSettingsPayload(body = {}) {
  const payload = {};

  if (Object.prototype.hasOwnProperty.call(body, "schedulingUrl")) {
    payload.schedulingUrl = sanitizeUrlLike(body.schedulingUrl);
  }
  if (Object.prototype.hasOwnProperty.call(body, "schedulingLabel")) {
    payload.schedulingLabel = sanitizePlainText(body.schedulingLabel);
  }
  if (Object.prototype.hasOwnProperty.call(body, "meetingDefaultUrl")) {
    payload.meetingDefaultUrl = sanitizeUrlLike(body.meetingDefaultUrl);
  }
  if (Object.prototype.hasOwnProperty.call(body, "cancellationPolicyText")) {
    payload.cancellationPolicyText = sanitizePlainText(body.cancellationPolicyText);
  }
  if (Object.prototype.hasOwnProperty.call(body, "showSchedulingButton")) {
    payload.showSchedulingButton = body.showSchedulingButton;
  }
  if (Object.prototype.hasOwnProperty.call(body, "professionalName")) {
    payload.professionalName = sanitizePlainText(body.professionalName);
  }
  if (Object.prototype.hasOwnProperty.call(body, "crp")) {
    payload.crp = sanitizePlainText(body.crp);
  }
  if (Object.prototype.hasOwnProperty.call(body, "professionalDocument")) {
    payload.professionalDocument = sanitizePlainText(body.professionalDocument);
  }
  if (Object.prototype.hasOwnProperty.call(body, "receiptCity")) {
    payload.receiptCity = sanitizePlainText(body.receiptCity);
  }
  if (Object.prototype.hasOwnProperty.call(body, "receiptFooterText")) {
    payload.receiptFooterText = sanitizePlainText(body.receiptFooterText);
  }
  if (Object.prototype.hasOwnProperty.call(body, "googleCalendarEnabled")) {
    payload.googleCalendarEnabled = body.googleCalendarEnabled;
  }
  if (Object.prototype.hasOwnProperty.call(body, "googleCalendarId")) {
    payload.googleCalendarId = sanitizePlainText(body.googleCalendarId);
  }
  if (Object.prototype.hasOwnProperty.call(body, "googleCalendarCreateMeet")) {
    payload.googleCalendarCreateMeet = body.googleCalendarCreateMeet;
  }
  if (Object.prototype.hasOwnProperty.call(body, "googleCalendarReminderMinutes")) {
    payload.googleCalendarReminderMinutes = sanitizeNumericLike(body.googleCalendarReminderMinutes);
  }
  if (Object.prototype.hasOwnProperty.call(body, "googleCalendarSendUpdates")) {
    payload.googleCalendarSendUpdates = body.googleCalendarSendUpdates;
  }

  return payload;
}

function sanitizeGoogleCalendarSettingsPayload(body = {}) {
  const payload = {};

  if (Object.prototype.hasOwnProperty.call(body, "googleCalendarEnabled")) {
    payload.googleCalendarEnabled = body.googleCalendarEnabled;
  }
  if (Object.prototype.hasOwnProperty.call(body, "googleCalendarId")) {
    payload.googleCalendarId = sanitizePlainText(body.googleCalendarId);
  }
  if (Object.prototype.hasOwnProperty.call(body, "googleCalendarCreateMeet")) {
    payload.googleCalendarCreateMeet = body.googleCalendarCreateMeet;
  }
  if (Object.prototype.hasOwnProperty.call(body, "googleCalendarReminderMinutes")) {
    payload.googleCalendarReminderMinutes = sanitizeNumericLike(body.googleCalendarReminderMinutes);
  }
  if (Object.prototype.hasOwnProperty.call(body, "googleCalendarSendUpdates")) {
    payload.googleCalendarSendUpdates = body.googleCalendarSendUpdates;
  }

  return payload;
}

function sanitizeLeadFilters(query = {}) {
  return {
    search: sanitizePlainText(query.search || ""),
    status: sanitizePlainText(query.status || "")
  };
}

function sanitizePatientFilters(query = {}) {
  return {
    search: sanitizePlainText(query.search || ""),
    status: sanitizePlainText(query.status || "")
  };
}

// "2026-06-30" no filtro significa o dia 30 no fuso da clínica. Com a janela
// montada em UTC, o intervalo terminava às 21h locais e escondia justamente as
// sessões da noite. Data malformada devolve vazio em vez de derrubar a rota.
function normalizeFilterDateBoundary(value, mode) {
  return normalizeClinicFilterBoundary(sanitizeDateLike(value), mode);
}

function sanitizeSessionFilters(query = {}) {
  return {
    patientId: sanitizeIdFilter(query.patientId),
    status: sanitizePlainText(query.status || ""),
    paymentStatus: sanitizePlainText(query.paymentStatus || ""),
    dateFrom: normalizeFilterDateBoundary(query.dateFrom || "", "start"),
    dateTo: normalizeFilterDateBoundary(query.dateTo || "", "end")
  };
}

// Faixa dos filtros de período. Fora dela, Date.UTC devolve data inválida e
// toISOString lança — o que virava 500 no Financeiro e nos recibos.
const ANO_MINIMO = 1900;
const ANO_MAXIMO = 2999;

function sanitizePeriodo(query) {
  const hoje = getClinicDateParts();
  return {
    month: String(
      sanitizeBoundedInteger(query.month, { min: 1, max: 12, fallback: hoje.month })
    ),
    year: String(
      sanitizeBoundedInteger(query.year, {
        min: ANO_MINIMO,
        max: ANO_MAXIMO,
        fallback: hoje.year
      })
    )
  };
}

function sanitizeFinanceFilters(query = {}) {
  return {
    ...sanitizePeriodo(query),
    patientId: sanitizeIdFilter(query.patientId),
    paymentStatus: sanitizePlainText(query.paymentStatus || "")
  };
}

// Regime de apuração do recibo:
//   "competencia" — mês do atendimento (session_date). É o padrão: o recibo
//                   de uma sessão de junho pertence a junho, mesmo que o
//                   pagamento entre depois.
//   "caixa"       — mês em que o pagamento entrou (payment_date).
const RECEIPT_BASES = ["competencia", "caixa"];

function sanitizeReceiptFilters(query = {}) {
  const basis = sanitizePlainText(query.basis || "");
  // month/year só entram como período quando foram pedidos: buildReceiptFilters
  // usa a ausência para decidir se recorta o mês.
  const pediuPeriodo = Boolean(sanitizeNumericLike(query.month)) || Boolean(sanitizeNumericLike(query.year));
  const periodo = pediuPeriodo ? sanitizePeriodo(query) : { month: "", year: "" };

  return {
    ...periodo,
    patientId: sanitizeIdFilter(query.patientId),
    sessionId: sanitizeIdFilter(query.sessionId),
    basis: RECEIPT_BASES.includes(basis) ? basis : "competencia"
  };
}

function sanitizeMessageTemplateFilters(query = {}) {
  return {
    search: sanitizePlainText(query.search || ""),
    category: sanitizePlainText(query.category || ""),
    isActive:
      typeof query.isActive === "undefined" || query.isActive === ""
        ? undefined
        : query.isActive === "true" || query.isActive === "1"
  };
}

function sanitizeAuditLogFilters(query = {}) {
  const page = sanitizeBoundedInteger(query.page, { min: 1, max: 1000000, fallback: 1 });
  const pageSize = sanitizeBoundedInteger(query.pageSize, { min: 1, max: 100, fallback: 20 });
  const date = sanitizeDateLike(query.date || "");

  // A janela é montada pelo mesmo helper dos outros filtros: no fuso da clínica
  // (a lista é exibida nele) e devolvendo "" para data malformada. Antes, um
  // ?date=qualquer-coisa derrubava a rota inteira com RangeError.
  const dateFrom = normalizeClinicFilterBoundary(date, "start");
  const dateTo = normalizeClinicFilterBoundary(date, "end");

  return {
    action: sanitizePlainText(query.action || ""),
    entityType: sanitizePlainText(query.entityType || ""),
    adminEmail: sanitizePlainText(query.adminEmail || ""),
    date: dateFrom ? date : "",
    dateFrom,
    dateTo,
    page,
    pageSize
  };
}

function getPublicAgendaSettings(settings = {}) {
  return {
    schedulingUrl: settings.schedulingUrl || "",
    schedulingLabel: settings.schedulingLabel || "",
    showSchedulingButton: Boolean(settings.showSchedulingButton)
  };
}

function getPublicContactChannels(content = {}) {
  const contact = content.contact || {};
  const emailLink = (contact.socialLinks || []).find((link) => link.platform === "email");
  const instagramLink = (contact.socialLinks || []).find((link) => link.platform === "instagram");

  return {
    contactEmail: emailLink?.url?.replace(/^mailto:/i, "") || "",
    whatsappUrl: contact.whatsappUrl || "",
    instagramUrl: instagramLink?.url || ""
  };
}

function buildSecurityStatus(runtimeConfig) {
  const tokenEncryptionKeyState = getTokenEncryptionKeyState(runtimeConfig);
  const developmentSecret = "development-session-secret-change-me";
  const hasNonDefaultSecret = (value) =>
    Boolean(String(value || "").trim()) && String(value || "").trim() !== developmentSecret;

  return {
    nodeEnvProduction: runtimeConfig.nodeEnv === "production",
    dataProviderPostgres: runtimeConfig.dataProvider === "postgres",
    storageProviderSupabase: runtimeConfig.storageProvider === "supabase",
    databaseUrlConfigured: Boolean(runtimeConfig.databaseUrl),
    supabaseUrlConfigured: Boolean(runtimeConfig.supabaseUrl),
    supabaseServiceRoleKeyConfigured: Boolean(runtimeConfig.supabaseServiceRoleKey),
    supabaseStorageBucketConfigured: Boolean(runtimeConfig.supabaseStorageBucket),
    supabasePrivateStorageBucketConfigured: Boolean(runtimeConfig.supabasePrivateStorageBucket),
    sessionSecretConfiguredAndNonDefault: hasNonDefaultSecret(runtimeConfig.sessionSecret),
    authCookieSecretConfiguredAndNonDefault: hasNonDefaultSecret(runtimeConfig.authCookieSecret),
    adminPasswordHashConfigured: Boolean(runtimeConfig.adminPasswordHash),
    adminInitialPasswordAbsentInProduction:
      runtimeConfig.nodeEnv !== "production" || !runtimeConfig.adminInitialPassword,
    tokenEncryptionKeyConfigured: tokenEncryptionKeyState.valid,
    googleClientIdConfigured: Boolean(runtimeConfig.googleClientId),
    googleClientSecretConfigured: Boolean(runtimeConfig.googleClientSecret),
    googleRedirectUriConfigured: Boolean(runtimeConfig.googleRedirectUri),
    siteUrlConfigured: Boolean(runtimeConfig.siteUrl),
    runDatabaseMigrationsOnBootRecommendedFalse: runtimeConfig.runDatabaseMigrationsOnBoot === false
  };
}

// Marca de ordem de bytes. Sem ela o Excel abre o CSV como Latin-1 e todo nome
// acentuado chega corrompido. Declarada por código para não virar um caractere
// invisível no meio do arquivo.
const BOM_UTF8 = String.fromCharCode(0xfeff);

function buildFinanceCsvRows(items = []) {
  const headers = [
    "id",
    "patientName",
    "scheduledAt",
    "durationMinutes",
    "status",
    "paymentStatus",
    "price",
    "paymentMethod",
    "paidAt",
    "meetingUrl"
  ];

  // Excel e LibreOffice tratam célula que começa com = + - @ (ou com tab/CR)
  // como fórmula e a executam ao abrir o arquivo. Nome de paciente é texto
  // livre, então prefixamos com apóstrofo, que a planilha lê como texto.
  const INICIOS_DE_FORMULA = ["=", "+", "-", "@"];
  const escapeCell = (value) => {
    const texto = String(value ?? "");
    const primeiroCodigo = texto.charCodeAt(0);
    const viraFormula =
      INICIOS_DE_FORMULA.includes(texto.charAt(0)) ||
      primeiroCodigo === 9 ||
      primeiroCodigo === 13;
    const neutro = viraFormula ? `'${texto}` : texto;
    return `"${neutro.split(`"`).join(`""`)}"`;
  };
  const rows = items.map((item) =>
    [
      item.id,
      item.patientName,
      item.scheduledAt,
      item.durationMinutes,
      item.status,
      item.paymentStatus,
      item.price,
      item.paymentMethod,
      item.paidAt,
      item.meetingUrl
    ]
      .map(escapeCell)
      .join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

function buildReceiptFilters(rawFilters = {}) {
  const basis = rawFilters.basis === "caixa" ? "caixa" : "competencia";
  const filters = {
    patientId: rawFilters.patientId,
    sessionId: rawFilters.sessionId,
    basis
  };

  // Só recorta por mês quando o mês foi pedido. Antes, buscar por paciente ou
  // por sessão aplicava silenciosamente a janela do mês corrente e escondia
  // recibos de outros meses.
  const temPeriodo = Boolean(rawFilters.month) || Boolean(rawFilters.year);
  if (!temPeriodo) {
    return filters;
  }

  const hoje = getClinicDateParts();
  const year = Number(rawFilters.year) || hoje.year;
  const month = Number(rawFilters.month) || hoje.month;
  const range = getMonthRange(year, month);

  return {
    ...filters,
    dateFrom: range.start,
    dateTo: range.end
  };
}

function serializeReceiptForAdmin(receipt) {
  if (!receipt) {
    return null;
  }

  const {
    fileObjectKey,
    ...safeReceipt
  } = receipt;

  return safeReceipt;
}

function serializeReceiptListForAdmin(items = []) {
  return items.map(serializeReceiptForAdmin);
}

function shouldLogBootstrap(runtimeConfig) {
  return runtimeConfig.isProduction || process.env.DEBUG_BOOTSTRAP === "true";
}

function shouldLogPublicApi(runtimeConfig) {
  return runtimeConfig.isProduction || process.env.DEBUG_PUBLIC_API === "true";
}

async function runBootstrapStep(runtimeConfig, step, action) {
  const startedAt = Date.now();

  if (shouldLogBootstrap(runtimeConfig)) {
    console.info("[BOOTSTRAP]", { step, status: "start" });
  }

  try {
    const result = await action();

    if (shouldLogBootstrap(runtimeConfig)) {
      console.info("[BOOTSTRAP]", {
        step,
        status: "done",
        durationMs: Date.now() - startedAt
      });
    }

    return result;
  } catch (error) {
    console.error("[BOOTSTRAP]", {
      step,
      status: "failed",
      durationMs: Date.now() - startedAt,
      message: error.message,
      name: error.name
    });
    throw error;
  }
}

async function runObservedStep(runtimeConfig, step, action) {
  const startedAt = Date.now();

  if (shouldLogPublicApi(runtimeConfig)) {
    console.info("[API_TRACE]", { step, status: "start" });
  }

  try {
    const result = await action();

    if (shouldLogPublicApi(runtimeConfig)) {
      console.info("[API_TRACE]", {
        step,
        status: "done",
        durationMs: Date.now() - startedAt
      });
    }

    return result;
  } catch (error) {
    console.error("[API_TRACE]", {
      step,
      status: "failed",
      durationMs: Date.now() - startedAt,
      message: error.message,
      name: error.name
    });
    throw error;
  }
}

async function createAppDependencies(runtimeConfig, serviceOverrides = {}) {
  const db = createDatabase(runtimeConfig);

  try {
    return await bootstrapDependencies(db, runtimeConfig, serviceOverrides);
  } catch (error) {
    // O chamador zera a promessa memoizada quando o boot falha, para tentar de
    // novo no próximo request. Sem fechar aqui, cada tentativa deixaria uma
    // conexão pendurada.
    await closeDatabaseQuietly(db);
    throw error;
  }
}

async function closeDatabaseQuietly(db) {
  try {
    if (typeof db?.end === "function") {
      await db.end({ timeout: 5 });
    } else if (typeof db?.close === "function") {
      db.close();
    }
  } catch (error) {
    // Fechar é melhor esforço: o erro original é o que importa propagar.
  }
}

async function bootstrapDependencies(db, runtimeConfig, serviceOverrides) {

  if (runtimeConfig.dataProvider === "postgres" && runtimeConfig.runDatabaseMigrationsOnBoot) {
    // Verifica migrações pendentes na conexão principal (pooler, confiável)
    // ANTES de abrir a conexão de migração. A conexão de migração pode apontar
    // para o endpoint non-pooling/direto, que é instável a partir de serverless
    // e, quando lento, trava o boot (e com isso toda rota que depende do banco).
    // No caso normal (tudo aplicado) pulamos essa conexão por completo.
    const pending = await runBootstrapStep(runtimeConfig, "postgres-migrations-check", () =>
      hasPendingPostgresMigrations(db)
    );

    if (pending) {
      const migrationDb = createMigrationDatabase(runtimeConfig);
      try {
        await runBootstrapStep(runtimeConfig, "postgres-migrations", () => runMigrations(migrationDb));
      } finally {
        await migrationDb.end({ timeout: 5 });
      }
    } else if (shouldLogBootstrap(runtimeConfig)) {
      console.info("[BOOTSTRAP]", {
        step: "postgres-migrations",
        status: "skipped-already-applied"
      });
    }
  } else if (runtimeConfig.dataProvider === "postgres" && shouldLogBootstrap(runtimeConfig)) {
    console.info("[BOOTSTRAP]", {
      step: "postgres-migrations",
      status: "skipped"
    });
  }

  if (runtimeConfig.dataProvider === "postgres" && !runtimeConfig.runDatabaseMigrationsOnBoot) {
    await runBootstrapStep(runtimeConfig, "postgres-phase2-compat", () =>
      ensurePostgresPhase2Schema(db)
    );
    await runBootstrapStep(runtimeConfig, "postgres-security-audit-compat", () =>
      ensurePostgresSecurityAuditSchema(db)
    );
    await runBootstrapStep(runtimeConfig, "postgres-clinical-compat", () =>
      ensurePostgresClinicalSchema(db)
    );
    await runBootstrapStep(runtimeConfig, "postgres-receipt-sequence-compat", () =>
      ensurePostgresReceiptSequenceSchema(db)
    );
    await runBootstrapStep(runtimeConfig, "postgres-admin-session-compat", () =>
      ensurePostgresAdminSessionSchema(db)
    );
    await runBootstrapStep(runtimeConfig, "postgres-check-constraints-compat", () =>
      ensurePostgresCheckConstraintsSchema(db)
    );
    await runBootstrapStep(runtimeConfig, "postgres-clinical-record-compat", () =>
      ensurePostgresClinicalRecordSchema(db)
    );
  }
  if (runtimeConfig.dataProvider !== "postgres") {
    await runBootstrapStep(runtimeConfig, "sqlite-migrations", () => runMigrations(db));
  }
  const repositories = createRepositories(db, runtimeConfig);
  const services = createServices(runtimeConfig, serviceOverrides);
  await runBootstrapStep(runtimeConfig, "site-seed-defaults", () => repositories.site.seedDefaults());
  await runBootstrapStep(runtimeConfig, "clinic-seed-defaults", () =>
    repositories.clinic.seedDefaults()
  );
  await runBootstrapStep(runtimeConfig, "storage-ready", () => ensureUploadDirectory(runtimeConfig));
  await runBootstrapStep(runtimeConfig, "admin-ready", () =>
    ensureAdminUser(repositories.admins, runtimeConfig)
  );

  if (shouldLogBootstrap(runtimeConfig)) {
    console.info("[BOOTSTRAP]", { status: "complete" });
  }

  return { db, repositories, services };
}

// Garante que uma promessa não fique pendente para sempre. Em serverless, um
// boot pendurado bloquearia TODAS as requisições concorrentes da instância até
// o 504 do Vercel. Aqui ele falha rápido (e o chamador reseta para tentar de
// novo no próximo request).
function withTimeout(promise, ms, message) {
  if (!ms || ms <= 0) {
    return promise;
  }

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new AppError(message, 503)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function resolveDependencies(app) {
  if (app.locals.dependencies) {
    return app.locals.dependencies;
  }

  if (!app.locals.dependenciesPromise) {
    // withTimeout rejeita, mas a criação continua correndo por baixo e acaba
    // devolvendo um db que ninguém mais referencia. Sem este encadeamento, cada
    // boot que estoura o tempo deixa uma conexão pendurada.
    const criacao = createAppDependencies(
      app.locals.runtimeConfig,
      app.locals.serviceOverrides
    );
    let expirou = false;

    criacao
      .then((dependencies) => {
        if (expirou) {
          return closeDatabaseQuietly(dependencies.db);
        }
        return null;
      })
      .catch(() => null);

    app.locals.dependenciesPromise = withTimeout(
      criacao,
      app.locals.runtimeConfig.bootTimeoutMs,
      "Inicialização do servidor excedeu o tempo limite. Tente novamente em instantes."
    )
      .then((dependencies) => {
        app.locals.dependencies = dependencies;
        return dependencies;
      })
      .catch((error) => {
        expirou = true;
        app.locals.dependenciesPromise = null;
        throw error;
      });
  }

  return app.locals.dependenciesPromise;
}

async function getRepositories(req) {
  const dependencies = await resolveDependencies(req.app);
  return dependencies.repositories;
}

async function getServices(req) {
  const dependencies = await resolveDependencies(req.app);
  return dependencies.services;
}

async function mergePlatformSettingsUpdate(repositories, partialPayload) {
  const currentSettings = await repositories.clinic.getPlatformSettings();
  return {
    ...currentSettings,
    ...partialPayload
  };
}

function parseBooleanFlag(value) {
  return value === true || value === "true" || value === "1" || value === 1;
}

function buildDefinitiveRecordError(footprint) {
  const motivos = [];
  if (footprint.definitiveIntake) {
    motivos.push("anamnese concluída");
  }
  if (footprint.definitiveEvolutions > 0) {
    motivos.push(
      footprint.definitiveEvolutions === 1
        ? "1 evolução assinada"
        : `${footprint.definitiveEvolutions} evoluções assinadas`
    );
  }
  if (footprint.definitiveBlocks > 0) {
    motivos.push(
      footprint.definitiveBlocks === 1
        ? "1 bloco concluído"
        : `${footprint.definitiveBlocks} blocos concluídos`
    );
  }
  if (footprint.documentsCount > 0) {
    motivos.push(
      footprint.documentsCount === 1
        ? "1 documento emitido"
        : `${footprint.documentsCount} documentos emitidos`
    );
  }
  if (footprint.recordClosed) {
    motivos.push("prontuário encerrado");
  }

  const detalhe = motivos.length ? ` (${motivos.join(", ")})` : "";
  return (
    `Este paciente tem prontuário que não pode ser apagado${detalhe}. ` +
    "Marque o paciente como encerrado para fechar o acompanhamento sem perder o registro."
  );
}

function registerRoutes(app, runtimeConfig, uploadMiddleware) {
  const schemas = buildSchemas(runtimeConfig);
  // Um freio por processo. Vive junto com as rotas para que cada app criado
  // em teste tenha o seu, sem vazar contagem de um teste para o outro.
  const loginThrottle = createLoginThrottle(runtimeConfig.loginThrottle || {});

  // O token é assinado e stateless, então limpar o cookie no logout não o
  // invalidava. Cada admin tem um contador de sessão que o logout incrementa;
  // um token emitido antes disso deixa de bater e é recusado aqui.
  async function sessionEpochIsCurrent(req) {
    const repositories = await getRepositories(req);
    const user = await repositories.admins.findById(Number(req.adminUser.sub));
    if (!user) {
      return false;
    }

    const atual = Number(user.session_epoch ?? user.sessionEpoch ?? 0);
    return Number(req.adminUser.epoch ?? 0) === atual;
  }

  const requireAdminApi = asyncRoute(async (req, res, next) => {
    return requireAdminApiSession(req, res, async () => {
      if (!(await sessionEpochIsCurrent(req))) {
        res.setHeader("Set-Cookie", serializeClearedAdminSessionCookie(runtimeConfig));
        return res.status(401).json({ ok: false, error: "Sessão encerrada. Entre novamente." });
      }
      return next();
    });
  });

  const requireAdminPage = asyncRoute(async (req, res, next) => {
    return requireAdminPageSession(req, res, async () => {
      if (!(await sessionEpochIsCurrent(req))) {
        res.setHeader("Set-Cookie", serializeClearedAdminSessionCookie(runtimeConfig));
        return res.redirect("/admin/login");
      }
      return next();
    });
  });

  app.get(
    "/",
    asyncRoute(async (req, res) => {
      // A landing não pode depender do banco para responder: se a leitura do
      // SEO falhar, o shell padrão ainda é servido e o conteúdo é montado no
      // cliente como sempre.
      let seo = {};
      try {
        const repositories = await getRepositories(req);
        const bundle = await repositories.site.getContentBundle();
        seo = { ...(bundle.seo || {}), siteUrl: runtimeConfig.siteUrl };
      } catch (error) {
        console.error("[PUBLIC_PAGE_SEO]", {
          message: "Não foi possível ler o SEO; servindo o shell padrão.",
          causa: error?.message,
          stack: error?.stack
        });
      }

      res.send(renderPublicPage(seo));
    })
  );

  app.get(
    "/privacidade",
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const content = enrichPublicContent(await repositories.site.getContentBundle());
      res.send(renderPrivacyPage(getPublicContactChannels(content)));
    })
  );

  app.get("/admin/login", (req, res) => {
    if (req.adminUser?.role === "admin") {
      return res.redirect("/admin/dashboard");
    }
    return res.send(renderAdminLoginPage());
  });

  app.get("/admin/dashboard", requireAdminPage, (req, res) => {
    res.send(renderAdminDashboardPage(req.adminUser));
  });

  app.get(
    "/api/public/content",
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const bundle = await runObservedStep(runtimeConfig, "public-content:bundle", () =>
        repositories.site.getContentBundle()
      );
      const platformSettings = await runObservedStep(
        runtimeConfig,
        "public-content:platform-settings",
        () => repositories.clinic.getPlatformSettings()
      );
      res.json({
        ok: true,
        data: enrichPublicContent({
          ...bundle,
          agenda: getPublicAgendaSettings(platformSettings)
        })
      });
    })
  );

  app.post(
    "/api/admin/login",
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const credentials = validateWithSchema(schemas.loginSchema, {
        email: sanitizePlainText(req.body.email),
        password: String(req.body.password || "")
      });

      const throttleKeys = loginThrottle.buildKeys(req.ip, credentials.email);
      // Só o bloqueio por IP nega antes de verificar a senha. O bloqueio por
      // e-mail é aplicado depois, e a senha correta o atravessa: caso contrário
      // bastava alguém errar a senha cinco vezes para deixar a psicóloga sem
      // acesso ao próprio painel.
      const esperaSegundos = loginThrottle.retryAfterSecondsHard(throttleKeys);
      if (esperaSegundos > 0) {
        // Sem gravar auditoria aqui: a rota é anônima, e registrar cada
        // tentativa bloqueada deixaria a tabela de logs crescer sob ataque.
        // As falhas que levaram ao bloqueio já foram registradas.
        res.setHeader("Retry-After", String(esperaSegundos));
        throw new AppError(
          "Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.",
          429
        );
      }

      const user = await repositories.admins.findByEmail(credentials.email);
      // Quando o e-mail não existe, verifica contra um registro-isca: sem isso
      // a resposta instantânea revela qual é o e-mail administrativo válido.
      const senhaConfere = user
        ? verifyPassword(credentials.password, user)
        : (verifyPassword(credentials.password, buildDecoyPasswordRecord()), false);

      if (!senhaConfere) {
        loginThrottle.registerFailure(throttleKeys);

        // A tentativa aconteceu e deixa rastro, independentemente de o código
        // devolvido ser 401 ou 429. Registrar só no ramo do 401 escondia da
        // auditoria justamente as tentativas que dispararam o bloqueio.
        await appendAuditLog(repositories, req, {
          adminEmail: credentials.email,
          action: "login_failed",
          entityType: "admin_session",
          summary: "Falha de login administrativo.",
          metadata: {
            outcome: "invalid_credentials"
          }
        });

        // Com a senha errada, o bloqueio por e-mail também vale: é ele que
        // contém quem troca de IP para adivinhar a senha de um alvo conhecido.
        const esperaPorEmail = loginThrottle.retryAfterSeconds(throttleKeys);
        if (esperaPorEmail > 0) {
          res.setHeader("Retry-After", String(esperaPorEmail));
          throw new AppError(
            "Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.",
            429
          );
        }

        throw new AppError("E-mail ou senha inválidos.", 401);
      }

      loginThrottle.registerSuccess(throttleKeys);

      const token = createAdminSessionToken(user, runtimeConfig);
      res.setHeader("Set-Cookie", serializeAdminSessionCookie(token, runtimeConfig));
      await appendAuditLog(repositories, req, {
        adminUserId: user.id,
        adminEmail: user.email,
        action: "login_succeeded",
        entityType: "admin_session",
        entityId: user.id,
        summary: "Login administrativo realizado."
      });
      res.json({ ok: true });
    })
  );

  app.post(
    "/api/admin/logout",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      // Invalida os tokens já emitidos para este admin, e não só o cookie
      // deste navegador.
      await repositories.admins.incrementSessionEpoch(Number(req.adminUser.sub));
      res.setHeader("Set-Cookie", serializeClearedAdminSessionCookie(runtimeConfig));
      await appendAuditLog(repositories, req, {
        action: "logout",
        entityType: "admin_session",
        entityId: req.adminUser.sub,
        summary: "Logout administrativo realizado."
      });
      return res.json({ ok: true });
    })
  );

  app.get(
    "/api/admin/security/status",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      res.json({
        ok: true,
        data: buildSecurityStatus(runtimeConfig)
      });
    })
  );

  app.get(
    "/api/admin/content",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      res.json({
        ok: true,
        data: await repositories.site.getContentBundle(),
        meta: {
          allowedHelpIcons: runtimeConfig.allowedHelpIcons
        }
      });
    })
  );

  app.put(
    "/api/admin/content/:section",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const { section } = req.params;
      const sanitizedPayload = sanitizeSectionPayload(section, req.body || {});
      const imagensAntes = collectSectionImages(
        section,
        await repositories.site.getContentBundle()
      );

      switch (section) {
        case "home":
          await repositories.site.setSection(
            "home",
            validateWithSchema(schemas.homeSchema, sanitizedPayload)
          );
          break;
        case "about":
          await repositories.site.setSection(
            "about",
            validateWithSchema(schemas.aboutSchema, sanitizedPayload)
          );
          break;
        case "aboutPanel":
          await repositories.site.setSection(
            "aboutPanel",
            validateWithSchema(schemas.aboutPanelSchema, sanitizedPayload)
          );
          break;
        case "help": {
          const validated = validateWithSchema(schemas.helpSchema, sanitizedPayload);
          await repositories.site.setSection("help", {
            eyebrow: validated.eyebrow,
            title: validated.title
          });
          await repositories.site.replaceHelpCards(validated.cards);
          break;
        }
        case "work":
          await repositories.site.setSection(
            "work",
            validateWithSchema(schemas.workSchema, sanitizedPayload)
          );
          break;
        case "attendance":
          await repositories.site.setSection(
            "attendance",
            validateWithSchema(schemas.attendanceSchema, sanitizedPayload)
          );
          break;
        case "closing":
          await repositories.site.setSection(
            "closing",
            validateWithSchema(schemas.closingSchema, sanitizedPayload)
          );
          break;
        case "contact":
          await repositories.site.setSection(
            "contact",
            validateWithSchema(schemas.contactSchema, sanitizedPayload)
          );
          break;
        case "seo":
          await repositories.site.setSection(
            "seo",
            validateWithSchema(schemas.seoSchema, sanitizedPayload)
          );
          break;
        case "footer":
          await repositories.site.setSection(
            "footer",
            validateWithSchema(schemas.footerSchema, sanitizedPayload)
          );
          break;
        default:
          throw new AppError("Seção inválida.", 404);
      }

      const bundleAtualizado = await repositories.site.getContentBundle();

      // Toda troca de imagem deixava o arquivo anterior para sempre no storage.
      // A limpeza é melhor esforço e roda depois do salvamento: se falhar, o
      // conteúdo já está salvo e no máximo sobra um arquivo sem uso.
      //
      // A comparação é contra TODAS as seções, não só a que foi salva: a mesma
      // imagem pode estar em home.imageUrl e em seo.shareImageUrl, e apagar
      // olhando uma seção só derrubava a imagem que a outra ainda usa.
      const emUso = new Set(todasAsImagensDoSite(bundleAtualizado));
      for (const imagem of imagensAntes) {
        if (!emUso.has(imagem)) {
          await deleteStoredImage(imagem, runtimeConfig);
        }
      }

      await appendAuditLog(repositories, req, {
        action: "site_content_updated",
        entityType: "site_content",
        entityId: section,
        summary: `Conteúdo do site atualizado: ${sanitizeAuditString(section, 60)}.`,
        metadata: {
          section
        }
      });

      return res.json({
        ok: true,
        data: bundleAtualizado
      });
    })
  );

  app.get(
    "/api/admin/dashboard-summary",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      res.json({
        ok: true,
        data: await repositories.clinic.getDashboardSummary()
      });
    })
  );

  app.get(
    "/api/admin/leads",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const filters = sanitizeLeadFilters(req.query);
      res.json({
        ok: true,
        data: {
          items: await repositories.clinic.listLeads(filters),
          filters
        }
      });
    })
  );

  app.post(
    "/api/admin/leads",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const payload = validateWithSchema(schemas.leadSchema, sanitizeLeadPayload(req.body));
      const createdLead = await repositories.clinic.createLead(payload);
      await appendAuditLog(repositories, req, {
        action: "lead_created",
        entityType: "lead",
        entityId: createdLead.id,
        summary: "Lead criado.",
        metadata: {
          source: createdLead.source,
          interest: createdLead.interest,
          status: createdLead.status
        }
      });
      res.status(201).json({
        ok: true,
        data: createdLead
      });
    })
  );

  app.put(
    "/api/admin/leads/:id",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Lead");
      if (!(await repositories.clinic.getLeadById(id))) {
        throw new AppError("Lead não encontrado.", 404);
      }

      const payload = validateWithSchema(schemas.leadSchema, sanitizeLeadPayload(req.body));
      const updatedLead = await repositories.clinic.updateLead(id, payload);
      await appendAuditLog(repositories, req, {
        action: "lead_updated",
        entityType: "lead",
        entityId: id,
        summary: "Lead atualizado.",
        metadata: {
          status: updatedLead.status,
          interest: updatedLead.interest
        }
      });
      res.json({
        ok: true,
        data: updatedLead
      });
    })
  );

  app.delete(
    "/api/admin/leads/:id",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Lead");
      const existingLead = await repositories.clinic.getLeadById(id);
      if (!existingLead) {
        throw new AppError("Lead não encontrado.", 404);
      }

      await repositories.clinic.deleteLead(id);
      await appendAuditLog(repositories, req, {
        action: "lead_deleted",
        entityType: "lead",
        entityId: id,
        summary: "Lead excluído.",
        metadata: {
          status: existingLead.status,
          interest: existingLead.interest
        }
      });
      res.json({ ok: true });
    })
  );

  app.post(
    "/api/admin/leads/:id/convert-to-patient",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Lead");
      const existingLead = await repositories.clinic.getLeadById(id);
      if (!existingLead) {
        throw new AppError("Lead não encontrado.", 404);
      }

      // Converter duas vezes criava dois pacientes para a mesma pessoa. Um
      // duplo clique, ou a tela recarregada, bastava.
      if (existingLead.status === "virou_paciente") {
        throw new AppError(
          "Este contato já foi convertido em paciente.",
          409
        );
      }

      const camposEnviados = Object.keys(req.body || {});
      const hasOverridePayload = camposEnviados.length > 0;
      const sanitizedOverrides = hasOverridePayload ? sanitizePatientPayload(req.body) : {};
      const candidatePatient = buildPatientFromLead(
        existingLead,
        sanitizedOverrides,
        hasOverridePayload ? camposEnviados : null
      );

      // A exigência acompanha o TIPO escolhido para o paciente, não o interesse
      // que o lead registrou lá atrás: converter um contato marcado como
      // "responsável de adolescente" em paciente adulto é legítimo e não deve
      // travar pedindo dados de responsável.
      const precisaDeResponsavel = requiresGuardianForPatientType(
        candidatePatient.patientType
      );
      if (
        precisaDeResponsavel &&
        (!candidatePatient.guardianName || !candidatePatient.guardianPhone)
      ) {
        throw new AppError("Lead adolescente precisa de responsável antes da conversão.", 400, {
          fieldErrors: {
            guardianName: candidatePatient.guardianName
              ? []
              : ["Informe o nome do responsável para concluir a conversão."],
            guardianPhone: candidatePatient.guardianPhone
              ? []
              : ["Informe o telefone do responsável para concluir a conversão."]
          }
        });
      }

      const validatedPatient = validateWithSchema(schemas.patientSchema, candidatePatient);
      const result = await repositories.clinic.convertLeadToPatient(id, validatedPatient);
      if (!result) {
        throw new AppError("Não foi possível converter o lead.", 400);
      }

      await appendAuditLog(repositories, req, {
        action: "lead_converted_to_patient",
        entityType: "lead",
        entityId: id,
        summary: "Lead convertido em paciente.",
        metadata: {
          patientId: result.patient.id,
          patientType: result.patient.patientType
        }
      });

      res.status(201).json({
        ok: true,
        data: result
      });
    })
  );

  app.get(
    "/api/admin/patients",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const filters = sanitizePatientFilters(req.query);
      res.json({
        ok: true,
        data: {
          items: await repositories.clinic.listPatients(filters),
          filters
        }
      });
    })
  );

  app.post(
    "/api/admin/patients",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const payload = validateWithSchema(schemas.patientSchema, sanitizePatientPayload(req.body));
      // Mesma regra da edição: dado de responsável só faz sentido para
      // adolescente, e não pode acabar impresso como pagador no recibo.
      if (!requiresGuardianForPatientType(payload.patientType)) {
        payload.guardianName = "";
        payload.guardianPhone = "";
      }

      const createdPatient = await repositories.clinic.createPatient(payload);
      await appendAuditLog(repositories, req, {
        action: "patient_created",
        entityType: "patient",
        entityId: createdPatient.id,
        summary: "Paciente criado.",
        metadata: {
          patientType: createdPatient.patientType,
          status: createdPatient.status
        }
      });
      res.status(201).json({
        ok: true,
        data: createdPatient
      });
    })
  );

  app.put(
    "/api/admin/patients/:id",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Paciente");
      if (!(await repositories.clinic.getPatientById(id))) {
        throw new AppError("Paciente não encontrado.", 404);
      }

      const payload = validateWithSchema(schemas.patientSchema, sanitizePatientPayload(req.body));

      // Dados do responsável só fazem sentido para adolescente. Ao mudar o tipo,
      // eles continuavam gravados e apareciam como pagador no recibo — dado de
      // terceiro num documento onde já não cabe.
      if (!requiresGuardianForPatientType(payload.patientType)) {
        payload.guardianName = "";
        payload.guardianPhone = "";
      }

      const updatedPatient = await repositories.clinic.updatePatient(id, payload);
      await appendAuditLog(repositories, req, {
        action: "patient_updated",
        entityType: "patient",
        entityId: id,
        summary: "Paciente atualizado.",
        metadata: {
          patientType: updatedPatient.patientType,
          status: updatedPatient.status
        }
      });
      res.json({
        ok: true,
        data: updatedPatient
      });
    })
  );

  app.delete(
    "/api/admin/patients/:id",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Paciente");
      const existingPatient = await repositories.clinic.getPatientById(id);
      if (!existingPatient) {
        throw new AppError("Paciente não encontrado.", 404);
      }

      // A exclusão do paciente apaga o prontuário inteiro em cascata — contrato,
      // plano, anamnese, evoluções e documentos. Registro concluído, assinado,
      // emitido ou encerrado não pode ser destruído por essa via: o caminho
      // correto é inativar o paciente e preservar o prontuário.
      const footprint = await clinicalService.getClinicalRecordFootprint({
        patientId: id,
        repositories
      });

      if (footprint.hasDefinitiveRecords) {
        throw new AppError(
          buildDefinitiveRecordError(footprint),
          409
        );
      }

      const recibos = await repositories.phase2.listReceipts({ patientId: id });
      if (recibos.length) {
        throw new AppError(
          `Este paciente tem ${recibos.length} recibo(s) emitido(s) e não pode ser apagado. ` +
            "Marque o paciente como encerrado para fechar o acompanhamento sem perder os documentos.",
          409
        );
      }

      // Só depois de TODAS as recusas: limpar a agenda antes fazia uma exclusão
      // que terminava em 409 já ter apagado os compromissos do paciente — e
      // disparado avisos de cancelamento para ele — sem nada ter sido excluído.
      //
      // As sessões somem por cascata, e com elas a referência aos eventos: sem
      // remover aqui, os compromissos ficam para sempre na agenda com o nome de
      // alguém que já não está no sistema.
      const services = await getServices(req);
      const sessoesDoPaciente = await repositories.clinic.listSessions({ patientId: id });
      for (const sessao of sessoesDoPaciente) {
        if (sessao.googleCalendarEventId) {
          await services.googleCalendarSync.removeSessionEvent(repositories, sessao.id);
        }
      }

      await repositories.clinic.deletePatient(id);
      await appendAuditLog(repositories, req, {
        action: "patient_deleted",
        entityType: "patient",
        entityId: id,
        summary: "Paciente excluído.",
        metadata: {
          patientType: existingPatient.patientType,
          status: existingPatient.status
        }
      });

      // Rascunhos podem ir junto, mas a destruição de conteúdo clínico precisa
      // deixar rastro próprio — o log de exclusão de paciente não conta isso.
      if (footprint.hasRecords) {
        await appendAuditLog(repositories, req, {
          action: "clinical_record_destroyed",
          entityType: "clinical_record",
          entityId: id,
          summary: "Prontuário em rascunho destruído junto com a exclusão do paciente.",
          metadata: {
            hadIntake: footprint.hasIntake,
            hadRecord: footprint.hasRecord,
            evolutionsCount: footprint.evolutionsCount,
            documentsCount: footprint.documentsCount
          }
        });
      }
      res.json({ ok: true });
    })
  );

  app.get(
    "/api/admin/sessions",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const filters = sanitizeSessionFilters(req.query);
      res.json({
        ok: true,
        data: {
          items: await repositories.clinic.listSessions(filters),
          filters
        }
      });
    })
  );

  app.post(
    "/api/admin/sessions",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const services = await getServices(req);
      const payload = validateWithSchema(schemas.sessionSchema, sanitizeSessionPayload(req.body));
      if (!(await repositories.clinic.getPatientById(payload.patientId))) {
        throw new AppError("Paciente não encontrado para esta sessão.", 404);
      }

      const createdSession = await repositories.clinic.createSession(payload);
      const syncedSession = await services.googleCalendarSync.syncSession(
        repositories,
        createdSession.id
      );
      await appendAuditLog(repositories, req, {
        action: "session_created",
        entityType: "session",
        entityId: syncedSession.id,
        summary: "Sessão criada.",
        metadata: {
          patientId: syncedSession.patientId,
          status: syncedSession.status,
          paymentStatus: syncedSession.paymentStatus
        }
      });

      res.status(201).json({
        ok: true,
        data: syncedSession
      });
    })
  );

  app.get(
    "/api/admin/audit-logs",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const filters = sanitizeAuditLogFilters(req.query);
      const result = await repositories.phase2.listAuditLogs(filters);
      res.json({
        ok: true,
        data: result,
        meta: {
          filters: {
            action: filters.action,
            entityType: filters.entityType,
            adminEmail: filters.adminEmail,
            date: filters.date,
            page: filters.page,
            pageSize: filters.pageSize
          }
        }
      });
    })
  );

  app.put(
    "/api/admin/sessions/:id",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const services = await getServices(req);
      const id = parseEntityId(req.params.id, "Sessão");
      const sessaoAtual = await repositories.clinic.getSessionById(id);
      if (!sessaoAtual) {
        throw new AppError("Sessão não encontrada.", 404);
      }

      const payload = validateWithSchema(schemas.sessionSchema, sanitizeSessionPayload(req.body));
      if (!(await repositories.clinic.getPatientById(payload.patientId))) {
        throw new AppError("Paciente não encontrado para esta sessão.", 404);
      }

      // O recibo é um documento já entregue, com paciente, valor e data
      // impressos. Deixar a sessão ser editada por baixo dele fazia o PDF
      // descrever uma coisa e o sistema outra.
      const reciboDaSessao = await repositories.phase2.getReceiptBySessionId(id);
      if (reciboDaSessao && mudaOQueOReciboAfirma(sessaoAtual, payload)) {
        throw new AppError(
          `Esta sessão tem o recibo ${reciboDaSessao.receiptNumber} emitido. ` +
            "Paciente, valor e data não podem mudar sem reemitir o documento.",
          409
        );
      }

      await repositories.clinic.updateSession(id, payload);
      const syncedSession = await services.googleCalendarSync.syncSession(repositories, id);
      await appendAuditLog(repositories, req, {
        action: payload.status === "remarcada" ? "session_rescheduled" : "session_updated",
        entityType: "session",
        entityId: id,
        summary:
          payload.status === "remarcada" ? "Sessão remarcada." : "Sessão atualizada.",
        metadata: {
          patientId: syncedSession.patientId,
          status: syncedSession.status,
          paymentStatus: syncedSession.paymentStatus
        }
      });

      res.json({
        ok: true,
        data: syncedSession
      });
    })
  );

  app.delete(
    "/api/admin/sessions/:id",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Sessão");
      const existingSession = await repositories.clinic.getSessionById(id);
      if (!existingSession) {
        throw new AppError("Sessão não encontrada.", 404);
      }

      // A tabela de recibos apaga em cascata pela sessão. Excluir aqui levaria
      // junto um documento já entregue ao paciente e deixaria o PDF órfão no
      // storage privado. Cancelar preserva o histórico.
      const recibo = await repositories.phase2.getReceiptBySessionId(id);
      if (recibo) {
        throw new AppError(
          `Esta sessão tem o recibo ${recibo.receiptNumber} emitido e não pode ser excluída. ` +
            "Cancele a sessão para manter o histórico.",
          409
        );
      }

      // Remove o compromisso da agenda do paciente antes de apagar a sessão:
      // depois do delete não há mais como saber qual era o evento.
      const services = await getServices(req);
      await services.googleCalendarSync.removeSessionEvent(repositories, id);

      await repositories.clinic.deleteSession(id);
      await appendAuditLog(repositories, req, {
        action: "session_deleted",
        entityType: "session",
        entityId: id,
        summary: "Sessão excluída.",
        metadata: {
          patientId: existingSession.patientId,
          status: existingSession.status,
          paymentStatus: existingSession.paymentStatus
        }
      });
      res.json({ ok: true });
    })
  );

  app.post(
    "/api/admin/sessions/:id/mark-paid",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Sessão");
      const sessionToPay = await repositories.clinic.getSessionById(id);
      if (!sessionToPay) {
        throw new AppError("Sessão não encontrada.", 404);
      }

      // Sem forma de pagamento no corpo, preserva a que já estava na sessão.
      // Antes o default "pix" sobrescrevia, por exemplo, uma transferência.
      const paymentMethod = sanitizePlainText(req.body.paymentMethod || "");
      const payload = validateWithSchema(schemas.sessionPaymentSchema, {
        ...(paymentMethod ? { paymentMethod } : {}),
        paidAt: sanitizeDateLike(req.body.paidAt || "")
      });
      const updatedSession = await repositories.clinic.markSessionPaid(id, {
        paymentMethod: payload.paymentMethod || sessionToPay.paymentMethod || "pix",
        paidAt: payload.paidAt || undefined
      });
      await appendAuditLog(repositories, req, {
        action: "session_payment_marked",
        entityType: "session",
        entityId: id,
        summary: "Pagamento de sessão marcado como pago.",
        metadata: {
          paymentMethod: updatedSession.paymentMethod,
          paymentStatus: updatedSession.paymentStatus
        }
      });

      res.json({
        ok: true,
        data: updatedSession
      });
    })
  );

  app.post(
    "/api/admin/sessions/:id/mark-done",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Sessão");
      if (!(await repositories.clinic.getSessionById(id))) {
        throw new AppError("Sessão não encontrada.", 404);
      }
      const updatedSession = await repositories.clinic.markSessionDone(id);
      await appendAuditLog(repositories, req, {
        action: "session_marked_done",
        entityType: "session",
        entityId: id,
        summary: "Sessão marcada como realizada.",
        metadata: {
          status: updatedSession.status
        }
      });

      res.json({
        ok: true,
        data: updatedSession
      });
    })
  );

  app.post(
    "/api/admin/sessions/:id/mark-missed",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Sessão");
      if (!(await repositories.clinic.getSessionById(id))) {
        throw new AppError("Sessão não encontrada.", 404);
      }
      const updatedSession = await repositories.clinic.markSessionMissed(id);
      await appendAuditLog(repositories, req, {
        action: "session_marked_missed",
        entityType: "session",
        entityId: id,
        summary: "Sessão marcada como falta.",
        metadata: {
          status: updatedSession.status
        }
      });

      res.json({
        ok: true,
        data: updatedSession
      });
    })
  );

  app.post(
    "/api/admin/sessions/:id/cancel",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const services = await getServices(req);
      const id = parseEntityId(req.params.id, "Sessão");
      if (!(await repositories.clinic.getSessionById(id))) {
        throw new AppError("Sessão não encontrada.", 404);
      }

      await repositories.clinic.cancelSession(id);
      const syncedSession = await services.googleCalendarSync.syncSession(repositories, id);
      await appendAuditLog(repositories, req, {
        action: "session_canceled",
        entityType: "session",
        entityId: id,
        summary: "Sessão cancelada.",
        metadata: {
          status: syncedSession.status,
          paymentStatus: syncedSession.paymentStatus
        }
      });

      res.json({
        ok: true,
        data: syncedSession
      });
    })
  );

  app.post(
    "/api/admin/sessions/:id/retry-google-sync",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const services = await getServices(req);
      const id = parseEntityId(req.params.id, "Sessão");
      // Com a sincronização desligada, syncSession marcaria a sessão como
      // "skipped" e apagaria a mensagem do erro — o histórico da falha sumia e
      // a tela dizia que tudo certo, sem nada ter sido enviado.
      const agenda = await repositories.clinic.getPlatformSettings();
      if (!agenda.googleCalendarEnabled) {
        throw new AppError(
          "Ative a sincronização com o Google Calendar antes de tentar de novo.",
          400
        );
      }

      const syncedSession = await services.googleCalendarSync.syncSession(repositories, id);
      await appendAuditLog(repositories, req, {
        action: "google_calendar_retry_session_sync",
        entityType: "session",
        entityId: id,
        summary: "Reprocessamento manual de sincronização do Google Calendar.",
        metadata: {
          googleCalendarSyncStatus: syncedSession.googleCalendarSyncStatus
        }
      });

      res.json({
        ok: true,
        data: syncedSession
      });
    })
  );

  app.get(
    "/api/admin/finance/summary",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const filters = sanitizeFinanceFilters(req.query);
      res.json({
        ok: true,
        data: {
          ...(await repositories.clinic.getFinanceSummary(filters)),
          filters
        }
      });
    })
  );

  app.get(
    "/api/admin/finance/export.csv",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const filters = sanitizeFinanceFilters(req.query);
      const items = await repositories.clinic.listFinanceSessions(filters);

      // O arquivo sai com nome de paciente e valor: é saída de dado pessoal e
      // precisa de rastro, como as demais leituras sensíveis.
      await appendAuditLog(repositories, req, {
        action: "finance_csv_exported",
        entityType: "finance",
        entityId: `${filters.year}-${filters.month}`,
        summary: "Financeiro exportado em CSV.",
        metadata: { month: filters.month, year: filters.year, linhas: items.length }
      });

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="financeiro.csv"');
      // BOM: sem ele o Excel lê o arquivo como Latin-1 e nome acentuado abre
      // corrompido, que é como a planilha chega na mão de quem usa.
      res.status(200).send(`${BOM_UTF8}${buildFinanceCsvRows(items)}`);
    })
  );

  app.get(
    "/api/admin/receipts",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const filters = sanitizeReceiptFilters(req.query);
      res.json({
        ok: true,
        data: {
          items: serializeReceiptListForAdmin(
            await repositories.phase2.listReceipts(buildReceiptFilters(filters))
          ),
          filters
        }
      });
    })
  );

  app.get(
    "/api/admin/receipts/:id",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Recibo");
      const receipt = await repositories.phase2.getReceiptById(id);
      if (!receipt) {
        throw new AppError("Recibo não encontrado.", 404);
      }

      res.json({
        ok: true,
        data: serializeReceiptForAdmin(receipt)
      });
    })
  );

  app.post(
    "/api/admin/sessions/:id/receipt",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Sessão");
      const result = await generateReceiptForSession({
        sessionId: id,
        force: parseBooleanFlag(req.body.force || req.query.force),
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "receipt_generated",
        entityType: "receipt",
        entityId: result.receipt.id,
        summary: result.reused ? "Recibo reutilizado." : "Recibo gerado.",
        metadata: {
          sessionId: result.receipt.sessionId,
          receiptNumber: result.receipt.receiptNumber,
          reused: result.reused
        }
      });

      res.status(result.reused ? 200 : 201).json({
        ok: true,
        data: serializeReceiptForAdmin(result.receipt),
        meta: {
          reused: result.reused,
          deliveryMessage: result.deliveryMessage
        }
      });
    })
  );

  app.get(
    "/api/admin/receipts/:id/download",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Recibo");
      const { receipt, buffer } = await downloadReceiptById({
        receiptId: id,
        repositories,
        runtimeConfig
      });

      res.setHeader("Content-Type", receipt.fileContentType || "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${receipt.receiptNumber.toLowerCase()}.pdf"`
      );
      await appendAuditLog(repositories, req, {
        action: "receipt_downloaded",
        entityType: "receipt",
        entityId: receipt.id,
        summary: "Recibo baixado.",
        metadata: {
          receiptNumber: receipt.receiptNumber,
          sessionId: receipt.sessionId
        }
      });
      res.status(200).send(buffer);
    })
  );

  // ── Prontuário clínico (anamnese + evoluções) ────────────────────────────
  app.get(
    "/api/admin/patients/:patientId/clinical-record",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const patientId = parseEntityId(req.params.patientId, "Paciente");
      const summary = await clinicalService.getClinicalRecordSummary({
        patientId,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_record_viewed",
        entityType: "clinical_record",
        entityId: patientId,
        summary: "Prontuário visualizado.",
        metadata: {
          patientId,
          intakeId: summary.intake?.id || null,
          status: summary.intake?.status || "ausente",
          evolutionsCount: summary.evolutionsCount
        }
      });
      res.json({ ok: true, data: summary });
    })
  );

  app.get(
    "/api/admin/patients/:patientId/clinical-record/export.pdf",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const patientId = parseEntityId(req.params.patientId, "Paciente");
      const { patient, buffer } = await clinicalService.exportClinicalRecordPdf({
        patientId,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_record_exported",
        entityType: "clinical_record",
        entityId: patientId,
        summary: "Prontuário completo exportado.",
        metadata: { patientId, exportType: "clinical_record" }
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="prontuario-${patient.id}.pdf"`
      );
      res.status(200).send(buffer);
    })
  );

  // ── Prontuário: abertura e encerramento ──────────────────────────────────
  app.post(
    "/api/admin/patients/:patientId/clinical-record",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const patientId = parseEntityId(req.params.patientId, "Paciente");
      const { record, created } = await clinicalRecordService.openRecordForPatient({
        patientId,
        adminUser: req.adminUser,
        repositories,
        runtimeConfig
      });
      if (created) {
        await appendAuditLog(repositories, req, {
          action: "clinical_record_opened",
          entityType: "clinical_record",
          entityId: record.id,
          summary: "Prontuário aberto.",
          metadata: { patientId, recordNumber: record.recordNumber }
        });
      }
      res.status(created ? 201 : 200).json({ ok: true, data: record });
    })
  );

  app.post(
    "/api/admin/clinical-records/:id/close",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const recordId = parseEntityId(req.params.id, "Prontuário");
      const payload = validateWithSchema(schemas.recordCloseSchema, req.body || {});
      const record = await clinicalRecordService.closeRecord({
        recordId,
        closingReason: payload.closingReason,
        payload: { sections: payload.sections },
        adminUser: req.adminUser,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_record_closed",
        entityType: "clinical_record",
        entityId: recordId,
        summary: "Prontuário encerrado.",
        metadata: {
          patientId: record.patientId,
          recordNumber: record.recordNumber,
          closingReason: record.closingReason
        }
      });
      res.json({ ok: true, data: record });
    })
  );

  app.post(
    "/api/admin/clinical-records/:id/reopen",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const recordId = parseEntityId(req.params.id, "Prontuário");
      const payload = validateWithSchema(schemas.recordReopenSchema, req.body || {});
      const record = await clinicalRecordService.reopenRecord({
        recordId,
        reason: payload.reason,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_record_reopened",
        entityType: "clinical_record",
        entityId: recordId,
        summary: "Prontuário reaberto.",
        metadata: {
          patientId: record.patientId,
          recordNumber: record.recordNumber,
          reason: sanitizeAuditString(payload.reason, 300)
        }
      });
      res.json({ ok: true, data: record });
    })
  );

  // ── Prontuário: contrato, plano terapêutico e encerramento ───────────────
  app.get(
    "/api/admin/clinical-records/:id/blocks/:blockType",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const recordId = parseEntityId(req.params.id, "Prontuário");
      const result = await clinicalRecordService.getBlockForRecord({
        recordId,
        blockType: req.params.blockType,
        repositories,
        runtimeConfig
      });
      if (result.block) {
        await appendAuditLog(repositories, req, {
          action: "clinical_record_block_viewed",
          entityType: "clinical_record_block",
          entityId: result.block.id,
          summary: `${result.block.blockLabel} visualizado.`,
          metadata: {
            recordId,
            blockType: result.block.blockType,
            status: result.block.status
          }
        });
      }
      res.json({ ok: true, data: result });
    })
  );

  app.put(
    "/api/admin/clinical-records/:id/blocks/:blockType",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const recordId = parseEntityId(req.params.id, "Prontuário");
      const payload = validateWithSchema(schemas.recordBlockPayloadSchema, req.body || {});
      const block = await clinicalRecordService.saveBlock({
        recordId,
        blockType: req.params.blockType,
        payload: { sections: payload.sections },
        changeReason: payload.changeReason,
        adminUser: req.adminUser,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_record_block_updated",
        entityType: "clinical_record_block",
        entityId: block.id,
        summary: `${block.blockLabel} atualizado.`,
        metadata: {
          recordId,
          blockType: block.blockType,
          status: block.status,
          versionsCount: block.versionsCount
        }
      });
      res.json({ ok: true, data: block });
    })
  );

  app.post(
    "/api/admin/clinical-records/:id/blocks/:blockType/complete",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const recordId = parseEntityId(req.params.id, "Prontuário");
      const block = await clinicalRecordService.completeBlock({
        recordId,
        blockType: req.params.blockType,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_record_block_completed",
        entityType: "clinical_record_block",
        entityId: block.id,
        summary: `${block.blockLabel} concluído.`,
        metadata: { recordId, blockType: block.blockType }
      });
      res.json({ ok: true, data: block });
    })
  );

  app.post(
    "/api/admin/clinical-records/:id/blocks/:blockType/lock",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const recordId = parseEntityId(req.params.id, "Prontuário");
      const block = await clinicalRecordService.lockBlock({
        recordId,
        blockType: req.params.blockType,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_record_block_locked",
        entityType: "clinical_record_block",
        entityId: block.id,
        summary: `${block.blockLabel} bloqueado.`,
        metadata: { recordId, blockType: block.blockType }
      });
      res.json({ ok: true, data: block });
    })
  );

  app.get(
    "/api/admin/clinical-records/:id/blocks/:blockType/export.pdf",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const recordId = parseEntityId(req.params.id, "Prontuário");
      const { block, buffer } = await clinicalRecordService.exportBlockPdf({
        recordId,
        blockType: req.params.blockType,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_record_block_exported",
        entityType: "clinical_record_block",
        entityId: block.id,
        summary: "Bloco do prontuário exportado.",
        metadata: { recordId, blockType: block.blockType }
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${block.blockType}-${recordId}.pdf"`
      );
      res.status(200).send(buffer);
    })
  );

  // ── Prontuário: documentos emitidos ──────────────────────────────────────
  app.get(
    "/api/admin/clinical-records/:id/documents",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const recordId = parseEntityId(req.params.id, "Prontuário");
      const items = await clinicalDocumentsService.listDocuments({
        recordId,
        repositories,
        runtimeConfig
      });
      res.json({ ok: true, data: items });
    })
  );

  app.post(
    "/api/admin/clinical-records/:id/documents",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const recordId = parseEntityId(req.params.id, "Prontuário");
      const payload = validateWithSchema(schemas.clinicalDocumentSchema, req.body || {});
      const document = await clinicalDocumentsService.issueDocument({
        recordId,
        payload,
        adminUser: req.adminUser,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_document_issued",
        entityType: "clinical_document",
        entityId: document.id,
        summary: `${document.documentTypeLabel} emitido.`,
        metadata: {
          recordId,
          patientId: document.patientId,
          documentNumber: document.documentNumber,
          documentType: document.documentType
        }
      });
      res.status(201).json({ ok: true, data: document });
    })
  );

  app.get(
    "/api/admin/clinical-documents/:id",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const documentId = parseEntityId(req.params.id, "Documento");
      const document = await clinicalDocumentsService.getDocument({
        documentId,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_document_viewed",
        entityType: "clinical_document",
        entityId: documentId,
        summary: "Documento visualizado.",
        metadata: {
          documentNumber: document.documentNumber,
          documentType: document.documentType
        }
      });
      res.json({ ok: true, data: document });
    })
  );

  app.get(
    "/api/admin/clinical-documents/:id/download",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const documentId = parseEntityId(req.params.id, "Documento");
      const { document, buffer } = await clinicalDocumentsService.downloadDocument({
        documentId,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_document_downloaded",
        entityType: "clinical_document",
        entityId: documentId,
        summary: "Documento baixado.",
        metadata: {
          documentNumber: document.documentNumber,
          documentType: document.documentType
        }
      });
      res.setHeader("Content-Type", document.fileContentType || "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${document.documentNumber || "documento"}.pdf"`
      );
      res.status(200).send(buffer);
    })
  );

  app.post(
    "/api/admin/clinical-documents/:id/revoke",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const documentId = parseEntityId(req.params.id, "Documento");
      const payload = validateWithSchema(schemas.documentRevokeSchema, req.body || {});
      const document = await clinicalDocumentsService.revokeDocument({
        documentId,
        reason: payload.reason,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_document_revoked",
        entityType: "clinical_document",
        entityId: documentId,
        summary: `${document.documentTypeLabel} revogado.`,
        metadata: {
          documentNumber: document.documentNumber,
          documentType: document.documentType,
          reason: sanitizeAuditString(payload.reason, 300)
        }
      });
      res.json({ ok: true, data: document });
    })
  );

  app.get(
    "/api/admin/patients/:patientId/intake",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const patientId = parseEntityId(req.params.patientId, "Paciente");
      const result = await clinicalService.getIntakeForPatient({
        patientId,
        repositories,
        runtimeConfig
      });
      if (result.intake) {
        await appendAuditLog(repositories, req, {
          action: "clinical_intake_viewed",
          entityType: "clinical_intake",
          entityId: result.intake.id,
          summary: "Anamnese visualizada.",
          metadata: {
            patientId,
            intakeId: result.intake.id,
            status: result.intake.status
          }
        });
      }
      res.json({ ok: true, data: result });
    })
  );

  app.post(
    "/api/admin/patients/:patientId/intake",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const patientId = parseEntityId(req.params.patientId, "Paciente");
      const payload = validateWithSchema(schemas.intakePayloadSchema, req.body || {});
      const intake = await clinicalService.createIntakeForPatient({
        patientId,
        payload,
        adminUser: req.adminUser,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_intake_created",
        entityType: "clinical_intake",
        entityId: intake.id,
        summary: "Anamnese criada.",
        metadata: { patientId, intakeId: intake.id, status: intake.status }
      });
      res.status(201).json({ ok: true, data: intake });
    })
  );

  app.put(
    "/api/admin/intakes/:id",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Anamnese");
      const payload = validateWithSchema(schemas.intakePayloadSchema, req.body || {});
      const intake = await clinicalService.updateIntake({
        intakeId: id,
        payload,
        changeReason: req.body?.changeReason,
        adminUser: req.adminUser,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_intake_updated",
        entityType: "clinical_intake",
        entityId: intake.id,
        summary: "Anamnese atualizada.",
        metadata: { patientId: intake.patientId, intakeId: intake.id, status: intake.status }
      });
      res.json({ ok: true, data: intake });
    })
  );

  app.post(
    "/api/admin/intakes/:id/complete",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Anamnese");
      const intake = await clinicalService.completeIntake({
        intakeId: id,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_intake_completed",
        entityType: "clinical_intake",
        entityId: intake.id,
        summary: "Anamnese concluída.",
        metadata: { patientId: intake.patientId, intakeId: intake.id, status: intake.status }
      });
      res.json({ ok: true, data: intake });
    })
  );

  app.post(
    "/api/admin/intakes/:id/lock",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Anamnese");
      const intake = await clinicalService.lockIntake({
        intakeId: id,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_intake_locked",
        entityType: "clinical_intake",
        entityId: intake.id,
        summary: "Anamnese bloqueada.",
        metadata: { patientId: intake.patientId, intakeId: intake.id, status: intake.status }
      });
      res.json({ ok: true, data: intake });
    })
  );

  app.get(
    "/api/admin/intakes/:id/export.pdf",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Anamnese");
      const { intake, buffer } = await clinicalService.exportIntakePdf({
        intakeId: id,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_intake_exported",
        entityType: "clinical_intake",
        entityId: intake.id,
        summary: "Anamnese exportada.",
        metadata: { patientId: intake.patientId, intakeId: intake.id, exportType: "intake" }
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="anamnese-${intake.id}.pdf"`);
      res.status(200).send(buffer);
    })
  );

  app.get(
    "/api/admin/patients/:patientId/evolutions",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const patientId = parseEntityId(req.params.patientId, "Paciente");
      // Única rota de leitura do prontuário que não registrava acesso. Como
      // devolve a relação inteira de evoluções do paciente, a trilha precisa
      // saber que alguém a consultou.
      const items = await clinicalService.listEvolutions({
        patientId,
        repositories,
        runtimeConfig
      });

      await appendAuditLog(repositories, req, {
        action: "clinical_evolutions_listed",
        entityType: "clinical_record",
        entityId: patientId,
        summary: "Relação de evoluções do prontuário consultada.",
        metadata: { patientId, evolutionsCount: items.length }
      });

      res.json({ ok: true, data: { items } });
    })
  );

  app.get(
    "/api/admin/evolutions/:id",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Evolução");
      const evolution = await clinicalService.getEvolution({
        evolutionId: id,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_evolution_viewed",
        entityType: "clinical_evolution",
        entityId: evolution.id,
        summary: "Evolução visualizada.",
        metadata: {
          patientId: evolution.patientId,
          evolutionId: evolution.id,
          sessionId: evolution.sessionId || null,
          evolutionType: evolution.evolutionType,
          status: evolution.status
        }
      });
      res.json({ ok: true, data: evolution });
    })
  );

  app.post(
    "/api/admin/evolutions",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const payload = validateWithSchema(schemas.evolutionCreateSchema, req.body || {});
      const evolution = await clinicalService.createEvolution({
        payload,
        adminUser: req.adminUser,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_evolution_created",
        entityType: "clinical_evolution",
        entityId: evolution.id,
        summary: "Evolução criada.",
        metadata: {
          patientId: evolution.patientId,
          evolutionId: evolution.id,
          sessionId: evolution.sessionId || null,
          evolutionType: evolution.evolutionType,
          status: evolution.status
        }
      });
      res.status(201).json({ ok: true, data: evolution });
    })
  );

  app.put(
    "/api/admin/evolutions/:id",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Evolução");
      const payload = validateWithSchema(schemas.evolutionUpdateSchema, req.body || {});
      const evolution = await clinicalService.updateEvolution({
        evolutionId: id,
        payload,
        changeReason: req.body?.changeReason,
        adminUser: req.adminUser,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_evolution_updated",
        entityType: "clinical_evolution",
        entityId: evolution.id,
        summary: "Evolução atualizada.",
        metadata: {
          patientId: evolution.patientId,
          evolutionId: evolution.id,
          evolutionType: evolution.evolutionType,
          status: evolution.status
        }
      });
      res.json({ ok: true, data: evolution });
    })
  );

  app.post(
    "/api/admin/evolutions/:id/sign",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Evolução");
      const evolution = await clinicalService.signEvolution({
        evolutionId: id,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_evolution_signed",
        entityType: "clinical_evolution",
        entityId: evolution.id,
        summary: "Evolução assinada.",
        metadata: {
          patientId: evolution.patientId,
          evolutionId: evolution.id,
          status: evolution.status
        }
      });
      res.json({ ok: true, data: evolution });
    })
  );

  app.post(
    "/api/admin/evolutions/:id/lock",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Evolução");
      const evolution = await clinicalService.lockEvolution({
        evolutionId: id,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_evolution_locked",
        entityType: "clinical_evolution",
        entityId: evolution.id,
        summary: "Evolução bloqueada.",
        metadata: {
          patientId: evolution.patientId,
          evolutionId: evolution.id,
          status: evolution.status
        }
      });
      res.json({ ok: true, data: evolution });
    })
  );

  app.post(
    "/api/admin/evolutions/:id/addendum",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Evolução");
      const payload = validateWithSchema(schemas.evolutionAddendumSchema, req.body || {});
      const evolution = await clinicalService.createAddendum({
        evolutionId: id,
        payload,
        adminUser: req.adminUser,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_evolution_addendum_created",
        entityType: "clinical_evolution",
        entityId: evolution.id,
        summary: "Adendo/retificação criado.",
        metadata: {
          patientId: evolution.patientId,
          evolutionId: evolution.id,
          parentEvolutionId: evolution.parentEvolutionId || null,
          evolutionType: evolution.evolutionType,
          status: evolution.status
        }
      });
      res.status(201).json({ ok: true, data: evolution });
    })
  );

  app.get(
    "/api/admin/evolutions/:id/export.pdf",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Evolução");
      const { evolution, buffer } = await clinicalService.exportEvolutionPdf({
        evolutionId: id,
        repositories,
        runtimeConfig
      });
      await appendAuditLog(repositories, req, {
        action: "clinical_evolution_exported",
        entityType: "clinical_evolution",
        entityId: evolution.id,
        summary: "Evolução exportada.",
        metadata: {
          patientId: evolution.patientId,
          evolutionId: evolution.id,
          exportType: "evolution"
        }
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="evolucao-${evolution.id}.pdf"`);
      res.status(200).send(buffer);
    })
  );

  app.get(
    "/api/admin/message-templates",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const filters = sanitizeMessageTemplateFilters(req.query);
      res.json({
        ok: true,
        data: {
          items: await repositories.clinic.listMessageTemplates(filters),
          filters
        }
      });
    })
  );

  app.post(
    "/api/admin/message-templates",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const payload = validateWithSchema(
        schemas.messageTemplateSchema,
        sanitizeMessageTemplatePayload(req.body)
      );
      const createdTemplate = await repositories.clinic.createMessageTemplate(payload);
      await appendAuditLog(repositories, req, {
        action: "message_template_created",
        entityType: "message_template",
        entityId: createdTemplate.id,
        summary: "Modelo de mensagem criado.",
        metadata: {
          category: createdTemplate.category,
          isActive: createdTemplate.isActive
        }
      });
      res.status(201).json({
        ok: true,
        data: createdTemplate
      });
    })
  );

  app.put(
    "/api/admin/message-templates/:id",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Modelo");
      if (!(await repositories.clinic.getMessageTemplateById(id))) {
        throw new AppError("Modelo não encontrado.", 404);
      }

      const payload = validateWithSchema(
        schemas.messageTemplateSchema,
        sanitizeMessageTemplatePayload(req.body)
      );
      const updatedTemplate = await repositories.clinic.updateMessageTemplate(id, payload);
      await appendAuditLog(repositories, req, {
        action: "message_template_updated",
        entityType: "message_template",
        entityId: id,
        summary: "Modelo de mensagem atualizado.",
        metadata: {
          category: updatedTemplate.category,
          isActive: updatedTemplate.isActive
        }
      });
      res.json({
        ok: true,
        data: updatedTemplate
      });
    })
  );

  app.delete(
    "/api/admin/message-templates/:id",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const id = parseEntityId(req.params.id, "Modelo");
      const existingTemplate = await repositories.clinic.getMessageTemplateById(id);
      if (!existingTemplate) {
        throw new AppError("Modelo não encontrado.", 404);
      }

      await repositories.clinic.deleteMessageTemplate(id);
      await appendAuditLog(repositories, req, {
        action: "message_template_deleted",
        entityType: "message_template",
        entityId: id,
        summary: "Modelo de mensagem excluído.",
        metadata: {
          category: existingTemplate.category,
          isActive: existingTemplate.isActive
        }
      });
      res.json({ ok: true });
    })
  );

  app.get(
    "/api/admin/platform-settings",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      res.json({
        ok: true,
        data: await repositories.clinic.getPlatformSettings()
      });
    })
  );

  app.put(
    "/api/admin/platform-settings",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const payload = validateWithSchema(schemas.platformSettingsSchema, {
        ...(await repositories.clinic.getPlatformSettings()),
        ...sanitizePlatformSettingsPayload(req.body)
      });
      const savedSettings = await repositories.clinic.setPlatformSettings(payload);
      await appendAuditLog(repositories, req, {
        action: "platform_settings_updated",
        entityType: "platform_settings",
        entityId: "agenda",
        summary: "Configurações administrativas atualizadas.",
        metadata: {
          showSchedulingButton: savedSettings.showSchedulingButton,
          googleCalendarEnabled: savedSettings.googleCalendarEnabled
        }
      });
      res.json({
        ok: true,
        data: savedSettings
      });
    })
  );

  app.get(
    "/api/admin/google-calendar/status",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const services = await getServices(req);
      res.json({
        ok: true,
        data: await services.googleCalendarSync.getStatus(repositories)
      });
    })
  );

  app.get(
    "/api/admin/google-calendar/auth-url",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const services = await getServices(req);
      res.json({
        ok: true,
        data: {
          url: await services.googleCalendarSync.getAuthUrl(req.adminUser)
        }
      });
    })
  );

  app.get(
    "/api/admin/google-calendar/callback",
    requireAdminPage,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const services = await getServices(req);
      const code = sanitizePlainText(req.query.code || "");
      const stateToken = sanitizePlainText(req.query.state || "");

      if (!code || !stateToken) {
        throw new AppError("Callback do Google Calendar inválido.", 400);
      }

      await services.googleCalendarSync.handleCallback(
        repositories,
        req.adminUser,
        code,
        stateToken
      );
      await appendAuditLog(repositories, req, {
        action: "google_calendar_connected",
        entityType: "google_calendar",
        entityId: "default",
        summary: "Google Calendar conectado."
      });

      return res.redirect("/admin/dashboard?panel=agenda&googleCalendar=connected");
    })
  );

  app.post(
    "/api/admin/google-calendar/disconnect",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const services = await getServices(req);
      const revogacao = await services.googleCalendarSync.disconnect(repositories);
      await appendAuditLog(repositories, req, {
        action: "google_calendar_disconnected",
        entityType: "google_calendar",
        entityId: "default",
        summary: revogacao?.revoked
          ? "Google Calendar desconectado e acesso revogado na conta Google."
          : "Google Calendar desconectado; a revogação na conta Google não foi confirmada.",
        metadata: { revoked: Boolean(revogacao?.revoked) }
      });

      // A conexão local sempre é apagada, mas quem desconecta precisa saber se
      // o acesso foi mesmo revogado do lado do Google — senão fica achando que
      // encerrou algo que continua autorizado.
      res.json({
        ok: true,
        data: { revoked: Boolean(revogacao?.revoked) },
        meta: {
          aviso: revogacao?.revoked
            ? ""
            : "Desconectado aqui, mas o Google não confirmou a revogação. Revise o acesso em myaccount.google.com/permissions."
        }
      });
    })
  );

  app.get(
    "/api/admin/google-calendar/calendars",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const services = await getServices(req);
      res.json({
        ok: true,
        data: {
          items: await services.googleCalendarSync.listCalendars(repositories)
        }
      });
    })
  );

  app.post(
    "/api/admin/google-calendar/test-connection",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const services = await getServices(req);
      const result = await services.googleCalendarSync.testConnection(repositories);
      await appendAuditLog(repositories, req, {
        action: "google_calendar_tested",
        entityType: "google_calendar",
        entityId: "default",
        summary: "Teste de conexão do Google Calendar executado.",
        metadata: {
          calendarsCount: result.calendarsCount
        }
      });
      res.json({
        ok: true,
        data: result
      });
    })
  );

  app.post(
    "/api/admin/google-calendar/reprocess-failures",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const services = await getServices(req);
      const result = await services.googleCalendarSync.reprocessFailures(repositories);
      await appendAuditLog(repositories, req, {
        action: "google_calendar_failures_reprocessed",
        entityType: "google_calendar",
        entityId: "default",
        summary: "Falhas do Google Calendar reprocessadas.",
        metadata: {
          processed: result.processed
        }
      });
      res.json({
        ok: true,
        data: result
      });
    })
  );

  app.put(
    "/api/admin/google-calendar/settings",
    requireAdminApi,
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const currentSettings = await repositories.clinic.getPlatformSettings();
      const payload = validateWithSchema(
        schemas.platformSettingsSchema.pick({
          googleCalendarEnabled: true,
          googleCalendarId: true,
          googleCalendarCreateMeet: true,
          googleCalendarReminderMinutes: true,
          googleCalendarSendUpdates: true
        }),
        {
          googleCalendarEnabled: currentSettings.googleCalendarEnabled,
          googleCalendarId: currentSettings.googleCalendarId,
          googleCalendarCreateMeet: currentSettings.googleCalendarCreateMeet,
          googleCalendarReminderMinutes: currentSettings.googleCalendarReminderMinutes,
          googleCalendarSendUpdates: currentSettings.googleCalendarSendUpdates,
          ...sanitizeGoogleCalendarSettingsPayload(req.body)
        }
      );

      const mergedSettings = await mergePlatformSettingsUpdate(repositories, payload);
      const saved = await repositories.clinic.setPlatformSettings(mergedSettings);
      await appendAuditLog(repositories, req, {
        action: "google_calendar_settings_updated",
        entityType: "google_calendar",
        entityId: "default",
        summary: "Configurações do Google Calendar atualizadas.",
        metadata: {
          googleCalendarEnabled: saved.googleCalendarEnabled,
          googleCalendarCreateMeet: saved.googleCalendarCreateMeet,
          googleCalendarSendUpdates: saved.googleCalendarSendUpdates
        }
      });
      res.json({
        ok: true,
        data: {
          googleCalendarEnabled: saved.googleCalendarEnabled,
          googleCalendarId: saved.googleCalendarId,
          googleCalendarCreateMeet: saved.googleCalendarCreateMeet,
          googleCalendarReminderMinutes: saved.googleCalendarReminderMinutes,
          googleCalendarSendUpdates: saved.googleCalendarSendUpdates
        }
      });
    })
  );

  app.post(
    "/api/admin/uploads",
    requireAdminApi,
    uploadMiddleware.single("image"),
    asyncRoute(async (req, res) => {
      const repositories = await getRepositories(req);
      const url = await storeUploadedImage(req.file, runtimeConfig);
      await appendAuditLog(repositories, req, {
        action: "image_uploaded",
        entityType: "image_upload",
        entityId: req.file?.originalname || "",
        summary: "Imagem enviada para o sistema.",
        metadata: {
          mimeType: req.file?.mimetype || "",
          sizeBytes: Number(req.file?.size || 0)
        }
      });
      res.json({
        ok: true,
        data: { url }
      });
    })
  );
}

function mountStatic(app, runtimeConfig) {
  app.use(express.static(runtimeConfig.publicDir, { index: false, fallthrough: true }));

  if (runtimeConfig.storageProvider === "local") {
    // Recibos emitidos antes da separação de diretórios ainda estão dentro de
    // uploadDir. Eles continuam legíveis pela rota autenticada de download
    // (que sabe procurar no local antigo), mas não podem sair por aqui.
    app.use("/uploads", (req, res, next) => {
      const caminho = decodeURIComponent(req.path || "").toLowerCase();
      if (caminho.startsWith("/receipts/") || caminho === "/receipts") {
        return res.status(404).json({ ok: false, error: "Não encontrado." });
      }
      return next();
    });
    app.use("/uploads", express.static(runtimeConfig.uploadDir, { fallthrough: false }));
  }

  app.get("/favicon.ico", (req, res) => {
    res.redirect(302, "/assets/icons/heart-handshake.svg");
  });
}

// Backstop final: garante que TODA requisição receba uma resposta antes do
// limite do Vercel (504). Se o handler não respondeu até `ms`, devolvemos um
// 503 limpo (e o cliente pode tentar de novo) em vez de pendurar até o 504.
function createRequestTimeout(ms) {
  return (req, res, next) => {
    if (!ms || ms <= 0) {
      next();
      return;
    }

    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(503).json({
          ok: false,
          error: "O servidor demorou para responder. Tente novamente em instantes."
        });
      }
    }, ms);

    if (typeof timer.unref === "function") {
      timer.unref();
    }

    const clear = () => clearTimeout(timer);
    res.on("finish", clear);
    res.on("close", clear);
    next();
  };
}

function createExpressApp(baseConfig, overrides = {}) {
  const runtimeConfig = buildRuntimeConfig(baseConfig, overrides);

  if (
    runtimeConfig.isProduction &&
    runtimeConfig.authCookieSecret === "development-session-secret-change-me"
  ) {
    throw new AppError(
      "AUTH_COOKIE_SECRET ou SESSION_SECRET deve ser configurado em produção.",
      500
    );
  }

  const uploadMiddleware = createUploadMiddleware(runtimeConfig);
  const app = express();

  app.disable("x-powered-by");
  // Quantos proxies à frente da aplicação são confiáveis. Em Vercel/Render é 1.
  // Com o app exposto diretamente, precisa ser 0: senão qualquer requisição
  // pode declarar o próprio X-Forwarded-For e escolher o IP que a auditoria
  // registra e que o limitador de login usa como chave.
  app.set("trust proxy", runtimeConfig.trustProxyHops);
  app.locals.runtimeConfig = runtimeConfig;
  app.locals.serviceOverrides = {
    googleCalendarService: overrides.googleCalendarService || null
  };
  app.use(createRequestTimeout(runtimeConfig.requestTimeoutMs));
  applySecurityHeaders(app, runtimeConfig);
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  app.use(attachAdminUser(runtimeConfig));
  app.use("/admin", applyNoStoreHeaders);
  app.use("/api/admin", applyNoStoreHeaders);
  app.use("/api/public/content", applyNoStoreHeaders);
  app.use("/health", applyNoStoreHeaders);
  app.use("/api/admin", requireSameOriginForAdminWrites);

  mountStatic(app, runtimeConfig);
  registerRoutes(app, runtimeConfig, uploadMiddleware);
  app.get(
    "/health",
    asyncRoute(async (req, res) => {
      await resolveDependencies(app);
      res.status(200).json({ ok: true });
    })
  );
  app.use(errorHandler);

  return {
    app,
    runtimeConfig,
    async close() {
      if (!app.locals.dependenciesPromise) {
        return;
      }

      const dependencies = await app.locals.dependenciesPromise;
      if (dependencies.db.kind === "postgres") {
        await dependencies.db.end({ timeout: 5 });
      } else {
        dependencies.db.close();
      }
    }
  };
}

module.exports = {
  createExpressApp,
  createRequestTimeout
};
