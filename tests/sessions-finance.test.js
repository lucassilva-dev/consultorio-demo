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
