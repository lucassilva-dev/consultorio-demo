function isSafeImagePath(value, options = {}) {
  const normalizedValue = String(value ?? "").trim();
  const externalPrefixes = Array.isArray(options.externalImagePrefixes)
    ? options.externalImagePrefixes.filter(Boolean)
    : [];

  if (
    /^\/(assets|uploads)\/[A-Za-z0-9/_\-.]+$/.test(normalizedValue) &&
    !normalizedValue.includes("..")
  ) {
    return true;
  }

  return externalPrefixes.some((prefix) => normalizedValue.startsWith(prefix));
}

function isSafeLink(value) {
  if (!value) {
    return true;
  }

  if (value.startsWith("#")) {
    return /^#[A-Za-z0-9_-]+$/.test(value);
  }

  if (value.startsWith("/")) {
    return /^\/[A-Za-z0-9/_\-?.=&%]+$/.test(value) && !value.includes("..");
  }

  try {
    const parsed = new URL(value);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol);
  } catch (error) {
    return false;
  }
}

function normalizeWhatsappNumber(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function buildWhatsappUrl(number, message) {
  const digits = normalizeWhatsappNumber(number);
  if (!digits) {
    return "";
  }

  const params = new URLSearchParams();
  if (message) {
    params.set("text", message);
  }

  const suffix = params.toString();
  return `https://wa.me/${digits}${suffix ? `?${suffix}` : ""}`;
}

module.exports = {
  buildWhatsappUrl,
  isSafeImagePath,
  isSafeLink,
  normalizeWhatsappNumber
};
