const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  TOKEN_ENCRYPTION_KEY,
  createTestContext,
  destroyTestContext,
  loginAsAdmin,
  createPatient,
  createSession
} = require("./helpers");

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
