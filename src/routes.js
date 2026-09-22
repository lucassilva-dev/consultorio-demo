const helmet = require("helmet");
const express = require("express");
const { buildSchemas } = require("./lib/validation");
const { AppError } = require("./lib/errors");
const { createLoginThrottle } = require("./lib/login-throttle");
const { serializeClearedAdminSessionCookie } = require("./lib/admin-session");
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
const { createUploadMiddleware } = require("./middleware/upload");
const { getRepositories, resolveDependencies } = require("./routes/dependencies");
const { asyncRoute } = require("./routes/shared");
const pages = require("./routes/pages");
const publicContent = require("./routes/public-content");
const auth = require("./routes/auth");
const siteContent = require("./routes/site-content");
const dashboardSummary = require("./routes/dashboard-summary");
const leads = require("./routes/leads");
const patients = require("./routes/patients");
const sessions = require("./routes/sessions");
const auditLogs = require("./routes/audit-logs");
const finance = require("./routes/finance");
const receipts = require("./routes/receipts");
const clinicalRecord = require("./routes/clinical-record");
const messageTemplates = require("./routes/message-templates");
const platformSettings = require("./routes/platform-settings");
const googleCalendar = require("./routes/google-calendar");
const uploads = require("./routes/uploads");

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

  const deps = {
    runtimeConfig,
    schemas,
    loginThrottle,
    requireAdminApi,
    requireAdminPage,
    uploadMiddleware
  };

  pages.register(app, deps);
  publicContent.register(app, deps);
  auth.register(app, deps);
  siteContent.register(app, deps);
  dashboardSummary.register(app, deps);
  leads.register(app, deps);
  patients.register(app, deps);
  sessions.registerCollectionRoutes(app, deps);
  auditLogs.register(app, deps);
  sessions.registerItemRoutes(app, deps);
  finance.register(app, deps);
  receipts.register(app, deps);
  clinicalRecord.register(app, deps);
  messageTemplates.register(app, deps);
  platformSettings.register(app, deps);
  googleCalendar.register(app, deps);
  uploads.register(app, deps);
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
