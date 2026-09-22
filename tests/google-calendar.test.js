const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { decryptSecret } = require("../src/lib/encryption");
const {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  createTestContext,
  destroyTestContext,
  loginAsAdmin,
  createPatient,
  createSession
} = require("./helpers");

function createMockGoogleCalendarService(options = {}) {
  const calls = {
    buildAuthUrl: [],
    exchangeCodeForConnection: [],
    listCalendars: [],
    testConnection: [],
    syncSession: [],
    cancelSession: []
  };

  return {
    calls,
    isConfigured() {
      return true;
    },
    buildAuthUrl(stateToken) {
      calls.buildAuthUrl.push(stateToken);
      return `https://accounts.google.test/o/oauth2/auth?state=${encodeURIComponent(stateToken)}`;
    },
    async exchangeCodeForConnection(code, existingConnection = null) {
      calls.exchangeCodeForConnection.push({ code, existingConnection });
      return {
        email: "calendar@example.com",
        accessToken: "mock-access-token",
        refreshToken: "mock-refresh-token",
        scope: "calendar.events calendar.calendarlist.readonly",
        tokenType: "Bearer",
        expiryDate: "2026-06-30T00:00:00.000Z"
      };
    },
    async listCalendars() {
      calls.listCalendars.push(true);
      return [
        { id: "primary", summary: "Agenda principal", primary: true },
        { id: "agenda-secundaria", summary: "Agenda secundária", primary: false }
      ];
    },
    async testConnection() {
      calls.testConnection.push(true);
      return {
        ok: true,
        calendarsCount: 2
      };
    },
    async syncSession(connection, settings, session, patient) {
      calls.syncSession.push({ connection, settings, session, patient });
      if (options.syncFailure) {
        return {
          googleCalendarEventId: session.googleCalendarEventId || "",
          googleCalendarId: settings.googleCalendarId || "primary",
          googleCalendarSyncStatus: "failed",
          googleCalendarLastSyncedAt: "2026-06-06T12:00:00.000Z",
          googleCalendarError: "Falha simulada no Google Calendar.",
          meetingUrl: ""
        };
      }

      return {
        googleCalendarEventId: `evt-${session.id}-${calls.syncSession.length}`,
        googleCalendarId: settings.googleCalendarId || "primary",
        googleCalendarSyncStatus: "synced",
        googleCalendarLastSyncedAt: "2026-06-06T12:00:00.000Z",
        googleCalendarError: "",
        meetingUrl: session.meetingUrl || "https://meet.google.com/mock-room"
      };
    },
    async cancelSession(connection, settings, session, patient) {
      calls.cancelSession.push({ connection, settings, session, patient });
      return {
        googleCalendarEventId: "",
        googleCalendarId: session.googleCalendarId || settings.googleCalendarId || "primary",
        googleCalendarSyncStatus: "synced",
        googleCalendarLastSyncedAt: "2026-06-06T12:15:00.000Z",
        googleCalendarError: ""
      };
    }
  };
}

async function connectGoogleCalendar(agent) {
  const authUrlResponse = await agent.get("/api/admin/google-calendar/auth-url").expect(200);
  const authUrl = new URL(authUrlResponse.body.data.url);
  const stateToken = authUrl.searchParams.get("state");
  assert.ok(stateToken);

  await agent
    .get(`/api/admin/google-calendar/callback?code=mock-code&state=${encodeURIComponent(stateToken)}`)
    .expect(302)
    .expect("Location", "/admin/dashboard?panel=agenda&googleCalendar=connected");
}

test("mantém sessões funcionando sem Google Calendar configurado", async () => {
  const mockGoogleCalendarService = createMockGoogleCalendarService();
  const context = createTestContext(undefined, {
    googleCalendarService: mockGoogleCalendarService
  });

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    const patient = await createPatient(agent);
    const session = await createSession(agent, patient.id, {
      meetingUrl: ""
    });

    assert.equal(session.googleCalendarSyncStatus, "skipped");
    assert.equal(mockGoogleCalendarService.calls.syncSession.length, 0);
  } finally {
    await destroyTestContext(context);
  }
});

test("sincroniza sessão com Google Calendar mockado, atualiza em remarcação e remove ao cancelar", async () => {
  const mockGoogleCalendarService = createMockGoogleCalendarService();
  const context = createTestContext(undefined, {
    googleCalendarService: mockGoogleCalendarService
  });

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    await connectGoogleCalendar(agent);

    const rawConnection = context.app.locals.dependencies.db
      .prepare(`
        SELECT access_token AS accessToken, refresh_token AS refreshToken
        FROM google_calendar_connections
        WHERE connection_key = 'default'
        LIMIT 1
      `)
      .get();

    assert.match(rawConnection.accessToken, /^enc:v1:/);
    assert.match(rawConnection.refreshToken, /^enc:v1:/);
    assert.notEqual(rawConnection.accessToken, "mock-access-token");
    assert.notEqual(rawConnection.refreshToken, "mock-refresh-token");
    assert.equal(decryptSecret(rawConnection.accessToken, context.runtimeConfig), "mock-access-token");
    assert.equal(decryptSecret(rawConnection.refreshToken, context.runtimeConfig), "mock-refresh-token");

    const googleStatus = await agent.get("/api/admin/google-calendar/status").expect(200);
    assert.equal(Object.prototype.hasOwnProperty.call(googleStatus.body.data, "accessToken"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(googleStatus.body.data, "refreshToken"), false);

    await agent
      .put("/api/admin/google-calendar/settings")
      .send({
        googleCalendarEnabled: true,
        googleCalendarId: "primary",
        googleCalendarCreateMeet: true,
        googleCalendarReminderMinutes: 1440,
        googleCalendarSendUpdates: true
      })
      .expect(200);

    const patient = await createPatient(agent, {
      fullName: "Fernanda Google",
      email: "fernanda@example.com"
    });

    const createdSession = await createSession(agent, patient.id, {
      meetingUrl: ""
    });

    assert.equal(createdSession.googleCalendarSyncStatus, "synced");
    assert.match(createdSession.googleCalendarEventId, /^evt-/);
    assert.equal(mockGoogleCalendarService.calls.syncSession.length, 1);

    const updatedSession = await agent
      .put(`/api/admin/sessions/${createdSession.id}`)
      .send({
        patientId: patient.id,
        scheduledAt: "2026-06-22T19:30:00",
        durationMinutes: 50,
        status: "remarcada",
        paymentStatus: "pendente",
        price: 180,
        paymentMethod: "pix",
        paidAt: "",
        meetingUrl: "",
        administrativeNote: "Sessão remarcada."
      })
      .expect(200);

    assert.equal(updatedSession.body.data.googleCalendarSyncStatus, "synced");
    assert.equal(mockGoogleCalendarService.calls.syncSession.length, 2);

    const canceledSession = await agent
      .post(`/api/admin/sessions/${createdSession.id}/cancel`)
      .expect(200);

    assert.equal(canceledSession.body.data.googleCalendarEventId, "");
    assert.equal(mockGoogleCalendarService.calls.cancelSession.length, 1);
  } finally {
    await destroyTestContext(context);
  }
});

test("salva sessão mesmo com falha no Google Calendar e desconectar interrompe novos syncs", async () => {
  const mockGoogleCalendarService = createMockGoogleCalendarService({ syncFailure: true });
  const context = createTestContext(undefined, {
    googleCalendarService: mockGoogleCalendarService
  });

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    await connectGoogleCalendar(agent);

    await agent
      .put("/api/admin/google-calendar/settings")
      .send({
        googleCalendarEnabled: true,
        googleCalendarId: "primary",
        googleCalendarCreateMeet: false,
        googleCalendarReminderMinutes: 60,
        googleCalendarSendUpdates: false
      })
      .expect(200);

    const patient = await createPatient(agent, {
      fullName: "Paciente Falha Google"
    });

    const failedSession = await createSession(agent, patient.id, {
      scheduledAt: "2026-06-23T18:00:00"
    });

    assert.equal(failedSession.googleCalendarSyncStatus, "failed");
    assert.equal(
      failedSession.googleCalendarError,
      "Falha simulada no Google Calendar."
    );
    assert.equal(mockGoogleCalendarService.calls.syncSession.length, 1);

    await agent.post("/api/admin/google-calendar/disconnect").expect(200);

    const statusAfterDisconnect = await agent
      .get("/api/admin/google-calendar/status")
      .expect(200);

    assert.equal(statusAfterDisconnect.body.data.connected, false);
    assert.equal(statusAfterDisconnect.body.data.settings.googleCalendarEnabled, false);

    const sessionAfterDisconnect = await createSession(agent, patient.id, {
      scheduledAt: "2026-06-24T18:00:00"
    });

    assert.equal(sessionAfterDisconnect.googleCalendarSyncStatus, "skipped");
    assert.equal(mockGoogleCalendarService.calls.syncSession.length, 1);
  } finally {
    await destroyTestContext(context);
  }
});

test("bloqueia o Google Calendar em produção sem TOKEN_ENCRYPTION_KEY", async () => {
  const context = createTestContext(undefined, {
    nodeEnv: "production",
    isProduction: true,
    tokenEncryptionKey: "",
    googleClientId: "google-client-id",
    googleClientSecret: "google-client-secret",
    googleRedirectUri: "https://example.com/api/admin/google-calendar/callback"
  });

  try {
    const loginResponse = await request(context.app)
      .post("/api/admin/login")
      .send({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD
      })
      .expect(200);

    const cookieHeader = (loginResponse.headers["set-cookie"] || [])
      .map((cookie) => cookie.split(";")[0])
      .join("; ");

    const statusResponse = await request(context.app)
      .get("/api/admin/google-calendar/status")
      .set("Cookie", cookieHeader)
      .expect(200);

    assert.equal(statusResponse.body.data.configured, false);
    assert.match(statusResponse.body.data.blockedReason, /TOKEN_ENCRYPTION_KEY/i);

    const authUrlResponse = await request(context.app)
      .get("/api/admin/google-calendar/auth-url")
      .set("Cookie", cookieHeader)
      .expect(500);

    assert.match(authUrlResponse.body.error, /TOKEN_ENCRYPTION_KEY/i);
  } finally {
    await destroyTestContext(context);
  }
});

test("desconectar o Google Calendar revoga o token na conta", async () => {
  const revogacoes = [];
  const mock = createMockGoogleCalendarService();
  mock.revokeConnection = async (connection) => {
    revogacoes.push(connection?.refreshToken || null);
    return { revoked: true };
  };

  const context = createTestContext(undefined, {
    googleCalendarService: mock
  });

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    await context.app.locals.dependencies.repositories.phase2.saveGoogleCalendarConnection({
      email: "agenda@example.com",
      accessToken: "token-de-acesso",
      refreshToken: "token-de-renovacao",
      scope: "calendar",
      tokenType: "Bearer",
      expiryDate: ""
    });

    await agent.post("/api/admin/google-calendar/disconnect").expect(200);

    // O token precisa ter sido revogado no Google, não só esquecido aqui.
    assert.deepEqual(revogacoes, ["token-de-renovacao"]);

    const conexao =
      await context.app.locals.dependencies.repositories.phase2.getGoogleCalendarConnection();
    assert.equal(conexao, null);
  } finally {
    await destroyTestContext(context);
  }
});

test("excluir sessão remove o evento da agenda do paciente", async () => {
  const mockGoogleCalendarService = createMockGoogleCalendarService();
  const context = createTestContext(undefined, {
    googleCalendarService: mockGoogleCalendarService
  });

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    await connectGoogleCalendar(agent);
    await agent
      .put("/api/admin/google-calendar/settings")
      .send({
        googleCalendarEnabled: true,
        googleCalendarId: "primary",
        googleCalendarCreateMeet: false,
        googleCalendarReminderMinutes: 1440,
        googleCalendarSendUpdates: false
      })
      .expect(200);

    const patient = await createPatient(agent, { fullName: "Evento Órfão" });
    const session = await createSession(agent, patient.id);

    const sincronizada = context.app.locals.dependencies.db
      .prepare("SELECT google_calendar_event_id AS id FROM clinic_sessions WHERE id = ?")
      .get(session.id);
    assert.ok(sincronizada.id);

    const cancelamentosAntes = mockGoogleCalendarService.calls.cancelSession.length;
    await agent.delete(`/api/admin/sessions/${session.id}`).expect(200);

    // Sem isso o paciente ficava com convite e lembrete de uma sessão apagada.
    assert.equal(
      mockGoogleCalendarService.calls.cancelSession.length,
      cancelamentosAntes + 1
    );
  } finally {
    await destroyTestContext(context);
  }
});

test("reprocessar falhas exige a sincronização ligada", async () => {
  const mockGoogleCalendarService = createMockGoogleCalendarService();
  const context = createTestContext(undefined, {
    googleCalendarService: mockGoogleCalendarService
  });

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    await connectGoogleCalendar(agent);

    const patient = await createPatient(agent, { fullName: "Reprocessar" });
    const session = await createSession(agent, patient.id);

    // Registra uma falha de sincronização e desliga a integração.
    context.app.locals.dependencies.db
      .prepare(
        "UPDATE clinic_sessions SET google_calendar_sync_status = ?, google_calendar_error = ? WHERE id = ?"
      )
      .run("failed", "erro anterior", session.id);

    const settings = await agent.get("/api/admin/google-calendar/status").expect(200);
    await agent
      .put("/api/admin/google-calendar/settings")
      .send({ ...settings.body.data.settings, googleCalendarEnabled: false })
      .expect(200);

    // Antes, isso respondia sucesso e apagava o histórico sem enviar nada.
    const resposta = await agent
      .post("/api/admin/google-calendar/reprocess-failures")
      .send({})
      .expect(400);
    assert.match(resposta.body.error, /ative a sincroniza/i);

    const depois = context.app.locals.dependencies.db
      .prepare("SELECT google_calendar_error AS erro FROM clinic_sessions WHERE id = ?")
      .get(session.id);
    assert.equal(depois.erro, "erro anterior");
  } finally {
    await destroyTestContext(context);
  }
});

test("excluir paciente limpa os eventos das sessões na agenda", async () => {
  const mockGoogleCalendarService = createMockGoogleCalendarService();
  const context = createTestContext(undefined, {
    googleCalendarService: mockGoogleCalendarService
  });

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    await connectGoogleCalendar(agent);
    await agent
      .put("/api/admin/google-calendar/settings")
      .send({
        googleCalendarEnabled: true,
        googleCalendarId: "primary",
        googleCalendarCreateMeet: false,
        googleCalendarReminderMinutes: 1440,
        googleCalendarSendUpdates: false
      })
      .expect(200);

    const patient = await createPatient(agent, { fullName: "Agenda Limpa" });
    await createSession(agent, patient.id);
    await createSession(agent, patient.id, { scheduledAt: "2026-06-22T18:00" });

    const antes = mockGoogleCalendarService.calls.cancelSession.length;
    await agent.delete(`/api/admin/patients/${patient.id}`).expect(200);

    // Sem isso os compromissos ficavam para sempre na agenda, com o nome de
    // alguém que já não existe no sistema.
    assert.equal(mockGoogleCalendarService.calls.cancelSession.length, antes + 2);
  } finally {
    await destroyTestContext(context);
  }
});

test("callback do Google recusa state inválido, ausente ou de outro admin", async () => {
  const mockGoogleCalendarService = createMockGoogleCalendarService();
  const context = createTestContext(undefined, {
    googleCalendarService: mockGoogleCalendarService
  });

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    // Sem state: nem chega a trocar o código.
    await agent.get("/api/admin/google-calendar/callback?code=mock-code").expect(400);

    // State inventado: a assinatura não confere.
    await agent
      .get("/api/admin/google-calendar/callback?code=mock-code&state=inventado")
      .expect(400);

    // State com assinatura adulterada.
    const authUrl = new URL((await agent.get("/api/admin/google-calendar/auth-url").expect(200)).body.data.url);
    const stateValido = authUrl.searchParams.get("state");
    const adulterado = stateValido.slice(0, -3) + "aaa";
    await agent
      .get(`/api/admin/google-calendar/callback?code=mock-code&state=${encodeURIComponent(adulterado)}`)
      .expect(400);

    // Nenhuma conexão foi criada por nenhuma dessas tentativas.
    const conexao =
      await context.app.locals.dependencies.repositories.phase2.getGoogleCalendarConnection();
    assert.equal(conexao, null);

    // O state legítimo continua funcionando.
    await agent
      .get(`/api/admin/google-calendar/callback?code=mock-code&state=${encodeURIComponent(stateValido)}`)
      .expect(302);
  } finally {
    await destroyTestContext(context);
  }
});
