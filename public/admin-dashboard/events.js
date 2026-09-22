import { state } from "./state.js";
import { fecharDrawer, setStatus } from "./ui.js";
import { clearFieldErrorForInput, refreshPreviewFromInput } from "./forms.js";
import { ACOES_DOCUMENTOS } from "./clinical-documents.js";
import { ACOES_EVOLUCOES } from "./clinical-evolutions.js";
import {
  ACOES_FORMULARIOS_CLINICOS,
  atualizarIndiceSecoes,
  toggleIntakeQuestion
} from "./clinical-forms.js";
import { ACOES_PRONTUARIO } from "./clinical-record.js";
import { ACOES_RECIBOS } from "./finance.js";
import { ACOES_CONTATOS } from "./leads.js";
import { ACOES_MENSAGENS } from "./messages.js";
import { acharPaciente, ACOES_PACIENTES, updateGuardianFieldsState } from "./patients.js";
import { ACOES_SESSOES, applySessionPatientDefaults } from "./sessions.js";
import { ACOES_SITE, handleUpload, marcarBlocoSujo, preencherBlocoSite } from "./site-content.js";

export function registrarDescarteEFechamento() {
  document.addEventListener("click", (event) => {
    // Descartar restaura o bloco ao último estado salvo.
    const descartar = event.target.closest("[data-discard-block]");
    if (descartar) {
      const chave = descartar.dataset.discardBlock;
      if (state.siteDirty.has(chave) && !window.confirm("Descartar as alterações deste bloco?")) {
        return;
      }
      preencherBlocoSite(chave);
      marcarBlocoSujo(chave, false);
      setStatus("Alterações descartadas.", "info");
      return;
    }

    const fechar = event.target.closest("[data-close-drawer]");
    if (fechar) {
      fecharDrawer(fechar.dataset.closeDrawer);
      return;
    }
    // Clique no fundo (fora do painel) também fecha.
    if (event.target.classList?.contains("admin-overlay")) {
      event.target.hidden = true;
      if (!document.querySelector(".admin-overlay:not([hidden])")) {
        document.body.style.overflow = "";
      }
    }
  });
}

export function registrarRoteadorDeAcoes() {
  const acoes = {
    ...ACOES_PRONTUARIO,
    ...ACOES_FORMULARIOS_CLINICOS,
    ...ACOES_DOCUMENTOS,
    ...ACOES_EVOLUCOES,
    ...ACOES_SITE,
    ...ACOES_CONTATOS,
    ...ACOES_PACIENTES,
    ...ACOES_SESSOES,
    ...ACOES_MENSAGENS,
    ...ACOES_RECIBOS
  };

  document.addEventListener("click", async (event) => {
    // Resolve a ação no próprio alvo (comportamento original) e, só quando ele
    // não carrega data-action, no ancestral mais próximo — permite botões com
    // conteúdo aninhado (cards de atalho do prontuário).
    const actionSource = event.target.dataset.action
      ? event.target
      : event.target.closest("[data-action]");
    const { action, id } = actionSource ? actionSource.dataset : {};

    if (event.target.matches('[data-action="remove-help-card"]')) {
      event.target.closest(".admin-nested-card").remove();
      marcarBlocoSujo("help", true);
      return;
    }

    if (event.target.matches('[data-action="remove-social-link"]')) {
      event.target.closest(".admin-nested-card").remove();
      marcarBlocoSujo("contact", true);
      return;
    }

    if (event.target.matches('[data-action="remove-intake-question"]')) {
      event.target.closest(".anamnese-item")?.remove();
      return;
    }

    if (event.target.matches('[data-action="toggle-intake-question"]')) {
      toggleIntakeQuestion(event.target.closest(".anamnese-item"));
      return;
    }

    try {
      if (Object.prototype.hasOwnProperty.call(acoes, action)) {
        await acoes[action]({ id, actionSource });
      }
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
}

export function registrarEntradaGlobal() {
  // Digitar realimenta os contadores por seção e a barra de progresso — do
  // formulário em que se está digitando, não dos três.
  document.addEventListener("input", (event) => {
    if (event.target.classList?.contains("anamnese-resposta")) {
      const raiz = event.target.closest("[data-form]");
      if (raiz?.dataset.form) {
        atualizarIndiceSecoes(raiz.dataset.form);
      }
    }

    // Qualquer edição dentro de um bloco do site o marca como não salvo.
    const bloco = event.target.closest?.("[data-site-block]");
    if (bloco && !state.siteDirty.has(bloco.dataset.siteBlock)) {
      marcarBlocoSujo(bloco.dataset.siteBlock, true);
    }

    // Contador do corpo da mensagem.
    if (event.target.matches?.('#message-form textarea[name="body"]')) {
      const contador = document.getElementById("message-body-count");
      if (contador) contador.textContent = `${event.target.value.length}/2500`;
    }
  });
}

export function registrarMudancaGlobal() {
  document.addEventListener("change", async (event) => {
    const target = event.target;

    if (target.matches(".field input, .field textarea, .field select")) {
      clearFieldErrorForInput(target);
    }

    const blocoSite = target.closest?.("[data-site-block]");
    if (blocoSite) {
      marcarBlocoSujo(blocoSite.dataset.siteBlock, true);
    }

    if (target.matches('input[type="file"][data-upload-target]')) {
      try {
        await handleUpload(target);
      } catch (error) {
        setStatus(error.message, "error");
      } finally {
        target.value = "";
      }
    }

    if (target.matches('select[name="assetType"]')) {
      const cardEl = target.closest(".admin-nested-card");
      const iconField = cardEl.querySelector(".help-icon-field");
      const imageBlock = cardEl.querySelector(".help-image-block");
      const isImage = target.value === "image";
      iconField.hidden = isImage;
      imageBlock.hidden = !isImage;
    }

    if (target.matches('input[readonly][name]')) {
      refreshPreviewFromInput(target);
    }

    if (target.matches('#patient-form select[name="patientType"]')) {
      updateGuardianFieldsState();
    }

    if (target.matches('#patient-form input[name="birthDate"]')) {
      const ageField = document.querySelector('#patient-form input[name="age"]');
      if (target.value) {
        // new Date("2000-06-15") é interpretado como meia-noite UTC, mas
        // getDate()/getMonth() devolvem valores locais: em UTC-3 o dia voltava
        // um, e na véspera do aniversário a idade já aparecia somada. Lemos as
        // partes direto do texto, que é o que a pessoa digitou.
        const [anoNasc, mesNasc, diaNasc] = target.value.split("-").map(Number);
        const today = new Date();
        let age = today.getFullYear() - anoNasc;
        const monthDiff = today.getMonth() + 1 - mesNasc;
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < diaNasc)) {
          age -= 1;
        }
        if (age >= 0 && age <= 120) {
          ageField.value = String(age);
          ageField.readOnly = true;
          ageField.title = "Calculado automaticamente a partir da data de nascimento";
        }
      } else {
        ageField.readOnly = false;
        ageField.title = "";
      }
    }

    if (target.matches('#session-form select[name="patientId"]')) {
      const patient = acharPaciente(target.value);
      applySessionPatientDefaults(patient);
    }
  });
}
