const { validateWithSchema } = require("../lib/validation");
const {
  sanitizeHelpCards,
  sanitizeImagePath,
  sanitizeNullableText,
  sanitizePlainText,
  sanitizeSocialLinks,
  sanitizeUrlLike
} = require("../lib/sanitize");
const { AppError } = require("../lib/errors");
const { deleteStoredImage } = require("../services/storage");
const { appendAuditLog, sanitizeAuditString } = require("../services/audit");
const { getRepositories } = require("./dependencies");
const { asyncRoute } = require("./shared");

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

function register(app, { runtimeConfig, schemas, requireAdminApi }) {
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
}

module.exports = {
  register
};
