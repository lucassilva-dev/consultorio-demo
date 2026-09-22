const { AppError } = require("../lib/errors");
const { getTokenEncryptionKeyState } = require("../lib/encryption");
const { createSignedToken, verifySignedToken } = require("../lib/signed-token");

function createGoogleCalendarSyncService(runtimeConfig, googleCalendarService) {
  function getSecurityBlockReason() {
    const encryptionKeyState = getTokenEncryptionKeyState(runtimeConfig);
    if (!encryptionKeyState.valid) {
      return encryptionKeyState.reason;
    }

    return "";
  }

  function assertGoogleCalendarReady() {
    const blockReason = getSecurityBlockReason();
    if (blockReason) {
      throw new AppError(
        `Google Calendar bloqueado até corrigir a configuração de segurança: ${blockReason}`,
        runtimeConfig.isProduction ? 500 : 400
      );
    }
  }

  function buildOAuthState(adminUser) {
    return createSignedToken(
      {
        email: adminUser.email,
        iat: Date.now(),
        exp: Date.now() + runtimeConfig.googleCalendarStateTtlMs
      },
      runtimeConfig.authCookieSecret
    );
  }

  function verifyOAuthState(stateToken, adminUser) {
    const payload = verifySignedToken(stateToken, runtimeConfig.authCookieSecret);
    if (!payload || payload.email !== adminUser.email || Number(payload.exp) < Date.now()) {
      throw new AppError("State do Google Calendar inválido ou expirado.", 400);
    }
  }

  async function getCalendarSettings(repositories) {
    const settings = await repositories.clinic.getPlatformSettings();
    return {
      googleCalendarEnabled: Boolean(settings.googleCalendarEnabled),
      googleCalendarId: settings.googleCalendarId || "primary",
      googleCalendarCreateMeet: Boolean(settings.googleCalendarCreateMeet),
      googleCalendarReminderMinutes: Number(settings.googleCalendarReminderMinutes || 0),
      googleCalendarSendUpdates: Boolean(settings.googleCalendarSendUpdates)
    };
  }

  async function getStatus(repositories) {
    const settings = await getCalendarSettings(repositories);
    const connection = await repositories.phase2.getGoogleCalendarConnectionOverview();
    const summary = await repositories.phase2.getGoogleCalendarSyncSummary();
    const blockReason = getSecurityBlockReason();

    return {
      configured: googleCalendarService.isConfigured() && !blockReason,
      connected: Boolean(connection?.connected),
      email: connection?.email || "",
      lastSyncedAt: summary.lastSyncedAt || "",
      failedCount: summary.failedCount || 0,
      blockedReason: blockReason,
      settings
    };
  }

  // Registra a falha no próprio agendamento, para que a interface mostre o
  // aviso e o botão de reprocessar em vez de simplesmente perder o erro.
  async function marcarFalhaDeSync(repositories, sessionId, error) {
    try {
      await repositories.phase2.updateSessionGoogleCalendarSync(sessionId, {
        googleCalendarSyncStatus: "failed",
        googleCalendarError: String(
          error?.message || "Falha inesperada ao sincronizar com o Google Calendar."
        ).slice(0, 500),
        googleCalendarLastSyncedAt: new Date().toISOString()
      });
    } catch (falhaAoRegistrar) {
      // Se nem registrar a falha der certo, ainda assim a sessão está salva.
      console.error("[GOOGLE_SYNC_ERROR]", {
        sessionId,
        message: "Não foi possível registrar a falha de sincronização."
      });
    }
  }

  async function syncSessionRecord(repositories, sessionId) {
    const session = await repositories.clinic.getSessionById(sessionId);
    if (!session) {
      throw new AppError("Sessão não encontrada.", 404);
    }

    const settings = await getCalendarSettings(repositories);
    if (!settings.googleCalendarEnabled) {
      await repositories.phase2.updateSessionGoogleCalendarSync(sessionId, {
        googleCalendarSyncStatus: "skipped",
        googleCalendarError: "",
        googleCalendarLastSyncedAt: ""
      });
      return repositories.clinic.getSessionById(sessionId);
    }

    if (getSecurityBlockReason()) {
      await repositories.phase2.updateSessionGoogleCalendarSync(sessionId, {
        googleCalendarSyncStatus: "failed",
        googleCalendarError: getSecurityBlockReason(),
        googleCalendarLastSyncedAt: new Date().toISOString()
      });
      return repositories.clinic.getSessionById(sessionId);
    }

    if (!googleCalendarService.isConfigured()) {
      await repositories.phase2.updateSessionGoogleCalendarSync(sessionId, {
        googleCalendarSyncStatus: "failed",
        googleCalendarError: "Credenciais do Google Calendar não configuradas no servidor.",
        googleCalendarLastSyncedAt: new Date().toISOString()
      });
      return repositories.clinic.getSessionById(sessionId);
    }

    const connection = await repositories.phase2.getGoogleCalendarConnection();
    if (!connection) {
      await repositories.phase2.updateSessionGoogleCalendarSync(sessionId, {
        googleCalendarSyncStatus: "failed",
        googleCalendarError: "Google Calendar não conectado.",
        googleCalendarLastSyncedAt: new Date().toISOString()
      });
      return repositories.clinic.getSessionById(sessionId);
    }

    const patient = await repositories.clinic.getPatientById(session.patientId);
    if (!patient) {
      throw new AppError("Paciente da sessão não encontrado.", 404);
    }

    // Callback de persistência de token: sempre que o googleapis auto-renova o
    // access_token expirado durante uma chamada à API, salvamos o novo token no
    // banco imediatamente. Isso garante que a próxima instância serverless use
    // um token válido sem precisar re-autenticar (OAuth flow completo).
    const onTokensRefreshed = async (tokens) => {
      if (!tokens.access_token && !tokens.refresh_token) {
        return;
      }
      const updatedConnection = {
        ...connection,
        accessToken: tokens.access_token || connection.accessToken,
        refreshToken: tokens.refresh_token || connection.refreshToken,
        expiryDate: tokens.expiry_date
          ? new Date(tokens.expiry_date).toISOString()
          : connection.expiryDate
      };
      await repositories.phase2.saveGoogleCalendarConnection(updatedConnection);
    };

    const patch =
      session.status === "cancelada"
        ? await googleCalendarService.cancelSession(connection, settings, session, patient, { onTokensRefreshed })
        : await googleCalendarService.syncSession(connection, settings, session, patient, { onTokensRefreshed });

    await repositories.phase2.updateSessionGoogleCalendarSync(sessionId, patch);
    return repositories.clinic.getSessionById(sessionId);
  }

  return {
    buildOAuthState,
    verifyOAuthState,

    async getStatus(repositories) {
      return getStatus(repositories);
    },

    async getAuthUrl(adminUser) {
      assertGoogleCalendarReady();
      if (!googleCalendarService.isConfigured()) {
        throw new AppError(
          "Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_REDIRECT_URI antes de conectar o Google Calendar.",
          400
        );
      }

      return googleCalendarService.buildAuthUrl(buildOAuthState(adminUser));
    },

    async handleCallback(repositories, adminUser, code, stateToken) {
      assertGoogleCalendarReady();
      verifyOAuthState(stateToken, adminUser);
      const existingConnection = await repositories.phase2.getGoogleCalendarConnection();
      const connection = await googleCalendarService.exchangeCodeForConnection(
        code,
        existingConnection
      );
      await repositories.phase2.saveGoogleCalendarConnection(connection);
      return connection;
    },

    async listCalendars(repositories) {
      assertGoogleCalendarReady();
      const connection = await repositories.phase2.getGoogleCalendarConnection();
      if (!connection) {
        throw new AppError("Google Calendar ainda não conectado.", 400);
      }

      return googleCalendarService.listCalendars(connection);
    },

    async testConnection(repositories) {
      assertGoogleCalendarReady();
      const connection = await repositories.phase2.getGoogleCalendarConnection();
      if (!connection) {
        throw new AppError("Google Calendar ainda não conectado.", 400);
      }

      return googleCalendarService.testConnection(connection);
    },

    async disconnect(repositories) {
      // Revoga no Google antes de esquecer localmente. Se falhar, seguimos:
      // deixar o admin preso a uma conexão que ele já pediu para encerrar
      // seria pior. O resultado volta para a rota poder informar.
      let revogacao = { revoked: false, reason: "conexão ausente" };
      try {
        const connection = await repositories.phase2.getGoogleCalendarConnection();
        if (connection && typeof googleCalendarService.revokeConnection === "function") {
          revogacao = await googleCalendarService.revokeConnection(connection);
        }
      } catch (error) {
        // Ler a conexão pode falhar se a chave de criptografia mudou. Não é
        // motivo para impedir a desconexão.
        revogacao = { revoked: false, reason: "não foi possível ler a conexão" };
      }

      await repositories.phase2.deleteGoogleCalendarConnection();
      const settings = await repositories.clinic.getPlatformSettings();
      await repositories.clinic.setPlatformSettings({
        ...settings,
        googleCalendarEnabled: false
      });

      return revogacao;
    },

    // Quando esta função é chamada, a sessão JÁ foi gravada. Uma falha no
    // caminho do Google não pode virar 500 na rota: o admin veria erro, mas a
    // sessão existiria — e ao tentar de novo criaria uma duplicada.
    //
    // As falhas de chamada à API já eram tratadas dentro do serviço do Google.
    // O que escapava era tudo o que vem antes: ler a conexão do banco
    // descriptografa os tokens, e isso lança se a TOKEN_ENCRYPTION_KEY mudou
    // ou o texto cifrado corrompeu.
    // Chamada antes de excluir uma sessão. Cancelar já removia o evento; excluir
    // não, e o paciente ficava com convite e lembrete de um atendimento que não
    // existe mais. Falhar aqui não pode impedir a exclusão.
    async removeSessionEvent(repositories, sessionId) {
      try {
        const session = await repositories.clinic.getSessionById(sessionId);
        if (!session?.googleCalendarEventId) {
          return { removed: false };
        }

        const settings = await getCalendarSettings(repositories);
        if (getSecurityBlockReason() || !googleCalendarService.isConfigured()) {
          return { removed: false };
        }

        const connection = await repositories.phase2.getGoogleCalendarConnection();
        if (!connection) {
          return { removed: false };
        }

        const patient = await repositories.clinic.getPatientById(session.patientId);
        const patch = await googleCalendarService.cancelSession(
          connection,
          settings,
          session,
          patient || {}
        );

        // cancelSession não lança quando o Google recusa: devolve o patch com
        // status "failed". Reportar removed:true nesse caso escondia o evento
        // órfão que fica na agenda do paciente.
        const removido = patch?.googleCalendarSyncStatus === "synced";
        if (!removido) {
          console.warn("[GOOGLE_SYNC]", {
            sessionId,
            message: "Evento não pôde ser removido da agenda antes da exclusão.",
            motivo: patch?.googleCalendarError || ""
          });
        }
        return { removed: removido, motivo: patch?.googleCalendarError || "" };
      } catch (error) {
        console.warn("[GOOGLE_SYNC]", {
          sessionId,
          message: "Falha inesperada ao remover o evento antes da exclusão."
        });
        return { removed: false };
      }
    },

    async syncSession(repositories, sessionId) {
      try {
        return await syncSessionRecord(repositories, sessionId);
      } catch (error) {
        // Sessão inexistente é erro legítimo de quem chamou, não de sync.
        if (error instanceof AppError && error.statusCode === 404) {
          throw error;
        }

        await marcarFalhaDeSync(repositories, sessionId, error);
        return repositories.clinic.getSessionById(sessionId);
      }
    },

    async reprocessFailures(repositories, limit = 25) {
      assertGoogleCalendarReady();

      // Com a integração desligada, cada sessão seria marcada como "skipped" e
      // teria a mensagem de erro apagada — o histórico de falhas sumia e a tela
      // dizia que tudo foi reprocessado, sem nada ter sido enviado ao Google.
      const settings = await getCalendarSettings(repositories);
      if (!settings.googleCalendarEnabled) {
        throw new AppError(
          "Ative a sincronização com o Google Calendar antes de reprocessar as falhas.",
          400
        );
      }

      const sessions = await repositories.phase2.listFailedGoogleCalendarSessions(limit);
      const results = [];

      for (const session of sessions) {
        // Uma sessão problemática não pode interromper o reprocessamento das
        // outras: ela é marcada como falha e o lote segue.
        try {
          results.push(await syncSessionRecord(repositories, session.id));
        } catch (error) {
          await marcarFalhaDeSync(repositories, session.id, error);
          results.push(await repositories.clinic.getSessionById(session.id));
        }
      }

      return {
        processed: results.length,
        items: results
      };
    }
  };
}

module.exports = {
  createGoogleCalendarSyncService
};
