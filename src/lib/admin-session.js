const crypto = require("crypto");

// decodeURIComponent lança URIError diante de um % solto. Como este parser roda
// no middleware global attachAdminUser, um cookie de terceiro qualquer (um
// "promo=50%off" de campanha) fazia TODA requisição daquele visitante responder
// 500 — inclusive a landing pública. O valor cru é melhor que uma exceção: no
// pior caso a assinatura do token não confere e a sessão é recusada.
function decodeCookieValue(value) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
}

function parseCookieHeader(headerValue) {
  const cookies = {};

  for (const part of String(headerValue || "").split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const name = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (!name) {
      continue;
    }

    cookies[name] = decodeCookieValue(value);
  }

  return cookies;
}

function signValue(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function createAdminSessionToken(user, runtimeConfig) {
  const now = Date.now();
  const payload = {
    sub: String(user.id),
    email: user.email,
    role: user.role,
    // Contador de sessão do admin. O logout o incrementa, e tokens emitidos
    // antes deixam de bater — é o que torna o logout uma revogação de fato.
    epoch: Number(user.session_epoch ?? user.sessionEpoch ?? 0),
    iat: now,
    exp: now + runtimeConfig.authCookieTtlMs
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signValue(encodedPayload, runtimeConfig.authCookieSecret);
  return `${encodedPayload}.${signature}`;
}

function verifyAdminSessionToken(token, runtimeConfig) {
  const [encodedPayload, signature] = String(token || "").split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signValue(encodedPayload, runtimeConfig.authCookieSecret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (
      !payload ||
      payload.role !== "admin" ||
      !payload.email ||
      !payload.exp ||
      Number(payload.exp) < Date.now()
    ) {
      return null;
    }

    return payload;
  } catch (error) {
    return null;
  }
}

function buildCookieAttributes(runtimeConfig, overrides = {}) {
  const attributes = [
    `Path=${overrides.path || "/"}`,
    "HttpOnly",
    "SameSite=Lax"
  ];

  if (runtimeConfig.isProduction) {
    attributes.push("Secure");
  }

  if (overrides.maxAge !== undefined) {
    attributes.push(`Max-Age=${overrides.maxAge}`);
  }

  if (overrides.expires) {
    attributes.push(`Expires=${new Date(overrides.expires).toUTCString()}`);
  }

  return attributes;
}

function serializeAdminSessionCookie(token, runtimeConfig) {
  const attributes = buildCookieAttributes(runtimeConfig, {
    maxAge: Math.floor(runtimeConfig.authCookieTtlMs / 1000),
    expires: Date.now() + runtimeConfig.authCookieTtlMs
  });
  return `${runtimeConfig.authCookieName}=${encodeURIComponent(token)}; ${attributes.join("; ")}`;
}

function serializeClearedAdminSessionCookie(runtimeConfig) {
  const attributes = buildCookieAttributes(runtimeConfig, {
    maxAge: 0,
    expires: 0
  });
  return `${runtimeConfig.authCookieName}=; ${attributes.join("; ")}`;
}

function getRequestOrigin(req) {
  const protocol = req.get("x-forwarded-proto") || req.protocol;
  return `${protocol}://${req.get("host")}`;
}

module.exports = {
  createAdminSessionToken,
  getRequestOrigin,
  parseCookieHeader,
  serializeAdminSessionCookie,
  serializeClearedAdminSessionCookie,
  verifyAdminSessionToken
};
