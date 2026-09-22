const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const request = require("supertest");
const { encryptClinicalText } = require("../src/lib/clinical-crypto");
const {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  createTestContext,
  destroyTestContext,
  loginAsAdmin,
  createPatient,
  createSession
} = require("./helpers");

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
