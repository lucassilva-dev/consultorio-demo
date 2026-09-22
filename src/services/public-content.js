const { buildWhatsappUrl } = require("../lib/urls");

function enrichPublicContent(bundle) {
  const contact = bundle.contact || {};
  const agenda = bundle.agenda || {};
  const whatsappUrl = buildWhatsappUrl(contact.whatsappNumber, contact.whatsappMessage);
  const hasPublicScheduling =
    Boolean(agenda.showSchedulingButton) && Boolean(agenda.schedulingUrl);

  const socialLinks = (contact.socialLinks || [])
    .filter((link) => link.url)
    .map((link) => ({
      ...link,
      icon:
        {
          whatsapp: "message-circle",
          instagram: "instagram",
          email: "mail"
        }[link.platform] || null
    }));

  return {
    ...bundle,
    home: {
      ...bundle.home,
      ctaUrl: bundle.home?.ctaUrl || whatsappUrl || "#agendar"
    },
    agenda: {
      schedulingUrl: hasPublicScheduling ? agenda.schedulingUrl : "",
      schedulingLabel: agenda.schedulingLabel || "Agendar conversa inicial",
      showSchedulingButton: hasPublicScheduling
    },
    contact: {
      ...contact,
      whatsappUrl,
      socialLinks
    }
  };
}

module.exports = {
  enrichPublicContent
};
