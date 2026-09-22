import { state } from "./state.js";
import { formatAuditDateTime, formatDate, labelMaps } from "./format.js";
import { escapeHtml, renderChip, setStatus } from "./ui.js";
import { apiRequest } from "./api.js";
import { loadDocuments } from "./clinical-documents.js";
import { EVOLUTION_STATUS_LABELS, loadEvolutions } from "./clinical-evolutions.js";
import {
  formularioJaRenderizadoParaPacienteAtual,
  limparFormulariosDeSecoes,
  loadBlock,
  loadIntake,
  renderBlock,
  renderIntake
} from "./clinical-forms.js";
import { openPanel } from "./navigation.js";

// ── Prontuário clínico ───────────────────────────────────────────────────────

async function openClinical(patientId) {
  const patient = state.patients.find((item) => String(item.id) === String(patientId));
  state.clinical = {
    patientId: Number(patientId),
    tab: "resumo",
    summary: null,
    intake: null,
    intakeTemplate: null,
    blocks: {},
    documents: [],
    sectionIndex: { intake: 0, contract: 0, plan: 0 },
    evolutions: [],
    patient: patient || null
  };
  // O formulário da anamnese vive no DOM e é dele que a coleta lê.
  // Trocar de paciente sem limpá-lo deixava as respostas do anterior na tela:
  // se a carga da nova anamnese falhasse, salvar gravaria o conteúdo de uma
  // pessoa no prontuário de outra.
  limparFormulariosDeSecoes();

  openPanel("clinical", { scrollIntoView: true });
  setClinicalTab("resumo");
  await loadClinicalRecord();
}

function renderClinicalPatientCard() {
  const card = document.getElementById("clinical-patient-card");
  const patient = state.clinical.summary?.patient || state.clinical.patient;
  if (!patient) {
    card.innerHTML = "";
    return;
  }
  const partes = [
    patient.phone ? `<span class="mono">${escapeHtml(patient.phone)}</span>` : "",
    patient.email ? `<span>${escapeHtml(patient.email)}</span>` : "",
    `<span>${escapeHtml(labelMaps.patientType[patient.patientType] || patient.patientType)} · ${escapeHtml(
      labelMaps.patientModality[patient.modality] || patient.modality
    )} · em acompanhamento desde ${escapeHtml(formatDate(patient.createdAt))}</span>`
  ].filter(Boolean);

  card.innerHTML = partes.join("");
}

function setClinicalTab(tab) {
  state.clinical.tab = tab;
  document.querySelectorAll("[data-clinical-tab]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.clinicalTab === tab);
  });
  document.querySelectorAll("[data-clinical-panel]").forEach((panel) => {
    const isCurrent = panel.dataset.clinicalPanel === tab;
    panel.hidden = !isCurrent;
    panel.classList.toggle("is-active", isCurrent);
  });
}

export async function switchClinicalTab(tab) {
  setClinicalTab(tab);
  if (tab === "anamnese" && !state.clinical.intake && !state.clinical.intakeTemplate) {
    await loadIntake();
  } else if (tab === "anamnese" && !formularioJaRenderizadoParaPacienteAtual("intake")) {
    renderIntake();
  }

  // Contrato e plano seguem a mesma regra da anamnese: só recarregam se o
  // formulário na tela ainda não for o deste paciente. Recarregar sempre
  // jogaria fora o que foi digitado e não salvo ao trocar de aba.
  for (const [aba, formKey] of [["contrato", "contract"], ["plano", "plan"]]) {
    if (tab !== aba) continue;
    if (!state.clinical.blocks?.[formKey]) {
      await loadBlock(formKey);
    } else if (!formularioJaRenderizadoParaPacienteAtual(formKey)) {
      renderBlock(formKey);
    }
  }

  if (tab === "evolucoes") {
    await loadEvolutions();
  }
  if (tab === "documentos") {
    await loadDocuments();
  }
  atualizarAcoesDeCriacaoDoCofre();
}

// Prontuário encerrado não recebe registro novo: os botões de criar somem
// em vez de levar a um 409 depois de a pessoa já ter digitado.
function atualizarAcoesDeCriacaoDoCofre() {
  const encerrado = state.clinical.summary?.record?.status === "closed";
  for (const seletor of ['[data-action="new-evolution"]', '[data-action="new-document"]']) {
    document.querySelectorAll(`.cofre ${seletor}`).forEach((botao) => {
      botao.hidden = encerrado;
    });
  }
}

export async function loadClinicalRecord() {
  if (!state.clinical.patientId) return;

  // Trocar de paciente mantinha na tela o cartão e o resumo do anterior até a
  // resposta chegar. Num prontuário, ver dado de outra pessoa — ainda que por
  // um instante — não é aceitável.
  if (String(state.clinical.summary?.patient?.id || "") !== String(state.clinical.patientId)) {
    state.clinical.summary = null;
    renderClinicalPatientCard();
    renderRecordHeader();
    renderClinicalSummary();
  }
  const response = await apiRequest(
    `/api/admin/patients/${state.clinical.patientId}/clinical-record`
  );
  state.clinical.summary = response.data;
  renderClinicalPatientCard();
  renderRecordHeader();
  renderClinicalSummary();
  atualizarAcoesDeCriacaoDoCofre();
}

function describeIntakeStatus(intake) {
  if (!intake) return "Ausente";
  return intake.statusLabel || intake.status;
}

function renderClinicalSummary() {
  const container = document.getElementById("clinical-summary");
  const resumo = state.clinical.summary;
  if (!resumo) {
    container.innerHTML = "<p class=\"field-help\">Carregando…</p>";
    return;
  }

  const patient = resumo.patient;
  const record = resumo.record;

  // Sem prontuário aberto não há o que resumir: a tela oferece o ato que
  // faltava — abrir o registro.
  if (!record) {
    container.innerHTML = `
      <div class="cofre-proximo">
        <div>
          <div class="rotulo-micro">Próximo passo</div>
          <h3>Abra o prontuário</h3>
          <p>
            O prontuário reúne contrato e consentimento, plano terapêutico, anamnese,
            evolução de cada atendimento, documentos emitidos e o encerramento do caso.
            Abrir dá número ao registro e começa o acompanhamento.
          </p>
        </div>
        <div class="inline-actions">
          <button class="btn btn-primary btn-compacto" type="button" data-action="open-clinical-record">Abrir prontuário</button>
        </div>
      </div>
    `;
    atualizarContadoresDoCofre(resumo);
    return;
  }

  const intakeStatus = describeIntakeStatus(resumo.intake);
  const latest = resumo.latestEvolution;
  const encerrado = record.status === "closed";

  const timeline = (resumo.timeline || [])
    .map(
      (entry) => `
        <li>
          <span class="cofre-timeline-data">${escapeHtml(formatAuditDateTime(entry.date))}</span>
          <span>${escapeHtml(entry.label)}</span>
          ${
            entry.status
              ? `<span class="cofre-timeline-estado is-menor">${renderChip(
                  chipDaTimeline(entry),
                  entry.status,
                  rotuloDoEstado(entry)
                )}</span>`
              : ""
          }
        </li>
      `
    )
    .join("");

  const proximo = proximoPassoDoProntuario(resumo);
  const chipAnamnese = resumo.intake
    ? renderChip("intake", resumo.intake.status, resumo.intake.statusLabel || intakeStatus)
    : "";
  const evolutionsCount = Number(resumo.evolutionsCount) || 0;

  container.innerHTML = `
    <div class="cofre-proximo">
      <div>
        <div class="rotulo-micro">Próximo passo</div>
        <h3>${escapeHtml(proximo.titulo)}</h3>
        <p>${escapeHtml(proximo.ajuda)}</p>
      </div>
      <div class="inline-actions">
        ${proximo.acoes}
      </div>
    </div>

    <div class="cofre-estatisticas">
      <button class="cofre-estatistica" type="button" data-clinical-goto="contrato">
        <span class="rotulo-micro">Contrato</span>
        <strong>${
          resumo.blocks?.contract
            ? renderChip("intake", resumo.blocks.contract.status, resumo.blocks.contract.statusLabel)
            : "Não registrado"
        }</strong>
        <span class="cofre-estatistica-hint">${resumo.blocks?.contract ? "Abrir" : "Registrar"}</span>
      </button>
      <button class="cofre-estatistica" type="button" data-clinical-goto="plano">
        <span class="rotulo-micro">Plano terapêutico</span>
        <strong>${
          resumo.blocks?.plan
            ? renderChip("intake", resumo.blocks.plan.status, resumo.blocks.plan.statusLabel)
            : "Não registrado"
        }</strong>
        <span class="cofre-estatistica-hint">${resumo.blocks?.plan ? "Abrir" : "Registrar"}</span>
      </button>
      <button class="cofre-estatistica" type="button" data-clinical-goto="anamnese">
        <span class="rotulo-micro">Anamnese</span>
        <strong>${chipAnamnese || escapeHtml(intakeStatus)}</strong>
        <span class="cofre-estatistica-hint">${resumo.intake ? "Abrir" : "Criar agora"}</span>
      </button>
      <button class="cofre-estatistica" type="button" data-clinical-goto="evolucoes">
        <span class="rotulo-micro">Evoluções</span>
        <strong>${escapeHtml(String(evolutionsCount))}</strong>
        <span class="cofre-estatistica-hint">${evolutionsCount ? "Ver todas" : "Registrar a primeira"}</span>
      </button>
      <button class="cofre-estatistica" type="button" data-clinical-goto="documentos">
        <span class="rotulo-micro">Documentos</span>
        <strong>${escapeHtml(String(Number(resumo.documentsCount) || 0))}</strong>
        <span class="cofre-estatistica-hint">${resumo.documentsCount ? "Ver todos" : "Emitir"}</span>
      </button>
      <article class="cofre-estatistica">
        <span class="rotulo-micro">Última evolução</span>
        <strong>${latest ? escapeHtml(formatDate(latest.evolutionDate)) : "—"}</strong>
      </article>
    </div>

    <h2 class="cofre-titulo-secao">Histórico do prontuário</h2>
    <div class="cofre-cartao">
      ${
        timeline
          ? `<ul class="cofre-timeline">${timeline}</ul>`
          : `<p class="field-help" style="margin-top:8px">Nenhum registro ainda. Use os botões acima para começar.</p>`
      }
    </div>
  `;

  atualizarContadoresDoCofre(resumo);
}

// A cadeia do prontuário: contrato, plano, anamnese, primeiro atendimento.
// Antes o próximo passo olhava só a anamnese, e por isso o registro parecia
// começar e terminar nela.
function proximoPassoDoProntuario(resumo) {
  const acao = (rotulo, aba) =>
    `<button class="btn btn-primary btn-compacto" type="button" data-clinical-goto="${aba}">${rotulo}</button>`;

  if (resumo.record?.status === "closed") {
    return {
      titulo: "Prontuário encerrado",
      ajuda:
        "O caso foi encerrado e o registro está em leitura. Reabra o prontuário para retomar o acompanhamento.",
      acoes: `<button class="btn btn-secondary btn-compacto" type="button" data-action="export-clinical-record">Exportar em PDF</button>`
    };
  }

  if (!resumo.blocks?.contract) {
    return {
      titulo: "Registre o contrato",
      ajuda:
        "O que foi combinado e o que foi explicado sobre sigilo abre o acompanhamento. O contrato sai em PDF para assinatura.",
      acoes: acao("Registrar contrato", "contrato")
    };
  }

  if (!resumo.intake) {
    return {
      titulo: "Comece pela anamnese",
      ajuda:
        "A anamnese é o retrato da chegada. Depois dela, registre uma evolução a cada atendimento.",
      acoes: acao("Criar anamnese", "anamnese")
    };
  }

  if (!resumo.blocks?.plan) {
    return {
      titulo: "Defina o plano terapêutico",
      ajuda: "Foco do trabalho e objetivos combinados, revisáveis ao longo do acompanhamento.",
      acoes: acao("Registrar plano", "plano")
    };
  }

  if (!Number(resumo.evolutionsCount)) {
    return {
      titulo: "Registre a primeira evolução",
      ajuda: "Cada atendimento vira uma evolução clínica, com data e conteúdo criptografado.",
      acoes: acao("Nova evolução", "evolucoes")
    };
  }

  return {
    titulo: "Prontuário em andamento",
    ajuda:
      "Registre uma evolução a cada atendimento, revise o plano quando o foco mudar e encerre o caso quando ele terminar.",
    acoes: acao("Nova evolução", "evolucoes")
  };
}

// A linha do tempo mistura blocos, anamnese, evoluções e documentos: cada um
// tem seu próprio conjunto de estados.
function chipDaTimeline(entry) {
  if (entry.type === "document") return "document";
  if (entry.type === "block") return "intake";
  if (entry.type === "evolution") return "evolution";
  return "intake";
}

function rotuloDoEstado(entry) {
  if (entry.type === "document") {
    return entry.status === "revoked" ? "Revogado" : "Emitido";
  }
  if (entry.type === "evolution") {
    return EVOLUTION_STATUS_LABELS[entry.status] || entry.status;
  }
  return BLOCK_STATUS_LABELS[entry.status] || entry.status;
}

const BLOCK_STATUS_LABELS = {
  draft: "Rascunho",
  completed: "Concluído",
  locked: "Bloqueado"
};

function atualizarContadoresDoCofre(resumo) {
  const contadores = {
    "clinical-tab-contrato": resumo.blocks?.contract ? "●" : "",
    "clinical-tab-plano": resumo.blocks?.plan ? "●" : "",
    "clinical-tab-anamnese": resumo.intake ? "●" : "",
    "clinical-tab-evolucoes": Number(resumo.evolutionsCount)
      ? String(resumo.evolutionsCount)
      : "",
    "clinical-tab-documentos": Number(resumo.documentsCount)
      ? String(resumo.documentsCount)
      : ""
  };
  for (const [id, valor] of Object.entries(contadores)) {
    const el = document.getElementById(id);
    if (el) el.textContent = valor;
  }
}

export function recordId() {
  return state.clinical.summary?.record?.id || null;
}

// ── Abertura, encerramento e reabertura ──────────────────────────────────────
async function openClinicalRecordForPatient() {
  if (!state.clinical.patientId) return;
  await apiRequest(`/api/admin/patients/${state.clinical.patientId}/clinical-record`, {
    method: "POST"
  });
  await loadClinicalRecord();
  setStatus("Prontuário aberto.", "success");
}

function openCloseRecordDialog() {
  const modal = document.getElementById("clinical-close-modal");
  const form = document.getElementById("clinical-close-form");
  if (!modal || !form) return;
  form.reset();
  modal.showModal();
}

async function confirmCloseRecord() {
  const id = recordId();
  if (!id) return;
  const form = document.getElementById("clinical-close-form");
  const dados = Object.fromEntries(new FormData(form).entries());

  // Os campos do diálogo são exatamente os itens do template de encerramento.
  const items = [
    "synthesis",
    "reached_goals",
    "pending_goals",
    "guidance",
    "referral",
    "return_terms"
  ].map((id) => ({ id, answer: dados[id] || "" }));

  await apiRequest(`/api/admin/clinical-records/${id}/close`, {
    method: "POST",
    body: JSON.stringify({
      closingReason: dados.closingReason,
      sections: [{ id: "closing", items }]
    })
  });

  document.getElementById("clinical-close-modal")?.close();
  descartarAbasDoCofre();
  await loadClinicalRecord();
  await refreshClinicalTab();
  setStatus("Prontuário encerrado.", "success");
}

async function reopenClinicalRecord() {
  const id = recordId();
  if (!id) return;
  const motivo = window.prompt("Por que o prontuário está sendo reaberto?");
  if (motivo === null) return;
  if (motivo.trim().length < 3) {
    setStatus("Explique por que o prontuário está sendo reaberto.", "error");
    return;
  }
  await apiRequest(`/api/admin/clinical-records/${id}/reopen`, {
    method: "POST",
    body: JSON.stringify({ reason: motivo.trim() })
  });
  descartarAbasDoCofre();
  await loadClinicalRecord();
  await refreshClinicalTab();
  setStatus("Prontuário reaberto.", "success");
}

// Encerrar e reabrir mudam o que cada aba permite. As abas já montadas no
// DOM não são re-renderizadas — é assim que rascunho não salvo sobrevive à
// troca de aba —, e por isso seguiam oferecendo Salvar e Concluir num
// prontuário encerrado. Descartar o que está em cache faz cada aba voltar do
// servidor já no estado certo. O rascunho não salvo se perde, e é o correto:
// o servidor recusaria salvá-lo de qualquer forma.
function descartarAbasDoCofre() {
  state.clinical.blocks = {};
  state.clinical.intake = null;
  state.clinical.intakeTemplate = null;
  limparFormulariosDeSecoes();
}

// Depois de encerrar ou reabrir, a aba em que se está precisa refletir o novo
// estado — os botões de edição somem ou voltam.
async function refreshClinicalTab() {
  const tab = state.clinical.tab;
  if (tab === "contrato") await loadBlock("contract");
  else if (tab === "plano") await loadBlock("plan");
  else if (tab === "anamnese") await loadIntake();
  else if (tab === "evolucoes") await loadEvolutions();
  else if (tab === "documentos") await loadDocuments();
}

// Cabeçalho do cofre: número do prontuário, situação e as ações do registro.
function renderRecordHeader() {
  const acoesEl = document.getElementById("clinical-record-actions");
  const faixaEl = document.getElementById("clinical-record-closed-banner");
  const nomeEl = document.getElementById("clinical-patient-name");
  if (!acoesEl) return;

  const record = state.clinical.summary?.record || null;
  const patient = state.clinical.summary?.patient || state.clinical.patient;

  if (nomeEl && patient) {
    nomeEl.innerHTML = `${escapeHtml(patient.fullName)}${
      record
        ? ` <span class="cofre-numero mono">${escapeHtml(record.recordNumber)}</span>${renderChip(
            "record",
            record.status,
            record.statusLabel
          )}`
        : ""
    }`;
  }

  const acoes = [];
  if (!record) {
    acoes.push(
      '<button class="btn btn-primary" type="button" data-action="open-clinical-record">Abrir prontuário</button>'
    );
  } else {
    acoes.push(
      '<button class="btn btn-secondary" type="button" data-action="export-clinical-record">Exportar prontuário em PDF</button>'
    );
    acoes.push(
      record.status === "closed"
        ? '<button class="btn btn-secondary" type="button" data-action="reopen-clinical-record">Reabrir prontuário</button>'
        : '<button class="btn btn-secondary" type="button" data-action="close-clinical-record">Encerrar prontuário</button>'
    );
  }
  acoesEl.innerHTML = acoes.join("");

  if (faixaEl) {
    const encerrado = record && record.status === "closed";
    faixaEl.hidden = !encerrado;
    faixaEl.innerHTML = encerrado
      ? `<span class="glifo" aria-hidden="true">◆</span>
         <span><strong>Prontuário encerrado em ${escapeHtml(
           formatDate(record.closedAt)
         )} — ${escapeHtml(record.closingReasonLabel || "")}.</strong>
         O registro está em leitura. Correções entram como adendo; para retomar o acompanhamento, reabra o prontuário.</span>`
      : "";
  }
}

export function registrarAtalhosDoProntuario() {
  // Os atalhos do resumo (cartões e botões de próximo passo) levam à aba.
  document.addEventListener("click", (event) => {
    const atalho = event.target.closest?.("[data-clinical-goto]");
    if (!atalho) return;
    switchClinicalTab(atalho.dataset.clinicalGoto).catch((error) =>
      setStatus(error.message, "error")
    );
  });

  document.querySelectorAll("[data-clinical-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      switchClinicalTab(button.dataset.clinicalTab).catch((error) => setStatus(error.message, "error"));
    });
  });
}

export const ACOES_PRONTUARIO = {
  "open-clinical": async ({ id }) => {
    await openClinical(id);
  },
  "back-to-patients": () => {
    openPanel("patients");
  },
  "export-clinical-record": () => {
    if (state.clinical.patientId) {
      window.open(
        `/api/admin/patients/${state.clinical.patientId}/clinical-record/export.pdf`,
        "_blank"
      );
    }
  },
  "open-clinical-record": async () => {
    await openClinicalRecordForPatient();
  },
  "close-clinical-record": () => {
    openCloseRecordDialog();
  },
  "confirm-close-record": async () => {
    await confirmCloseRecord();
  },
  "reopen-clinical-record": async () => {
    await reopenClinicalRecord();
  },
  "go-intake": async () => {
    await switchClinicalTab("anamnese");
  },
  "go-evolutions": async () => {
    await switchClinicalTab("evolucoes");
  }
};
