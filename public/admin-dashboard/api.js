import { showToast } from "./ui.js";

/**
 * Executa uma requisição de mutação com retry automático em caso de
 * AbortError (timeout / cold start do servidor).
 *
 * O retry só vale para métodos idempotentes. Um POST que estourou o tempo do
 * lado do cliente pode ter sido concluído no servidor: repetir criava um
 * segundo paciente, uma segunda sessão, uma segunda evolução. Nesses casos é
 * melhor avisar e deixar a pessoa conferir antes de tentar de novo.
 */
const METODOS_IDEMPOTENTES = ["PUT", "DELETE", "PATCH", "GET"];

export async function runMutation(url, options = {}) {
  const metodo = String(options.method || "GET").toUpperCase();
  try {
    return await apiRequest(url, options);
  } catch (error) {
    if (error.name !== "AbortError") throw error;

    if (!METODOS_IDEMPOTENTES.includes(metodo)) {
      const aviso = new Error(
        "O servidor demorou a responder e não dá para saber se o registro foi criado. Atualize a lista antes de tentar de novo, para não duplicar."
      );
      aviso.name = "TimeoutIndeterminado";
      throw aviso;
    }

    showToast("Servidor demorou a responder. Tentando novamente…", "warning");
    await new Promise((resolve) => window.setTimeout(resolve, 3000));
    return apiRequest(url, options);
  }
}

export function toQueryString(params) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== "" && value !== null && typeof value !== "undefined") {
      searchParams.set(key, String(value));
    }
  });
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

export async function apiRequest(url, options = {}) {
  const controller = new AbortController();
  const { timeoutMs = 30000, headers = {}, ...requestOptions } = options;
  const timer = window.setTimeout(
    () => controller.abort(new DOMException("Servidor demorou para responder. Tente novamente em alguns segundos.", "AbortError")),
    timeoutMs
  );

  try {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-store",
        Pragma: "no-cache",
        ...(requestOptions.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...headers
      },
      ...requestOptions,
      signal: controller.signal
    });

    let payload = {};
    const rawText = await response.text();
    if (rawText) {
      try {
        payload = JSON.parse(rawText);
      } catch (error) {
        payload = {};
      }
    }

    if (!response.ok || payload.ok === false) {
      // Sessão expirada ou revogada: sem isso o painel ficava travado, com
      // todas as ações falhando e nenhum caminho visível de volta.
      if (response.status === 401) {
        window.location.assign("/admin/login");
      }

      const requestError = new Error(
        payload.error || `Falha na requisição (${response.status}).`
      );
      requestError.status = response.status;
      requestError.details = payload.details || null;
      throw requestError;
    }

    return payload;
  } finally {
    window.clearTimeout(timer);
  }
}
