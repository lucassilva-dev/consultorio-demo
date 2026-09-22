const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const {
  createTestContext,
  destroyTestContext,
  loginAsAdmin,
  createPatient,
  createSession
} = require("./helpers");

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
