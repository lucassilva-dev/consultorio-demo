const { ADMIN_FONTS_HEAD, renderLayout } = require("../lib/render");

function renderAdminLoginPage() {
  return renderLayout({
    title: "Admin | Login",
    description: "Acesso administrativo.",
    bodyClass: "admin-shell",
    head: ADMIN_FONTS_HEAD,
    styles: ["/admin.css"],
    scripts: ["/admin-login.js"],
    content: `
      <main class="admin-login-page">
        <div class="admin-login-wrap">
          <div class="marca">
            <div class="marca-selo" aria-hidden="true">e</div>
            <div>
              <div class="marca-nome">Marina Alves <em>· psi</em></div>
              <div class="rotulo-micro">Painel do consultório</div>
            </div>
          </div>

          <section class="admin-login-card">
            <h1>Bem-vinda de volta</h1>
            <p>Entre para abrir o consultório.</p>

            <div id="login-error" class="aviso aviso-erro" role="alert" hidden>
              <span aria-hidden="true">▲</span>
              <span id="login-error-text"></span>
            </div>

            <form id="login-form" novalidate>
              <label class="field" for="email">
                <span>E-mail</span>
                <input id="email" name="email" type="email" autocomplete="username" required>
              </label>
              <div id="email-error" class="field-error" aria-live="polite"></div>

              <label class="field" for="password">
                <span>Senha</span>
                <input id="password" name="password" type="password" autocomplete="current-password" required minlength="8">
              </label>
              <div id="password-error" class="field-error" aria-live="polite"></div>

              <button id="login-submit" class="btn btn-primary btn-bloco btn-largo" type="submit">
                <span id="login-submit-spinner" class="spinner" aria-hidden="true" hidden></span>
                <span id="login-submit-label">Entrar no painel</span>
              </button>
            </form>

            <div id="login-espera" class="admin-espera" role="status" hidden>
              <span class="glifo" aria-hidden="true">◐</span>
              <span>
                <strong>Ainda esperando o servidor.</strong>
                Ele estava em repouso e pode levar até 30 s para acordar — isso é normal,
                não feche a página.
              </span>
            </div>
          </section>

          <p class="admin-login-rodape">Acesso restrito · Marina Alves — CRP 00/00000</p>
        </div>
      </main>
    `
  });
}

module.exports = {
  renderAdminLoginPage
};
