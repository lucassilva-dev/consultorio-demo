const { enrichPublicContent } = require("../services/public-content");
const { renderPublicPage } = require("../views/public-page");
const { renderPrivacyPage } = require("../views/privacy-page");
const { renderAdminLoginPage } = require("../views/admin-login-page");
const { renderAdminDashboardPage } = require("../views/admin-dashboard-page");
const { getRepositories } = require("./dependencies");
const { asyncRoute } = require("./shared");

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

function register(app, { runtimeConfig, requireAdminPage }) {
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
}

module.exports = {
  register
};
