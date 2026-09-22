const { getClinicDateParts } = require("../lib/clinic-time");
const {
  sanitizeDateLike,
  sanitizeNullableText,
  sanitizeNumericLike,
  sanitizePlainText,
  sanitizeTimeLike
} = require("../lib/sanitize");
const { AppError } = require("../lib/errors");

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

// isSafeInteger, e não isInteger: 1e30 passa em isInteger e chega ao banco
// como notação científica, que o SQLite ignora silenciosamente e o Postgres
// responde com 500. Aqui vira 400, que é o que de fato aconteceu.
function parseEntityId(rawValue, label = "Registro") {
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AppError(`${label} inválido.`, 400);
  }
  return value;
}

// Inteiro vindo da query, preso a uma faixa. Valores como 1e30, Infinity ou
// 99999999 chegavam crus a Date.UTC e ao LIMIT/OFFSET do SQL: o primeiro
// produzia "Invalid time value" e o segundo era recusado pelo driver — os dois
// viravam 500 numa rota que o admin abre só mudando a URL.
function sanitizeBoundedInteger(rawValue, { min, max, fallback }) {
  const texto = sanitizeNumericLike(rawValue);
  if (!texto) {
    return fallback;
  }

  const value = Number(texto);
  if (!Number.isFinite(value)) {
    return fallback;
  }

  const inteiro = Math.trunc(value);
  if (!Number.isSafeInteger(inteiro)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, inteiro));
}

// Filtro por id vindo da query. Valor que não é um id plausível é descartado
// em vez de virar NaN no repositório — o SQLite devolvia lista vazia e o
// Postgres estourava 500 para a mesma entrada.
function sanitizeIdFilter(rawValue) {
  const texto = sanitizeNumericLike(rawValue);
  if (!texto) {
    return "";
  }

  const value = Number(texto);
  return Number.isSafeInteger(value) && value > 0 ? String(value) : "";
}

function sanitizePatientPayload(body = {}) {
  return {
    fullName: sanitizePlainText(body.fullName),
    preferredName: sanitizePlainText(body.preferredName),
    birthDate: sanitizeDateLike(body.birthDate),
    age: sanitizeNumericLike(body.age),
    phone: sanitizePlainText(body.phone),
    email: sanitizeNullableText(body.email),
    patientType: sanitizePlainText(body.patientType),
    guardianName: sanitizePlainText(body.guardianName),
    guardianPhone: sanitizePlainText(body.guardianPhone),
    sessionPrice: sanitizeNumericLike(body.sessionPrice),
    defaultWeekday: sanitizePlainText(body.defaultWeekday),
    defaultTime: sanitizeTimeLike(body.defaultTime),
    modality: sanitizePlainText(body.modality),
    status: sanitizePlainText(body.status),
    administrativeNote: sanitizePlainText(body.administrativeNote)
  };
}

// Faixa dos filtros de período. Fora dela, Date.UTC devolve data inválida e
// toISOString lança — o que virava 500 no Financeiro e nos recibos.
const ANO_MINIMO = 1900;
const ANO_MAXIMO = 2999;

function sanitizePeriodo(query) {
  const hoje = getClinicDateParts();
  return {
    month: String(
      sanitizeBoundedInteger(query.month, { min: 1, max: 12, fallback: hoje.month })
    ),
    year: String(
      sanitizeBoundedInteger(query.year, {
        min: ANO_MINIMO,
        max: ANO_MAXIMO,
        fallback: hoje.year
      })
    )
  };
}

module.exports = {
  asyncRoute,
  parseEntityId,
  sanitizeBoundedInteger,
  sanitizeIdFilter,
  sanitizePatientPayload,
  sanitizePeriodo
};
