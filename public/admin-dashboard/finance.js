import { state } from "./state.js";
import {
  CLINIC_TIME_ZONE,
  formatCurrency,
  formatDate,
  formatDateTime,
  labelMaps
} from "./format.js";
import { copyText, escapeHtml, setStatus } from "./ui.js";
import { apiRequest, toQueryString } from "./api.js";
import { loadSessions } from "./sessions.js";

function buildReceiptDeliveryMessage(receipt) {
  return `Olá. Segue o recibo referente ao atendimento psicológico realizado em ${formatDate(
    receipt.sessionDate
  )}.`;
}

async function getReceiptById(receiptId) {
  const existing = state.receipts.find((item) => String(item.id) === String(receiptId));
  if (existing) {
    return existing;
  }

  const response = await apiRequest(`/api/admin/receipts/${receiptId}`);
  return response.data;
}

// Marca o mês corrente no filtro do financeiro.
export function marcarMesAtual() {
  const select = document.querySelector('#finance-filters-form select[name="month"]');
  if (!select) return;
  const mesAtual = Number(
    new Intl.DateTimeFormat("pt-BR", { month: "numeric", timeZone: CLINIC_TIME_ZONE }).format(new Date())
  );
  Array.from(select.options).forEach((opcao) => {
    const base = opcao.dataset.base || opcao.textContent;
    opcao.dataset.base = base;
    opcao.textContent = Number(opcao.value) === mesAtual ? `${base} · atual` : base;
  });
}

function buildReceiptActionButtons(item) {
  if (item.paymentStatus !== "pago") {
    return "";
  }

  if (item.receiptId) {
    return `
      <button class="btn btn-secondary btn-compacto" type="button" data-action="download-receipt" data-id="${item.receiptId}">Baixar recibo</button>
      <button class="btn btn-secondary btn-compacto" type="button" data-action="copy-receipt-message" data-id="${item.receiptId}">Copiar mensagem</button>
    `;
  }

  return `
    <button class="btn btn-secondary btn-compacto" type="button" data-action="generate-receipt" data-id="${item.id}">Gerar recibo</button>
  `;
}

function renderFinancePanel() {
  const finance = state.finance || {
    summary: {
      totalReceived: 0,
      totalPending: 0,
      completedSessions: 0,
      pendingPayments: 0
    },
    pendingPayments: [],
    receivedPayments: []
  };

  document.getElementById("finance-total-received").textContent = formatCurrency(
    finance.summary.totalReceived
  );
  document.getElementById("finance-total-pending").textContent = formatCurrency(
    finance.summary.totalPending
  );
  document.getElementById("finance-completed-sessions").textContent =
    finance.summary.completedSessions;
  document.getElementById("finance-pending-count").textContent =
    finance.summary.pendingPayments;

  const pendingList = document.getElementById("finance-pending-list");
  const pendingEmpty = document.getElementById("finance-pending-empty");
  pendingList.innerHTML = finance.pendingPayments
    .map(
      (session) => `
        <div class="admin-linha">
          <strong>${escapeHtml(session.patientName)}</strong>
          <span class="mono texto-secundario">${escapeHtml(formatDateTime(session.scheduledAt))}</span>
          <span class="valor">${escapeHtml(formatCurrency(session.price))}</span>
          <button class="btn btn-primary btn-compacto" type="button" data-action="paid-session" data-id="${session.id}">Marcar como pago</button>
        </div>
      `
    )
    .join("");
  pendingList.hidden = finance.pendingPayments.length === 0;
  pendingEmpty.hidden = finance.pendingPayments.length > 0;

  const receivedList = document.getElementById("finance-received-list");
  const receivedEmpty = document.getElementById("finance-received-empty");
  receivedList.innerHTML = finance.receivedPayments
    .map(
      (session) => `
        <div class="admin-linha">
          <strong>${escapeHtml(session.patientName)}</strong>
          <span class="mono texto-secundario">${escapeHtml(formatDateTime(session.paidAt || session.scheduledAt))}</span>
          <span class="texto-apoio">${escapeHtml(
            labelMaps.paymentMethod[session.paymentMethod] || session.paymentMethod
          )}</span>
          <span class="valor">${escapeHtml(formatCurrency(session.price))}</span>
          ${buildReceiptActionButtons(session)}
        </div>
      `
    )
    .join("");
  receivedList.hidden = finance.receivedPayments.length === 0;
  receivedEmpty.hidden = finance.receivedPayments.length > 0;

  const receiptsList = document.getElementById("finance-receipts-list");
  const receiptsEmpty = document.getElementById("finance-receipts-empty");
  receiptsList.innerHTML = state.receipts
    .map(
      (receipt) => `
        <div class="admin-linha">
          <strong>
            <span class="mono" style="color:var(--verde)">${escapeHtml(receipt.receiptNumber)}</span>
            ${escapeHtml(receipt.patientName)}
          </strong>
          <!-- A data mostrada acompanha o regime escolhido: em competência é a
               do atendimento, em caixa é a do pagamento. Mostrar sempre a de
               pagamento fazia a lista contradizer o próprio filtro. -->
          <span class="mono texto-secundario">${escapeHtml(
            formatDate(state.receiptBasis === "caixa" ? receipt.paymentDate : receipt.sessionDate)
          )}</span>
          <span class="valor">${escapeHtml(formatCurrency(receipt.amount))}</span>
          <button class="btn btn-secondary btn-compacto" type="button" data-action="download-receipt" data-id="${receipt.id}">⤓ Baixar PDF</button>
          <button class="btn btn-secondary btn-compacto" type="button" data-action="copy-receipt-message" data-id="${receipt.id}">⧉ Copiar mensagem</button>
        </div>
      `
    )
    .join("");
  receiptsList.hidden = state.receipts.length === 0;
  receiptsEmpty.hidden = state.receipts.length > 0;
}

export async function loadFinance() {
  const response = await apiRequest(
    `/api/admin/finance/summary${toQueryString(state.financeFilters)}`
  );
  state.finance = response.data;
  renderFinancePanel();
}

export async function loadReceipts() {
  const response = await apiRequest(
    `/api/admin/receipts${toQueryString({
      month: state.financeFilters.month,
      year: state.financeFilters.year,
      patientId: state.financeFilters.patientId,
      basis: state.receiptBasis
    })}`
  );
  state.receipts = response.data.items || [];
  renderFinancePanel();
}

export function registrarExportacaoDoFinanceiro() {
  document.getElementById("finance-export-button").addEventListener("click", () => {
    window.open(`/api/admin/finance/export.csv${toQueryString(state.financeFilters)}`, "_blank");
  });
}

export const ACOES_RECIBOS = {
  "generate-receipt": async ({ id }) => {
    const response = await apiRequest(`/api/admin/sessions/${id}/receipt`, {
      method: "POST",
      body: JSON.stringify({})
    });
    await Promise.all([loadSessions(), loadFinance(), loadReceipts()]);
    setStatus(
      response.meta?.reused ? "Recibo já existente carregado." : "Recibo gerado com sucesso.",
      "success"
    );
  },
  "download-receipt": ({ id }) => {
    window.open(`/api/admin/receipts/${id}/download`, "_blank");
  },
  "copy-receipt-message": async ({ id }) => {
    const receipt = await getReceiptById(id);
    await copyText(
      buildReceiptDeliveryMessage(receipt),
      "Mensagem de envio do recibo copiada."
    );
  }
};
