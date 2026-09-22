const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const request = require("supertest");
const {
  deletePrivateDocument,
  ensureStorageReady,
  persistPrivateDocument,
  readPrivateDocument
} = require("../src/services/storage");
const {
  createTestOverrides,
  createTestContext,
  destroyTestContext,
  loginAsAdmin,
  createPatient,
  createSession
} = require("./helpers");

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
