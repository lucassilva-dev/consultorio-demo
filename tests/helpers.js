const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../src/app");
const { hashPassword, serializePasswordRecord } = require("../src/lib/password");

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

module.exports = {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  TOKEN_ENCRYPTION_KEY,
  SAMPLE_PNG,
  createTestOverrides,
  createTestContext,
  destroyTestContext,
  loginAsAdmin,
  createPatient,
  createSession
};
