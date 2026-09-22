
// Estrutura padrão da anamnese. As perguntas padrão (isDefault) não podem ser
// excluídas pelo usuário — apenas respondidas. Perguntas personalizadas podem
// ser adicionadas, editadas, reordenadas e removidas livremente.
const DEFAULT_INTAKE_TEMPLATE = {
  sections: [
    {
      id: "attendance",
      title: "Atendimento",
      items: [
        { id: "main_complaint", label: "Queixa principal" },
        { id: "secondary_complaint", label: "Queixa secundária" },
        { id: "symptoms", label: "Sintomas" },
        { id: "demand_duration", label: "Duração da demanda" },
        { id: "search_motivation", label: "O que motivou a busca agora?" }
      ]
    },
    {
      id: "history",
      title: "Histórico",
      items: [
        { id: "previous_psychological", label: "Já fez acompanhamento psicológico?" },
        { id: "previous_psychiatric", label: "Já fez acompanhamento psiquiátrico?" },
        { id: "current_medication", label: "Usa medicação atualmente?" },
        { id: "relevant_history", label: "Histórico de internações ou acompanhamentos relevantes" }
      ]
    },
    {
      id: "routine",
      title: "Rotina",
      items: [
        { id: "sleep", label: "Sono" },
        { id: "feeding", label: "Alimentação" },
        { id: "work_studies", label: "Trabalho/estudos" },
        { id: "physical_leisure", label: "Atividades físicas/lazer" }
      ]
    },
    {
      id: "support",
      title: "Relações e rede de apoio",
      items: [
        { id: "family", label: "Família" },
        { id: "relationships", label: "Relacionamentos" },
        { id: "support_network", label: "Rede de apoio" },
        { id: "current_conflicts", label: "Principais conflitos atuais" }
      ]
    },
    {
      id: "goals",
      title: "Objetivos terapêuticos",
      items: [
        { id: "therapy_expectation", label: "O que espera da terapia?" },
        { id: "initial_goals", label: "Objetivos iniciais combinados" }
      ]
    },
    {
      id: "adolescent",
      title: "Adolescente (quando aplicável)",
      items: [
        { id: "legal_guardian", label: "Responsável legal" },
        { id: "school_routine", label: "Escola/rotina" },
        { id: "family_dynamics", label: "Dinâmica familiar geral" },
        { id: "guardian_alignment", label: "Alinhamentos com responsável" },
        { id: "consent_notes", label: "Observações sobre consentimento/ciência" }
      ]
    }
  ]
};

// Contrato e consentimento. Não é papelada: é o combinado que dá base ao
// atendimento e o registro de que o sigilo e seus limites foram explicados.
const CONTRACT_TEMPLATE = {
  sections: [
    {
      id: "agreement",
      title: "Combinados do atendimento",
      items: [
        { id: "modality", label: "Modalidade e local" },
        { id: "frequency", label: "Frequência" },
        { id: "duration", label: "Duração da sessão" },
        { id: "price", label: "Valor por sessão" },
        { id: "payment", label: "Forma e prazo de pagamento" },
        { id: "start_date", label: "Início do acompanhamento" }
      ]
    },
    {
      id: "absences",
      title: "Faltas e remarcações",
      items: [
        { id: "notice_window", label: "Prazo combinado para avisar" },
        { id: "missed_session", label: "O que acontece em falta sem aviso" },
        { id: "reschedule", label: "Como funciona a remarcação" },
        { id: "vacation", label: "Férias e interrupções previstas" }
      ]
    },
    {
      id: "confidentiality",
      title: "Sigilo",
      items: [
        { id: "scope", label: "O que é sigiloso" },
        { id: "limits", label: "Limites do sigilo (risco de vida, determinação judicial)" },
        { id: "record_notice", label: "Registro em prontuário e guarda por cinco anos" },
        { id: "third_parties", label: "Contato com outros profissionais" }
      ]
    },
    {
      id: "contact",
      title: "Contato entre sessões",
      items: [
        { id: "channel", label: "Canal combinado" },
        { id: "hours", label: "Horários de resposta" },
        { id: "scope_notice", label: "O que não é atendimento" },
        { id: "urgency", label: "O que fazer em urgência" }
      ]
    },
    {
      id: "consent",
      title: "Consentimento",
      items: [
        { id: "accepted_at", label: "Data do aceite" },
        { id: "accepted_form", label: "Forma do aceite (verbal, assinado)" },
        { id: "notes", label: "Observações" }
      ]
    },
    {
      id: "guardian",
      title: "Responsável legal (quando aplicável)",
      items: [
        { id: "guardian_name", label: "Nome do responsável" },
        { id: "guardian_relationship", label: "Parentesco" },
        { id: "guardian_awareness", label: "Ciência do responsável" },
        { id: "shared_with_guardian", label: "O que é compartilhado com o responsável" }
      ]
    }
  ]
};

// Plano terapêutico. Separado da anamnese porque a anamnese é o retrato da
// chegada e o plano muda ao longo do acompanhamento.
const PLAN_TEMPLATE = {
  sections: [
    {
      id: "focus",
      title: "Foco do trabalho",
      items: [
        { id: "central_demand", label: "Demanda central" },
        { id: "clinical_understanding", label: "Compreensão do caso" }
      ]
    },
    {
      id: "objectives",
      title: "Objetivos",
      items: [
        { id: "short_term", label: "Objetivos de curto prazo" },
        { id: "medium_term", label: "Objetivos de médio prazo" },
        { id: "agreed_with_patient", label: "O que foi combinado com a pessoa atendida" }
      ]
    },
    {
      id: "approach",
      title: "Abordagem e recursos",
      items: [
        { id: "approach", label: "Abordagem e referencial" },
        { id: "resources", label: "Recursos e intervenções previstas" },
        { id: "referrals", label: "Encaminhamentos e trabalho em rede" }
      ]
    },
    {
      id: "pacing",
      title: "Frequência e duração",
      items: [
        { id: "frequency", label: "Frequência prevista" },
        { id: "estimated_duration", label: "Previsão de duração" },
        { id: "review_interval", label: "De quanto em quanto tempo revisar" }
      ]
    },
    {
      id: "progress",
      title: "Indicadores e revisões",
      items: [
        { id: "indicators", label: "Indicadores combinados de progresso" },
        { id: "last_review", label: "Data da última revisão" },
        { id: "review_notes", label: "O que mudou na última revisão" }
      ]
    }
  ]
};

// Encerramento. O motivo também vai em coluna própria do prontuário, para ser
// filtrável sem abrir o conteúdo clínico.
const CLOSING_TEMPLATE = {
  sections: [
    {
      id: "closing",
      title: "Encerramento",
      items: [
        { id: "synthesis", label: "Síntese do processo" },
        { id: "reached_goals", label: "Objetivos alcançados" },
        { id: "pending_goals", label: "Objetivos não alcançados" },
        { id: "guidance", label: "Orientações dadas no encerramento" },
        { id: "referral", label: "Encaminhamento (para quem e por quê)" },
        { id: "return_terms", label: "Combinados sobre retorno" }
      ]
    }
  ]
};

// Contrato, plano e encerramento compartilham o formato da anamnese, então
// compartilham também a normalização, o versionamento e a tela de seções.
const CLINICAL_TEMPLATES = {
  intake: DEFAULT_INTAKE_TEMPLATE,
  contract: CONTRACT_TEMPLATE,
  plan: PLAN_TEMPLATE,
  closing: CLOSING_TEMPLATE
};

const TEMPLATE_KEYS = Object.keys(CLINICAL_TEMPLATES);


function getTemplate(templateKey) {
  return CLINICAL_TEMPLATES[templateKey] || DEFAULT_INTAKE_TEMPLATE;
}

const MAX_SECTIONS = 40;
const MAX_ITEMS_PER_SECTION = 80;
const MAX_LABEL_LENGTH = 200;
const MAX_ANSWER_LENGTH = 8000;
const MAX_TITLE_LENGTH = 160;

function cleanText(value, maxLength) {
  // Anotação clínica é registro legal e precisa ser gravada literalmente.
  // Passar por sanitize-html apagava trechos entre < e > (uma anotação como
  // "paciente relatou <choro> ao falar da mãe" perdia a palavra) e ainda
  // transformava & em &amp; dentro do prontuário. Guardar o texto cru não
  // abre risco: o conteúdo é cifrado em repouso, o painel escapa com
  // escapeHtml antes de inserir no DOM e o PDF desenha texto, nunca HTML.
  // Aqui só normalizamos quebras de linha e tiramos caracteres de controle.
  const stripped = String(value ?? "")
    .replace(/\r/g, "")
    // Caracteres de controle (exceto tab e quebra de linha). Escritos como
    // escapes e não literalmente: com os bytes crus, o git classifica o arquivo
    // como binário e nenhum diff dele é legível.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/[ \t]+\n/g, "\n");

  return stripped.slice(0, maxLength).trim();
}

function slugifyId(value, fallback) {
  const slug = String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return slug || fallback;
}

function buildDefaultIndex(template) {
  const sectionLabels = new Map();
  const itemLabels = new Map();
  for (const section of template.sections) {
    sectionLabels.set(section.id, section.title);
    for (const item of section.items) {
      itemLabels.set(`${section.id}::${item.id}`, item.label);
    }
  }
  return { sectionLabels, itemLabels };
}

function buildDefaultPayload(templateKey = "intake") {
  return {
    sections: getTemplate(templateKey).sections.map((section) => ({
      id: section.id,
      title: section.title,
      isDefault: true,
      items: section.items.map((item) => ({
        id: item.id,
        label: item.label,
        answer: "",
        isDefault: true,
        hidden: false
      }))
    }))
  };
}

/**
 * Normaliza o payload da anamnese vindo do cliente:
 * - garante que toda seção/pergunta padrão exista (não podem ser excluídas);
 * - mantém perguntas personalizadas (isDefault: false) sanitizadas;
 * - preserva a ordem enviada pelo cliente;
 * - aplica limites de tamanho e remove HTML.
 */
function normalizeIntakePayload(rawPayload, templateKey = "intake") {
  const template = getTemplate(templateKey);
  const { sectionLabels, itemLabels } = buildDefaultIndex(template);
  const inputSections = Array.isArray(rawPayload?.sections) ? rawPayload.sections : [];

  const outputSections = [];
  const seenSectionIds = new Set();
  let customSectionCounter = 0;
  let customItemCounter = 0;

  for (const rawSection of inputSections.slice(0, MAX_SECTIONS)) {
    const isDefaultSection = sectionLabels.has(rawSection?.id);
    const sectionId = isDefaultSection
      ? rawSection.id
      : slugifyId(rawSection?.id || rawSection?.title, `secao_${++customSectionCounter}`);

    if (seenSectionIds.has(sectionId)) {
      continue;
    }
    seenSectionIds.add(sectionId);

    const title = isDefaultSection
      ? sectionLabels.get(sectionId)
      : cleanText(rawSection?.title, MAX_TITLE_LENGTH) || "Seção personalizada";

    const rawItems = Array.isArray(rawSection?.items) ? rawSection.items : [];
    const outputItems = [];
    const seenItemIds = new Set();

    for (const rawItem of rawItems.slice(0, MAX_ITEMS_PER_SECTION)) {
      const defaultKey = `${sectionId}::${rawItem?.id}`;
      const isDefaultItem = isDefaultSection && itemLabels.has(defaultKey);
      let itemId = isDefaultItem
        ? rawItem.id
        : slugifyId(rawItem?.id, `item_${++customItemCounter}`);

      if (seenItemIds.has(itemId)) {
        if (isDefaultItem) {
          // Pergunta padrão repetida: a proteção mais abaixo garante que ela
          // volte exatamente uma vez, então descartar aqui é seguro.
          continue;
        }

        // Pergunta personalizada com id repetido NÃO pode ser descartada: o
        // cliente reinicia o contador a cada carregamento e reaproveita ids,
        // e o descarte fazia a pergunta e a resposta sumirem em silêncio.
        do {
          itemId = slugifyId("", `item_${++customItemCounter}`);
        } while (seenItemIds.has(itemId));
      }

      seenItemIds.add(itemId);

      outputItems.push({
        id: itemId,
        label: isDefaultItem
          ? itemLabels.get(defaultKey)
          : cleanText(rawItem?.label, MAX_LABEL_LENGTH) || "Pergunta personalizada",
        answer: cleanText(rawItem?.answer, MAX_ANSWER_LENGTH),
        isDefault: isDefaultItem,
        // Perguntas padrão não podem ser excluídas, mas podem ser ocultadas.
        hidden: rawItem?.hidden === true
      });
    }

    // Garante que perguntas padrão removidas pelo cliente voltem (protegidas).
    if (isDefaultSection) {
      const defaultSection = template.sections.find((s) => s.id === sectionId);
      for (const defaultItem of defaultSection.items) {
        if (!seenItemIds.has(defaultItem.id)) {
          outputItems.push({
            id: defaultItem.id,
            label: defaultItem.label,
            answer: "",
            isDefault: true,
            hidden: false
          });
          seenItemIds.add(defaultItem.id);
        }
      }
    }

    outputSections.push({
      id: sectionId,
      title,
      isDefault: isDefaultSection,
      items: outputItems
    });
  }

  // Garante que toda seção padrão exista mesmo se o cliente não a enviou.
  for (const defaultSection of template.sections) {
    if (!seenSectionIds.has(defaultSection.id)) {
      outputSections.push({
        id: defaultSection.id,
        title: defaultSection.title,
        isDefault: true,
        items: defaultSection.items.map((item) => ({
          id: item.id,
          label: item.label,
          answer: "",
          isDefault: true
        }))
      });
    }
  }

  return { sections: outputSections };
}

module.exports = {
  CLINICAL_TEMPLATES,
  DEFAULT_INTAKE_TEMPLATE,
  TEMPLATE_KEYS,
  buildDefaultPayload,
  getTemplate,
  normalizeIntakePayload
};
