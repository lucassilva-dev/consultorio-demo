const { validateWithSchema } = require("../lib/validation");
const { sanitizePlainText } = require("../lib/sanitize");
const { AppError } = require("../lib/errors");
const { getTokenEncryptionKeyState } = require("../lib/encryption");
const { buildDecoyPasswordRecord, verifyPassword } = require("../lib/password");
const {
  createAdminSessionToken,
  serializeAdminSessionCookie,
  serializeClearedAdminSessionCookie
} = require("../lib/admin-session");
const { appendAuditLog } = require("../services/audit");
const { getRepositories } = require("./dependencies");
const { asyncRoute } = require("./shared");

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

function register(app, { runtimeConfig, schemas, loginThrottle, requireAdminApi }) {
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
}

module.exports = {
  register
};
