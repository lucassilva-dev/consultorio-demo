import { state } from "./state.js";
import { formatDate } from "./format.js";
import { escapeHtml, renderChip, setStatus } from "./ui.js";
import { apiRequest } from "./api.js";
import { loadClinicalRecord, recordId, switchClinicalTab } from "./clinical-record.js";

// ── Documentos emitidos ──────────────────────────────────────────────────────
const DOCUMENT_TYPE_LABELS = {
  attendance_declaration: "Declaração de comparecimento",
  psychological_certificate: "Atestado psicológico",
  report: "Relatório psicológico",
  opinion: "Parecer psicológico",
  referral: "Encaminhamento"
};

export async function loadDocuments() {
  const id = recordId();
  if (!id) {
    state.clinical.documents = [];
    renderDocuments();
    return;
  }
  const response = await apiRequest(`/api/admin/clinical-records/${id}/documents`);
  state.clinical.documents = response.data || [];
  renderDocuments();
}

function renderDocuments() {
  const lista = document.getElementById("clinical-documents-list");
  const vazio = document.getElementById("clinical-documents-empty");
  if (!lista || !vazio) return;

  const documentos = state.clinical.documents || [];
  lista.innerHTML = documentos
    .map(
      (documento) => `
        <article class="admin-registro${documento.status === "revoked" ? " is-revogado" : ""}">
          <div>
            <div class="admin-registro-titulo">
              ${escapeHtml(documento.documentTypeLabel || DOCUMENT_TYPE_LABELS[documento.documentType] || documento.documentType)}
              <span class="mono">${escapeHtml(documento.documentNumber)}</span>
              ${renderChip("document", documento.status, documento.statusLabel)}
            </div>
            <div class="admin-registro-linha">
              <span>${escapeHtml(formatDate(documento.issuedAt))}</span>
              ${documento.title ? `<span>·</span><span>${escapeHtml(documento.title)}</span>` : ""}
            </div>
            ${
              documento.status === "revoked" && documento.revokeReason
                ? `<div class="admin-registro-linha"><span>Revogado: ${escapeHtml(documento.revokeReason)}</span></div>`
                : ""
            }
          </div>
          <div class="admin-registro-acoes">
            <button class="btn btn-secondary btn-compacto" type="button" data-action="download-document" data-id="${documento.id}">Baixar PDF</button>
            ${
              documento.status === "issued"
                ? `<button class="btn btn-secondary btn-compacto" type="button" data-action="revoke-document" data-id="${documento.id}">Revogar</button>`
                : ""
            }
          </div>
        </article>
      `
    )
    .join("");

  vazio.hidden = documentos.length > 0;
  vazio.innerHTML = `<h3>Nenhum documento emitido</h3>
     <p>Declaração, atestado, relatório, parecer e encaminhamento saem daqui, numerados e em PDF.</p>
     <button class="btn btn-primary btn-compacto" type="button" data-action="new-document">＋ Emitir documento</button>`;

  const contador = document.getElementById("clinical-tab-documentos");
  if (contador) {
    contador.textContent = documentos.length ? String(documentos.length) : "";
  }
}

function openDocumentForm() {
  const form = document.getElementById("clinical-document-form");
  if (!form) return;
  form.reset();
  form.hidden = false;
  form.querySelector('[name="documentType"]').focus();
  form.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function closeDocumentForm() {
  const form = document.getElementById("clinical-document-form");
  if (!form) return;
  form.hidden = true;
  form.reset();
}

async function issueDocument() {
  const id = recordId();
  if (!id) return;
  const form = document.getElementById("clinical-document-form");
  const dados = Object.fromEntries(new FormData(form).entries());

  await apiRequest(`/api/admin/clinical-records/${id}/documents`, {
    method: "POST",
    body: JSON.stringify({
      documentType: dados.documentType,
      title: dados.title || "",
      addressee: dados.addressee || "",
      purpose: dados.purpose || "",
      validUntil: dados.validUntil || "",
      body: dados.body || ""
    })
  });

  closeDocumentForm();
  await loadDocuments();
  await loadClinicalRecord();
  setStatus("Documento emitido.", "success");
}

async function revokeDocument(documentId) {
  const motivo = window.prompt("Por que este documento está sendo revogado?");
  if (motivo === null) return;
  if (!motivo.trim()) {
    setStatus("Informe o motivo da revogação.", "error");
    return;
  }
  await apiRequest(`/api/admin/clinical-documents/${documentId}/revoke`, {
    method: "POST",
    body: JSON.stringify({ reason: motivo.trim() })
  });
  await loadDocuments();
  await loadClinicalRecord();
  setStatus("Documento revogado. O registro continua no prontuário.", "success");
}

export function registrarFormularioDeDocumento() {
  document
    .getElementById("clinical-document-form")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await issueDocument();
      } catch (error) {
        setStatus(error.message, "error");
      }
    });
}

export const ACOES_DOCUMENTOS = {
  "new-document": async () => {
    await switchClinicalTab("documentos");
    openDocumentForm();
  },
  "cancel-document-form": () => {
    closeDocumentForm();
  },
  "download-document": ({ id }) => {
    window.open(`/api/admin/clinical-documents/${id}/download`, "_blank");
  },
  "revoke-document": async ({ id }) => {
    await revokeDocument(id);
  }
};
