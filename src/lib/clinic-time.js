// Fuso horário da clínica. A plataforma é de uso único (Brasil), então horários
// "ingênuos" (sem fuso) — tanto os digitados no admin quanto os limites de
// relatório — representam o horário local da clínica, não UTC.
//
// Antes, as janelas de mês, semana e filtro eram montadas com Date.UTC. Como a
// clínica atende à noite, uma sessão de 30/06 às 21h (Brasília) é gravada como
// 01/07T00:00Z e caía no fechamento do mês seguinte.
const CLINIC_TIME_ZONE = "America/Sao_Paulo";

// Offset (em ms) do fuso da clínica para um instante UTC específico. Usa Intl
// para respeitar regras de fuso/horário de verão de forma robusta (o Brasil não
// tem DST desde 2019, mas isto não fica frágil caso volte).
function getClinicTimeZoneOffsetMs(instant) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CLINIC_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(instant);

  const map = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }

  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );

  return asUtc - instant.getTime();
}

// Converte uma data/hora local da clínica para o instante UTC correspondente.
// Aceita valores fora de faixa (mês 13, dia 32) como Date.UTC aceita, o que
// deixa somar meses e dias trivial em quem chama.
function clinicLocalToInstant(year, month, day, hour = 0, minute = 0, second = 0) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMs = getClinicTimeZoneOffsetMs(new Date(utcGuess));
  return new Date(utcGuess - offsetMs);
}

// Partes da data no fuso da clínica (e não no fuso do servidor).
function getClinicDateParts(instant = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CLINIC_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(instant);

  const map = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day)
  };
}

// Converte um horário digitado no admin para ISO UTC. Quando o valor é "ingênuo"
// (YYYY-MM-DDTHH:MM, sem fuso), interpreta-o como horário da clínica — antes ele
// era lido como UTC, o que em produção (servidor em UTC) deslocava o horário em
// 3h (20:30 virava 17:30). Valores que já trazem fuso (Z ou ±hh:mm) são
// respeitados como estão.
function normalizeDateTimeToIso(value) {
  const naive = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!naive) {
    return new Date(value).toISOString();
  }

  const [, year, month, day, hour, minute, second] = naive;
  return clinicLocalToInstant(
    Number(year),
    Number(month),
    Number(day),
    Number(hour),
    Number(minute),
    second ? Number(second) : 0
  ).toISOString();
}

// Janela [start, end) do mês, ancorada na meia-noite do fuso da clínica.
function getClinicMonthRange(year, month) {
  return {
    start: clinicLocalToInstant(year, month, 1).toISOString(),
    end: clinicLocalToInstant(year, month + 1, 1).toISOString()
  };
}

// Janela [start, end) da semana (segunda a segunda), no fuso da clínica.
function getClinicWeekRange(referenceDate = new Date()) {
  const instant = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  const { year, month, day } = getClinicDateParts(instant);

  // Dia da semana lido no fuso da clínica: a virada do dia não é a mesma do UTC.
  const meioDiaLocal = clinicLocalToInstant(year, month, day, 12);
  const diaSemana = new Intl.DateTimeFormat("en-US", {
    timeZone: CLINIC_TIME_ZONE,
    weekday: "short"
  }).format(meioDiaLocal);
  const indice = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(diaSemana);
  const ateSegunda = indice === 0 ? -6 : 1 - indice;

  return {
    start: clinicLocalToInstant(year, month, day + ateSegunda).toISOString(),
    end: clinicLocalToInstant(year, month, day + ateSegunda + 7).toISOString()
  };
}

// Limite de filtro vindo da interface. "2026-06-30" significa o dia 30 no fuso
// da clínica: início é a meia-noite local, fim é a meia-noite local do dia
// seguinte (intervalo aberto à direita), para que a sessão das 21h entre.
function normalizeClinicFilterBoundary(value, mode) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return "";
  }

  const somenteData = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (somenteData) {
    const [, year, month, day] = somenteData;
    const diaFinal = Number(day) + (mode === "end" ? 1 : 0);
    return clinicLocalToInstant(Number(year), Number(month), diaFinal).toISOString();
  }

  const naive = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(trimmed);
  if (naive) {
    return normalizeDateTimeToIso(trimmed);
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString();
}

// Formatação para leitura humana (recibo, PDF, tela) sempre no fuso da clínica.
function formatClinicDate(value, options = { dateStyle: "medium" }) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("pt-BR", {
    ...options,
    timeZone: CLINIC_TIME_ZONE
  }).format(parsed);
}

module.exports = {
  CLINIC_TIME_ZONE,
  clinicLocalToInstant,
  formatClinicDate,
  getClinicDateParts,
  getClinicMonthRange,
  getClinicTimeZoneOffsetMs,
  getClinicWeekRange,
  normalizeClinicFilterBoundary,
  normalizeDateTimeToIso
};
