import { state } from "./state.js";
import { escapeHtml, setStatus } from "./ui.js";
import { apiRequest } from "./api.js";
import { loadClinicalRecord, recordId } from "./clinical-record.js";

let clinicalCustomCounter = 0;

export function limparFormulariosDeSecoes() {
  for (const formKey of Object.keys(FORMULARIOS_SECOES)) {
    const { raiz } = refsFormulario(formKey);
    if (!raiz) continue;
    raiz.innerHTML = "";
    raiz.dataset.patientId = "";
  }
}

export async function loadIntake() {
  if (!state.clinical.patientId) return;
  const response = await apiRequest(`/api/admin/patients/${state.clinical.patientId}/intake`);
  state.clinical.intake = response.data.intake;
  state.clinical.intakeTemplate = response.data.template;
  renderIntake();
}

function getIntakeWorkingPayload() {
  if (state.clinical.intake?.payload) {
    return state.clinical.intake.payload;
  }
  return state.clinical.intakeTemplate || { sections: [] };
}

// Anamnese, contrato e plano usam o mesmo formulário de seções, mas cada um no
// seu container. As funções abaixo leem e escrevem SEMPRE a partir da raiz do
// formulário: com querySelectorAll no documento inteiro, salvar o contrato
// varreria também os campos da anamnese e do plano.
const FORMULARIOS_SECOES = {
  intake: { prefixo: "intake", rotulo: "Anamnese" },
  contract: { prefixo: "contract", rotulo: "Contrato e consentimento" },
  plan: { prefixo: "plan", rotulo: "Plano terapêutico" }
};

function refsFormulario(formKey) {
  const prefixo = FORMULARIOS_SECOES[formKey]?.prefixo || formKey;
  return {
    formKey,
    raiz: document.getElementById(`clinical-${prefixo}-sections`),
    indice: document.getElementById(`clinical-${prefixo}-index`),
    progressoWrap: document.getElementById(`clinical-${prefixo}-progress-wrap`),
    progresso: document.getElementById(`clinical-${prefixo}-progress`),
    progressoBarra: document.getElementById(`clinical-${prefixo}-progress-bar`),
    progressoTexto: document.getElementById(`clinical-${prefixo}-progress-text`),
    status: document.getElementById(`clinical-${prefixo}-status`),
    ajuda: document.getElementById(`clinical-${prefixo}-help`),
    acoes: document.getElementById(`clinical-${prefixo}-actions`)
  };
}

function secaoAtual(formKey) {
  return state.clinical.sectionIndex?.[formKey] || 0;
}

function definirSecaoAtual(formKey, indice) {
  if (!state.clinical.sectionIndex) {
    state.clinical.sectionIndex = {};
  }
  state.clinical.sectionIndex[formKey] = indice;
}

// O formulário montado no DOM é a verdade em edição: a coleta lê dele, não do
// state. Se já existe formulário deste paciente na tela, uma nova renderização
// jogaria fora tudo que foi digitado e ainda não salvo.
export function formularioJaRenderizadoParaPacienteAtual(formKey) {
  const { raiz } = refsFormulario(formKey);
  return Boolean(
    raiz &&
      raiz.children.length > 0 &&
      raiz.dataset.patientId === String(state.clinical.patientId || "")
  );
}

export function renderIntake() {
  const statusEl = document.getElementById("clinical-intake-status");
  const helpEl = document.getElementById("clinical-intake-help");
  const actionsEl = document.getElementById("clinical-intake-actions");
  const sectionsEl = document.getElementById("clinical-intake-sections");
  const intake = state.clinical.intake;
  const encerrado =
    intake?.recordClosed === true ||
    state.clinical.summary?.record?.status === "closed";
  const editable = intake ? intake.editable : !encerrado;

  statusEl.textContent = intake
    ? `Status: ${intake.statusLabel || intake.status}`
    : "Anamnese ainda não criada";

  // Um rascunho pode ficar não editável por três motivos diferentes — janela
  // vencida, registro concluído e prontuário encerrado —, e dar o motivo
  // errado manda a pessoa para uma saída que não existe.
  const janelaExpirada = Boolean(intake) && intake.status === "draft" && !editable && !encerrado;

  helpEl.textContent = encerrado
    ? "Prontuário encerrado: este registro está em leitura. Reabra o prontuário para retomar."
    : janelaExpirada
      ? "A janela de edição desta anamnese já fechou. Conclua a anamnese para encerrá-la, ou registre o que mudou como evolução."
      : !editable
        ? "Registro concluído ou bloqueado: não pode ser editado diretamente."
        : intake
          ? "Preencha as respostas. Perguntas padrão não podem ser excluídas; você pode adicionar perguntas personalizadas."
          : "Preencha o que já souber e salve — a anamnese é criada como rascunho e pode ser completada depois.";

  const actions = [];
  if (editable) {
    actions.push(
      `<button class="btn btn-primary btn-compacto" type="button" data-action="save-intake">${
        intake ? "Salvar rascunho" : "Criar anamnese"
      }</button>`
    );
    if (intake) {
      actions.push(
        '<button class="btn btn-secondary btn-compacto" type="button" data-action="complete-intake">Concluir</button>',
        '<button class="btn btn-secondary btn-compacto" type="button" data-action="lock-intake">Bloquear</button>'
      );
    }
  } else if (janelaExpirada) {
    // Rascunho fora da janela não pode mais ser editado, mas o servidor ainda
    // aceita concluir e bloquear. Sem estes botões o registro ficava sem saída.
    actions.push(
      '<button class="btn btn-secondary btn-compacto" type="button" data-action="complete-intake">Concluir</button>',
      '<button class="btn btn-secondary btn-compacto" type="button" data-action="lock-intake">Bloquear</button>'
    );
  } else if (intake && intake.status === "completed" && !encerrado) {
    actions.push(
      '<button class="btn btn-secondary btn-compacto" type="button" data-action="lock-intake">Bloquear</button>'
    );
  }
  if (intake) {
    actions.push(
      '<button class="btn btn-secondary btn-compacto" type="button" data-action="export-intake">Exportar PDF</button>'
    );
  }
  actionsEl.innerHTML = actions.join("");

  const payload = getIntakeWorkingPayload();
  const sections = payload.sections || [];

  // São ~26 campos de texto. Para não virar um paredão, mostramos uma seção
  // por vez — mas todas continuam no DOM (apenas ocultas), porque é do DOM que
  // a coleta lê as respostas ao salvar.
  if (secaoAtual("intake") >= sections.length) {
    definirSecaoAtual("intake", 0);
  }
  const atual = secaoAtual("intake");

  sectionsEl.innerHTML = sections
    .map((section, indice) => renderIntakeSection("intake", section, editable, indice !== atual))
    .join("");
  sectionsEl.dataset.patientId = String(state.clinical.patientId || "");

  renderSectionsIndex("intake", sections, atual);
}


// Trocar de seção NUNCA re-renderiza: o DOM guarda as respostas ainda não
// salvas e é dele que a coleta lê. Só alternamos a visibilidade.
function mostrarSecao(formKey, indice) {
  definirSecaoAtual(formKey, indice);
  const refs = refsFormulario(formKey);
  if (!refs.raiz) return;

  refs.raiz.querySelectorAll(".anamnese-secao").forEach((secao, i) => {
    secao.hidden = i !== indice;
  });

  atualizarIndiceSecoes(formKey);
  refs.raiz.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// Recalcula contadores e progresso a partir do DOM, sem tocar nas respostas.
export function atualizarIndiceSecoes(formKey) {
  const sections =
    formKey === "intake"
      ? getIntakeWorkingPayload().sections || []
      : getBlockWorkingPayload(formKey).sections || [];
  renderSectionsIndex(formKey, sections, secaoAtual(formKey));
}

// Conta respostas preenchidas por seção lendo o DOM (o que está em tela é a
// verdade em edição), com o payload como origem antes da primeira renderização.
function contarSecao(raiz, section, indice) {
  const secaoEl = raiz ? raiz.querySelectorAll(".anamnese-secao")[indice] : null;
  const itens = (section.items || []).filter((item) => item.hidden !== true);
  const total = itens.length;

  if (!secaoEl) {
    return { preenchidas: itens.filter((item) => String(item.answer || "").trim()).length, total };
  }

  const respostas = Array.from(secaoEl.querySelectorAll(".anamnese-resposta"));
  return { preenchidas: respostas.filter((el) => el.value.trim()).length, total };
}

function renderSectionsIndex(formKey, sections, atual) {
  const refs = refsFormulario(formKey);
  const indiceEl = refs.indice;
  const wrap = refs.progressoWrap;
  const barra = refs.progresso;
  const barraWrap = refs.progressoBarra;
  const texto = refs.progressoTexto;
  if (!indiceEl) return;

  let preenchidasTotal = 0;
  let camposTotal = 0;

  indiceEl.innerHTML = sections
    .map((section, indice) => {
      const { preenchidas, total } = contarSecao(refs.raiz, section, indice);
      preenchidasTotal += preenchidas;
      camposTotal += total;
      return `<button class="anamnese-indice-item${
        indice === atual ? " is-active" : ""
      }" type="button" data-action="go-section" data-form="${formKey}" data-index="${indice}">
        ${indice + 1} · ${escapeHtml(section.title)}
        <span class="anamnese-indice-contador">${preenchidas}/${total}</span>
      </button>`;
    })
    .join("");

  const pct = camposTotal ? Math.round((preenchidasTotal / camposTotal) * 100) : 0;
  wrap.hidden = false;
  barra.style.width = `${pct}%`;
  barraWrap.setAttribute("aria-valuenow", String(pct));
  texto.textContent = `${preenchidasTotal} de ${camposTotal} preenchidas`;
}

function renderIntakeItem(item, editable) {
  const isDefault = Boolean(item.isDefault);
  const isHidden = item.hidden === true;
  const labelMarkup = isDefault
    ? `<span class="anamnese-item-titulo">${escapeHtml(item.label)}</span>`
    : `<input class="anamnese-item-label-input" type="text" value="${escapeHtml(
        item.label || ""
      )}" maxlength="200" placeholder="Pergunta personalizada" ${editable ? "" : "disabled"}>`;

  let actionButton = "";
  if (editable) {
    if (isDefault) {
      // Perguntas padrão não podem ser excluídas, mas podem ser ocultadas.
      actionButton = `<button class="anamnese-item-acao" type="button" data-action="toggle-intake-question">${
        isHidden ? "Reexibir" : "Ocultar"
      }</button>`;
    } else {
      actionButton =
        '<button class="anamnese-item-acao" type="button" data-action="remove-intake-question">Remover</button>';
    }
  }

  const textarea = isHidden
    ? ""
    // maxlength espelha o limite do intakeItemSchema (8000). Sem ele, passar
      // do limite só aparecia como "Dados inválidos." ao salvar a anamnese
      // inteira, sem dizer qual resposta estourou.
    : `<textarea class="anamnese-resposta" rows="2" maxlength="8000" placeholder="Resposta..." ${
        editable ? "" : "disabled"
      }>${escapeHtml(item.answer || "")}</textarea>`;

  return `
    <div class="anamnese-item${isHidden ? " is-hidden" : ""}" data-item-id="${escapeHtml(
    item.id || ""
  )}" data-default="${isDefault ? "true" : "false"}" data-hidden="${
    isHidden ? "true" : "false"
  }" data-label="${escapeHtml(item.label || "")}" data-answer="${escapeHtml(item.answer || "")}">
      <div class="anamnese-item-head">
        ${labelMarkup}
        ${actionButton}
      </div>
      ${textarea}
    </div>
  `;
}

function renderIntakeSection(formKey, section, editable, oculta = false) {
  const items = (section.items || []).map((item) => renderIntakeItem(item, editable)).join("");
  const addButton = editable
    ? `<button class="btn btn-secondary btn-compacto" type="button" data-action="add-question" data-form="${escapeHtml(
        formKey
      )}" data-section="${escapeHtml(section.id)}">＋ Adicionar pergunta</button>`
    : "";
  return `
    <section class="anamnese-secao" ${oculta ? "hidden" : ""} data-section-id="${escapeHtml(
      section.id
    )}" data-section-title="${escapeHtml(section.title)}" data-default="${
    section.isDefault ? "true" : "false"
  }">
      <div class="anamnese-secao-head">
        <h4>${escapeHtml(section.title)}</h4>
        ${addButton}
      </div>
      <div class="anamnese-itens">${items}</div>
    </section>
  `;
}

// O contador zera a cada carregamento da página, então sozinho ele repetia
// ids de perguntas que já existiam na anamnese — e o id repetido fazia a
// pergunta nova sumir ao salvar. Olha o que já está na tela antes de escolher.
function nextCustomQuestionId() {
  const existentes = new Set(
    Array.from(document.querySelectorAll(".anamnese-item")).map((el) => el.dataset.itemId)
  );
  do {
    clinicalCustomCounter += 1;
  } while (existentes.has(`custom_${clinicalCustomCounter}`));
  return `custom_${clinicalCustomCounter}`;
}

function addIntakeQuestion(formKey, sectionId) {
  const { raiz } = refsFormulario(formKey);
  const sectionEl = raiz?.querySelector(
    `.anamnese-secao[data-section-id="${CSS.escape(sectionId)}"] .anamnese-itens`
  );
  if (!sectionEl) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = renderIntakeItem(
    { id: nextCustomQuestionId(), label: "", answer: "", isDefault: false },
    true
  );
  sectionEl.appendChild(wrapper.firstElementChild);
}

export function toggleIntakeQuestion(itemEl) {
  if (!itemEl) return;
  const currentlyHidden = itemEl.dataset.hidden === "true";
  const textarea = itemEl.querySelector(".anamnese-resposta");
  const answer = textarea ? textarea.value : itemEl.dataset.answer || "";
  const rebuilt = {
    id: itemEl.dataset.itemId,
    label: itemEl.dataset.label,
    answer,
    isDefault: itemEl.dataset.default === "true",
    hidden: !currentlyHidden
  };
  const wrapper = document.createElement("div");
  wrapper.innerHTML = renderIntakeItem(rebuilt, true);
  itemEl.replaceWith(wrapper.firstElementChild);
}

function collectSectionsPayload(raiz) {
  if (!raiz) {
    return { sections: [] };
  }
  const sections = Array.from(raiz.querySelectorAll(".anamnese-secao")).map(
    (sectionEl) => {
      const items = Array.from(sectionEl.querySelectorAll(".anamnese-item")).map((itemEl) => {
        const isDefault = itemEl.dataset.default === "true";
        const hidden = itemEl.dataset.hidden === "true";
        const labelInput = itemEl.querySelector(".anamnese-item-label-input");
        const label = isDefault ? itemEl.dataset.label : labelInput ? labelInput.value : "";
        const textarea = itemEl.querySelector(".anamnese-resposta");
        // Itens ocultos não renderizam textarea: preserva a resposta via data-answer.
        const answer = textarea ? textarea.value : itemEl.dataset.answer || "";
        return {
          id: itemEl.dataset.itemId,
          label,
          answer,
          isDefault,
          hidden
        };
      });
      return {
        id: sectionEl.dataset.sectionId,
        title: sectionEl.dataset.sectionTitle,
        isDefault: sectionEl.dataset.default === "true",
        items
      };
    }
  );
  return { sections };
}

async function saveIntake() {
  const sectionsEl = document.getElementById("clinical-intake-sections");
  const donoDoFormulario = sectionsEl ? sectionsEl.dataset.patientId : "";
  // Rede de segurança: mesmo que algum caminho deixe o formulário de outro
  // paciente na tela, nada é gravado sob o prontuário errado.
  if (donoDoFormulario !== String(state.clinical.patientId || "")) {
    setStatus(
      "A anamnese aberta não é a deste paciente. Recarregue a aba antes de salvar.",
      "error"
    );
    return;
  }

  const payload = collectSectionsPayload(document.getElementById("clinical-intake-sections"));
  if (state.clinical.intake) {
    await apiRequest(`/api/admin/intakes/${state.clinical.intake.id}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  } else {
    await apiRequest(`/api/admin/patients/${state.clinical.patientId}/intake`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }
  await loadIntake();
  await loadClinicalRecord();
  setStatus("Anamnese salva.", "success");
}

// ── Contrato e plano terapêutico ─────────────────────────────────────────────

function getBlockWorkingPayload(formKey) {
  const bloco = state.clinical.blocks?.[formKey];
  if (bloco?.block?.payload) {
    return bloco.block.payload;
  }
  return bloco?.template || { sections: [] };
}

export async function loadBlock(formKey) {
  const id = recordId();
  if (!id) return;
  const response = await apiRequest(`/api/admin/clinical-records/${id}/blocks/${formKey}`);

  // Mesma guarda da anamnese: se a resposta chegou depois de a tela já ter
  // trocado de paciente, ela é descartada. Num prontuário, mostrar dado de
  // outra pessoa é o pior defeito possível.
  if (String(response.data.record?.patientId || "") !== String(state.clinical.patientId || "")) {
    return;
  }

  state.clinical.blocks[formKey] = response.data;
  renderBlock(formKey);
}

export function renderBlock(formKey) {
  const refs = refsFormulario(formKey);
  if (!refs.raiz) return;

  const dados = state.clinical.blocks?.[formKey];
  const bloco = dados?.block || null;
  const prontuarioAberto = state.clinical.summary?.record?.status !== "closed";
  const editable = bloco ? bloco.editable : prontuarioAberto;
  const rotulo = FORMULARIOS_SECOES[formKey]?.rotulo || formKey;

  refs.status.textContent = bloco
    ? `Situação: ${bloco.statusLabel || bloco.status}`
    : `${rotulo} ainda não registrado`;

  refs.ajuda.textContent = !prontuarioAberto
    ? "Prontuário encerrado: este registro está em leitura. Reabra o prontuário para retomar."
    : !editable
      ? "Registro concluído ou bloqueado: não pode ser editado diretamente."
      : formKey === "contract"
        ? "Registre o que foi combinado e o que foi explicado sobre sigilo. O contrato sai em PDF para assinatura."
        : "O plano muda ao longo do acompanhamento. Revise sempre que o foco do trabalho mudar.";

  const acoes = [];
  if (editable) {
    acoes.push(
      `<button class="btn btn-primary btn-compacto" type="button" data-action="save-block" data-form="${formKey}">${
        bloco ? "Salvar rascunho" : `Criar ${rotulo.toLowerCase()}`
      }</button>`
    );
    if (bloco) {
      acoes.push(
        `<button class="btn btn-secondary btn-compacto" type="button" data-action="complete-block" data-form="${formKey}">Concluir</button>`,
        `<button class="btn btn-secondary btn-compacto" type="button" data-action="lock-block" data-form="${formKey}">Bloquear</button>`
      );
    }
  } else if (bloco && bloco.status === "completed" && prontuarioAberto) {
    acoes.push(
      `<button class="btn btn-secondary btn-compacto" type="button" data-action="lock-block" data-form="${formKey}">Bloquear</button>`
    );
  }
  if (bloco) {
    acoes.push(
      `<button class="btn btn-secondary btn-compacto" type="button" data-action="export-block" data-form="${formKey}">Exportar PDF</button>`
    );
  }
  refs.acoes.innerHTML = acoes.join("");

  const sections = getBlockWorkingPayload(formKey).sections || [];
  if (secaoAtual(formKey) >= sections.length) {
    definirSecaoAtual(formKey, 0);
  }
  const atual = secaoAtual(formKey);

  refs.raiz.innerHTML = sections
    .map((section, indice) => renderIntakeSection(formKey, section, editable, indice !== atual))
    .join("");
  refs.raiz.dataset.patientId = String(state.clinical.patientId || "");

  renderSectionsIndex(formKey, sections, atual);
}

async function saveBlock(formKey) {
  const id = recordId();
  if (!id) return;
  const { raiz } = refsFormulario(formKey);

  // Rede de segurança: mesmo que algum caminho deixe o formulário de outro
  // paciente na tela, nada é gravado sob o prontuário errado.
  if (!raiz || raiz.dataset.patientId !== String(state.clinical.patientId || "")) {
    setStatus(
      "O formulário aberto não é o deste paciente. Recarregue a aba antes de salvar.",
      "error"
    );
    return;
  }

  await apiRequest(`/api/admin/clinical-records/${id}/blocks/${formKey}`, {
    method: "PUT",
    body: JSON.stringify(collectSectionsPayload(raiz))
  });
  await loadBlock(formKey);
  await loadClinicalRecord();
  setStatus(`${FORMULARIOS_SECOES[formKey]?.rotulo || formKey} salvo.`, "success");
}

async function completeBlock(formKey) {
  const id = recordId();
  if (!id) return;
  await apiRequest(`/api/admin/clinical-records/${id}/blocks/${formKey}/complete`, {
    method: "POST"
  });
  await loadBlock(formKey);
  await loadClinicalRecord();
  setStatus("Bloco concluído.", "success");
}

async function lockBlock(formKey) {
  const id = recordId();
  if (!id) return;
  await apiRequest(`/api/admin/clinical-records/${id}/blocks/${formKey}/lock`, { method: "POST" });
  await loadBlock(formKey);
  await loadClinicalRecord();
  setStatus("Bloco bloqueado.", "success");
}

function exportBlock(formKey) {
  const id = recordId();
  if (!id) return;
  window.open(`/api/admin/clinical-records/${id}/blocks/${formKey}/export.pdf`, "_blank");
}

export const ACOES_FORMULARIOS_CLINICOS = {
  "save-intake": async () => {
    await saveIntake();
  },
  "complete-intake": async () => {
    if (!state.clinical.intake) return;
    if (!window.confirm("Concluir a anamnese? Após concluída ela não pode ser editada diretamente.")) return;
    await apiRequest(`/api/admin/intakes/${state.clinical.intake.id}/complete`, { method: "POST" });
    await loadIntake();
    await loadClinicalRecord();
    setStatus("Anamnese concluída.", "success");
  },
  "lock-intake": async () => {
    if (!state.clinical.intake) return;
    if (!window.confirm("Bloquear a anamnese? Registros bloqueados não podem ser editados — só por nova versão/adendo.")) return;
    await apiRequest(`/api/admin/intakes/${state.clinical.intake.id}/lock`, { method: "POST" });
    await loadIntake();
    await loadClinicalRecord();
    setStatus("Anamnese bloqueada.", "success");
  },
  "export-intake": () => {
    if (state.clinical.intake) {
      window.open(`/api/admin/intakes/${state.clinical.intake.id}/export.pdf`, "_blank");
    }
  },
  "add-question": ({ actionSource }) => {
    addIntakeQuestion(actionSource.dataset.form || "intake", actionSource.dataset.section);
  },
  "save-block": async ({ actionSource }) => {
    await saveBlock(actionSource.dataset.form);
  },
  "complete-block": async ({ actionSource }) => {
    if (
      !window.confirm(
        "Concluir este bloco? Depois de concluído ele não pode ser editado diretamente."
      )
    )
      return;
    await completeBlock(actionSource.dataset.form);
  },
  "lock-block": async ({ actionSource }) => {
    if (
      !window.confirm(
        "Bloquear este bloco? Registros bloqueados não podem ser editados — a correção passa a ser por nova versão."
      )
    )
      return;
    await lockBlock(actionSource.dataset.form);
  },
  "export-block": ({ actionSource }) => {
    exportBlock(actionSource.dataset.form);
  },
  "go-section": ({ actionSource }) => {
    mostrarSecao(
      actionSource.dataset.form || "intake",
      Number(actionSource.dataset.index) || 0
    );
  }
};
