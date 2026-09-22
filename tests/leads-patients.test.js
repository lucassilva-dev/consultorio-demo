const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createTestContext, destroyTestContext, loginAsAdmin, createPatient } = require("./helpers");

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
