const multer = require("multer");
const { AppError } = require("../lib/errors");
const { escapeHtml } = require("../lib/render");

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      ok: false,
      error:
        error.code === "LIMIT_FILE_SIZE"
          ? "Arquivo excede o tamanho máximo permitido."
          : "Falha no upload do arquivo."
    });
  }

  // Erros de bibliotecas trazem o status no próprio objeto: corpo JSON
  // malformado é 400 (body-parser), arquivo ausente em /uploads é 404
  // (express.static), payload grande demais é 413. Ignorar isso transformava
  // todos em 500 e escondia a causa de quem estava depurando.
  const statusDaBiblioteca = Number(error?.statusCode ?? error?.status);
  const statusCode =
    error instanceof AppError
      ? error.statusCode
      : Number.isInteger(statusDaBiblioteca) &&
          statusDaBiblioteca >= 400 &&
          statusDaBiblioteca <= 599
        ? statusDaBiblioteca
        : 500;
  // Mensagem de AppError é escrita para o admin e pode citar variável de
  // ambiente ou detalhe de infraestrutura. Fora das rotas administrativas, o
  // visitante recebe só o essencial — o detalhe fica no log do servidor.
  const ehRotaAdministrativa =
    req.path.startsWith("/admin") || req.path.startsWith("/api/admin");
  const mensagemDetalhada =
    error instanceof AppError ? error.message : "Ocorreu um erro inesperado. Tente novamente.";

  const payload = {
    ok: false,
    error:
      ehRotaAdministrativa || statusCode < 500
        ? mensagemDetalhada
        : "Não foi possível concluir agora. Tente novamente em instantes."
  };

  // 4xx é resultado esperado — recusa de exclusão, validação, id inválido,
  // arquivo estático ausente. Registrar cada um como erro, com stack, soterra
  // os 500 de verdade no log de produção. Fica uma linha só, sem stack.
  if (statusCode >= 500) {
    console.error("[APP_ERROR]", {
      path: req.path,
      method: req.method,
      message: error.message,
      stack: error.stack,
      details: error.details
    });
  } else {
    console.warn("[APP_REJECTED]", {
      path: req.path,
      method: req.method,
      status: statusCode,
      message: error.message
    });
  }

  if (error instanceof AppError && error.details) {
    payload.details = error.details;
  }

  if (req.path.startsWith("/api/")) {
    return res.status(statusCode).json(payload);
  }

  return res.status(statusCode).send(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Erro</title>
  <link rel="stylesheet" href="/colors_and_type.css">
  <link rel="stylesheet" href="/admin.css">
</head>
<body class="admin-shell">
  <main class="container admin-page">
    <section class="admin-card">
      <div class="eyebrow">Erro</div>
      <h1>Não foi possível concluir esta ação.</h1>
      <p>${escapeHtml(payload.error)}</p>
      <a class="btn btn-secondary" href="/">Voltar para o site</a>
    </section>
  </main>
</body>
</html>`);
}

module.exports = {
  errorHandler
};
