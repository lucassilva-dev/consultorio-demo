const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const request = require("supertest");
const { createApp } = require("../src/app");
const { decryptSecret } = require("../src/lib/encryption");
const { encryptClinicalText } = require("../src/lib/clinical-crypto");
const { hashPassword, serializePasswordRecord } = require("../src/lib/password");
const {
  deletePrivateDocument,
  ensureStorageReady,
  persistPrivateDocument,
  readPrivateDocument
} = require("../src/services/storage");

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "senha-teste-123";
const TOKEN_ENCRYPTION_KEY = Buffer.from(
  "0123456789abcdef0123456789abcdef",
  "utf8"
).toString("base64");
const SAMPLE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9VEaYwAAAABJRU5ErkJggg==",
  "base64"
);

function createTestOverrides(tempRoot) {
  return {
    nodeEnv: "test",
    isProduction: false,
    sessionSecret: "test-session-secret",
    authCookieSecret: "test-session-secret",
    dataProvider: "sqlite",
    storageProvider: "local",
    databasePath: path.join(tempRoot, "app.db"),
    uploadDir: path.join(tempRoot, "uploads"),
    adminEmail: ADMIN_EMAIL,
    adminPasswordHash: serializePasswordRecord(hashPassword(ADMIN_PASSWORD)),
    adminInitialPassword: "",
    tokenEncryptionKey: TOKEN_ENCRYPTION_KEY,
    legacyTokenEncryptionSecret: "legacy-google-token-secret"
  };
}

function createTestContext(
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cv2-admin-")),
  extraOverrides = {}
) {
  const context = createApp({
    ...createTestOverrides(tempRoot),
    ...extraOverrides
  });
  return {
    ...context,
    tempRoot
  };
}

function createMockSupabaseAdminClient() {
  const buckets = [];
  const objects = new Map();
  const calls = {
    createBucket: [],
    updateBucket: [],
    upload: [],
    download: [],
    remove: []
  };

  function ensureBucketRecord(name) {
    let bucket = buckets.find((item) => item.name === name);
    if (!bucket) {
      bucket = {
        name,
        public: false,
        allowed_mime_types: [],
        file_size_limit: null
      };
      buckets.push(bucket);
    }
    return bucket;
  }

  return {
    calls,
    storage: {
      async listBuckets() {
        return {
          data: buckets.map((bucket) => ({ ...bucket })),
          error: null
        };
      },
      async createBucket(name, options = {}) {
        calls.createBucket.push({ name, options });
        const bucket = ensureBucketRecord(name);
        bucket.public = Boolean(options.public);
        bucket.allowed_mime_types = [...(options.allowedMimeTypes || [])];
        bucket.file_size_limit = options.fileSizeLimit || null;
        return { data: bucket, error: null };
      },
      async updateBucket(name, options = {}) {
        calls.updateBucket.push({ name, options });
        const bucket = ensureBucketRecord(name);
        bucket.public = Boolean(options.public);
        bucket.allowed_mime_types = [...(options.allowedMimeTypes || [])];
        bucket.file_size_limit = options.fileSizeLimit || null;
        return { data: bucket, error: null };
      },
      from(bucketName) {
        return {
          async upload(objectKey, buffer, options = {}) {
            calls.upload.push({ bucketName, objectKey, options });
            objects.set(`${bucketName}:${objectKey}`, Buffer.from(buffer));
            return {
              data: { path: objectKey },
              error: null
            };
          },
          async download(objectKey) {
            calls.download.push({ bucketName, objectKey });
            const key = `${bucketName}:${objectKey}`;
            const data = objects.get(key);
            if (!data) {
              return {
                data: null,
                error: {
                  status: 404,
                  message: "Object not found"
                }
              };
            }

            return {
              data: {
                async arrayBuffer() {
                  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
                }
              },
              error: null
            };
          },
          async remove(objectKeys = []) {
            calls.remove.push({ bucketName, objectKeys });
            for (const objectKey of objectKeys) {
              objects.delete(`${bucketName}:${objectKey}`);
            }
            return { data: [], error: null };
          },
          getPublicUrl(objectKey) {
            return {
              data: {
                publicUrl: `https://storage.example/${bucketName}/${objectKey}`
              }
            };
          }
        };
      }
    }
  };
}

async function destroyTestContext(context, options = {}) {
  await context.close();
  if (!options.keepFiles) {
    fs.rmSync(context.tempRoot, { recursive: true, force: true });
  }
}

async function loginAsAdmin(agent) {
  return agent
    .post("/api/admin/login")
    .send({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    })
    .expect(200);
}

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

async function createPatient(agent, overrides = {}) {
  const response = await agent
    .post("/api/admin/patients")
    .send({
      fullName: "Paciente Teste",
      preferredName: "Paciente",
      birthDate: "1992-04-10",
      age: 34,
      phone: "31988887777",
      email: "paciente@example.com",
      patientType: "adulto",
      guardianName: "",
      guardianPhone: "",
      sessionPrice: 180,
      defaultWeekday: "quarta",
      defaultTime: "18:00",
      modality: "online",
      status: "ativo",
      administrativeNote: "Paciente de teste.",
      ...overrides
    })
    .expect(201);

  return response.body.data;
}

async function createSession(agent, patientId, overrides = {}) {
  const response = await agent
    .post("/api/admin/sessions")
    .send({
      patientId,
      scheduledAt: "2026-06-15T18:30:00",
      durationMinutes: 50,
      status: "agendada",
      paymentStatus: "pendente",
      price: 180,
      paymentMethod: "pix",
      paidAt: "",
      meetingUrl: "",
      administrativeNote: "Sessão de teste.",
      ...overrides
    })
    .expect(201);

  return response.body.data;
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

test("redireciona visitantes não autenticados ao acessar /admin/dashboard", async () => {
  const context = createTestContext();

  try {
    await request(context.app)
      .get("/admin/dashboard")
      .expect(302)
      .expect("Location", "/admin/login");

    await request(context.app).get("/api/admin/content").expect(401);
  } finally {
    await destroyTestContext(context);
  }
});

test("envia headers no-store para páginas e APIs administrativas", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    const adminPage = await agent.get("/admin/dashboard").expect(200);
    assert.match(adminPage.headers["cache-control"] || "", /no-store/i);

    const adminApi = await agent.get("/api/admin/content").expect(200);
    assert.match(adminApi.headers["cache-control"] || "", /no-store/i);

    const publicApi = await request(context.app).get("/api/public/content").expect(200);
    assert.match(publicApi.headers["cache-control"] || "", /no-store/i);
  } finally {
    await destroyTestContext(context);
  }
});

test("expõe a página pública de privacidade e deixa o link visível no shell público", async () => {
  const context = createTestContext();

  try {
    const privacyPage = await request(context.app).get("/privacidade").expect(200);
    assert.match(privacyPage.text, /Como os dados administrativos são tratados/i);
    assert.match(privacyPage.text, /site não é canal de emergência/i);

    const homePage = await request(context.app).get("/").expect(200);
    assert.match(homePage.text, /href="\/privacidade"/i);
  } finally {
    await destroyTestContext(context);
  }
});

test("protege a listagem de auditoria e expõe apenas status booleanos no checklist de segurança", async () => {
  const context = createTestContext();

  try {
    await request(context.app).get("/api/admin/audit-logs").expect(401);
    await request(context.app).get("/api/admin/security/status").expect(401);

    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    const statusResponse = await agent.get("/api/admin/security/status").expect(200);
    const serializedStatus = JSON.stringify(statusResponse.body.data);

    assert.equal(
      Object.values(statusResponse.body.data).every((value) => typeof value === "boolean"),
      true
    );
    assert.equal(serializedStatus.includes("test-session-secret"), false);
    assert.equal(serializedStatus.includes(TOKEN_ENCRYPTION_KEY), false);
  } finally {
    await destroyTestContext(context);
  }
});

test("gera logs de auditoria sem incluir senha, token ou secret", async () => {
  const context = createTestContext();

  try {
    await request(context.app)
      .post("/api/admin/login")
      .send({
        email: ADMIN_EMAIL,
        password: "senha-incorreta"
      })
      .expect(401);

    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    const createdPatient = await createPatient(agent, {
      fullName: "Paciente Auditoria",
      phone: "31995554444"
    });

    const createdSession = await createSession(agent, createdPatient.id, {
      scheduledAt: "2026-06-26T18:00:00"
    });

    await agent
      .post(`/api/admin/sessions/${createdSession.id}/mark-paid`)
      .send({ paymentMethod: "pix" })
      .expect(200);

    const generatedReceipt = await agent
      .post(`/api/admin/sessions/${createdSession.id}/receipt`)
      .send({})
      .expect(201);

    await agent
      .get(`/api/admin/receipts/${generatedReceipt.body.data.id}/download`)
      .expect(200);

    const auditLogs = await agent.get("/api/admin/audit-logs?pageSize=50").expect(200);
    const actions = auditLogs.body.data.items.map((item) => item.action);
    const serializedLogs = JSON.stringify(auditLogs.body.data.items);

    assert.ok(actions.includes("login_failed"));
    assert.ok(actions.includes("login_succeeded"));
    assert.ok(actions.includes("patient_created"));
    assert.ok(actions.includes("receipt_generated"));
    assert.ok(actions.includes("receipt_downloaded"));
    assert.equal(serializedLogs.includes(ADMIN_PASSWORD), false);
    assert.equal(serializedLogs.includes("senha-incorreta"), false);
    assert.equal(serializedLogs.includes("mock-access-token"), false);
    assert.equal(serializedLogs.includes("SUPABASE_SERVICE_ROLE_KEY"), false);
  } finally {
    await destroyTestContext(context);
  }
});

test("autentica o administrador com hash e define cookie de sessão HttpOnly", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    const response = await loginAsAdmin(agent);
    const cookies = response.headers["set-cookie"] || [];

    assert.ok(cookies.some((cookie) => cookie.includes("HttpOnly")));
    assert.ok(cookies.some((cookie) => cookie.includes("SameSite=Lax")));

    const dashboard = await agent.get("/admin/dashboard").expect(200);
    assert.match(dashboard.text, /Plataforma clínica/i);
    assert.match(dashboard.text, /data-panel-trigger="dashboard"/i);
  } finally {
    await destroyTestContext(context);
  }
});

test("cria, lista, edita lead e converte para paciente", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    const createdLead = await agent
      .post("/api/admin/leads")
      .send({
        name: "Marina Souza",
        phone: "31999990000",
        email: "marina@example.com",
        age: 29,
        source: "instagram",
        interest: "adulto",
        status: "novo",
        preferredPeriod: "noite",
        administrativeNote: "Veio pelo direct."
      })
      .expect(201);

    assert.equal(createdLead.body.data.name, "Marina Souza");

    const listedLeads = await agent
      .get("/api/admin/leads")
      .expect(200);

    assert.equal(listedLeads.body.data.items.length, 1);

    const leadId = createdLead.body.data.id;

    const updatedLead = await agent
      .put(`/api/admin/leads/${leadId}`)
      .send({
        name: "Marina Souza",
        phone: "31999990000",
        email: "marina@example.com",
        age: 29,
        source: "instagram",
        interest: "adulto",
        status: "contato_realizado",
        preferredPeriod: "noite",
        administrativeNote: "Contato inicial feito."
      })
      .expect(200);

    assert.equal(updatedLead.body.data.status, "contato_realizado");

    const converted = await agent
      .post(`/api/admin/leads/${leadId}/convert-to-patient`)
      .expect(201);

    assert.equal(converted.body.data.lead.status, "virou_paciente");
    assert.equal(converted.body.data.patient.fullName, "Marina Souza");

    const patients = await agent.get("/api/admin/patients").expect(200);
    assert.equal(patients.body.data.items.length, 1);
    assert.equal(patients.body.data.items[0].phone, "31999990000");
  } finally {
    await destroyTestContext(context);
  }
});

test("exige responsável para converter lead adolescente e permite concluir a conversão assistida", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    const createdLead = await agent
      .post("/api/admin/leads")
      .send({
        name: "Julia Costa",
        phone: "31977776666",
        email: "julia@example.com",
        age: 16,
        source: "site",
        interest: "adolescente",
        status: "novo",
        preferredPeriod: "tarde",
        administrativeNote: "Contato para adolescente."
      })
      .expect(201);

    const leadId = createdLead.body.data.id;

    const blockedConversion = await agent
      .post(`/api/admin/leads/${leadId}/convert-to-patient`)
      .expect(400);

    assert.equal(
      blockedConversion.body.error,
      "Lead adolescente precisa de responsável antes da conversão."
    );

    const converted = await agent
      .post(`/api/admin/leads/${leadId}/convert-to-patient`)
      .send({
        fullName: "Julia Costa",
        preferredName: "Juju",
        birthDate: "",
        age: 16,
        phone: "31977776666",
        email: "julia@example.com",
        patientType: "adolescente",
        guardianName: "Mariana Costa",
        guardianPhone: "31988887777",
        sessionPrice: 150,
        defaultWeekday: "",
        defaultTime: "",
        modality: "online",
        status: "ativo",
        administrativeNote: "Conversão assistida."
      })
      .expect(201);

    assert.equal(converted.body.data.patient.patientType, "adolescente");
    assert.equal(converted.body.data.patient.guardianName, "Mariana Costa");
    assert.equal(converted.body.data.patient.guardianPhone, "31988887777");
  } finally {
    await destroyTestContext(context);
  }
});

test("middleware de timeout responde 503 quando o handler pendura, sem afetar rotas rápidas", async () => {
  const express = require("express");
  const { createRequestTimeout } = require("../src/routes");

  const app = express();
  app.use(createRequestTimeout(80));
  app.get("/rapida", (req, res) => res.status(200).json({ ok: true }));
  // Handler que nunca responde — sem o middleware, penduraria até o limite do Vercel.
  app.get("/pendura", () => {});

  const agent = request(app);

  const fast = await agent.get("/rapida").expect(200);
  assert.equal(fast.body.ok, true);

  const slow = await agent.get("/pendura").expect(503);
  assert.equal(slow.body.ok, false);
  assert.match(slow.body.error, /demorou para responder/i);
});

test("interpreta horário de sessão como fuso da clínica (America/Sao_Paulo) ao salvar", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    const patient = await createPatient(agent);

    // Entrada "ingênua" 20:30 deve ser interpretada como horário da clínica
    // (UTC-3) e gravada como 23:30 UTC — antes virava 17:30 em produção (UTC).
    const session = await createSession(agent, patient.id, {
      scheduledAt: "2026-06-08T20:30"
    });
    assert.equal(session.scheduledAt, "2026-06-08T23:30:00.000Z");

    // Valor já com fuso explícito é respeitado como está.
    const sessionWithTz = await createSession(agent, patient.id, {
      scheduledAt: "2026-06-08T23:30:00.000Z"
    });
    assert.equal(sessionWithTz.scheduledAt, "2026-06-08T23:30:00.000Z");
  } finally {
    await destroyTestContext(context);
  }
});

test("cria e edita paciente, cria sessões, marca falta, remarca e atualiza o financeiro", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    const createdPatient = await agent
      .post("/api/admin/patients")
      .send({
        fullName: "Ana Ribeiro",
        preferredName: "Ana",
        birthDate: "1994-05-11",
        age: 32,
        phone: "31988887777",
        email: "ana@example.com",
        patientType: "adulto",
        guardianName: "",
        guardianPhone: "",
        sessionPrice: 180,
        defaultWeekday: "quarta",
        defaultTime: "18:00",
        modality: "online",
        status: "ativo",
        administrativeNote: "Atendimento semanal."
      })
      .expect(201);

    const patientId = createdPatient.body.data.id;

    const updatedPatient = await agent
      .put(`/api/admin/patients/${patientId}`)
      .send({
        fullName: "Ana Ribeiro",
        preferredName: "Aninha",
        birthDate: "1994-05-11",
        age: 32,
        phone: "31988887777",
        email: "ana@example.com",
        patientType: "adulto",
        guardianName: "",
        guardianPhone: "",
        sessionPrice: 190,
        defaultWeekday: "quarta",
        defaultTime: "18:30",
        modality: "online",
        status: "ativo",
        administrativeNote: "Horário ajustado."
      })
      .expect(200);

    assert.equal(updatedPatient.body.data.preferredName, "Aninha");
    assert.equal(updatedPatient.body.data.sessionPrice, 190);

    const createdSession = await agent
      .post("/api/admin/sessions")
      .send({
        patientId,
        scheduledAt: "2026-06-10T18:30:00",
        durationMinutes: 50,
        status: "agendada",
        paymentStatus: "pendente",
        price: 190,
        paymentMethod: "pix",
        paidAt: "",
        meetingUrl: "https://meet.google.com/teste",
        administrativeNote: "Primeira sessão."
      })
      .expect(201);

    const sessionId = createdSession.body.data.id;

    await agent.post(`/api/admin/sessions/${sessionId}/mark-done`).expect(200);
    const paid = await agent
      .post(`/api/admin/sessions/${sessionId}/mark-paid`)
      .send({ paymentMethod: "pix" })
      .expect(200);

    assert.equal(paid.body.data.paymentStatus, "pago");

    const missedSession = await agent
      .post("/api/admin/sessions")
      .send({
        patientId,
        scheduledAt: "2026-06-11T18:30:00",
        durationMinutes: 50,
        status: "agendada",
        paymentStatus: "pendente",
        price: 190,
        paymentMethod: "pix",
        paidAt: "",
        meetingUrl: "",
        administrativeNote: "Sessão para testar falta."
      })
      .expect(201);

    await agent.post(`/api/admin/sessions/${missedSession.body.data.id}/mark-missed`).expect(200);

    const rescheduledSession = await agent
      .post("/api/admin/sessions")
      .send({
        patientId,
        scheduledAt: "2026-06-12T18:30:00",
        durationMinutes: 50,
        status: "agendada",
        paymentStatus: "pendente",
        price: 190,
        paymentMethod: "pix",
        paidAt: "",
        meetingUrl: "",
        administrativeNote: "Sessão para testar remarcação."
      })
      .expect(201);

    await agent
      .put(`/api/admin/sessions/${rescheduledSession.body.data.id}`)
      .send({
        patientId,
        scheduledAt: "2026-06-19T18:30:00",
        durationMinutes: 50,
        status: "remarcada",
        paymentStatus: "pendente",
        price: 190,
        paymentMethod: "pix",
        paidAt: "",
        meetingUrl: "",
        administrativeNote: "Sessão remarcada."
      })
      .expect(200);

    const sessions = await agent.get("/api/admin/sessions").expect(200);
    assert.equal(sessions.body.data.items.length, 3);
    assert.ok(sessions.body.data.items.some((item) => item.id === sessionId && item.status === "realizada"));
    assert.ok(
      sessions.body.data.items.some(
        (item) => item.id === missedSession.body.data.id && item.status === "falta"
      )
    );
    assert.ok(
      sessions.body.data.items.some(
        (item) => item.id === rescheduledSession.body.data.id && item.status === "remarcada"
      )
    );

    const finance = await agent
      .get("/api/admin/finance/summary?month=6&year=2026")
      .expect(200);

    assert.equal(finance.body.data.summary.totalReceived, 190);
    assert.equal(finance.body.data.summary.completedSessions, 1);
    assert.equal(finance.body.data.receivedPayments.length, 1);
  } finally {
    await destroyTestContext(context);
  }
});

test("cria e lista modelo de mensagem e lê/salva configurações da agenda", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    const createdTemplate = await agent
      .post("/api/admin/message-templates")
      .send({
        title: "Confirmação personalizada",
        category: "confirmacao_sessao",
        body: "Olá, {primeiro_nome}. Confirmando sua sessão em {data}, às {horario}.",
        isActive: true
      })
      .expect(201);

    const templateId = createdTemplate.body.data.id;

    const listedTemplates = await agent
      .get("/api/admin/message-templates?search=Confirmação")
      .expect(200);

    assert.ok(listedTemplates.body.data.items.some((item) => item.id === templateId));

    const updatedTemplate = await agent
      .put(`/api/admin/message-templates/${templateId}`)
      .send({
        title: "Confirmação personalizada",
        category: "confirmacao_sessao",
        body: "Olá, {primeiro_nome}. Confirmando sua sessão em {data}, às {horario}. Link: {link_sessao}.",
        isActive: false
      })
      .expect(200);

    assert.equal(updatedTemplate.body.data.isActive, false);

    const currentSettings = await agent.get("/api/admin/platform-settings").expect(200);
    assert.equal(typeof currentSettings.body.data.showSchedulingButton, "boolean");

    const savedSettings = await agent
      .put("/api/admin/platform-settings")
      .send({
        schedulingUrl: "https://cal.com/consultorio-demo/conversa-inicial",
        schedulingLabel: "Copiar link da conversa inicial",
        meetingDefaultUrl: "https://meet.google.com/sala-padrao",
        cancellationPolicyText:
          "Cancelamentos e remarcações devem ser combinados com antecedência mínima de 24 horas.",
        showSchedulingButton: true
      })
      .expect(200);

    assert.equal(
      savedSettings.body.data.schedulingUrl,
      "https://cal.com/consultorio-demo/conversa-inicial"
    );
    assert.equal(savedSettings.body.data.showSchedulingButton, true);

    const publicContent = await agent.get("/api/public/content").expect(200);
    assert.equal(
      publicContent.body.data.agenda.schedulingUrl,
      "https://cal.com/consultorio-demo/conversa-inicial"
    );
    assert.equal(publicContent.body.data.agenda.schedulingLabel, "Copiar link da conversa inicial");
    assert.equal(publicContent.body.data.agenda.showSchedulingButton, true);
  } finally {
    await destroyTestContext(context);
  }
});

test("usa bucket privado do Supabase para recibos e mantém bucket público só para imagens", async () => {
  const mockSupabaseAdminClient = createMockSupabaseAdminClient();
  const runtimeConfig = {
    ...createTestOverrides(fs.mkdtempSync(path.join(os.tmpdir(), "cv2-storage-"))),
    storageProvider: "supabase",
    supabaseUrl: "https://example.supabase.co",
    supabaseServiceRoleKey: "service-role-for-tests",
    supabaseStorageBucket: "site-images",
    supabasePrivateStorageBucket: "private-documents",
    supabaseAdminClient: mockSupabaseAdminClient,
    allowedUploadMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    allowedDocumentMimeTypes: ["application/pdf"],
    maxUploadBytes: 3 * 1024 * 1024
  };

  try {
    await ensureStorageReady(runtimeConfig);

    const stored = await persistPrivateDocument(Buffer.from("receipt-pdf-content"), runtimeConfig, {
      folder: "receipts",
      extension: ".pdf",
      contentType: "application/pdf"
    });

    const loaded = await readPrivateDocument(stored.objectKey, runtimeConfig, "supabase");
    await deletePrivateDocument(stored.objectKey, runtimeConfig, "supabase");

    assert.equal(loaded.toString("utf8"), "receipt-pdf-content");
    assert.equal(mockSupabaseAdminClient.calls.upload[0].bucketName, "private-documents");
    assert.equal(mockSupabaseAdminClient.calls.download[0].bucketName, "private-documents");
    assert.equal(mockSupabaseAdminClient.calls.remove[0].bucketName, "private-documents");

    const publicBucket = mockSupabaseAdminClient.calls.createBucket.find(
      (call) => call.name === "site-images"
    );
    const privateBucket = mockSupabaseAdminClient.calls.createBucket.find(
      (call) => call.name === "private-documents"
    );

    assert.equal(publicBucket.options.public, true);
    assert.equal(privateBucket.options.public, false);
  } finally {
    fs.rmSync(runtimeConfig.databasePath ? path.dirname(runtimeConfig.databasePath) : runtimeConfig.uploadDir, {
      recursive: true,
      force: true
    });
  }
});

test("gera recibo em PDF para sessão paga, impede duplicação acidental e bloqueia sessão não paga", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    await agent
      .put("/api/admin/platform-settings")
      .send({
        professionalName: "Marina Alves",
        crp: "00/00000",
        professionalDocument: "123.456.789-00",
        receiptCity: "Belo Horizonte",
        receiptFooterText:
          "Este recibo é emitido apenas para fins administrativos e não substitui documento fiscal."
      })
      .expect(200);

    const patient = await createPatient(agent, {
      fullName: "Marina Carvalho",
      phone: "31991112222"
    });

    const unpaidSession = await createSession(agent, patient.id, {
      scheduledAt: "2026-06-20T18:00:00"
    });

    await agent.post(`/api/admin/sessions/${unpaidSession.id}/receipt`).send({}).expect(400);

    const paidSession = await createSession(agent, patient.id, {
      scheduledAt: "2026-06-21T18:00:00"
    });

    await agent
      .post(`/api/admin/sessions/${paidSession.id}/mark-paid`)
      .send({ paymentMethod: "pix" })
      .expect(200);

    const generatedReceipt = await agent
      .post(`/api/admin/sessions/${paidSession.id}/receipt`)
      .send({})
      .expect(201);

    assert.equal(generatedReceipt.body.data.sessionId, paidSession.id);
    assert.equal(generatedReceipt.body.meta.reused, false);
    assert.match(generatedReceipt.body.data.receiptNumber, /^REC-\d{6}$/);
    assert.equal(generatedReceipt.body.data.fileObjectKey, undefined);

    const reusedReceipt = await agent
      .post(`/api/admin/sessions/${paidSession.id}/receipt`)
      .send({})
      .expect(200);

    assert.equal(reusedReceipt.body.meta.reused, true);
    assert.equal(reusedReceipt.body.data.id, generatedReceipt.body.data.id);

    const listedReceipts = await agent
      .get("/api/admin/receipts?month=6&year=2026")
      .expect(200);

    assert.equal(listedReceipts.body.data.items.length, 1);
    assert.equal(listedReceipts.body.data.items[0].sessionId, paidSession.id);
    assert.equal(listedReceipts.body.data.items[0].fileObjectKey, undefined);

    const receiptDetails = await agent
      .get(`/api/admin/receipts/${generatedReceipt.body.data.id}`)
      .expect(200);

    assert.equal(receiptDetails.body.data.fileObjectKey, undefined);

    const downloadedReceipt = await agent
      .get(`/api/admin/receipts/${generatedReceipt.body.data.id}/download`)
      .expect(200)
      .expect("Content-Type", /application\/pdf/);

    assert.ok(downloadedReceipt.body.length > 1000);
  } finally {
    await destroyTestContext(context);
  }
});

test("reaplica nome profissional e CRP padrão no bootstrap quando agenda antiga está vazia", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cv2-admin-"));
  const context = createTestContext(tempRoot);

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    await agent
      .put("/api/admin/platform-settings")
      .send({
        professionalName: "",
        crp: ""
      })
      .expect(200);
  } finally {
    await destroyTestContext(context, { keepFiles: true });
  }

  const restarted = createTestContext(tempRoot);
  try {
    const agent = request.agent(restarted.app);
    await loginAsAdmin(agent);

    const settings = await agent.get("/api/admin/platform-settings").expect(200);
    assert.equal(settings.body.data.professionalName, "Marina Alves");
    assert.equal(settings.body.data.crp, "00/00000");

    const patient = await createPatient(agent, {
      fullName: "Paciente Recibo Padrao",
      phone: "31994445555"
    });

    const paidSession = await createSession(agent, patient.id, {
      scheduledAt: "2026-06-25T18:00:00"
    });

    await agent
      .post(`/api/admin/sessions/${paidSession.id}/mark-paid`)
      .send({ paymentMethod: "pix" })
      .expect(200);

    await agent
      .post(`/api/admin/sessions/${paidSession.id}/receipt`)
      .send({})
      .expect(201);
  } finally {
    await destroyTestContext(restarted);
  }
});

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

test("salva o conteúdo da home no banco e mantém o valor após reiniciar a aplicação", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cv2-admin-"));
  const context = createTestContext(tempRoot);

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    await agent
      .put("/api/admin/content/home")
      .send({
        eyebrow: "Psicóloga clínica",
        title: "<b>Marina</b>",
        subtitle: "Alves",
        body: "Um texto principal atualizado para a home com conteúdo suficiente para passar na validação.",
        ctaLabel: "Falar agora",
        ctaUrl: "#agendar",
        imageUrl: "/assets/portrait-placeholder.svg",
        imageAlt: "Retrato atualizado"
      })
      .expect(200);
  } finally {
    await destroyTestContext(context, { keepFiles: true });
  }

  const restarted = createTestContext(tempRoot);
  try {
    const publicContent = await request(restarted.app).get("/api/public/content").expect(200);

    assert.equal(publicContent.body.data.home.title, "Marina");
    assert.equal(publicContent.body.data.home.ctaLabel, "Falar agora");
    assert.equal(
      publicContent.body.data.home.body,
      "Um texto principal atualizado para a home com conteúdo suficiente para passar na validação."
    );
  } finally {
    await destroyTestContext(restarted);
  }
});

test("mantém uploads acessíveis após reiniciar a aplicação", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cv2-admin-"));
  const context = createTestContext(tempRoot);
  let uploadedUrl = "";

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    const uploadResponse = await agent
      .post("/api/admin/uploads")
      .attach("image", SAMPLE_PNG, {
        filename: "foto.png",
        contentType: "image/png"
      });

    assert.equal(uploadResponse.status, 200, JSON.stringify(uploadResponse.body));

    uploadedUrl = uploadResponse.body.data.url;
    const uploadedFilePath = path.join(context.runtimeConfig.uploadDir, path.basename(uploadedUrl));
    assert.equal(fs.existsSync(uploadedFilePath), true);
  } finally {
    await destroyTestContext(context, { keepFiles: true });
  }

  const restarted = createTestContext(tempRoot);
  try {
    await request(restarted.app).get(uploadedUrl).expect(200).expect("Content-Type", /image\/png/);
  } finally {
    await destroyTestContext(restarted);
  }
});

test("cria, edita, conclui e bloqueia anamnese criptografada e impede edição após bloqueio", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    const patient = await createPatient(agent, { fullName: "Anamnese Teste", email: "ana@example.com" });

    // Resumo inicial: anamnese ausente
    const emptyRecord = await agent
      .get(`/api/admin/patients/${patient.id}/clinical-record`)
      .expect(200);
    assert.equal(emptyRecord.body.data.intake, null);
    assert.equal(emptyRecord.body.data.evolutionsCount, 0);

    // GET intake sem registro retorna template padrão com 6 seções
    const templateResponse = await agent
      .get(`/api/admin/patients/${patient.id}/intake`)
      .expect(200);
    assert.equal(templateResponse.body.data.intake, null);
    assert.equal(templateResponse.body.data.template.sections.length, 6);

    // Cria anamnese (rascunho). Conteúdo clínico é gravado literalmente: é
    // registro legal, e a proteção contra HTML fica na renderização.
    const created = await agent
      .post(`/api/admin/patients/${patient.id}/intake`)
      .send({
        sections: [
          {
            id: "attendance",
            title: "tentativa de renomear",
            items: [
              { id: "main_complaint", answer: "ansiedade <script>alert(1)</script> recorrente" },
              { id: "custom_1", label: "Pergunta extra", answer: "resposta livre" }
            ]
          }
        ]
      })
      .expect(201);

    const intakeId = created.body.data.id;
    assert.equal(created.body.data.status, "draft");
    assert.equal(created.body.data.editable, true);
    const attendance = created.body.data.payload.sections.find((s) => s.id === "attendance");
    assert.equal(attendance.title, "Atendimento"); // seção padrão protegida
    const mainComplaint = attendance.items.find((i) => i.id === "main_complaint");
    // O texto volta exatamente como foi digitado — nada é apagado do prontuário.
    assert.equal(
      mainComplaint.answer,
      "ansiedade <script>alert(1)</script> recorrente"
    );
    assert.ok(attendance.items.some((i) => i.isDefault === false)); // pergunta custom mantida
    // Todas as 6 seções padrão presentes
    assert.equal(created.body.data.payload.sections.length, 6);

    // Conteúdo criptografado no banco não contém texto bruto
    const intakeRow = context.app.locals.dependencies.db
      .prepare("SELECT encrypted_payload FROM clinical_intakes WHERE id = ?")
      .get(intakeId);
    assert.match(intakeRow.encrypted_payload, /^clin:v1:/);
    assert.equal(intakeRow.encrypted_payload.includes("ansiedade"), false);
    assert.equal(intakeRow.encrypted_payload.includes("Atendimento"), false);

    // Atualiza rascunho (gera versão anterior)
    await agent
      .put(`/api/admin/intakes/${intakeId}`)
      .send({ sections: created.body.data.payload.sections })
      .expect(200);
    const versionRow = context.app.locals.dependencies.db
      .prepare("SELECT COUNT(*) AS total FROM clinical_intake_versions WHERE intake_id = ?")
      .get(intakeId);
    assert.equal(versionRow.total, 1);

    // Conclui e bloqueia
    await agent.post(`/api/admin/intakes/${intakeId}/complete`).expect(200);
    await agent.post(`/api/admin/intakes/${intakeId}/lock`).expect(200);

    // Edição após bloqueio é impedida
    const blocked = await agent
      .put(`/api/admin/intakes/${intakeId}`)
      .send({ sections: created.body.data.payload.sections })
      .expect(409);
    assert.match(blocked.body.error, /bloqueada|concluída/i);

    // Exporta PDF da anamnese
    const pdf = await agent.get(`/api/admin/intakes/${intakeId}/export.pdf`).expect(200);
    assert.match(pdf.headers["content-type"], /application\/pdf/);
    assert.equal(Buffer.from(pdf.body).slice(0, 4).toString(), "%PDF");
  } finally {
    await destroyTestContext(context);
  }
});

test("cria evolução vinculada à sessão, lista sem conteúdo, assina, cria adendo e exporta", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    const patient = await createPatient(agent, { fullName: "Evolução Teste", email: "evo@example.com" });
    const session = await createSession(agent, patient.id, { status: "realizada" });

    // Cria evolução vinculada à sessão
    const created = await agent
      .post("/api/admin/evolutions")
      .send({
        patientId: patient.id,
        sessionId: session.id,
        evolutionType: "session",
        title: "Sessão 1",
        content: "Paciente relatou melhora no sono e na rotina."
      })
      .expect(201);
    const evolutionId = created.body.data.id;
    assert.equal(created.body.data.sessionId, session.id);
    assert.equal(created.body.data.status, "draft");
    assert.equal(created.body.data.content, "Paciente relatou melhora no sono e na rotina.");

    // Conteúdo criptografado no banco
    const evoRow = context.app.locals.dependencies.db
      .prepare("SELECT encrypted_content FROM clinical_evolutions WHERE id = ?")
      .get(evolutionId);
    assert.match(evoRow.encrypted_content, /^clin:v1:/);
    assert.equal(evoRow.encrypted_content.includes("melhora"), false);

    // Listagem não retorna conteúdo
    const list = await agent.get(`/api/admin/patients/${patient.id}/evolutions`).expect(200);
    assert.equal(list.body.data.items.length, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(list.body.data.items[0], "content"), false);

    // Abre individual com conteúdo descriptografado
    const detail = await agent.get(`/api/admin/evolutions/${evolutionId}`).expect(200);
    assert.equal(detail.body.data.content, "Paciente relatou melhora no sono e na rotina.");

    // Edita rascunho, depois assina
    await agent
      .put(`/api/admin/evolutions/${evolutionId}`)
      .send({ content: "Paciente relatou melhora significativa." })
      .expect(200);
    await agent.post(`/api/admin/evolutions/${evolutionId}/sign`).expect(200);

    // Editar após assinatura é bloqueado
    const blocked = await agent
      .put(`/api/admin/evolutions/${evolutionId}`)
      .send({ content: "tentativa" })
      .expect(409);
    assert.match(blocked.body.error, /adendo|retifica/i);

    // Cria adendo/retificação -> registro original vira "amended"
    const addendum = await agent
      .post(`/api/admin/evolutions/${evolutionId}/addendum`)
      .send({ content: "Retificação: ajuste de data.", evolutionType: "correction" })
      .expect(201);
    assert.equal(addendum.body.data.parentEvolutionId, evolutionId);
    const parent = await agent.get(`/api/admin/evolutions/${evolutionId}`).expect(200);
    assert.equal(parent.body.data.status, "amended");

    // Exporta PDF da evolução
    const pdf = await agent.get(`/api/admin/evolutions/${evolutionId}/export.pdf`).expect(200);
    assert.equal(Buffer.from(pdf.body).slice(0, 4).toString(), "%PDF");

    // Resumo do prontuário não retorna conteúdo clínico, mas conta evoluções
    const record = await agent
      .get(`/api/admin/patients/${patient.id}/clinical-record`)
      .expect(200);
    assert.equal(record.body.data.evolutionsCount, 2);
    assert.ok(record.body.data.latestEvolution);
    assert.equal(Object.prototype.hasOwnProperty.call(record.body.data.latestEvolution, "content"), false);
    assert.equal(JSON.stringify(record.body.data).includes("melhora"), false);

    // Exporta prontuário completo
    const recordPdf = await agent
      .get(`/api/admin/patients/${patient.id}/clinical-record/export.pdf`)
      .expect(200);
    assert.equal(Buffer.from(recordPdf.body).slice(0, 4).toString(), "%PDF");
  } finally {
    await destroyTestContext(context);
  }
});

test("auditoria clínica registra ações sem conteúdo e conteúdo clínico não vaza para outros módulos", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    const patient = await createPatient(agent, { fullName: "Sigilo Teste", email: "sig@example.com" });

    const intake = await agent
      .post(`/api/admin/patients/${patient.id}/intake`)
      .send({
        sections: [
          { id: "attendance", items: [{ id: "main_complaint", answer: "segredo-clinico-xyz" }] }
        ]
      })
      .expect(201);
    await agent.get(`/api/admin/patients/${patient.id}/intake`).expect(200); // viewed
    const evolution = await agent
      .post("/api/admin/evolutions")
      .send({ patientId: patient.id, content: "anotacao-secreta-abc" })
      .expect(201);
    await agent.get(`/api/admin/evolutions/${evolution.body.data.id}`).expect(200); // viewed

    // Auditoria contém ações clínicas, sem texto digitado
    const auditRows = context.app.locals.dependencies.db
      .prepare("SELECT action, summary, metadata_json FROM audit_logs WHERE entity_type LIKE 'clinical%'")
      .all();
    assert.ok(auditRows.some((row) => row.action === "clinical_intake_created"));
    assert.ok(auditRows.some((row) => row.action === "clinical_intake_viewed"));
    assert.ok(auditRows.some((row) => row.action === "clinical_evolution_created"));
    for (const row of auditRows) {
      const blob = `${row.summary}${row.metadata_json}`;
      assert.equal(blob.includes("segredo-clinico-xyz"), false);
      assert.equal(blob.includes("anotacao-secreta-abc"), false);
    }

    // Dashboard, financeiro e modelos de mensagem não expõem conteúdo clínico
    const dashboard = await agent.get("/api/admin/dashboard-summary").expect(200);
    assert.equal(JSON.stringify(dashboard.body).includes("segredo-clinico-xyz"), false);
    const finance = await agent.get("/api/admin/finance/summary").expect(200);
    assert.equal(JSON.stringify(finance.body).includes("anotacao-secreta-abc"), false);
    const templates = await agent.get("/api/admin/message-templates").expect(200);
    assert.equal(JSON.stringify(templates.body).includes("segredo-clinico-xyz"), false);
  } finally {
    await destroyTestContext(context);
  }
});

test("rotas clínicas exigem autenticação de administrador", async () => {
  const context = createTestContext();

  try {
    await request(context.app).get("/api/admin/patients/1/clinical-record").expect(401);
    await request(context.app).get("/api/admin/patients/1/intake").expect(401);
    await request(context.app).post("/api/admin/patients/1/intake").send({ sections: [] }).expect(401);
    await request(context.app).get("/api/admin/patients/1/evolutions").expect(401);
    await request(context.app).post("/api/admin/evolutions").send({ patientId: 1 }).expect(401);
    await request(context.app).get("/api/admin/evolutions/1").expect(401);
  } finally {
    await destroyTestContext(context);
  }
});

test("bloqueia rotas clínicas em produção sem TOKEN_ENCRYPTION_KEY", async () => {
  const context = createTestContext(undefined, {
    nodeEnv: "production",
    isProduction: true,
    tokenEncryptionKey: ""
  });

  try {
    const loginResponse = await request(context.app)
      .post("/api/admin/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);
    const cookieHeader = (loginResponse.headers["set-cookie"] || [])
      .map((cookie) => cookie.split(";")[0])
      .join("; ");

    const patientResponse = await request(context.app)
      .post("/api/admin/patients")
      .set("Cookie", cookieHeader)
      .send({
        fullName: "Sem Chave",
        preferredName: "Sem",
        birthDate: "1990-01-01",
        age: 36,
        phone: "31988887777",
        email: "",
        patientType: "adulto",
        guardianName: "",
        guardianPhone: "",
        sessionPrice: 100,
        defaultWeekday: "",
        defaultTime: "",
        modality: "online",
        status: "ativo",
        administrativeNote: ""
      })
      .expect(201);
    const patientId = patientResponse.body.data.id;

    const intakeAttempt = await request(context.app)
      .post(`/api/admin/patients/${patientId}/intake`)
      .set("Cookie", cookieHeader)
      .send({ sections: [] })
      .expect(500);
    assert.match(intakeAttempt.body.error, /TOKEN_ENCRYPTION_KEY/i);
  } finally {
    await destroyTestContext(context);
  }
});

test("recusa conteúdo clínico em branco e mantém legível o que já foi gravado vazio", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    const patient = await createPatient(agent, { fullName: "Conteúdo Vazio" });

    // Evolução em branco é recusada na criação e na edição.
    const recusada = await agent
      .post("/api/admin/evolutions")
      .send({ patientId: patient.id, content: "   " })
      .expect(400);
    assert.match(recusada.body.error, /conteúdo da evolução/i);

    const criada = await agent
      .post("/api/admin/evolutions")
      .send({ patientId: patient.id, content: "Registro inicial da sessão." })
      .expect(201);

    await agent
      .put(`/api/admin/evolutions/${criada.body.data.id}`)
      .send({ content: "" })
      .expect(400);

    // Nenhuma versão órfã foi gravada pela tentativa recusada.
    const versoes = context.app.locals.dependencies.db
      .prepare("SELECT COUNT(*) AS total FROM clinical_evolution_versions WHERE evolution_id = ?")
      .get(criada.body.data.id);
    assert.equal(versoes.total, 0);

    // Registro gravado vazio antes da correção continua legível, não vira 500.
    const vazio = encryptClinicalText("", context.runtimeConfig);
    context.app.locals.dependencies.db
      .prepare("UPDATE clinical_evolutions SET encrypted_content = ? WHERE id = ?")
      .run(vazio, criada.body.data.id);

    const lida = await agent.get(`/api/admin/evolutions/${criada.body.data.id}`).expect(200);
    assert.equal(lida.body.data.content, "");

    // E o prontuário completo continua exportando.
    const pdf = await agent
      .get(`/api/admin/patients/${patient.id}/clinical-record/export.pdf`)
      .expect(200);
    assert.equal(Buffer.from(pdf.body).slice(0, 4).toString(), "%PDF");
  } finally {
    await destroyTestContext(context);
  }
});

test("exporta prontuário com emoji e acento decomposto sem derrubar o PDF", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    const patient = await createPatient(agent, {
      fullName: "Ana " + "Conceição".normalize("NFD")
    });

    const criada = await agent
      .post("/api/admin/evolutions")
      .send({
        patientId: patient.id,
        title: "Sessão 😔",
        content: "Paciente relatou 👍🏽 melhora. Anotação " + "ã".normalize("NFD") + " e 漢字."
      })
      .expect(201);

    const evolucaoPdf = await agent
      .get(`/api/admin/evolutions/${criada.body.data.id}/export.pdf`)
      .expect(200);
    assert.equal(Buffer.from(evolucaoPdf.body).slice(0, 4).toString(), "%PDF");

    const prontuarioPdf = await agent
      .get(`/api/admin/patients/${patient.id}/clinical-record/export.pdf`)
      .expect(200);
    assert.equal(Buffer.from(prontuarioPdf.body).slice(0, 4).toString(), "%PDF");
  } finally {
    await destroyTestContext(context);
  }
});

test("recusa excluir paciente com prontuário assinado e registra a destruição de rascunho", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    // Paciente sem prontuário: exclusão segue permitida.
    const semProntuario = await createPatient(agent, { fullName: "Sem Prontuário" });
    await agent.delete(`/api/admin/patients/${semProntuario.id}`).expect(200);

    // Paciente com evolução assinada: exclusão é recusada.
    const comProntuario = await createPatient(agent, { fullName: "Com Prontuário" });
    const evolucao = await agent
      .post("/api/admin/evolutions")
      .send({ patientId: comProntuario.id, content: "Primeira sessão registrada." })
      .expect(201);
    await agent.post(`/api/admin/evolutions/${evolucao.body.data.id}/sign`).expect(200);

    const recusado = await agent.delete(`/api/admin/patients/${comProntuario.id}`).expect(409);
    assert.match(recusado.body.error, /encerrado/i);

    // O paciente e a evolução continuam lá.
    const aindaExiste = context.app.locals.dependencies.db
      .prepare("SELECT COUNT(*) AS total FROM clinical_evolutions WHERE patient_id = ?")
      .get(comProntuario.id);
    assert.equal(aindaExiste.total, 1);

    // Paciente só com rascunho: exclusão passa, mas deixa log próprio.
    const soRascunho = await createPatient(agent, { fullName: "Só Rascunho" });
    await agent
      .post("/api/admin/evolutions")
      .send({ patientId: soRascunho.id, content: "Rascunho ainda não assinado." })
      .expect(201);
    await agent.delete(`/api/admin/patients/${soRascunho.id}`).expect(200);

    const logs = await agent.get("/api/admin/audit-logs").expect(200);
    const destruicao = logs.body.data.items.find(
      (item) => item.action === "clinical_record_destroyed"
    );
    assert.ok(destruicao, "esperava log clinical_record_destroyed");
    assert.equal(destruicao.entityId, String(soRascunho.id));
  } finally {
    await destroyTestContext(context);
  }
});

test("adendo em evolução bloqueada preserva o bloqueio e ainda sinaliza a retificação", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    const patient = await createPatient(agent, { fullName: "Bloqueio Teste" });

    const criada = await agent
      .post("/api/admin/evolutions")
      .send({ patientId: patient.id, content: "Registro que será bloqueado." })
      .expect(201);
    const id = criada.body.data.id;

    await agent.post(`/api/admin/evolutions/${id}/sign`).expect(200);
    await agent.post(`/api/admin/evolutions/${id}/lock`).expect(200);

    await agent
      .post(`/api/admin/evolutions/${id}/addendum`)
      .send({ content: "Retificação registrada depois do bloqueio." })
      .expect(201);

    const lista = await agent.get(`/api/admin/patients/${patient.id}/evolutions`).expect(200);
    const original = lista.body.data.items.find((item) => String(item.id) === String(id));

    assert.equal(original.status, "locked");
    assert.ok(original.lockedAt);
    assert.equal(original.hasAmendments, true);
  } finally {
    await destroyTestContext(context);
  }
});

test("anamnese fora da janela de edição não é anunciada como editável", async () => {
  // Janela de zero hora é tratada como "sem limite", então usamos um valor
  // mínimo e envelhecemos o registro direto no banco.
  const context = createTestContext(undefined, { clinicalRecordEditWindowHours: 1 });

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    const patient = await createPatient(agent, { fullName: "Janela Anamnese" });

    const criada = await agent
      .post(`/api/admin/patients/${patient.id}/intake`)
      .send({ sections: [] })
      .expect(201);
    assert.equal(criada.body.data.editable, true);

    // Envelhece a anamnese para além da janela.
    const antiga = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    context.app.locals.dependencies.db
      .prepare("UPDATE clinical_intakes SET created_at = ? WHERE id = ?")
      .run(antiga, criada.body.data.id);

    const lida = await agent.get(`/api/admin/patients/${patient.id}/intake`).expect(200);
    assert.equal(lida.body.data.intake.status, "draft");
    // A API não pode prometer uma edição que o servidor vai recusar.
    assert.equal(lida.body.data.intake.editable, false);
    assert.ok(lida.body.data.intake.editableUntil);

    await agent
      .put(`/api/admin/intakes/${criada.body.data.id}`)
      .send({ sections: [] })
      .expect(409);
  } finally {
    await destroyTestContext(context);
  }
});

test("pergunta personalizada com id repetido é mantida em vez de descartada", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    const patient = await createPatient(agent, { fullName: "Id Repetido" });

    const criada = await agent
      .post(`/api/admin/patients/${patient.id}/intake`)
      .send({
        sections: [
          {
            id: "attendance",
            title: "Atendimento",
            items: [
              { id: "custom_1", label: "Primeira pergunta", answer: "resposta A", isDefault: false },
              { id: "custom_1", label: "Segunda pergunta", answer: "resposta B", isDefault: false }
            ]
          }
        ]
      })
      .expect(201);

    const attendance = criada.body.data.payload.sections.find((s) => s.id === "attendance");
    const personalizadas = attendance.items.filter((item) => item.isDefault === false);

    assert.equal(personalizadas.length, 2);
    assert.deepEqual(
      personalizadas.map((item) => item.answer).sort(),
      ["resposta A", "resposta B"]
    );
    // Ids reatribuídos precisam ser únicos, senão a próxima gravação repete o problema.
    assert.equal(new Set(personalizadas.map((item) => item.id)).size, 2);
  } finally {
    await destroyTestContext(context);
  }
});

test("mapper do Postgres normaliza ids que o driver devolve como string", () => {
  const {
    mapEvolutionRow,
    mapIntakeRow
  } = require("../src/repositories/postgres-clinical-repository");

  // BIGSERIAL volta como string no postgres.js e como número no SQLite; sem
  // normalizar, o vínculo adendo -> original só quebra em produção.
  const original = mapEvolutionRow({
    id: "5",
    patientId: "3",
    sessionId: null,
    parentEvolutionId: null,
    createdByAdminId: null
  });
  const adendo = mapEvolutionRow({
    id: "7",
    patientId: "3",
    sessionId: "11",
    parentEvolutionId: "5",
    createdByAdminId: "1"
  });

  assert.equal(original.id, 5);
  assert.equal(original.patientId, 3);
  assert.equal(adendo.parentEvolutionId, original.id);
  assert.equal(adendo.sessionId, 11);
  assert.equal(original.sessionId, null);

  assert.equal(mapIntakeRow({ id: "9", patientId: "3", createdByAdminId: null }).id, 9);
  assert.equal(mapEvolutionRow(null), null);
  assert.equal(mapIntakeRow(null), null);
});

test("lista recibos por competência e por caixa, e não recorta o mês sem período pedido", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    const patient = await createPatient(agent, { fullName: "Regime Apuração" });

    // Atendimento em junho, pago só em agosto: os dois meses precisam ser
    // consultáveis, cada um pelo seu regime.
    const session = await createSession(agent, patient.id, { scheduledAt: "2026-06-21T18:00:00" });
    await agent
      .post(`/api/admin/sessions/${session.id}/mark-paid`)
      .send({ paymentMethod: "pix", paidAt: "2026-08-15T10:00:00" })
      .expect(200);
    await agent.post(`/api/admin/sessions/${session.id}/receipt`).send({}).expect(201);

    const porCompetencia = (mes) =>
      agent.get(`/api/admin/receipts?month=${mes}&year=2026&basis=competencia`).expect(200);
    const porCaixa = (mes) =>
      agent.get(`/api/admin/receipts?month=${mes}&year=2026&basis=caixa`).expect(200);

    assert.equal((await porCompetencia(6)).body.data.items.length, 1);
    assert.equal((await porCompetencia(8)).body.data.items.length, 0);
    assert.equal((await porCaixa(8)).body.data.items.length, 1);
    assert.equal((await porCaixa(6)).body.data.items.length, 0);

    // Competência é o padrão quando o regime não é informado.
    const semRegime = await agent.get("/api/admin/receipts?month=6&year=2026").expect(200);
    assert.equal(semRegime.body.data.items.length, 1);
    assert.equal(semRegime.body.data.filters.basis, "competencia");

    // Regime inválido cai no padrão em vez de virar coluna arbitrária.
    const invalido = await agent
      .get("/api/admin/receipts?month=6&year=2026&basis=r.id; DROP TABLE receipts")
      .expect(200);
    assert.equal(invalido.body.data.filters.basis, "competencia");
    assert.equal(invalido.body.data.items.length, 1);

    // Sem mês/ano pedidos, buscar por paciente não pode aplicar a janela do mês
    // corrente em silêncio — o recibo de junho tem de aparecer.
    const porPaciente = await agent
      .get(`/api/admin/receipts?patientId=${patient.id}`)
      .expect(200);
    assert.equal(porPaciente.body.data.items.length, 1);

    const porSessao = await agent
      .get(`/api/admin/receipts?sessionId=${session.id}`)
      .expect(200);
    assert.equal(porSessao.body.data.items.length, 1);
  } finally {
    await destroyTestContext(context);
  }
});

test("relatórios fecham o mês pelo calendário da clínica, não pelo do servidor", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    const patient = await createPatient(agent, { fullName: "Sessão Noturna" });

    // 30/06 às 21h no fuso da clínica vira 01/07T00:00Z: com a janela em UTC,
    // a sessão caía no fechamento de julho.
    const session = await createSession(agent, patient.id, {
      scheduledAt: "2026-06-30T21:00",
      status: "realizada"
    });

    const gravada = context.app.locals.dependencies.db
      .prepare("SELECT scheduled_at FROM clinic_sessions WHERE id = ?")
      .get(session.id);
    assert.equal(gravada.scheduled_at, "2026-07-01T00:00:00.000Z");

    const junho = await agent
      .get("/api/admin/finance/summary?month=6&year=2026")
      .expect(200);
    assert.equal(junho.body.data.summary.completedSessions, 1);

    const julho = await agent
      .get("/api/admin/finance/summary?month=7&year=2026")
      .expect(200);
    assert.equal(julho.body.data.summary.completedSessions, 0);

    // O filtro "até 30/06" também precisa alcançar a sessão das 21h.
    const filtrada = await agent
      .get("/api/admin/sessions?dateFrom=2026-06-30&dateTo=2026-06-30")
      .expect(200);
    assert.equal(filtrada.body.data.items.length, 1);
  } finally {
    await destroyTestContext(context);
  }
});

test("protege recibo emitido contra exclusão e nunca repete o número", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    const patient = await createPatient(agent, { fullName: "Recibo Protegido" });

    const session = await createSession(agent, patient.id);
    await agent.post(`/api/admin/sessions/${session.id}/mark-paid`).send({ paymentMethod: "pix" }).expect(200);
    const recibo = await agent.post(`/api/admin/sessions/${session.id}/receipt`).send({}).expect(201);
    assert.equal(recibo.body.data.receiptNumber, "REC-000001");

    // Excluir a sessão apagaria o recibo em cascata e deixaria o PDF órfão.
    const sessaoRecusada = await agent.delete(`/api/admin/sessions/${session.id}`).expect(409);
    assert.match(sessaoRecusada.body.error, /REC-000001/);

    // Excluir o paciente teria o mesmo efeito, por outro caminho.
    const pacienteRecusado = await agent.delete(`/api/admin/patients/${patient.id}`).expect(409);
    assert.match(pacienteRecusado.body.error, /recibo/i);

    // Mesmo que um recibo suma do banco, o número dele não volta ao pool.
    context.app.locals.dependencies.db
      .prepare("DELETE FROM receipts WHERE id = ?")
      .run(recibo.body.data.id);

    const outraSessao = await createSession(agent, patient.id);
    await agent.post(`/api/admin/sessions/${outraSessao.id}/mark-paid`).send({ paymentMethod: "pix" }).expect(200);
    const segundo = await agent.post(`/api/admin/sessions/${outraSessao.id}/receipt`).send({}).expect(201);

    assert.notEqual(segundo.body.data.receiptNumber, recibo.body.data.receiptNumber);
    assert.equal(segundo.body.data.receiptNumber, "REC-000002");
  } finally {
    await destroyTestContext(context);
  }
});

test("marcar como pago preserva a forma de pagamento já registrada", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    const patient = await createPatient(agent, { fullName: "Forma de Pagamento" });
    const session = await createSession(agent, patient.id, { paymentMethod: "cartao" });

    // Corpo vazio: o servidor não pode assumir Pix por conta própria.
    const pago = await agent
      .post(`/api/admin/sessions/${session.id}/mark-paid`)
      .send({})
      .expect(200);
    assert.equal(pago.body.data.paymentMethod, "cartao");
    assert.equal(pago.body.data.paymentStatus, "pago");
    assert.ok(pago.body.data.paidAt);

    // Quando a forma vem no corpo, ela vale.
    const trocado = await agent
      .post(`/api/admin/sessions/${session.id}/mark-paid`)
      .send({ paymentMethod: "dinheiro" })
      .expect(200);
    assert.equal(trocado.body.data.paymentMethod, "dinheiro");
  } finally {
    await destroyTestContext(context);
  }
});

test("CSV do financeiro neutraliza fórmula e sai com BOM", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    const patient = await createPatient(agent, {
      fullName: "=cmd|'/c calc'!A1 Conceição"
    });
    await createSession(agent, patient.id);

    const csv = await agent.get("/api/admin/finance/export.csv?month=6&year=2026").expect(200);
    const texto = csv.text;

    // BOM na frente, senão o Excel corrompe os acentos.
    assert.equal(texto.charCodeAt(0), 0xfeff);
    // A célula não pode começar com '=', senão a planilha executa ao abrir.
    assert.ok(texto.includes(`"'=cmd`));
    assert.ok(texto.includes("Conceição"));
  } finally {
    await destroyTestContext(context);
  }
});

test("recibo em storage local fica fora de /uploads e não é baixável sem autenticação", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    const patient = await createPatient(agent, { fullName: "Recibo Privado" });
    const session = await createSession(agent, patient.id);
    await agent.post(`/api/admin/sessions/${session.id}/mark-paid`).send({ paymentMethod: "pix" }).expect(200);
    await agent.post(`/api/admin/sessions/${session.id}/receipt`).send({}).expect(201);

    const linha = context.app.locals.dependencies.db
      .prepare("SELECT file_object_key AS k, file_storage_provider AS p FROM receipts LIMIT 1")
      .get();
    assert.equal(linha.p, "local");

    // O PDF não pode existir dentro do diretório publicado por express.static.
    const dentroDeUploads = path.join(context.runtimeConfig.uploadDir, linha.k);
    assert.equal(fs.existsSync(dentroDeUploads), false);

    // E precisa existir na raiz privada, irmã de uploads.
    const raizPrivada = path.join(
      path.dirname(path.resolve(context.runtimeConfig.uploadDir)),
      "private-documents"
    );
    assert.equal(fs.existsSync(path.join(raizPrivada, linha.k)), true);

    // A URL estática não pode servir o documento.
    const anonimo = request(context.app);
    const resposta = await anonimo.get(`/uploads/${linha.k}`);
    assert.notEqual(resposta.status, 200);

    // A rota autenticada continua entregando.
    const recibos = await agent.get("/api/admin/receipts").expect(200);
    const baixado = await agent
      .get(`/api/admin/receipts/${recibos.body.data.items[0].id}/download`)
      .expect(200);
    assert.equal(Buffer.from(baixado.body).slice(0, 4).toString(), "%PDF");
  } finally {
    await destroyTestContext(context);
  }
});

test("recibo gravado no local antigo continua baixável pela rota autenticada", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    const patient = await createPatient(agent, { fullName: "Recibo Legado" });
    const session = await createSession(agent, patient.id);
    await agent.post(`/api/admin/sessions/${session.id}/mark-paid`).send({ paymentMethod: "pix" }).expect(200);
    await agent.post(`/api/admin/sessions/${session.id}/receipt`).send({}).expect(201);

    const linha = context.app.locals.dependencies.db
      .prepare("SELECT id, file_object_key AS k FROM receipts LIMIT 1")
      .get();
    const raizPrivada = path.join(
      path.dirname(path.resolve(context.runtimeConfig.uploadDir)),
      "private-documents"
    );

    // Simula um recibo emitido antes da separação: move o arquivo para dentro
    // de uploads, como era gravado antes.
    const antigo = path.join(context.runtimeConfig.uploadDir, linha.k);
    fs.mkdirSync(path.dirname(antigo), { recursive: true });
    fs.renameSync(path.join(raizPrivada, linha.k), antigo);

    const baixado = await agent.get(`/api/admin/receipts/${linha.id}/download`).expect(200);
    assert.equal(Buffer.from(baixado.body).slice(0, 4).toString(), "%PDF");
  } finally {
    await destroyTestContext(context);
  }
});

test("logout invalida os tokens já emitidos, não só o cookie do navegador", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    const login = await loginAsAdmin(agent);

    // Guarda o cookie como um atacante que o tivesse capturado.
    const cookieCapturado = login.headers["set-cookie"]
      .map((c) => c.split(";")[0])
      .join("; ");

    const anonimo = request(context.app);
    await anonimo
      .get("/api/admin/patients")
      .set("Cookie", cookieCapturado)
      .expect(200);

    await agent.post("/api/admin/logout").expect(200);

    // O mesmo cookie, ainda dentro da validade, precisa deixar de valer.
    const depois = await anonimo
      .get("/api/admin/patients")
      .set("Cookie", cookieCapturado)
      .expect(401);
    assert.match(depois.body.error, /sessão encerrada/i);

    // E a página do painel volta para o login em vez de abrir.
    await anonimo
      .get("/admin/dashboard")
      .set("Cookie", cookieCapturado)
      .expect(302)
      .expect("Location", "/admin/login");

    // Entrar de novo funciona normalmente.
    await loginAsAdmin(request.agent(context.app));
  } finally {
    await destroyTestContext(context);
  }
});

test("bloqueia o login após tentativas repetidas e libera após um acesso válido", async () => {
  const context = createTestContext(undefined, {
    loginThrottle: { maxTentativas: 3, escadaDeBloqueioMs: [60000] }
  });

  try {
    const anonimo = request(context.app);
    const tentativaErrada = () =>
      anonimo
        .post("/api/admin/login")
        .send({ email: ADMIN_EMAIL, password: "senha-errada-123" });

    // As duas primeiras falhas são recusa comum; a terceira dispara o bloqueio.
    await tentativaErrada().expect(401);
    await tentativaErrada().expect(401);

    const bloqueado = await tentativaErrada().expect(429);
    assert.match(bloqueado.body.error, /muitas tentativas/i);
    assert.ok(Number(bloqueado.headers["retry-after"]) > 0);

    // Do mesmo IP, nem a senha certa passa: o excesso veio de lá.
    await anonimo
      .post("/api/admin/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(429);

    // De outro endereço, senha ERRADA segue barrada: é a chave de e-mail que
    // contém quem troca de IP para adivinhar a senha de um alvo conhecido.
    await anonimo
      .post("/api/admin/login")
      .set("X-Forwarded-For", "203.0.113.9")
      .send({ email: ADMIN_EMAIL, password: "senha-errada-123" })
      .expect(429);

    // Mas de outro endereço a senha CERTA entra. Sem isso, alguém errando a
    // senha de propósito trancaria a única administradora fora do painel — não
    // há segundo admin nem caminho de recuperação neste produto.
    const deOutroIp = await anonimo
      .post("/api/admin/login")
      .set("X-Forwarded-For", "203.0.113.7")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);
    assert.ok(deOutroIp.headers["set-cookie"]);

    // O acesso válido zera os contadores: a próxima tentativa recomeça do zero.
    await anonimo
      .post("/api/admin/login")
      .set("X-Forwarded-For", "203.0.113.9")
      .send({ email: ADMIN_EMAIL, password: "senha-errada-123" })
      .expect(401);

    // Toda tentativa que chegou a verificar a senha deixou rastro (as cinco com
    // senha errada), inclusive as que dispararam o bloqueio. A tentativa negada
    // pelo IP antes da verificação não entra: é justamente o que evita a tabela
    // de auditoria crescer sob ataque.
    const falhas = context.app.locals.dependencies.db
      .prepare(
        "SELECT COUNT(*) AS total FROM audit_logs WHERE action = 'login_failed'"
      )
      .get();
    assert.equal(falhas.total, 5);
  } finally {
    await destroyTestContext(context);
  }
});

test("resposta de login não denuncia se o e-mail existe", async () => {
  const context = createTestContext();

  try {
    const anonimo = request(context.app);

    const inexistente = await anonimo
      .post("/api/admin/login")
      .send({ email: "ninguem@example.com", password: "qualquer-senha-123" })
      .expect(401);

    const existente = await anonimo
      .post("/api/admin/login")
      .send({ email: ADMIN_EMAIL, password: "senha-errada-123" })
      .expect(401);

    // Mesma mensagem para os dois casos.
    assert.equal(inexistente.body.error, existente.body.error);

    // O tempo de resposta também não pode diferenciar os dois. Medir latência
    // em teste é instável, então cobrimos o mecanismo: o caminho "e-mail não
    // existe" precisa gastar exatamente UM PBKDF2, igual ao caminho em que o
    // e-mail existe.
    const {
      PASSWORD_ITERATIONS,
      buildDecoyPasswordRecord,
      verifyPassword
    } = require("../src/lib/password");

    const isca = buildDecoyPasswordRecord();
    assert.equal(isca.password_iterations, PASSWORD_ITERATIONS);
    assert.ok(isca.password_salt && isca.password_hash);
    assert.equal(verifyPassword("qualquer-senha-123", isca), false);

    // A isca é reaproveitada de propósito: construí-la roda um PBKDF2, e fazer
    // isso a cada tentativa dobrava o custo do caminho "e-mail não existe" —
    // o que mantinha o oráculo de tempo aberto, apenas invertido. Reusar não
    // vaza nada: o valor nunca sai do servidor e a senha é aleatória.
    assert.equal(buildDecoyPasswordRecord().password_hash, isca.password_hash);
  } finally {
    await destroyTestContext(context);
  }
});

test("busca trata % e _ como texto, não como curinga", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    await createPatient(agent, { fullName: "Ana Souza" });
    await createPatient(agent, { fullName: "Bruno 100% Presente" });
    await createPatient(agent, { fullName: "Carla_Dias" });

    // Antes, buscar "%" listava todo mundo.
    const curinga = await agent.get("/api/admin/patients?search=%25").expect(200);
    assert.equal(curinga.body.data.items.length, 1);
    assert.match(curinga.body.data.items[0].fullName, /Bruno/);

    // E "_" casava qualquer caractere.
    const sublinhado = await agent.get("/api/admin/patients?search=a_D").expect(200);
    assert.equal(sublinhado.body.data.items.length, 1);
    assert.match(sublinhado.body.data.items[0].fullName, /Carla/);

    // Busca normal segue funcionando.
    const normal = await agent.get("/api/admin/patients?search=Ana").expect(200);
    assert.equal(normal.body.data.items.length, 1);
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

test("migrações SQLite e Postgres não divergem", () => {
  // O schema tem duas fontes independentes: os arquivos .sql (SQLite) e a
  // constante POSTGRES_MIGRATIONS escrita à mão. Uma migração adicionada só de
  // um lado roda em desenvolvimento e nunca em produção, sem nenhum aviso.
  const dir = path.join(__dirname, "..", "src", "db", "migrations");
  const arquivos = fs
    .readdirSync(dir)
    .filter((nome) => nome.endsWith(".sql"))
    .sort()
    .map((nome) => nome.replace(/.sql$/, ""));

  const fonte = fs.readFileSync(
    path.join(__dirname, "..", "src", "db", "run-migrations.js"),
    "utf8"
  );
  const declaradas = [...fonte.matchAll(/name: "([^"]+)"/g)].map((m) => m[1]);

  assert.deepEqual(
    declaradas,
    arquivos,
    "POSTGRES_MIGRATIONS precisa listar as mesmas migrações, na mesma ordem, que os arquivos .sql"
  );
});

test("cookie malformado de terceiro não derruba o site nem o painel", async () => {
  const context = createTestContext();

  try {
    const anonimo = request(context.app);
    const cookieDeTerceiro = "_ga=GA1.1.x; promo=50%off";

    // Um % solto em cookie alheio fazia TODA rota responder 500, landing inclusive.
    await anonimo.get("/").set("Cookie", cookieDeTerceiro).expect(200);
    await anonimo.get("/admin/login").set("Cookie", cookieDeTerceiro).expect(200);
    await anonimo.get("/api/public/content").set("Cookie", cookieDeTerceiro).expect(200);

    // E a sessão válida continua sendo reconhecida ao lado do cookie estragado.
    const agent = request.agent(context.app);
    const login = await loginAsAdmin(agent);
    const sessao = login.headers["set-cookie"].map((c) => c.split(";")[0]).join("; ");
    await anonimo
      .get("/api/admin/patients")
      .set("Cookie", `${cookieDeTerceiro}; ${sessao}`)
      .expect(200);
  } finally {
    await destroyTestContext(context);
  }
});

test("erros de biblioteca preservam o próprio status em vez de virar 500", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    // Corpo JSON malformado é 400 do body-parser, não erro do servidor.
    await agent
      .post("/api/admin/patients")
      .set("Content-Type", "application/json")
      .send("{ isso nao e json")
      .expect(400);

    // Data malformada no filtro de auditoria não pode derrubar a rota.
    const auditoria = await agent.get("/api/admin/audit-logs?date=nao-e-data").expect(200);
    assert.ok(Array.isArray(auditoria.body.data.items));
  } finally {
    await destroyTestContext(context);
  }
});

test("migração interrompida não deixa schema pela metade", async () => {
  const Database = require("better-sqlite3");
  const { runMigrations } = require("../src/db/run-migrations");

  // A migração inválida vai para uma cópia temporária do diretório, nunca para
  // src/db/migrations do repositório: um teste interrompido no meio deixaria o
  // arquivo lá e travaria o boot de quem rodasse o projeto depois.
  const dirOriginal = path.join(__dirname, "..", "src", "db", "migrations");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cv2-mig-"));
  const dir = path.join(tempRoot, "migrations");
  fs.cpSync(dirOriginal, dir, { recursive: true });
  const arquivoRuim = path.join(dir, "999_teste_transacao.sql");
  const db = new Database(path.join(tempRoot, "app.db"));
  db.kind = "sqlite";
  db.migrationsDir = dir;

  try {
    await runMigrations(db);

    // Migração cuja primeira instrução é válida e a segunda não.
    fs.writeFileSync(
      arquivoRuim,
      "CREATE TABLE zzz_parcial (id INTEGER);" + String.fromCharCode(10) + "ISSO NAO E SQL;"
    );

    await assert.rejects(() => runMigrations(db));

    // Nada da migração pode ter sobrado, senão o boot seguinte trava para sempre
    // (o SQLite não tem ADD COLUMN IF NOT EXISTS).
    const tabela = db
      .prepare("SELECT COUNT(*) AS total FROM sqlite_master WHERE name = ?")
      .get("zzz_parcial");
    assert.equal(tabela.total, 0);

    const registrada = db
      .prepare("SELECT COUNT(*) AS total FROM _migrations WHERE name = ?")
      .get("999_teste_transacao.sql");
    assert.equal(registrada.total, 0);
  } finally {
    db.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("texto do site é guardado literalmente e não chega escapado duas vezes", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    const conteudo = await agent.get("/api/admin/content").expect(200);
    const home = conteudo.body.data.home;

    await agent
      .put("/api/admin/content/home")
      .send({
        ...home,
        title: "Acolhimento & escuta",
        subtitle: "5 < 10 pessoas por semana"
      })
      .expect(200);

    const publico = await agent.get("/api/public/content").expect(200);
    assert.equal(publico.body.data.home.title, "Acolhimento & escuta");
    assert.equal(publico.body.data.home.subtitle, "5 < 10 pessoas por semana");

    // Markup continua sendo removido — o que muda é só o escape duplo.
    await agent
      .put("/api/admin/content/home")
      .send({ ...home, title: "Titulo <script>alert(1)</script> limpo" })
      .expect(200);
    const semScript = await agent.get("/api/public/content").expect(200);
    assert.equal(semScript.body.data.home.title.includes("<script>"), false);
  } finally {
    await destroyTestContext(context);
  }
});

test("card de ajuda aceita imagem do storage externo configurado", async () => {
  const prefixo = "https://projeto.supabase.co/storage/v1/object/public/site-images/";
  const context = createTestContext(undefined, {
    allowedExternalImagePrefixes: [prefixo]
  });

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    const conteudo = await agent.get("/api/admin/content").expect(200);

    const salvo = await agent
      .put("/api/admin/content/help")
      .send({
        eyebrow: conteudo.body.data.help.eyebrow,
        title: conteudo.body.data.help.title,
        cards: [
          {
            title: "Card com imagem",
            description: "Descrição suficientemente longa.",
            assetType: "image",
            assetValue: `${prefixo}site/exemplo.webp`,
            sortOrder: 1
          }
        ]
      })
      .expect(200);

    const card = salvo.body.data.help.cards[0];
    assert.equal(card.assetType, "image");
    assert.equal(card.assetValue, `${prefixo}site/exemplo.webp`);
  } finally {
    await destroyTestContext(context);
  }
});

test("página inicial traz o SEO configurado já no HTML servido", async () => {
  // Com SITE_URL definida, og:image precisa sair como URL absoluta: crawler de
  // prévia não resolve caminho relativo.
  const context = createTestContext(undefined, { siteUrl: "https://exemplo.com" });

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    await agent
      .put("/api/admin/content/seo")
      .send({
        title: "Marina Alves | Psicóloga em BH",
        description: "Atendimento on-line e presencial para adultos e adolescentes.",
        shareImageUrl: "/uploads/compartilhamento.png"
      })
      .expect(200);

    const html = (await request(context.app).get("/").expect(200)).text;

    // Crawlers de prévia não executam JS: isso precisa estar no HTML servido.
    assert.ok(html.includes("<title>Marina Alves | Psicóloga em BH</title>"));
    assert.ok(html.includes("Atendimento on-line e presencial"));
    assert.ok(html.includes('property="og:image"'));
    assert.ok(
      html.includes('content="https://exemplo.com/uploads/compartilhamento.png"'),
      "og:image deve ser absoluta"
    );
    assert.equal(html.includes("Carregando conteúdo."), false);
  } finally {
    await destroyTestContext(context);
  }
});

test("sem SITE_URL a landing omite og:image em vez de publicar caminho relativo", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    await agent
      .put("/api/admin/content/seo")
      .send({
        title: "Título",
        description: "Descrição da página com tamanho suficiente.",
        shareImageUrl: "/uploads/compartilhamento.png"
      })
      .expect(200);

    const html = (await request(context.app).get("/").expect(200)).text;
    // Um og:image relativo não é carregado por nenhum crawler: melhor omitir.
    assert.equal(html.includes('property="og:image"'), false);
  } finally {
    await destroyTestContext(context);
  }
});

test("página de privacidade não republica e-mail que saiu do site", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    const conteudo = await agent.get("/api/admin/content").expect(200);

    // Remove todos os canais: nenhum e-mail pode ser inventado no lugar.
    await agent
      .put("/api/admin/content/contact")
      .send({
        ...conteudo.body.data.contact,
        whatsappNumber: "",
        socialLinks: []
      })
      .expect(200);

    const html = (await request(context.app).get("/privacidade").expect(200)).text;
    assert.equal(/@gmail.com/.test(html), false);
    assert.ok(html.includes("seção de contato"));

    // Com um canal configurado, ele aparece.
    await agent
      .put("/api/admin/content/contact")
      .send({
        ...conteudo.body.data.contact,
        whatsappNumber: "",
        socialLinks: [
          { platform: "email", label: "E-mail", url: "mailto:contato@exemplo.com" }
        ]
      })
      .expect(200);

    const comCanal = (await request(context.app).get("/privacidade").expect(200)).text;
    assert.ok(comCanal.includes("contato@exemplo.com"));
  } finally {
    await destroyTestContext(context);
  }
});

test("trocar a imagem de um bloco remove o arquivo anterior do storage", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    const upload = await agent
      .post("/api/admin/uploads")
      .attach("image", SAMPLE_PNG, { filename: "antiga.png", contentType: "image/png" })
      .expect(200);

    const caminhoAntigo = path.join(
      context.runtimeConfig.uploadDir,
      path.basename(upload.body.data.url)
    );
    assert.equal(fs.existsSync(caminhoAntigo), true);

    const conteudo = await agent.get("/api/admin/content").expect(200);
    await agent
      .put("/api/admin/content/home")
      .send({ ...conteudo.body.data.home, imageUrl: upload.body.data.url })
      .expect(200);

    // Troca por outra imagem: a anterior não pode ficar para trás.
    await agent
      .put("/api/admin/content/home")
      .send({ ...conteudo.body.data.home, imageUrl: "/assets/retrato.png" })
      .expect(200);

    assert.equal(fs.existsSync(caminhoAntigo), false);
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

test("conversão de lead é idempotente e não zera dados com corpo parcial", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    const lead = (
      await agent
        .post("/api/admin/leads")
        .send({
          name: "Ana Souza",
          phone: "31999998888",
          email: "ana@example.com",
          age: "16",
          source: "instagram",
          interest: "adolescente",
          preferredPeriod: "manha",
          status: "novo",
          administrativeNote: ""
        })
        .expect(201)
    ).body.data;

    // Corpo parcial (só o responsável) não pode apagar nome e telefone do lead.
    const convertido = await agent
      .post(`/api/admin/leads/${lead.id}/convert-to-patient`)
      .send({ guardianName: "Maria Souza", guardianPhone: "31988887777" })
      .expect(201);

    assert.equal(convertido.body.data.patient.fullName, "Ana Souza");
    assert.equal(convertido.body.data.patient.phone, "31999998888");
    assert.equal(convertido.body.data.patient.guardianName, "Maria Souza");

    // Converter de novo criava um segundo paciente para a mesma pessoa.
    const repetido = await agent
      .post(`/api/admin/leads/${lead.id}/convert-to-patient`)
      .send({ guardianName: "Maria Souza", guardianPhone: "31988887777" })
      .expect(409);
    assert.match(repetido.body.error, /já foi convertido/i);

    const pacientes = await agent.get("/api/admin/patients").expect(200);
    assert.equal(
      pacientes.body.data.items.filter((p) => p.fullName === "Ana Souza").length,
      1
    );
  } finally {
    await destroyTestContext(context);
  }
});

test("dados do responsável saem do cadastro quando o paciente deixa de ser adolescente", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    const patient = await createPatient(agent, {
      fullName: "Bruno Lima",
      patientType: "adolescente",
      guardianName: "Carla Lima",
      guardianPhone: "31977776666"
    });
    assert.equal(patient.guardianName, "Carla Lima");

    const atualizado = await agent
      .put(`/api/admin/patients/${patient.id}`)
      .send({ ...patient, patientType: "adulto" })
      .expect(200);

    // Antes o dado do responsável continuava gravado e ia parar no recibo.
    assert.equal(atualizado.body.data.guardianName, "");
    assert.equal(atualizado.body.data.guardianPhone, "");
  } finally {
    await destroyTestContext(context);
  }
});

test("cancelar sessão preserva pagamento já recebido", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    const patient = await createPatient(agent, { fullName: "Cancelamento" });

    const paga = await createSession(agent, patient.id);
    await agent.post(`/api/admin/sessions/${paga.id}/mark-paid`).send({ paymentMethod: "pix" }).expect(200);
    const canceladaPaga = await agent.post(`/api/admin/sessions/${paga.id}/cancel`).expect(200);
    assert.equal(canceladaPaga.body.data.status, "cancelada");
    assert.equal(canceladaPaga.body.data.paymentStatus, "pago");

    // Pendente continua virando cancelado, como antes.
    const pendente = await createSession(agent, patient.id, { scheduledAt: "2026-06-22T18:00" });
    const canceladaPendente = await agent
      .post(`/api/admin/sessions/${pendente.id}/cancel`)
      .expect(200);
    assert.equal(canceladaPendente.body.data.paymentStatus, "cancelado");
  } finally {
    await destroyTestContext(context);
  }
});

test("id inválido responde 400 e filtro inválido não quebra a listagem", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    await agent.delete("/api/admin/patients/abc").expect(400);
    // 1e30 passa em Number.isInteger e chegava ao banco em notação científica.
    await agent.delete("/api/admin/patients/1e30").expect(400);
    await agent.get("/api/admin/receipts/1e30").expect(400);

    const lista = await agent.get("/api/admin/sessions?patientId=abc").expect(200);
    assert.ok(Array.isArray(lista.body.data.items));
  } finally {
    await destroyTestContext(context);
  }
});

test("erro de validação aponta o campo e chega em português", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    const conteudo = await agent.get("/api/admin/content").expect(200);

    const erro = await agent
      .put("/api/admin/content/help")
      .send({
        eyebrow: conteudo.body.data.help.eyebrow,
        title: conteudo.body.data.help.title,
        cards: [
          {
            title: "Card ok",
            description: "Descrição suficientemente longa.",
            assetType: "icon",
            assetValue: "heart-handshake",
            sortOrder: 1
          },
          {
            title: "x",
            description: "curta",
            assetType: "icon",
            assetValue: "heart-handshake",
            sortOrder: 2
          }
        ]
      })
      .expect(400);

    // A chave precisa carregar o índice, senão o painel não sabe qual card falhou.
    const chaves = Object.keys(erro.body.details.fieldErrors);
    assert.ok(chaves.some((chave) => chave.startsWith("cards.1.")));

    // E a mensagem não pode chegar em inglês num painel PT-BR.
    const mensagens = Object.values(erro.body.details.fieldErrors)
      .flat()
      .join(" ");
    assert.equal(/String must contain|Invalid/.test(mensagens), false);
    assert.match(mensagens, /caracteres/);
  } finally {
    await destroyTestContext(context);
  }
});

test("consultar as evoluções do paciente deixa rastro na auditoria", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    const patient = await createPatient(agent, { fullName: "Rastro Clínico" });

    await agent.get(`/api/admin/patients/${patient.id}/evolutions`).expect(200);

    const logs = await agent.get("/api/admin/audit-logs").expect(200);
    const acesso = logs.body.data.items.find(
      (item) => item.action === "clinical_evolutions_listed"
    );
    assert.ok(acesso, "esperava log de consulta às evoluções");
  } finally {
    await destroyTestContext(context);
  }
});

test("CSP do painel não libera origens de terceiro", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    const painel = await agent.get("/admin/dashboard").expect(200);
    const cspPainel = painel.headers["content-security-policy"];

    // O prontuário é aberto aqui: nada de script ou websocket de terceiro.
    assert.equal(cspPainel.includes("vercel.live"), false);
    assert.equal(cspPainel.includes("pusher.com"), false);
  } finally {
    await destroyTestContext(context);
  }
});

test("consultas do Postgres numeram os placeholders corretamente", async () => {
  // A suíte roda em SQLite, então SQL malformado do lado Postgres passa batido e
  // só aparece em produção. Aqui as listagens são montadas contra um cliente
  // falso e cada $N é conferido contra os parâmetros enviados.
  const {
    createPostgresClinicRepository
  } = require("../src/repositories/postgres-clinic-repository");
  const {
    createPostgresPhase2Repository
  } = require("../src/repositories/postgres-phase2-repository");

  const CIFRAO = String.fromCharCode(36);
  const placeholdersDe = (sqlText) => {
    const encontrados = [];
    for (let i = 0; i < sqlText.length; i += 1) {
      if (sqlText[i] !== CIFRAO) continue;
      let j = i + 1;
      let numero = "";
      while (j < sqlText.length && sqlText[j] >= "0" && sqlText[j] <= "9") {
        numero += sqlText[j];
        j += 1;
      }
      if (numero) encontrados.push(Number(numero));
    }
    return encontrados;
  };

  const capturado = [];
  const fakeTag = () => Promise.resolve([]);
  fakeTag.unsafe = (sqlText, params = []) => {
    capturado.push({ sqlText, params });
    return Promise.resolve([]);
  };

  const clinic = createPostgresClinicRepository(fakeTag);
  const phase2 = createPostgresPhase2Repository(fakeTag, {});

  await clinic.listPatients({ search: "ana", status: "ativo" });
  await clinic.listLeads({ search: "ana", status: "novo" });
  await clinic.listSessions({
    patientId: 1,
    status: "agendada",
    paymentStatus: "pago",
    dateFrom: "a",
    dateTo: "b"
  });
  await clinic.listMessageTemplates({ search: "x", category: "novo_contato" });
  await clinic.listFinanceSessions({
    year: 2026,
    month: 6,
    patientId: 1,
    paymentStatus: "pago"
  });
  await phase2.listReceipts({
    patientId: 1,
    sessionId: 2,
    dateFrom: "a",
    dateTo: "b",
    basis: "competencia"
  });
  await phase2.listReceipts({ dateFrom: "a", dateTo: "b", basis: "caixa" });
  await phase2.listAuditLogs({
    adminEmail: "a@b.com",
    action: "x",
    entityType: "y",
    dateFrom: "a",
    dateTo: "b",
    page: 1,
    pageSize: 20
  });

  assert.ok(capturado.length >= 8);

  for (const { sqlText, params } of capturado) {
    const usados = placeholdersDe(sqlText);
    const resumo = sqlText.replace(/s+/g, " ").trim().slice(0, 70);

    for (const numero of usados) {
      assert.ok(
        numero >= 1 && numero <= params.length,
        `placeholder fora de faixa em: ${resumo}`
      );
    }

    for (let numero = 1; numero <= params.length; numero += 1) {
      assert.ok(
        usados.includes(numero),
        `parâmetro ${numero} nunca referenciado em: ${resumo}`
      );
    }
  }
});

test("parâmetro fora de faixa não derruba rota administrativa", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    // Valores que chegavam crus a Date.UTC e ao LIMIT/OFFSET do SQL e viravam 500.
    const hostis = [
      "/api/admin/finance/summary?year=999999",
      "/api/admin/finance/summary?month=99999999",
      "/api/admin/finance/summary?year=Infinity",
      "/api/admin/finance/summary?year=1e30",
      "/api/admin/finance/export.csv?year=999999",
      "/api/admin/receipts?year=999999&month=6",
      "/api/admin/receipts?month=1e30",
      "/api/admin/audit-logs?page=1e30",
      "/api/admin/audit-logs?page=Infinity",
      "/api/admin/audit-logs?pageSize=1.5",
      "/api/admin/audit-logs?pageSize=9007199254740993"
    ];

    for (const url of hostis) {
      const resposta = await agent.get(url);
      assert.ok(
        resposta.status < 500,
        `${url} respondeu ${resposta.status}`
      );
    }

    // Fora de faixa cai no período corrente, não em data inválida.
    const foraDeFaixa = await agent.get("/api/admin/receipts?year=999999&month=6").expect(200);
    assert.ok(Number(foraDeFaixa.body.data.filters.year) <= 2999);

    // Paginação continua respeitando o teto.
    const pagina = await agent.get("/api/admin/audit-logs?pageSize=9999").expect(200);
    assert.ok(pagina.body.data.items.length <= 100);
  } finally {
    await destroyTestContext(context);
  }
});

test("recusa esperada não é registrada como erro de servidor", async () => {
  const context = createTestContext();
  const erros = [];
  const avisos = [];
  const errorOriginal = console.error;
  const warnOriginal = console.warn;
  console.error = (...args) => erros.push(args[0]);
  console.warn = (...args) => avisos.push(args[0]);

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    const patient = await createPatient(agent, { fullName: "Log Limpo" });
    const session = await createSession(agent, patient.id);
    await agent.post(`/api/admin/sessions/${session.id}/mark-paid`).send({ paymentMethod: "pix" }).expect(200);
    await agent.post(`/api/admin/sessions/${session.id}/receipt`).send({}).expect(201);

    erros.length = 0;
    avisos.length = 0;

    // Recusa legítima: 409. Não pode virar [APP_ERROR] com stack no log de produção.
    await agent.delete(`/api/admin/sessions/${session.id}`).expect(409);
    await agent.delete("/api/admin/patients/abc").expect(400);

    assert.equal(erros.filter((e) => e === "[APP_ERROR]").length, 0);
    assert.equal(avisos.filter((a) => a === "[APP_REJECTED]").length, 2);
  } finally {
    console.error = errorOriginal;
    console.warn = warnOriginal;
    await destroyTestContext(context);
  }
});

test("sessão com recibo emitido não pode mudar paciente, valor ou data", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    const patient = await createPatient(agent, { fullName: "Recibo Congelado" });
    const outro = await createPatient(agent, { fullName: "Outro Paciente" });
    const session = await createSession(agent, patient.id);
    await agent.post(`/api/admin/sessions/${session.id}/mark-paid`).send({ paymentMethod: "pix" }).expect(200);
    await agent.post(`/api/admin/sessions/${session.id}/receipt`).send({}).expect(201);

    const base = {
      patientId: patient.id,
      scheduledAt: session.scheduledAt,
      durationMinutes: 50,
      status: "realizada",
      paymentStatus: "pago",
      price: 180,
      paymentMethod: "pix",
      paidAt: "",
      meetingUrl: "",
      administrativeNote: ""
    };

    // Trocar o paciente faria o recibo descrever outra pessoa.
    const trocaPaciente = await agent
      .put(`/api/admin/sessions/${session.id}`)
      .send({ ...base, patientId: outro.id })
      .expect(409);
    assert.match(trocaPaciente.body.error, /REC-000001/);

    // Trocar o valor faria o recibo declarar uma quantia que não corresponde.
    await agent
      .put(`/api/admin/sessions/${session.id}`)
      .send({ ...base, price: 250 })
      .expect(409);

    // Mexer no que o recibo não afirma continua permitido.
    await agent
      .put(`/api/admin/sessions/${session.id}`)
      .send({ ...base, administrativeNote: "Anotação administrativa nova." })
      .expect(200);
  } finally {
    await destroyTestContext(context);
  }
});

test("imagem usada por outro bloco do site não é apagada", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    const upload = await agent
      .post("/api/admin/uploads")
      .attach("image", SAMPLE_PNG, { filename: "compartilhada.png", contentType: "image/png" })
      .expect(200);
    const url = upload.body.data.url;
    const caminho = path.join(context.runtimeConfig.uploadDir, path.basename(url));

    const conteudo = await agent.get("/api/admin/content").expect(200);

    // A mesma imagem em dois blocos.
    await agent
      .put("/api/admin/content/home")
      .send({ ...conteudo.body.data.home, imageUrl: url })
      .expect(200);
    await agent
      .put("/api/admin/content/seo")
      .send({ ...conteudo.body.data.seo, shareImageUrl: url })
      .expect(200);

    // Tirar de um bloco não pode apagar o arquivo que o outro ainda usa.
    await agent
      .put("/api/admin/content/home")
      .send({ ...conteudo.body.data.home, imageUrl: "/assets/retrato.png" })
      .expect(200);

    assert.equal(fs.existsSync(caminho), true);

    // Saindo do último bloco que a referenciava, aí sim o arquivo vai embora.
    await agent
      .put("/api/admin/content/seo")
      .send({ ...conteudo.body.data.seo, shareImageUrl: "/assets/retrato.png" })
      .expect(200);

    assert.equal(fs.existsSync(caminho), false);
  } finally {
    await destroyTestContext(context);
  }
});

test("criar paciente adulto não guarda dados de responsável", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    const patient = await createPatient(agent, {
      fullName: "Adulto Sem Responsável",
      patientType: "adulto",
      guardianName: "Não Deveria Ficar",
      guardianPhone: "31900000000"
    });

    assert.equal(patient.guardianName, "");
    assert.equal(patient.guardianPhone, "");
  } finally {
    await destroyTestContext(context);
  }
});

test("conversão pede responsável pelo tipo escolhido, não pelo interesse do lead", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    const lead = (
      await agent
        .post("/api/admin/leads")
        .send({
          name: "Jovem Adulto",
          phone: "31999997777",
          email: "j@example.com",
          age: "19",
          source: "instagram",
          interest: "adolescente",
          preferredPeriod: "manha",
          status: "novo",
          administrativeNote: ""
        })
        .expect(201)
    ).body.data;

    // O lead veio marcado como adolescente, mas está sendo cadastrado como
    // adulto: não faz sentido exigir responsável.
    const convertido = await agent
      .post(`/api/admin/leads/${lead.id}/convert-to-patient`)
      .send({ patientType: "adulto" })
      .expect(201);

    assert.equal(convertido.body.data.patient.patientType, "adulto");
    assert.equal(convertido.body.data.patient.guardianName, "");
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

test("corpo com cards ou socialLinks fora de formato responde 400, não 500", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    const conteudo = await agent.get("/api/admin/content").expect(200);

    for (const valor of [null, "texto", 42, { a: 1 }]) {
      const r = await agent
        .put("/api/admin/content/help")
        .send({
          eyebrow: conteudo.body.data.help.eyebrow,
          title: conteudo.body.data.help.title,
          cards: valor
        });
      assert.ok(r.status < 500, `cards=${JSON.stringify(valor)} respondeu ${r.status}`);
    }

    const social = await agent
      .put("/api/admin/content/contact")
      .send({ ...conteudo.body.data.contact, socialLinks: null });
    assert.ok(social.status < 500, `socialLinks=null respondeu ${social.status}`);
  } finally {
    await destroyTestContext(context);
  }
});

test("escrita administrativa de outra origem é recusada", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    // Mesma origem: passa.
    const mesmaOrigem = await agent
      .post("/api/admin/leads")
      .send({
        name: "Origem Certa",
        phone: "31999990000",
        email: "",
        age: "",
        source: "instagram",
        interest: "adulto",
        preferredPeriod: "manha",
        status: "novo",
        administrativeNote: ""
      });
    assert.equal(mesmaOrigem.status, 201);

    // Origem estranha: recusada antes de tocar no banco.
    const outraOrigem = await agent
      .post("/api/admin/leads")
      .set("Origin", "https://site-malicioso.example")
      .send({
        name: "Origem Errada",
        phone: "31999991111",
        email: "",
        age: "",
        source: "instagram",
        interest: "adulto",
        preferredPeriod: "manha",
        status: "novo",
        administrativeNote: ""
      })
      .expect(403);
    assert.match(outraOrigem.body.error, /origem/i);

    const leads = await agent.get("/api/admin/leads").expect(200);
    assert.equal(leads.body.data.items.some((l) => l.name === "Origem Errada"), false);

    // Leitura de outra origem não é bloqueada (não é escrita).
    await agent
      .get("/api/admin/leads")
      .set("Origin", "https://site-malicioso.example")
      .expect(200);
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

test("clinic-time: janelas de mês e semana no fuso da clínica", () => {
  const {
    getClinicMonthRange,
    getClinicWeekRange,
    normalizeClinicFilterBoundary,
    normalizeDateTimeToIso,
    formatClinicDate
  } = require("../src/lib/clinic-time");

  // Meia-noite da clínica é 03:00Z (UTC-3).
  const junho = getClinicMonthRange(2026, 6);
  assert.equal(junho.start, "2026-06-01T03:00:00.000Z");
  assert.equal(junho.end, "2026-07-01T03:00:00.000Z");

  // Virada de ano.
  const dezembro = getClinicMonthRange(2026, 12);
  assert.equal(dezembro.end, "2027-01-01T03:00:00.000Z");

  // Fevereiro de ano bissexto termina no dia 29.
  const fevereiro = getClinicMonthRange(2028, 2);
  assert.equal(fevereiro.end, "2028-03-01T03:00:00.000Z");

  // A sessão das 21h do dia 30 pertence a junho.
  const sessaoNoturna = "2026-07-01T00:00:00.000Z";
  assert.ok(sessaoNoturna >= junho.start && sessaoNoturna < junho.end);

  // Semana começa na segunda, no fuso da clínica.
  const semana = getClinicWeekRange(new Date("2026-07-01T02:00:00.000Z"));
  assert.equal(semana.start, "2026-06-29T03:00:00.000Z");
  assert.equal(semana.end, "2026-07-06T03:00:00.000Z");
  // Uma segunda-feira cai no início da própria semana.
  const naSegunda = getClinicWeekRange(new Date("2026-06-29T15:00:00.000Z"));
  assert.equal(naSegunda.start, "2026-06-29T03:00:00.000Z");
  // Um domingo pertence à semana que começou na segunda anterior.
  const noDomingo = getClinicWeekRange(new Date("2026-07-05T15:00:00.000Z"));
  assert.equal(noDomingo.start, "2026-06-29T03:00:00.000Z");

  // Limite "até" é aberto à direita, na meia-noite do dia seguinte.
  assert.equal(normalizeClinicFilterBoundary("2026-06-30", "end"), "2026-07-01T03:00:00.000Z");
  assert.equal(normalizeClinicFilterBoundary("2026-06-30", "start"), "2026-06-30T03:00:00.000Z");
  assert.equal(normalizeClinicFilterBoundary("nao-e-data", "start"), "");
  assert.equal(normalizeClinicFilterBoundary("", "start"), "");

  // Horário sem fuso é horário da clínica.
  assert.equal(normalizeDateTimeToIso("2026-06-30T21:00"), "2026-07-01T00:00:00.000Z");
  // Com fuso explícito, respeita o que veio.
  assert.equal(normalizeDateTimeToIso("2026-06-30T21:00:00Z"), "2026-06-30T21:00:00.000Z");

  // Exibição usa o calendário da clínica, não o do servidor.
  assert.equal(formatClinicDate("2026-07-01T00:00:00.000Z", { dateStyle: "short" }), "30/06/2026");
});

test("pdf-text preserva o texto legível e neutraliza o que a fonte não desenha", () => {
  const { toPdfText, toPdfData } = require("../src/lib/pdf-text");

  // Acento composto e decomposto chegam ao mesmo resultado legível.
  assert.equal(toPdfText("Conceição".normalize("NFC")), "Conceição");
  assert.equal(toPdfText("Conceição".normalize("NFD")), "Conceição");

  // Latin-1 e os símbolos do CP1252 passam intactos.
  assert.equal(toPdfText("a — b • c “d” € 10 º ª ç"), "a — b • c “d” € 10 º ª ç");

  // O que a fonte não representa vira um único marcador por trecho.
  assert.equal(toPdfText("sentiu-se 😔 hoje"), "sentiu-se ? hoje");
  assert.equal(toPdfText("família 👨‍👩‍👧 unida"), "família ? unida");
  assert.equal(toPdfText("ok 👍🏽 feito"), "ok ? feito");
  assert.equal(toPdfText("anotação 漢字 aqui"), "anotação ? aqui");
  assert.equal(toPdfText(""), "");

  // toPdfData percorre objetos sem estragar números nem nulos.
  const dados = toPdfData({
    nome: "Ana 😔",
    valor: 180,
    vazio: null,
    lista: ["a 😔", "b"]
  });
  assert.equal(dados.nome, "Ana ?");
  assert.equal(dados.valor, 180);
  assert.equal(dados.vazio, null);
  assert.deepEqual(dados.lista, ["a ?", "b"]);
});

test("editar rascunho de evolução guarda a versão anterior", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    const patient = await createPatient(agent, { fullName: "Versionamento" });

    const criada = await agent
      .post("/api/admin/evolutions")
      .send({ patientId: patient.id, content: "Primeira redação do registro." })
      .expect(201);
    const id = criada.body.data.id;

    await agent
      .put(`/api/admin/evolutions/${id}`)
      .send({ content: "Segunda redação, corrigida." })
      .expect(200);

    // A versão anterior precisa estar guardada — é o que sustenta a rastreabilidade.
    const versoes = context.app.locals.dependencies.db
      .prepare("SELECT encrypted_content AS conteudo, version_number AS versao FROM clinical_evolution_versions WHERE evolution_id = ? ORDER BY version_number")
      .all(id);

    assert.equal(versoes.length, 1);
    assert.equal(versoes[0].versao, 1);
    assert.match(versoes[0].conteudo, /^clin:v1:/);
    // E o texto guardado é o ORIGINAL, cifrado.
    const { decryptClinicalText } = require("../src/lib/clinical-crypto");
    assert.equal(
      decryptClinicalText(versoes[0].conteudo, context.runtimeConfig),
      "Primeira redação do registro."
    );

    // A leitura atual devolve a redação nova.
    const atual = await agent.get(`/api/admin/evolutions/${id}`).expect(200);
    assert.equal(atual.body.data.content, "Segunda redação, corrigida.");
  } finally {
    await destroyTestContext(context);
  }
});

test("abre o prontuário, registra contrato e plano, emite documento e encerra o caso", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    const patient = await createPatient(agent, {
      fullName: "Prontuário Teste",
      email: "prontuario@example.com"
    });

    // Antes de tudo o prontuário não existe — era exatamente a queixa: havia
    // anamnese, mas nenhum registro para abrir.
    const semProntuario = await agent
      .get(`/api/admin/patients/${patient.id}/clinical-record`)
      .expect(200);
    assert.equal(semProntuario.body.data.record, null);
    assert.deepEqual(semProntuario.body.data.blocks, {});
    assert.equal(semProntuario.body.data.documentsCount, 0);

    // Abrir prontuário
    const aberto = await agent
      .post(`/api/admin/patients/${patient.id}/clinical-record`)
      .expect(201);
    const recordId = aberto.body.data.id;
    assert.match(aberto.body.data.recordNumber, /^PRT-\d{6}$/);
    assert.equal(aberto.body.data.status, "open");
    assert.equal(aberto.body.data.statusLabel, "Aberto");

    // Abrir de novo é idempotente: um segundo clique não pode dar erro.
    const reaberto = await agent
      .post(`/api/admin/patients/${patient.id}/clinical-record`)
      .expect(200);
    assert.equal(reaberto.body.data.id, recordId);

    // Contrato: template em branco, seis seções
    const contratoVazio = await agent
      .get(`/api/admin/clinical-records/${recordId}/blocks/contract`)
      .expect(200);
    assert.equal(contratoVazio.body.data.block, null);
    assert.equal(contratoVazio.body.data.template.sections.length, 6);

    const contrato = await agent
      .put(`/api/admin/clinical-records/${recordId}/blocks/contract`)
      .send({
        sections: [
          {
            id: "agreement",
            items: [
              { id: "modality", answer: "Online, por vídeo" },
              { id: "price", answer: "R$ 180 por sessão" }
            ]
          },
          {
            id: "confidentiality",
            items: [{ id: "limits", answer: "Risco de vida e determinação judicial." }]
          }
        ]
      })
      .expect(200);
    assert.equal(contrato.body.data.blockType, "contract");
    assert.equal(contrato.body.data.status, "draft");
    assert.equal(contrato.body.data.editable, true);

    // Nada de conteúdo clínico em claro no banco.
    const linhaContrato = context.app.locals.dependencies.db
      .prepare("SELECT encrypted_payload FROM clinical_record_blocks WHERE id = ?")
      .get(contrato.body.data.id);
    assert.match(linhaContrato.encrypted_payload, /^clin:v1:/);
    assert.equal(linhaContrato.encrypted_payload.includes("Online"), false);
    assert.equal(linhaContrato.encrypted_payload.includes("determinação judicial"), false);

    // Editar de novo guarda a versão anterior.
    await agent
      .put(`/api/admin/clinical-records/${recordId}/blocks/contract`)
      .send({
        sections: [{ id: "agreement", items: [{ id: "modality", answer: "Presencial" }] }],
        changeReason: "Mudou a modalidade."
      })
      .expect(200);

    const versoes = context.app.locals.dependencies.db
      .prepare("SELECT COUNT(*) AS total FROM clinical_record_block_versions WHERE block_id = ?")
      .get(contrato.body.data.id);
    assert.equal(versoes.total, 1);

    // Concluir trava a edição direta.
    await agent
      .post(`/api/admin/clinical-records/${recordId}/blocks/contract/complete`)
      .expect(200);
    const contratoTravado = await agent
      .put(`/api/admin/clinical-records/${recordId}/blocks/contract`)
      .send({ sections: [] })
      .expect(409);
    assert.match(contratoTravado.body.error, /concluído ou bloqueado/i);

    // Contrato sai em PDF para assinatura.
    const pdfContrato = await agent
      .get(`/api/admin/clinical-records/${recordId}/blocks/contract/export.pdf`)
      .expect(200)
      .expect("Content-Type", /application\/pdf/);
    assert.equal(pdfContrato.body.subarray(0, 4).toString(), "%PDF");

    // Plano terapêutico
    const plano = await agent
      .put(`/api/admin/clinical-records/${recordId}/blocks/plan`)
      .send({
        sections: [
          { id: "focus", items: [{ id: "central_demand", answer: "Ansiedade no trabalho." }] }
        ]
      })
      .expect(200);
    assert.equal(plano.body.data.blockType, "plan");

    // Anamnese e evolução continuam funcionando, agora sob o prontuário.
    await agent
      .post(`/api/admin/patients/${patient.id}/intake`)
      .send({ sections: [{ id: "attendance", items: [{ id: "main_complaint", answer: "Ansiedade." }] }] })
      .expect(201);
    const evolucao = await agent
      .post("/api/admin/evolutions")
      .send({ patientId: patient.id, evolutionType: "session", content: "Primeiro encontro." })
      .expect(201);

    // Documento emitido: numerado, com PDF guardado e conteúdo cifrado.
    const documento = await agent
      .post(`/api/admin/clinical-records/${recordId}/documents`)
      .send({
        documentType: "attendance_declaration",
        title: "Comparecimento em agosto",
        addressee: "A quem possa interessar",
        purpose: "Justificar ausência no trabalho",
        body: "Compareceu a atendimento psicológico nesta data."
      })
      .expect(201);
    assert.match(documento.body.data.documentNumber, /^DOC-\d{6}$/);
    assert.equal(documento.body.data.status, "issued");
    assert.equal(documento.body.data.documentTypeLabel, "Declaração de comparecimento");

    const linhaDocumento = context.app.locals.dependencies.db
      .prepare("SELECT encrypted_content, file_object_key FROM clinical_documents WHERE id = ?")
      .get(documento.body.data.id);
    assert.match(linhaDocumento.encrypted_content, /^clin:v1:/);
    assert.equal(linhaDocumento.encrypted_content.includes("Justificar ausência"), false);
    assert.ok(linhaDocumento.file_object_key.startsWith("clinical-documents/"));

    const pdfDocumento = await agent
      .get(`/api/admin/clinical-documents/${documento.body.data.id}/download`)
      .expect(200)
      .expect("Content-Type", /application\/pdf/);
    assert.equal(pdfDocumento.body.subarray(0, 4).toString(), "%PDF");

    // A listagem não devolve conteúdo clínico.
    const listaDocumentos = await agent
      .get(`/api/admin/clinical-records/${recordId}/documents`)
      .expect(200);
    assert.equal(listaDocumentos.body.data.length, 1);
    assert.equal("content" in listaDocumentos.body.data[0], false);

    // Revogar mantém o registro e guarda o motivo.
    const revogado = await agent
      .post(`/api/admin/clinical-documents/${documento.body.data.id}/revoke`)
      .send({ reason: "Data incorreta." })
      .expect(200);
    assert.equal(revogado.body.data.status, "revoked");
    assert.equal(revogado.body.data.revokeReason, "Data incorreta.");

    // Resumo do prontuário reúne as peças, sem abrir conteúdo.
    const resumo = await agent
      .get(`/api/admin/patients/${patient.id}/clinical-record`)
      .expect(200);
    assert.equal(resumo.body.data.record.status, "open");
    assert.equal(resumo.body.data.blocks.contract.status, "completed");
    assert.equal(resumo.body.data.blocks.plan.status, "draft");
    assert.equal(resumo.body.data.documentsCount, 1);
    assert.equal(resumo.body.data.evolutionsCount, 1);
    assert.ok(resumo.body.data.timeline.some((entrada) => entrada.type === "record_opened"));
    assert.ok(resumo.body.data.timeline.some((entrada) => entrada.type === "document"));

    // Encerrar exige motivo válido.
    await agent
      .post(`/api/admin/clinical-records/${recordId}/close`)
      .send({ closingReason: "qualquer" })
      .expect(400);

    const encerrado = await agent
      .post(`/api/admin/clinical-records/${recordId}/close`)
      .send({
        closingReason: "discharge",
        sections: [
          { id: "synthesis", items: [{ id: "reached_goals", answer: "Reduziu a ansiedade." }] }
        ]
      })
      .expect(200);
    assert.equal(encerrado.body.data.status, "closed");
    assert.equal(encerrado.body.data.closingReasonLabel, "Alta");
    assert.ok(encerrado.body.data.closedAt);

    // Depois de encerrado, o registro é leitura: nada de evolução nova nem edição.
    const recusaEvolucao = await agent
      .post("/api/admin/evolutions")
      .send({ patientId: patient.id, evolutionType: "session", content: "Depois do fim." })
      .expect(409);
    assert.match(recusaEvolucao.body.error, /encerrado/i);

    await agent
      .put(`/api/admin/clinical-records/${recordId}/blocks/plan`)
      .send({ sections: [] })
      .expect(409);

    // Adendo continua permitido: é o caminho de correção de um registro fechado.
    await agent
      .post(`/api/admin/evolutions/${evolucao.body.data.id}/addendum`)
      .send({ content: "Retificação após o encerramento.", evolutionType: "correction" })
      .expect(201);

    // Prontuário com documento emitido e caso encerrado não pode ser apagado.
    const recusaExclusao = await agent.delete(`/api/admin/patients/${patient.id}`).expect(409);
    assert.match(recusaExclusao.body.error, /não pode ser apagado/i);
    assert.match(recusaExclusao.body.error, /documento emitido/i);

    // Exportação traz o prontuário inteiro, não só anamnese e evoluções.
    const pdfCompleto = await agent
      .get(`/api/admin/patients/${patient.id}/clinical-record/export.pdf`)
      .expect(200)
      .expect("Content-Type", /application\/pdf/);
    assert.equal(pdfCompleto.body.subarray(0, 4).toString(), "%PDF");
    const textoPdf = pdfCompleto.body.toString("latin1");
    assert.ok(textoPdf.length > 3000);

    // Reabrir devolve o prontuário ao trabalho — encerrar por engano não pode
    // virar beco sem saída.
    await agent
      .post(`/api/admin/clinical-records/${recordId}/reopen`)
      .send({ reason: "Encerrado por engano." })
      .expect(200);
    const depoisDeReabrir = await agent
      .get(`/api/admin/patients/${patient.id}/clinical-record`)
      .expect(200);
    assert.equal(depoisDeReabrir.body.data.record.status, "open");
    assert.equal(depoisDeReabrir.body.data.blocks.closing.status, "draft");

    await agent
      .post("/api/admin/evolutions")
      .send({ patientId: patient.id, evolutionType: "session", content: "Retomada." })
      .expect(201);

    // Auditoria registra cada ato do prontuário, sem conteúdo clínico.
    const acoes = context.app.locals.dependencies.db
      .prepare("SELECT DISTINCT action FROM audit_logs WHERE entity_type LIKE 'clinical%'")
      .all()
      .map((linha) => linha.action);
    for (const esperada of [
      "clinical_record_opened",
      "clinical_record_block_updated",
      "clinical_record_block_completed",
      "clinical_document_issued",
      "clinical_document_revoked",
      "clinical_record_closed",
      "clinical_record_reopened"
    ]) {
      assert.ok(acoes.includes(esperada), `faltou a ação ${esperada} na auditoria`);
    }
  } finally {
    await destroyTestContext(context);
  }
});

test("prontuário aberto por anamnese numera na sequência e não repete número", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    const primeiro = await createPatient(agent, { fullName: "Um", email: "um@example.com" });
    const segundo = await createPatient(agent, { fullName: "Dois", email: "dois@example.com" });

    // A anamnese abre o prontuário sozinha: quem começa por ela não fica sem
    // registro.
    for (const paciente of [primeiro, segundo]) {
      await agent
        .post(`/api/admin/patients/${paciente.id}/intake`)
        .send({ sections: [] })
        .expect(201);
    }

    const numeros = context.app.locals.dependencies.db
      .prepare("SELECT record_number AS numero FROM clinical_records ORDER BY id")
      .all()
      .map((linha) => linha.numero);

    assert.deepEqual(numeros, ["PRT-000001", "PRT-000002"]);
    assert.equal(new Set(numeros).size, numeros.length);
  } finally {
    await destroyTestContext(context);
  }
});

test("prontuário encerrado devolve editable falso, e não só recusa a gravação", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    const patient = await createPatient(agent, {
      fullName: "Leitura Teste",
      email: "leitura@example.com"
    });

    await agent
      .post(`/api/admin/patients/${patient.id}/intake`)
      .send({ sections: [{ id: "attendance", items: [{ id: "main_complaint", answer: "Queixa." }] }] })
      .expect(201);
    const evolucao = await agent
      .post("/api/admin/evolutions")
      .send({ patientId: patient.id, evolutionType: "session", content: "Encontro." })
      .expect(201);

    const antes = await agent.get(`/api/admin/patients/${patient.id}/intake`).expect(200);
    assert.equal(antes.body.data.intake.editable, true);
    assert.equal(antes.body.data.intake.recordClosed, false);

    const record = await agent
      .get(`/api/admin/patients/${patient.id}/clinical-record`)
      .expect(200);
    await agent
      .post(`/api/admin/clinical-records/${record.body.data.record.id}/close`)
      .send({ closingReason: "dropout", sections: [] })
      .expect(200);

    // O servidor já recusava a gravação, mas seguia dizendo que dava para
    // editar — e a tela oferecia Salvar e Concluir num registro que responde
    // 409. Quem desenha os botões precisa da mesma verdade.
    const depois = await agent.get(`/api/admin/patients/${patient.id}/intake`).expect(200);
    assert.equal(depois.body.data.intake.editable, false);
    assert.equal(depois.body.data.intake.recordClosed, true);

    const detalhe = await agent.get(`/api/admin/evolutions/${evolucao.body.data.id}`).expect(200);
    assert.equal(detalhe.body.data.editable, false);
    assert.equal(detalhe.body.data.recordClosed, true);

    const lista = await agent.get(`/api/admin/patients/${patient.id}/evolutions`).expect(200);
    assert.equal(lista.body.data.items[0].recordClosed, true);

    // E a recusa continua valendo no servidor.
    await agent
      .put(`/api/admin/intakes/${antes.body.data.intake.id}`)
      .send({ sections: [] })
      .expect(409);
    await agent.post(`/api/admin/intakes/${antes.body.data.intake.id}/complete`).expect(409);
  } finally {
    await destroyTestContext(context);
  }
});

// As listas de tipos existem em três lugares: a constante em JS, o schema de
// validação e o CHECK do banco — em duas fontes de migração, SQLite e Postgres.
// As migrações 008 e 009 só existem porque essas cópias divergiram em silêncio.
// Este teste faz a divergência falhar aqui, e não em produção.
function extrairListaDoCheck(sql, coluna) {
  const marca = coluna + " IN (";
  const inicio = sql.indexOf(marca);
  assert.ok(inicio !== -1, "CHECK de " + coluna + " não encontrado");
  const fim = sql.indexOf(")", inicio);
  assert.ok(fim !== -1, "CHECK de " + coluna + " sem fechamento");
  return sql
    .slice(inicio + marca.length, fim)
    .split(",")
    .map((parte) => parte.trim())
    .map((parte) => parte.slice(1, -1));
}

test("listas do prontuário não divergem entre serviço, validação e banco", () => {
  const opcoes = require("../src/lib/clinic-options");
  const clinical = require("../src/services/clinical");
  const clinicalRecord = require("../src/services/clinical-record");
  const clinicalDocuments = require("../src/services/clinical-documents");

  const sqlite = fs.readFileSync(
    path.join(__dirname, "..", "src", "db", "migrations", "010_clinical_record.sql"),
    "utf8"
  );
  const postgres = fs.readFileSync(
    path.join(__dirname, "..", "src", "db", "run-migrations.js"),
    "utf8"
  );
  const sqliteEvolucoes = fs.readFileSync(
    path.join(__dirname, "..", "src", "db", "migrations", "005_clinical_records.sql"),
    "utf8"
  );

  const casos = [
    ["block_type", opcoes.RECORD_BLOCK_TYPES, sqlite, postgres],
    // O vazio é o estado "sem encerramento" e só existe no banco.
    ["closing_reason", ["", ...opcoes.RECORD_CLOSING_REASONS], sqlite, postgres],
    ["document_type", opcoes.CLINICAL_DOCUMENT_TYPES, sqlite, postgres],
    ["evolution_type", clinical.EVOLUTION_TYPES, sqliteEvolucoes, postgres]
  ];

  for (const [coluna, esperada, fonteSqlite, fontePostgres] of casos) {
    assert.deepEqual(
      extrairListaDoCheck(fonteSqlite, coluna),
      esperada,
      coluna + " diverge entre a constante em JS e o CHECK do SQLite"
    );
    assert.deepEqual(
      extrairListaDoCheck(fontePostgres, coluna),
      esperada,
      coluna + " diverge entre a constante em JS e o CHECK do Postgres"
    );
  }

  // E as constantes dos serviços são as mesmas listas, não cópias.
  assert.deepEqual(clinicalRecord.BLOCK_TYPES, opcoes.RECORD_BLOCK_TYPES);
  assert.deepEqual(clinicalRecord.CLOSING_REASONS, opcoes.RECORD_CLOSING_REASONS);
  assert.deepEqual(clinicalDocuments.DOCUMENT_TYPES, opcoes.CLINICAL_DOCUMENT_TYPES);

  // E os rótulos cobrem cada valor: um tipo sem rótulo aparece cru na tela.
  for (const tipo of opcoes.CLINICAL_DOCUMENT_TYPES) {
    assert.ok(clinicalDocuments.DOCUMENT_TYPE_LABELS[tipo], "documento sem rótulo: " + tipo);
  }
  for (const motivo of opcoes.RECORD_CLOSING_REASONS) {
    assert.ok(clinicalRecord.CLOSING_REASON_LABELS[motivo], "motivo sem rótulo: " + motivo);
  }
  for (const bloco of opcoes.RECORD_BLOCK_TYPES) {
    assert.ok(clinicalRecord.BLOCK_LABELS[bloco], "bloco sem rótulo: " + bloco);
  }
});

test("prontuário encerrado recusa toda alteração, mas aceita bloquear e adendo", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    const patient = await createPatient(agent, {
      fullName: "Encerrado Teste",
      email: "encerrado@example.com"
    });

    const aberto = await agent
      .post(`/api/admin/patients/${patient.id}/clinical-record`)
      .expect(201);
    const recordId = aberto.body.data.id;

    await agent
      .put(`/api/admin/clinical-records/${recordId}/blocks/contract`)
      .send({ sections: [{ id: "agreement", items: [{ id: "modality", answer: "Online" }] }] })
      .expect(200);
    const evolucao = await agent
      .post("/api/admin/evolutions")
      .send({ patientId: patient.id, evolutionType: "session", content: "Encontro." })
      .expect(201);

    await agent
      .post(`/api/admin/clinical-records/${recordId}/close`)
      .send({ closingReason: "dropout", sections: [] })
      .expect(200);

    // As três alterações que o servidor deixava passar enquanto a tela já as
    // escondia: emitir documento, concluir bloco e salvar bloco.
    await agent
      .post(`/api/admin/clinical-records/${recordId}/documents`)
      .send({ documentType: "report", body: "Depois do encerramento." })
      .expect(409);
    await agent
      .post(`/api/admin/clinical-records/${recordId}/blocks/contract/complete`)
      .expect(409);
    await agent
      .put(`/api/admin/clinical-records/${recordId}/blocks/contract`)
      .send({ sections: [] })
      .expect(409);

    // Bloquear só aperta, nunca afrouxa: continua permitido, como em
    // lockIntake e lockEvolution.
    const bloqueado = await agent
      .post(`/api/admin/clinical-records/${recordId}/blocks/contract/lock`)
      .expect(200);
    assert.equal(bloqueado.body.data.status, "locked");

    // E o adendo é o caminho de correção de um registro fechado.
    await agent
      .post(`/api/admin/evolutions/${evolucao.body.data.id}/addendum`)
      .send({ content: "Retificação depois do encerramento.", evolutionType: "correction" })
      .expect(201);
  } finally {
    await destroyTestContext(context);
  }
});

test("abrir prontuário sobrevive a chamadas simultâneas", async () => {
  const context = createTestContext();
  const server = context.app.listen(0);

  try {
    const agent = request.agent(server);
    await loginAsAdmin(agent);
    const patient = await createPatient(agent, {
      fullName: "Corrida Teste",
      email: "corrida@example.com"
    });

    // Um clique duplo, ou duas abas: o índice único de patient_id não pode
    // virar 500 na cara de quem só clicou duas vezes.
    const respostas = await Promise.all(
      new Array(5)
        .fill(0)
        .map(() => agent.post(`/api/admin/patients/${patient.id}/clinical-record`))
    );

    assert.ok(respostas.every((r) => r.status < 500), respostas.map((r) => r.status).join(","));
    const ids = new Set(respostas.filter((r) => r.body?.data).map((r) => r.body.data.id));
    assert.equal(ids.size, 1, "abriram prontuários diferentes para o mesmo paciente");

    const linhas = context.app.locals.dependencies.db
      .prepare("SELECT COUNT(*) AS total FROM clinical_records WHERE patient_id = ?")
      .get(patient.id);
    assert.equal(linhas.total, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await destroyTestContext(context);
  }
});
