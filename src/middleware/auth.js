const {
  getRequestOrigin,
  parseCookieHeader,
  verifyAdminSessionToken
} = require("../lib/admin-session");

function attachAdminUser(runtimeConfig) {
  return (req, res, next) => {
    // Este middleware roda em TODA requisição, inclusive na landing pública.
    // Qualquer exceção aqui viraria 500 para o visitante; não ter sessão é o
    // estado normal dele, então falhar significa apenas ficar sem admin.
    try {
      const cookies = parseCookieHeader(req.headers.cookie);
      const token = cookies[runtimeConfig.authCookieName];
      req.adminUser = verifyAdminSessionToken(token, runtimeConfig);
    } catch (error) {
      req.adminUser = null;
    }

    return next();
  };
}

function requireAdminPage(req, res, next) {
  if (req.adminUser?.role === "admin") {
    return next();
  }

  return res.redirect("/admin/login");
}

function requireAdminApi(req, res, next) {
  if (req.adminUser?.role === "admin") {
    return next();
  }

  return res.status(401).json({
    ok: false,
    error: "Autenticação necessária."
  });
}

function requireSameOriginForAdminWrites(req, res, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return next();
  }

  const origin = req.get("origin");
  if (!origin) {
    return next();
  }

  if (origin !== getRequestOrigin(req)) {
    return res.status(403).json({
      ok: false,
      error: "Origem inválida."
    });
  }

  return next();
}

module.exports = {
  attachAdminUser,
  requireAdminApi,
  requireAdminPage,
  requireSameOriginForAdminWrites
};
