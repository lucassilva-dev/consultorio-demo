const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_DEVELOPMENT_SECRET = "development-session-secret-change-me";

function resolveFromRoot(value, fallback) {
  return path.resolve(ROOT_DIR, value || fallback);
}

function deriveDataProvider() {
  if (process.env.DATA_PROVIDER) {
    return process.env.DATA_PROVIDER;
  }

  return process.env.DATABASE_URL || process.env.POSTGRES_URL ? "postgres" : "sqlite";
}

function deriveStorageProvider() {
  if (process.env.STORAGE_PROVIDER) {
    return process.env.STORAGE_PROVIDER;
  }

  return process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? "supabase" : "local";
}

function buildAllowedExternalImagePrefixes() {
  const prefixes = [];
  const supabaseUrl = process.env.SUPABASE_URL || "";
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "site-images";

  if (supabaseUrl) {
    prefixes.push(
      `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${bucket}/`
    );
  }

  return prefixes;
}

function parseGoogleCalendarScopes() {
  const rawValue =
    process.env.GOOGLE_CALENDAR_SCOPES ||
    [
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly"
    ].join(",");

  return rawValue
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function deriveRunDatabaseMigrationsOnBoot() {
  if (process.env.RUN_DATABASE_MIGRATIONS_ON_BOOT) {
    return process.env.RUN_DATABASE_MIGRATIONS_ON_BOOT === "true";
  }

  return (process.env.NODE_ENV || "development") !== "production";
}

const config = {
  rootDir: ROOT_DIR,
  publicDir: resolveFromRoot("./public"),
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || "development",
  isProduction: (process.env.NODE_ENV || "development") === "production",
  dataProvider: deriveDataProvider(),
  storageProvider: deriveStorageProvider(),
  sessionSecret:
    process.env.SESSION_SECRET ||
    process.env.JWT_SECRET ||
    DEFAULT_DEVELOPMENT_SECRET,
  authCookieSecret:
    process.env.AUTH_COOKIE_SECRET ||
    process.env.SESSION_SECRET ||
    process.env.JWT_SECRET ||
    DEFAULT_DEVELOPMENT_SECRET,
  authCookieName: process.env.AUTH_COOKIE_NAME || "cv2_admin_session",
  authCookieTtlMs: 7 * 24 * 60 * 60 * 1000,
  databaseUrl: process.env.DATABASE_URL || process.env.POSTGRES_URL || "",
  databaseMigrationUrl:
    process.env.MIGRATION_DATABASE_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.DATABASE_URL ||
    "",
  runDatabaseMigrationsOnBoot: deriveRunDatabaseMigrationsOnBoot(),
  // Modo TLS da conexão Postgres. "require" cifra mas não valida o certificado
  // do servidor; "verify-full" valida. O padrão preserva o comportamento
  // anterior para não arriscar uma indisponibilidade em produção sem quem
  // confirme — a recomendação é migrar para verify-full assim que possível.
  postgresSslMode: process.env.DATABASE_SSL_MODE || "require",
  databasePath: resolveFromRoot(process.env.DATABASE_PATH, "./data/app.db"),
  uploadDir: resolveFromRoot(process.env.UPLOAD_DIR, "./uploads"),
  // Número de proxies confiáveis à frente do app (Vercel e Render: 1). Zero
  // quando o Node atende direto — aí X-Forwarded-For não pode ser levado a
  // sério, porque vem do próprio cliente.
  trustProxyHops: Number.isInteger(Number(process.env.TRUST_PROXY_HOPS))
    ? Number(process.env.TRUST_PROXY_HOPS)
    : 1,
  // Documentos privados (recibos) NÃO podem morar dentro de uploadDir: esse
  // diretório é publicado por express.static em "/uploads", então o PDF ficava
  // baixável sem autenticação. Vazio aqui significa "irmão de uploadDir", o que
  // mantém os arquivos no mesmo disco persistente (ex.: /var/data no Render).
  privateUploadDir: process.env.PRIVATE_UPLOAD_DIR ? resolveFromRoot(process.env.PRIVATE_UPLOAD_DIR, "") : "",
  adminEmail: process.env.ADMIN_EMAIL || "",
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH || "",
  adminInitialPassword: process.env.ADMIN_INITIAL_PASSWORD || "",
  siteUrl: process.env.SITE_URL || "",
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  supabaseStorageBucket: process.env.SUPABASE_STORAGE_BUCKET || "site-images",
  supabasePrivateStorageBucket:
    process.env.SUPABASE_PRIVATE_STORAGE_BUCKET || "private-documents",
  allowedExternalImagePrefixes: buildAllowedExternalImagePrefixes(),
  adminInitialPasswordMinLength: 10,
  maxUploadBytes: 3 * 1024 * 1024,
  allowedUploadMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  allowedUploadExtensions: [".jpg", ".jpeg", ".png", ".webp"],
  allowedDocumentMimeTypes: ["application/pdf"],
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY || "",
  clinicalRecordEditWindowHours: Number(process.env.CLINICAL_RECORD_EDIT_WINDOW_HOURS || 24),
  legacyTokenEncryptionSecret:
    process.env.GOOGLE_TOKEN_ENCRYPTION_SECRET ||
    process.env.AUTH_COOKIE_SECRET ||
    process.env.SESSION_SECRET ||
    process.env.JWT_SECRET ||
    DEFAULT_DEVELOPMENT_SECRET,
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || "",
  googleCalendarScopes: parseGoogleCalendarScopes(),
  googleCalendarStateTtlMs: 15 * 60 * 1000,
  allowedHelpIcons: [
    "wind",
    "users-round",
    "circle-dot",
    "flower-2",
    "compass",
    "sun",
    "video",
    "calendar",
    "message-circle",
    "instagram",
    "mail",
    "shield-check",
    "heart-handshake"
  ],
  // Timeouts de resiliência (serverless). Garantem que nenhuma query, boot ou
  // requisição possa pendurar indefinidamente e travar rotas com 504.
  postgresStatementTimeoutMs: Number(process.env.POSTGRES_STATEMENT_TIMEOUT_MS || 12000),
  postgresMigrationStatementTimeoutMs: Number(
    process.env.POSTGRES_MIGRATION_STATEMENT_TIMEOUT_MS || 120000
  ),
  bootTimeoutMs: Number(process.env.BOOT_TIMEOUT_MS || 20000),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 25000)
};

module.exports = { config };
