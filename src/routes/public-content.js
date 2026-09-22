const { enrichPublicContent } = require("../services/public-content");
const { getRepositories } = require("./dependencies");
const { asyncRoute } = require("./shared");

function getPublicAgendaSettings(settings = {}) {
  return {
    schedulingUrl: settings.schedulingUrl || "",
    schedulingLabel: settings.schedulingLabel || "",
    showSchedulingButton: Boolean(settings.showSchedulingButton)
  };
}

function shouldLogPublicApi(runtimeConfig) {
  return runtimeConfig.isProduction || process.env.DEBUG_PUBLIC_API === "true";
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

function register(app, { runtimeConfig }) {
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
}

module.exports = {
  register
};
