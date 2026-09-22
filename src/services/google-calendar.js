const crypto = require("crypto");
const { google } = require("googleapis");
const { AppError } = require("../lib/errors");

function hasGoogleCalendarConfig(runtimeConfig) {
  return Boolean(
    runtimeConfig.googleClientId &&
      runtimeConfig.googleClientSecret &&
      runtimeConfig.googleRedirectUri
  );
}

function sanitizeGoogleError(error) {
  const message =
    error?.response?.data?.error?.message ||
    error?.response?.data?.error_description ||
    error?.message ||
    "Falha ao comunicar com o Google Calendar.";

  return {
    message: String(message),
    status: error?.response?.status || error?.code || 500
  };
}

function extractMeetUrl(event = {}) {
  if (event.hangoutLink) {
    return event.hangoutLink;
  }

  const entryPoint = event.conferenceData?.entryPoints?.find(
    (item) => item.entryPointType === "video" && item.uri
  );

  return entryPoint?.uri || "";
}

function buildEventDescription(session, patient) {
  const lines = [
    "Evento administrativo gerado pela plataforma clínica.",
    `Paciente: ${patient.fullName}`,
    `Duração: ${session.durationMinutes} minutos`
  ];

  if (patient.modality) {
    lines.push(`Modalidade: ${patient.modality}`);
  }

  if (session.meetingUrl) {
    lines.push(`Link da sessão: ${session.meetingUrl}`);
  }

  lines.push("Não incluir detalhes clínicos neste evento.");
  return lines.join("\n");
}

function buildSessionEventRequest(settings, session, patient) {
  const start = new Date(session.scheduledAt);
  const end = new Date(start.getTime() + Number(session.durationMinutes || 0) * 60000);
  const requestBody = {
    summary: `Sessão - ${patient.fullName}`,
    description: buildEventDescription(session, patient),
    start: {
      dateTime: start.toISOString()
    },
    end: {
      dateTime: end.toISOString()
    },
    visibility: "private",
    reminders: {
      useDefault: false,
      overrides:
        Number(settings.googleCalendarReminderMinutes) > 0
          ? [
              {
                method: "popup",
                minutes: Number(settings.googleCalendarReminderMinutes)
              }
            ]
          : []
    }
  };

  if (session.meetingUrl) {
    requestBody.location = session.meetingUrl;
  }

  if (settings.googleCalendarSendUpdates && patient.email) {
    requestBody.attendees = [
      {
        email: patient.email,
        displayName: patient.preferredName || patient.fullName
      }
    ];
  }

  if (settings.googleCalendarCreateMeet && !session.meetingUrl) {
    requestBody.conferenceData = {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: {
          type: "hangoutsMeet"
        }
      }
    };
  }

  return requestBody;
}

function createGoogleCalendarService(runtimeConfig) {
  function assertConfigured() {
    if (!hasGoogleCalendarConfig(runtimeConfig)) {
      throw new AppError(
        "Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_REDIRECT_URI antes de usar o Google Calendar.",
        400
      );
    }
  }

  // "primary" e o endereço real da agenda principal são o MESMO calendário. Sem
  // essa equivalência, escolher a principal pelo nome na lista era lido como
  // troca de agenda e recriava todos os eventos — cancelando e reconvidando o
  // paciente sem que nada tivesse mudado de fato.
  function mesmoCalendario(a, b, connection) {
    const principal = String(connection?.email || "").trim().toLowerCase();
    const normaliza = (valor) => {
      const texto = String(valor || "").trim().toLowerCase();
      return texto === "primary" && principal ? principal : texto;
    };
    return normaliza(a) === normaliza(b);
  }

  function createOAuthClient(connection = null) {
    assertConfigured();
    const client = new google.auth.OAuth2(
      runtimeConfig.googleClientId,
      runtimeConfig.googleClientSecret,
      runtimeConfig.googleRedirectUri
    );

    if (connection) {
      client.setCredentials({
        access_token: connection.accessToken || undefined,
        refresh_token: connection.refreshToken || undefined,
        scope: connection.scope || undefined,
        token_type: connection.tokenType || undefined,
        expiry_date: connection.expiryDate ? Date.parse(connection.expiryDate) : undefined
      });
    }

    return client;
  }

  function createCalendarApi(connection, { onTokensRefreshed } = {}) {
    const auth = createOAuthClient(connection);

    // Quando o googleapis auto-renova o access_token expirado, salva o novo
    // token de volta no banco para que a próxima instância serverless não precise
    // renovar novamente (e para que o refresh_token não se perca entre chamadas).
    if (onTokensRefreshed) {
      auth.on("tokens", (tokens) => {
        onTokensRefreshed(tokens).catch(() => {});
      });
    }

    return {
      auth,
      calendarApi: google.calendar({
        version: "v3",
        auth
      })
    };
  }

  return {
    isConfigured() {
      return hasGoogleCalendarConfig(runtimeConfig);
    },

    // Apagar a conexão do nosso banco não desfaz a autorização do lado do
    // Google: o refresh token continua válido indefinidamente. Revogar é o
    // que efetivamente encerra o acesso.
    async revokeConnection(connection) {
      const token = connection?.refreshToken || connection?.accessToken;
      if (!token) {
        return { revoked: false, reason: "sem token para revogar" };
      }

      try {
        const client = createOAuthClient(connection);
        await client.revokeToken(token);
        return { revoked: true };
      } catch (error) {
        // Revogação é o melhor esforço: se o Google recusar (token já
        // revogado, rede fora), a desconexão local precisa acontecer mesmo
        // assim, senão o admin fica preso a uma conexão que não quer.
        return { revoked: false, reason: sanitizeGoogleError(error).message };
      }
    },

    buildAuthUrl(stateToken) {
      const auth = createOAuthClient();
      return auth.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: true,
        scope: runtimeConfig.googleCalendarScopes,
        state: stateToken
      });
    },

    async exchangeCodeForConnection(code, existingConnection = null) {
      try {
        const auth = createOAuthClient();
        const { tokens } = await auth.getToken(code);
        auth.setCredentials(tokens);

        let email = existingConnection?.email || "";
        try {
          const calendarApi = google.calendar({ version: "v3", auth });
          const calendars = await calendarApi.calendarList.list({
            maxResults: 50,
            minAccessRole: "writer"
          });
          const primary = calendars.data.items?.find((item) => item.primary) || calendars.data.items?.[0];
          email = primary?.id || email;
        } catch (calendarError) {
          email = existingConnection?.email || "";
        }

        return {
          email,
          accessToken: tokens.access_token || existingConnection?.accessToken || "",
          refreshToken: tokens.refresh_token || existingConnection?.refreshToken || "",
          scope:
            typeof tokens.scope === "string"
              ? tokens.scope
              : existingConnection?.scope || runtimeConfig.googleCalendarScopes.join(" "),
          tokenType: tokens.token_type || existingConnection?.tokenType || "",
          expiryDate: tokens.expiry_date
            ? new Date(tokens.expiry_date).toISOString()
            : existingConnection?.expiryDate || ""
        };
      } catch (error) {
        const sanitized = sanitizeGoogleError(error);
        throw new AppError(`Falha ao concluir a autenticação com o Google: ${sanitized.message}`, 400);
      }
    },

    async listCalendars(connection) {
      try {
        const { calendarApi } = createCalendarApi(connection);
        const response = await calendarApi.calendarList.list({
          maxResults: 100,
          minAccessRole: "writer"
        });

        return (response.data.items || []).map((item) => ({
          id: item.id,
          summary: item.summary || item.id,
          primary: Boolean(item.primary),
          accessRole: item.accessRole || ""
        }));
      } catch (error) {
        const sanitized = sanitizeGoogleError(error);
        throw new AppError(`Falha ao listar calendários do Google: ${sanitized.message}`, 400);
      }
    },

    async testConnection(connection) {
      const calendars = await this.listCalendars(connection);
      return {
        ok: true,
        calendarsCount: calendars.length
      };
    },

    async syncSession(connection, settings, session, patient, { onTokensRefreshed } = {}) {
      const calendarId = settings.googleCalendarId || "primary";
      // O evento existente vive no calendário em que foi criado, que nem sempre é
      // o configurado hoje. Fazer patch no calendário das configurações devolvia
      // 404 para TODAS as sessões já sincronizadas assim que o admin trocasse de
      // agenda.
      const calendarioDeOrigem = session.googleCalendarId || calendarId;
      const precisaMudarDeCalendario =
        Boolean(session.googleCalendarEventId) &&
        !mesmoCalendario(calendarioDeOrigem, calendarId, connection);
      const sendUpdates =
        settings.googleCalendarSendUpdates && patient.email ? "all" : "none";
      const requestBody = buildSessionEventRequest(settings, session, patient);

      try {
        const { calendarApi } = createCalendarApi(connection, { onTokensRefreshed });

        // Onde o evento está AGORA e qual é o seu id. Os dois mudam se houver
        // troca de agenda, e o patch mais abaixo depende de estarem certos.
        let calendarioAtual = calendarioDeOrigem;
        let eventoExistente = session.googleCalendarEventId || "";
        let sobrouEventoAntigo = false;

        if (precisaMudarDeCalendario) {
          // MOVER, não apagar-e-recriar: apagar primeiro fazia o compromisso
          // sumir da agenda do paciente se a recriação falhasse, e deixava a
          // sessão travada em falha sem evento para reprocessar.
          try {
            const movido = await calendarApi.events.move({
              calendarId: calendarioDeOrigem,
              eventId: session.googleCalendarEventId,
              destination: calendarId,
              sendUpdates: "none"
            });
            calendarioAtual = calendarId;
            eventoExistente = (movido && movido.data && movido.data.id) || eventoExistente;
          } catch (erroAoMover) {
            // events.move indisponível ou recusado: cria no destino e só então
            // remove a origem. No pior caso sobra um duplicado, que dá para
            // apagar — perder o compromisso do paciente, não.
            eventoExistente = "";
            calendarioAtual = calendarId;
            sobrouEventoAntigo = true;
          }
        }

        const requestOptions = {
          calendarId: calendarioAtual,
          requestBody,
          sendUpdates
        };

        if (requestBody.conferenceData) {
          requestOptions.conferenceDataVersion = 1;
        }

        const response = eventoExistente
          ? await calendarApi.events.patch({
              ...requestOptions,
              eventId: eventoExistente
            })
          : await calendarApi.events.insert(requestOptions);

        // Só agora, com o evento garantido no destino, a cópia antiga sai.
        if (sobrouEventoAntigo) {
          try {
            await calendarApi.events.delete({
              calendarId: calendarioDeOrigem,
              eventId: session.googleCalendarEventId,
              sendUpdates: "none"
            });
          } catch (erroAoRemover) {
            // O duplicado fica visível na agenda; é recuperável à mão e não
            // justifica falhar o sync inteiro.
            console.warn("[GOOGLE_SYNC]", {
              sessionId: session.id,
              message: "Evento antigo não pôde ser removido após a troca de agenda."
            });
          }
        }

        return {
          googleCalendarEventId: response.data.id || eventoExistente || "",
          googleCalendarId: calendarioAtual,
          googleCalendarSyncStatus: "synced",
          googleCalendarLastSyncedAt: new Date().toISOString(),
          googleCalendarError: "",
          meetingUrl: extractMeetUrl(response.data) || session.meetingUrl || ""
        };
      } catch (error) {
        const sanitized = sanitizeGoogleError(error);
        return {
          googleCalendarEventId: session.googleCalendarEventId || "",
          googleCalendarId: calendarioDeOrigem,
          googleCalendarSyncStatus: "failed",
          googleCalendarLastSyncedAt: new Date().toISOString(),
          googleCalendarError: sanitized.message,
          meetingUrl: ""
        };
      }
    },

    async cancelSession(connection, settings, session, patient, { onTokensRefreshed } = {}) {
      const calendarId = session.googleCalendarId || settings.googleCalendarId || "primary";
      const sendUpdates =
        settings.googleCalendarSendUpdates && patient?.email ? "all" : "none";

      if (!session.googleCalendarEventId) {
        return {
          googleCalendarEventId: "",
          googleCalendarId: calendarId,
          googleCalendarSyncStatus: "skipped",
          googleCalendarLastSyncedAt: "",
          googleCalendarError: ""
        };
      }

      try {
        const { calendarApi } = createCalendarApi(connection, { onTokensRefreshed });
        await calendarApi.events.delete({
          calendarId,
          eventId: session.googleCalendarEventId,
          sendUpdates
        });

        return {
          googleCalendarEventId: "",
          googleCalendarId: calendarId,
          googleCalendarSyncStatus: "synced",
          googleCalendarLastSyncedAt: new Date().toISOString(),
          googleCalendarError: ""
        };
      } catch (error) {
        const sanitized = sanitizeGoogleError(error);
        if (sanitized.status === 404) {
          return {
            googleCalendarEventId: "",
            googleCalendarId: calendarId,
            googleCalendarSyncStatus: "synced",
            googleCalendarLastSyncedAt: new Date().toISOString(),
            googleCalendarError: ""
          };
        }

        return {
          googleCalendarEventId: session.googleCalendarEventId || "",
          googleCalendarId: calendarId,
          googleCalendarSyncStatus: "failed",
          googleCalendarLastSyncedAt: new Date().toISOString(),
          googleCalendarError: sanitized.message
        };
      }
    }
  };
}

module.exports = {
  createGoogleCalendarService,
  hasGoogleCalendarConfig
};
