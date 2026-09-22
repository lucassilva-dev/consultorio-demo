import { state } from "./state.js";
import { escapeHtml } from "./ui.js";
import { apiRequest } from "./api.js";

function formatBooleanStatus(value) {
  return value ? "Em conformidade" : "Pendente";
}

function renderSecurityStatus() {
  const container = document.getElementById("security-status-list");
  const status = state.securityStatus || {};
  const labels = {
    nodeEnvProduction: "NODE_ENV=production",
    dataProviderPostgres: "DATA_PROVIDER=postgres",
    storageProviderSupabase: "STORAGE_PROVIDER=supabase",
    databaseUrlConfigured: "DATABASE_URL configurada",
    supabaseUrlConfigured: "SUPABASE_URL configurada",
    supabaseServiceRoleKeyConfigured: "SUPABASE_SERVICE_ROLE_KEY configurada",
    supabaseStorageBucketConfigured: "SUPABASE_STORAGE_BUCKET configurado",
    supabasePrivateStorageBucketConfigured: "SUPABASE_PRIVATE_STORAGE_BUCKET configurado",
    sessionSecretConfiguredAndNonDefault: "SESSION_SECRET configurado e não default",
    authCookieSecretConfiguredAndNonDefault: "AUTH_COOKIE_SECRET configurado e não default",
    adminPasswordHashConfigured: "ADMIN_PASSWORD_HASH configurado",
    adminInitialPasswordAbsentInProduction: "ADMIN_INITIAL_PASSWORD ausente em produção",
    tokenEncryptionKeyConfigured: "TOKEN_ENCRYPTION_KEY configurado",
    googleClientIdConfigured: "GOOGLE_CLIENT_ID configurado",
    googleClientSecretConfigured: "GOOGLE_CLIENT_SECRET configurado",
    googleRedirectUriConfigured: "GOOGLE_REDIRECT_URI configurado",
    siteUrlConfigured: "SITE_URL configurado",
    runDatabaseMigrationsOnBootRecommendedFalse: "RUN_DATABASE_MIGRATIONS_ON_BOOT=false"
  };

  container.innerHTML = Object.entries(labels)
    .map(
      ([key, label]) => `
        <article class="admin-security-item${status[key] ? "" : " is-pendente"}">
          <span class="glifo" aria-hidden="true">${status[key] ? "✓" : "✕"}</span>
          <span style="flex:1">${escapeHtml(label)}</span>
          <span style="font-size:11.5px;font-weight:600">${formatBooleanStatus(status[key])}</span>
        </article>
      `
    )
    .join("");
}

export async function loadSecurityStatus() {
  const response = await apiRequest("/api/admin/security/status");
  state.securityStatus = response.data;
  renderSecurityStatus();
}
