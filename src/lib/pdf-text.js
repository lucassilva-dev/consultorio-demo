// As fontes padrão do pdf-lib (Helvetica) usam codificação WinAnsi, que cobre
// Latin-1 mais os 27 símbolos do CP1252. Qualquer caractere fora disso faz
// drawText lançar e derruba a exportação inteira com 500 — o prontuário do
// paciente deixa de sair por causa de um caractere.
//
// Dois casos aparecem na prática:
//   1. Texto decomposto (NFD). Colar de macOS ou de certas páginas produz "a"
//      seguido de acento combinante; o combinante não existe em WinAnsi, então
//      *qualquer* palavra acentuada em português quebraria. normalize("NFC")
//      recompõe e resolve o caso inteiro sem perder nada.
//   2. Caracteres que WinAnsi realmente não representa (emoji, CJK, cirílico).
//      Aqui não há como preservar com a fonte padrão; cada trecho contíguo vira
//      um único "?", para deixar visível que havia algo ali sem encher o
//      documento de marcadores.

// Os 27 caracteres do intervalo 0x80–0x9F do CP1252, que WinAnsi representa
// apesar de estarem fora do Latin-1.
const EXTRAS_WINANSI = new Set([
  "€", "‚", "ƒ", "„", "…", "†", "‡",
  "ˆ", "‰", "Š", "‹", "Œ", "Ž", "‘",
  "’", "“", "”", "•", "–", "—", "˜",
  "™", "š", "›", "œ", "ž", "Ÿ"
]);

// Caracteres invisíveis que só existem para compor emoji ou controlar layout.
// Removê-los é melhor que trocá-los por "?", que poluiria o texto.
const INVISIVEIS = /[​-‍⁠︎️﻿\u{1F3FB}-\u{1F3FF}]/gu;

function representavelEmWinAnsi(caractere) {
  const ponto = caractere.codePointAt(0);

  // Quebra de linha e tabulação são tratadas pelo wrap antes do desenho.
  if (ponto === 0x0a || ponto === 0x0d || ponto === 0x09) {
    return true;
  }

  if (ponto >= 0x20 && ponto <= 0x7e) {
    return true;
  }

  if (ponto >= 0xa0 && ponto <= 0xff) {
    return true;
  }

  return EXTRAS_WINANSI.has(caractere);
}

function toPdfText(value) {
  const texto = String(value ?? "").normalize("NFC").replace(INVISIVEIS, "");

  let resultado = "";
  let substituindo = false;

  // Itera por code points (e não por unidades UTF-16) para não partir pares
  // substitutos ao meio — um emoji é um caractere só, vira um "?" só.
  for (const caractere of texto) {
    if (representavelEmWinAnsi(caractere)) {
      resultado += caractere;
      substituindo = false;
      continue;
    }

    if (!substituindo) {
      resultado += "?";
      substituindo = true;
    }
  }

  return resultado;
}

// Aplica toPdfText em todos os campos de texto de um objeto de dados, sem tocar
// em números, booleanos e datas. Serve como ponto único de higienização na
// entrada dos renderizadores de PDF.
function toPdfData(value) {
  if (typeof value === "string") {
    return toPdfText(value);
  }

  if (Array.isArray(value)) {
    return value.map(toPdfData);
  }

  if (value && typeof value === "object" && !(value instanceof Date)) {
    const saida = {};
    for (const [chave, item] of Object.entries(value)) {
      saida[chave] = toPdfData(item);
    }
    return saida;
  }

  return value;
}

module.exports = {
  toPdfData,
  toPdfText
};
