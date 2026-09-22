import { state } from "./state.js";
import { CLINIC_TIME_ZONE, formatCurrency, formatDateTime, labelMaps } from "./format.js";
import { escapeHtml, renderChip } from "./ui.js";
import { apiRequest } from "./api.js";

function renderDashboardSummary() {
  const summary = state.dashboardSummary || {};
  document.getElementById("summary-new-leads").textContent = summary.newLeads ?? 0;

  // O selo ao lado de Contatos na barra lateral existia no HTML e no CSS, mas
  // nada o preenchia — quem abria o painel não via que havia contato novo.
  const badge = document.getElementById("nav-badge-leads");
  if (badge) {
    const novos = Number(summary.newLeads ?? 0);
    badge.hidden = novos <= 0;
    badge.textContent = novos > 99 ? "99+" : String(novos);
  }
  document.getElementById("summary-active-patients").textContent = summary.activePatients ?? 0;
  document.getElementById("summary-sessions-week").textContent = summary.sessionsThisWeek ?? 0;
  document.getElementById("summary-pending-payments").textContent = summary.pendingPayments ?? 0;
  document.getElementById("summary-month-revenue").textContent = formatCurrency(
    summary.monthRevenue || 0
  );
  document.getElementById("summary-month-pending").textContent = formatCurrency(
    summary.monthPending || 0
  );

  const agora = new Date();
  const hora = Number(
    new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hour12: false, timeZone: CLINIC_TIME_ZONE }).format(agora)
  );
  const saudacao = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
  document.getElementById("dashboard-saudacao").textContent = `${saudacao}, Marina.`;

  // A data vem com iniciais maiúsculas, como no protótipo.
  const dataLonga = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    timeZone: CLINIC_TIME_ZONE
  }).format(agora);
  document.getElementById("dashboard-hoje").textContent = dataLonga.replace(
    /(^|[\s-])([a-zà-ú])/g,
    (_, antes, letra) => antes + letra.toUpperCase()
  );

  // Intervalo da semana corrente (segunda a domingo) sob os "Sessões na semana".
  const diaSemana = (agora.getDay() + 6) % 7;
  const inicioSemana = new Date(agora);
  inicioSemana.setDate(agora.getDate() - diaSemana);
  const fimSemana = new Date(inicioSemana);
  fimSemana.setDate(inicioSemana.getDate() + 6);
  const diaMes = (d) =>
    new Intl.DateTimeFormat("pt-BR", { day: "numeric", timeZone: CLINIC_TIME_ZONE }).format(d);
  const mesLongo = (d) =>
    new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: CLINIC_TIME_ZONE }).format(d);
  document.getElementById("summary-week-range").textContent =
    `${diaMes(inicioSemana)}–${diaMes(fimSemana)} de ${mesLongo(fimSemana)}`;
  document.getElementById("summary-month-label").textContent = `${mesLongo(agora)} · confirmado`;

  const lista = document.getElementById("dashboard-upcoming-list");
  const empty = document.getElementById("dashboard-upcoming-empty");
  const items = summary.upcomingSessions || [];

  lista.innerHTML = items
    .map(
      (session) => `
        <div class="admin-linha">
          <strong>${escapeHtml(session.patientName)}</strong>
          <span class="mono texto-secundario">${escapeHtml(formatDateTime(session.scheduledAt))}</span>
          ${renderChip("session", session.status, labelMaps.sessionStatus[session.status])}
          ${renderChip("payment", session.paymentStatus, labelMaps.paymentStatus[session.paymentStatus])}
        </div>
      `
    )
    .join("");
  lista.hidden = items.length === 0;
  empty.hidden = items.length > 0;
}

export async function loadDashboardSummary() {
  const response = await apiRequest("/api/admin/dashboard-summary");
  state.dashboardSummary = response.data;
  renderDashboardSummary();
}
