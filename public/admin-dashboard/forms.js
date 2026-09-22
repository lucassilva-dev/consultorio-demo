import { escapeSelector } from "./ui.js";

export function setFormFeedback(form, message, tone = "success") {
  const feedback = form.querySelector(".form-feedback");
  if (!feedback) {
    return;
  }

  feedback.hidden = false;
  feedback.dataset.tone = tone;
  feedback.textContent = message;
}

export function clearFormFeedback(form) {
  const feedback = form.querySelector(".form-feedback");
  if (!feedback) {
    return;
  }

  feedback.hidden = true;
  feedback.textContent = "";
  feedback.dataset.tone = "";
}

export function clearFieldErrors(form) {
  form.querySelectorAll(".field-error").forEach((node) => {
    node.hidden = true;
    node.textContent = "";
  });

  form.querySelectorAll(".field.has-error").forEach((field) => {
    field.classList.remove("has-error");
  });

  form.querySelectorAll("[aria-invalid='true']").forEach((field) => {
    field.removeAttribute("aria-invalid");
  });
}

function ensureFieldErrorNode(fieldWrapper) {
  let node = fieldWrapper.querySelector(".field-error");
  if (node) {
    return node;
  }

  node = document.createElement("div");
  node.className = "field-error";
  node.hidden = true;
  fieldWrapper.appendChild(node);
  return node;
}

export function applyFieldErrors(form, fieldErrors = {}) {
  Object.entries(fieldErrors || {}).forEach(([fieldName, messages]) => {
    const field = getFormField(form, fieldName);
    if (!field || !Array.isArray(messages) || !messages.length) {
      return;
    }

    const fieldWrapper = field.closest(".field");
    if (!fieldWrapper) {
      return;
    }

    fieldWrapper.classList.add("has-error");
    field.setAttribute("aria-invalid", "true");

    const errorNode = ensureFieldErrorNode(fieldWrapper);
    errorNode.hidden = false;
    errorNode.textContent = messages[0];
  });
}

export function clearFieldErrorForInput(input) {
  const fieldWrapper = input.closest(".field");
  if (!fieldWrapper) {
    return;
  }

  fieldWrapper.classList.remove("has-error");
  input.removeAttribute("aria-invalid");

  const errorNode = fieldWrapper.querySelector(".field-error");
  if (!errorNode) {
    return;
  }

  errorNode.hidden = true;
  errorNode.textContent = "";
}

export function buildErrorMessage(error) {
  if (!error) {
    return "Ocorreu um erro inesperado.";
  }

  if (error.name === "AbortError") {
    return "A operação demorou mais do que o esperado. Tente novamente.";
  }

  if (error.details?.formErrors?.length) {
    return error.details.formErrors[0];
  }

  const fieldErrors = Object.values(error.details?.fieldErrors || {}).flat().filter(Boolean);
  if (fieldErrors.length) {
    return fieldErrors[0];
  }

  return error.message || "Ocorreu um erro inesperado.";
}

export function setFormBusy(form, isBusy, busyText) {
  // Limpa timer de "aguardando servidor" anterior
  if (form._slowServerTimer) {
    window.clearTimeout(form._slowServerTimer);
    form._slowServerTimer = null;
  }

  // Em formulários dentro de drawer o botão de enviar fica no rodapé, fora do
  // <form>, associado por atributo form="…".
  const externos = form.id
    ? Array.from(document.querySelectorAll(`button[form="${form.id}"]`))
    : [];

  const controls = [...form.querySelectorAll("input, textarea, select, button"), ...externos];
  controls.forEach((control) => {
    control.disabled = isBusy;
  });

  const submitButton =
    form.querySelector('button[type="submit"]') ||
    externos.find((botao) => botao.type === "submit");
  if (submitButton) {
    submitButton.dataset.originalText = submitButton.dataset.originalText || submitButton.textContent;
    submitButton.textContent = isBusy ? busyText : submitButton.dataset.originalText;

    if (isBusy) {
      // Se demorar mais de 10 s, avisa que está aguardando o servidor
      form._slowServerTimer = window.setTimeout(() => {
        if (submitButton.disabled) {
          submitButton.textContent = "Aguardando servidor…";
        }
      }, 10000);
    }
  }
}

export function isSafeImagePath(value) {
  if (/^\/(assets|uploads)\/[A-Za-z0-9/_\-.]+$/.test(value) && !value.includes("..")) {
    return true;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch (error) {
    return false;
  }
}

export function fillForm(form, values) {
  Object.entries(values).forEach(([key, value]) => {
    const field = form.elements.namedItem(key);
    if (!field) {
      return;
    }

    if (field.type === "checkbox") {
      field.checked = Boolean(value);
      return;
    }

    field.value = value ?? "";
  });

  refreshPreviews(form);
}

export function getEntityIdField(form) {
  return form.elements.namedItem("id");
}

export function getFormField(form, name) {
  return form.elements.namedItem(name);
}

export function getFormValue(form, name) {
  const field = getFormField(form, name);
  return field ? field.value : "";
}

export function getFormChecked(form, name) {
  const field = getFormField(form, name);
  return Boolean(field && field.checked);
}

export function refreshPreviewFromInput(input) {
  const scope = input.closest(".upload-block") || input.closest(".admin-nested-card") || input.form;
  const preview = scope.querySelector(`[data-preview-target="${escapeSelector(input.name)}"]`);

  if (!preview) {
    return;
  }

  if (input.value && isSafeImagePath(input.value)) {
    preview.src = input.value;
    preview.hidden = false;
  } else {
    preview.hidden = true;
    preview.removeAttribute("src");
  }
}

export function refreshPreviews(scope) {
  scope.querySelectorAll('input[readonly][name]').forEach((input) => {
    refreshPreviewFromInput(input);
  });
}

export function registrarLimpezaDeErroAoDigitar() {
  document.addEventListener("input", (event) => {
    const target = event.target;
    if (target.matches(".field input, .field textarea")) {
      clearFieldErrorForInput(target);
    }
  });
}
