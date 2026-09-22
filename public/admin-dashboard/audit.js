import { state } from "./state.js";
import { formatAuditDateTime } from "./format.js";
import { escapeHtml, setStatus } from "./ui.js";
import { apiRequest, toQueryString } from "./api.js";
import { atualizarLimparFiltros } from "./filters.js";

function formatAuditMetadata(metadata = {}) {
  const entries = Object.entries(metadata || {});
  if (!entries.length) {
    return "—";
  }

  return entries
    .map(([key, value]) => {
      const formattedValue = Array.isArray(value)
        ? value.join(", ")
        : value && typeof value === "object"
          ? JSON.stringify(value)
          : value;
      return `${key}: ${formattedValue}`;
    })
    .join(" · ");
}

function renderAuditPanel() {
  const lista = document.getElementById("audit-list");
  const empty = document.getElementById("audit-empty");
  const paginationText = document.getElementById("audit-pagination-text");
  const prevButton = document.getElementById("audit-prev-page");
  const nextButton = document.getElementById("audit-next-page");
  const auditState = state.auditLogs || { items: [], total: 0, page: 1, pageSize: 20 };
  const totalPages = Math.max(
    1,
    Math.ceil(Number(auditState.total || 0) / Number(auditState.pageSize || 20))
  );

  lista.innerHTML = auditState.items
    .map((log) => {
      const metadados = formatAuditMetadata(log.metadata);
      const conteudo = `
        <span class="auditoria-data">${escapeHtml(formatAuditDateTime(log.createdAt))}</span>
        <span class="chip chip-neutro">${escapeHtml(log.action || "—")}</span>
        <span class="auditoria-entidade">${escapeHtml(log.entityType || "—")}${
          log.entityId ? ` #${escapeHtml(String(log.entityId))}` : ""
        }</span>
        <span class="auditoria-resumo">${escapeHtml(log.summary || "—")}</span>
        <!-- A API já devolvia adminEmail e o filtro por autor existia, mas a
             linha nunca dizia quem fez a ação. -->
        <span class="auditoria-autor">${escapeHtml(log.adminEmail || "sistema")}</span>
      `;

      // Com metadados a linha inteira vira o gatilho de <details>; sem eles,
      // é só uma linha.
      return metadados
        ? `<details class="auditoria-item">
             <summary class="auditoria-linha">
               ${conteudo}
               <span class="auditoria-ver">ver metadados</span>
             </summary>
             <pre>${escapeHtml(metadados)}</pre>
           </details>`
        : `<div class="auditoria-item"><div class="auditoria-linha">${conteudo}</div></div>`;
    })
    .join("");

  const filtroAtivo = Boolean(
    state.auditFilters.action ||
      state.auditFilters.entityType ||
      state.auditFilters.date ||
      state.auditFilters.adminEmail
  );

  atualizarLimparFiltros("audit-filters-form", filtroAtivo);

  empty.hidden = auditState.items.length > 0;
  empty.innerHTML = filtroAtivo
    ? `<h3>Nenhum evento com esse filtro</h3>
       <p>Nenhuma ação registrada corresponde aos critérios escolhidos.</p>
       <button class="btn btn-secondary btn-compacto" type="button" data-reset-filter="audit">Limpar filtros</button>`
    : `<h3>Nenhum evento registrado</h3>
       <p>As ações administrativas aparecem aqui conforme forem acontecendo.</p>`;

  paginationText.textContent = `Página ${auditState.page} de ${totalPages} · ${auditState.total} registro(s)`;
  prevButton.disabled = auditState.page <= 1;
  nextButton.disabled = auditState.page >= totalPages;
}

export async function loadAuditLogs() {
  const response = await apiRequest(`/api/admin/audit-logs${toQueryString(state.auditFilters)}`);
  state.auditLogs = response.data;
  renderAuditPanel();
}

export function registrarPaginacaoDaAuditoria() {
  document.getElementById("audit-prev-page").addEventListener("click", async () => {
    if (state.auditFilters.page <= 1) {
      return;
    }

    state.auditFilters.page -= 1;
    await loadAuditLogs().catch((error) => setStatus(error.message, "error"));
  });

  document.getElementById("audit-next-page").addEventListener("click", async () => {
    const totalPages = Math.max(
      1,
      Math.ceil(Number(state.auditLogs.total || 0) / Number(state.auditLogs.pageSize || 20))
    );
    if (state.auditFilters.page >= totalPages) {
      return;
    }

    state.auditFilters.page += 1;
    await loadAuditLogs().catch((error) => setStatus(error.message, "error"));
  });
}
