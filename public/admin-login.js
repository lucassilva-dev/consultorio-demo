const form = document.getElementById("login-form");
const errorBox = document.getElementById("login-error");
const errorText = document.getElementById("login-error-text");
const submitButton = document.getElementById("login-submit");
const submitLabel = document.getElementById("login-submit-label");
const submitSpinner = document.getElementById("login-submit-spinner");
const esperaBox = document.getElementById("login-espera");

// O servidor é serverless: a primeira requisição depois de um período ocioso
// pode levar até ~30 s. Passados 10 s sem resposta avisamos, para a tela nunca
// parecer travada.
const LIMIAR_ESPERA_MS = 10000;
let temporizadorEspera = null;

const CAMPOS = {
  email: document.getElementById("email"),
  password: document.getElementById("password")
};

function setFieldError(name, message) {
  const campo = CAMPOS[name];
  const alvo = document.getElementById(`${name}-error`);
  if (!campo || !alvo) return;
  alvo.textContent = message || "";
  campo.closest(".field")?.classList.toggle("has-error", Boolean(message));
}

function clearErrors() {
  errorBox.hidden = true;
  errorText.textContent = "";
  Object.keys(CAMPOS).forEach((name) => setFieldError(name, ""));
}

function showError(message) {
  errorText.textContent = message;
  errorBox.hidden = false;
}

function validate() {
  let ok = true;
  const email = CAMPOS.email.value.trim();
  const password = CAMPOS.password.value;

  if (!email) {
    setFieldError("email", "Informe o e-mail.");
    ok = false;
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setFieldError("email", "E-mail inválido.");
    ok = false;
  }

  if (!password) {
    setFieldError("password", "Informe a senha.");
    ok = false;
  } else if (password.length < 8) {
    setFieldError("password", "A senha tem no mínimo 8 caracteres.");
    ok = false;
  }

  return ok;
}

function setBusy(busy) {
  submitButton.disabled = busy;
  submitSpinner.hidden = !busy;
  submitLabel.textContent = busy ? "Entrando…" : "Entrar no painel";

  clearTimeout(temporizadorEspera);
  if (busy) {
    temporizadorEspera = setTimeout(() => {
      esperaBox.hidden = false;
    }, LIMIAR_ESPERA_MS);
  } else {
    esperaBox.hidden = true;
  }
}

async function handleLogin(event) {
  event.preventDefault();
  clearErrors();

  if (!validate()) {
    return;
  }

  setBusy(true);

  try {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        email: CAMPOS.email.value.trim(),
        password: CAMPOS.password.value
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      const fieldErrors = payload.details?.fieldErrors;
      if (fieldErrors) {
        Object.entries(fieldErrors).forEach(([name, mensagens]) => {
          setFieldError(name, Array.isArray(mensagens) ? mensagens[0] : String(mensagens));
        });
      }
      throw new Error(payload.error || "Falha ao autenticar.");
    }

    window.location.assign("/admin/dashboard");
    return;
  } catch (error) {
    showError(error.message);
  }

  setBusy(false);
}

Object.values(CAMPOS).forEach((campo) => {
  campo.addEventListener("input", () => {
    const name = campo.getAttribute("id");
    setFieldError(name, "");
  });
});

form.addEventListener("submit", handleLogin);
