const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const request = require("supertest");
const {
  SAMPLE_PNG,
  createTestContext,
  destroyTestContext,
  loginAsAdmin,
  createPatient,
  createSession
} = require("./helpers");

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
