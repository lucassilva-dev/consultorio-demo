/**
 * Verificação do caminho Postgres.
 *
 * A suíte (`npm test`) roda em SQLite. Isso deixa cego para uma classe inteira de
 * defeito: SQL malformado só no dialeto Postgres, divergência de tipo entre os
 * dois drivers, migração que aplica num banco e não no outro. Dois defeitos assim
 * já chegaram em produção — ids devolvidos como string e placeholder de parâmetro
 * sem o cifrão.
 *
 * Este script sobe a aplicação de verdade contra um Postgres descartável, roda as
 * migrações duas vezes (para provar idempotência) e exercita os fluxos que
 * dependem do dialeto. Serve para rodar ANTES de `npm run migrate:prod`.
 *
 * Uso:
 *   docker run -d --rm --name cv2-pg -e POSTGRES_PASSWORD=teste \
 *     -e POSTGRES_DB=cv2 -p 55432:5432 postgres:16-alpine
 *   npm run verify:postgres
 *   docker stop cv2-pg
 *
 * A URL pode ser trocada por VERIFY_DATABASE_URL. Nunca aponte para produção: o
 * script escreve dados de teste.
 */
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createApp } = require("../src/app");
const { createMigrationDatabase } = require("../src/db/database");
const { runMigrations } = require("../src/db/run-migrations");
const { hashPassword, serializePasswordRecord } = require("../src/lib/password");

const URL_PADRAO = "postgres://postgres:teste@127.0.0.1:55432/cv2";
const url = process.env.VERIFY_DATABASE_URL || URL_PADRAO;
const SENHA = "senha-de-verificacao-123";

const resultados = [];
function checa(nome, ok, detalhe) {
  resultados.push({ nome, ok: Boolean(ok), detalhe: detalhe || "" });
}

function baseConfig(raiz) {
  return {
    nodeEnv: "development",
    dataProvider: "postgres",
    databaseUrl: url,
    databaseMigrationUrl: url,
    postgresSslMode: process.env.VERIFY_SSL_MODE || undefined,
    storageProvider: "local",
    uploadDir: path.join(raiz, "uploads"),
    sessionSecret: "x".repeat(40),
    authCookieSecret: "y".repeat(40),
    adminEmail: "verificacao@example.com",
    adminPasswordHash: serializePasswordRecord(hashPassword(SENHA)),
    tokenEncryptionKey: crypto.randomBytes(32).toString("base64"),
    runDatabaseMigrationsOnBoot: true,
    logBootstrap: false
  };
}

async function verificarMigracoes(raiz) {
  const db = createMigrationDatabase(baseConfig(raiz));
  try {
    await runMigrations(db);
    // De novo: migração não idempotente trava o boot seguinte.
    await runMigrations(db);

    const arquivos = fs
      .readdirSync(path.join(__dirname, "..", "src", "db", "migrations"))
      .filter((nome) => nome.endsWith(".sql"))
      .map((nome) => nome.replace(/\.sql$/, ""))
      .sort();
    const aplicadas = (await db`SELECT name FROM _migrations ORDER BY name`).map((m) => m.name);

    checa(
      "todas as migrações aplicadas no Postgres",
      arquivos.every((nome) => aplicadas.includes(nome)),
      `esperadas ${arquivos.length}, aplicadas ${aplicadas.length}`
    );

    const contador = await db`SELECT next_value FROM receipt_sequence WHERE id = 1`;
    checa("contador de recibo existe", contador.length === 1);

    const epoch = await db`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'admin_users' AND column_name = 'session_epoch'
    `;
    checa("coluna session_epoch existe", epoch.length === 1);

    const checks = (await db`SELECT conname FROM pg_constraint WHERE contype = 'c'`).map(
      (c) => c.conname
    );
    for (const nome of [
      "clinical_intakes_status_check",
      "clinical_evolutions_status_check",
      "clinical_evolutions_type_check",
      "clinic_sessions_google_sync_status_check",
      "clinical_records_status_check",
      "clinical_records_closing_reason_check",
      "clinical_record_blocks_block_type_check",
      "clinical_record_blocks_status_check",
      "clinical_documents_document_type_check",
      "clinical_documents_status_check"
    ]) {
      checa("restrição " + nome, checks.includes(nome));
    }

    const contadorProntuario = await db`SELECT next_value FROM clinical_record_sequence WHERE id = 1`;
    checa("contador de prontuário existe", contadorProntuario.length === 1);
    const contadorDocumento = await db`SELECT next_value FROM clinical_document_sequence WHERE id = 1`;
    checa("contador de documento existe", contadorDocumento.length === 1);
  } finally {
    await db.end({ timeout: 5 });
  }
}

function criarCliente(base) {
  const estado = { cookie: "" };
  return async function req(metodo, caminho, corpo) {
    const headers = { Accept: "application/json" };
    if (corpo !== undefined) headers["Content-Type"] = "application/json";
    if (estado.cookie) headers.Cookie = estado.cookie;

    const resposta = await fetch(base + caminho, {
      method: metodo,
      headers,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      redirect: "manual"
    });

    const set = resposta.headers.get("set-cookie");
    if (set) {
      const par = set.split(";")[0];
      if (!par.endsWith("=")) estado.cookie = par;
    }

    const texto = await resposta.text();
    let json = null;
    try {
      json = JSON.parse(texto);
    } catch (erro) {
      json = null;
    }
    return { status: resposta.status, json, texto };
  };
}

async function verificarAplicacao(raiz) {
  const context = createApp(baseConfig(raiz));
  const servidor = context.app.listen(0);
  await new Promise((resolve) => servidor.once("listening", resolve));

  try {
    const req = criarCliente("http://127.0.0.1:" + servidor.address().port);

    const login = await req("POST", "/api/admin/login", {
      email: "verificacao@example.com",
      password: SENHA
    });
    checa("login", login.status === 200, "status " + login.status);

    for (const rota of [
      "/api/admin/leads",
      "/api/admin/patients",
      "/api/admin/sessions",
      "/api/admin/finance/summary",
      "/api/admin/finance/export.csv",
      "/api/admin/receipts",
      "/api/admin/receipts?basis=caixa",
      "/api/admin/message-templates",
      "/api/admin/audit-logs",
      "/api/admin/platform-settings"
    ]) {
      const r = await req("GET", rota);
      checa("GET " + rota, r.status === 200, "status " + r.status);
    }

    const paciente = await req("POST", "/api/admin/patients", {
      fullName: "Verificação Postgres",
      preferredName: "Verificação",
      birthDate: "",
      age: "30",
      phone: "31999990000",
      email: "",
      patientType: "adulto",
      guardianName: "",
      guardianPhone: "",
      sessionPrice: 180,
      defaultWeekday: "",
      defaultTime: "",
      modality: "online",
      status: "ativo",
      administrativeNote: ""
    });
    checa("cria paciente", paciente.status === 201, JSON.stringify(paciente.json));
    const pid = paciente.json && paciente.json.data && paciente.json.data.id;
    checa("id de paciente é número", typeof pid === "number", "tipo " + typeof pid);

    const sessao = await req("POST", "/api/admin/sessions", {
      patientId: pid,
      scheduledAt: "2026-06-30T21:00",
      durationMinutes: 50,
      status: "realizada",
      paymentStatus: "pendente",
      price: 180,
      paymentMethod: "pix",
      paidAt: "",
      meetingUrl: "",
      administrativeNote: ""
    });
    checa("cria sessão", sessao.status === 201, JSON.stringify(sessao.json));
    const sid = sessao.json.data.id;

    const junho = await req("GET", "/api/admin/finance/summary?month=6&year=2026");
    checa(
      "sessão das 21h de 30/06 entra em junho",
      junho.json.data.summary.completedSessions >= 1,
      "completedSessions=" + junho.json.data.summary.completedSessions
    );

    await req("POST", "/api/admin/sessions/" + sid + "/mark-paid", {});
    const recibo = await req("POST", "/api/admin/sessions/" + sid + "/receipt", {});
    checa("gera recibo", recibo.status === 201, JSON.stringify(recibo.json));

    const download = await req("GET", "/api/admin/receipts/" + recibo.json.data.id + "/download");
    checa("baixa recibo", download.status === 200 && download.texto.indexOf("%PDF") === 0);

    // Vínculo adendo -> original: comparação estrita de id, que já quebrou só em
    // produção quando o driver devolvia string.
    const evolucao = await req("POST", "/api/admin/evolutions", {
      patientId: pid,
      evolutionType: "session",
      title: "Original",
      evolutionDate: "2026-06-30T21:00",
      content: "Primeira redação do registro."
    });
    checa("cria evolução", evolucao.status === 201, JSON.stringify(evolucao.json));
    const eid = evolucao.json.data.id;

    await req("POST", "/api/admin/evolutions/" + eid + "/sign", {});
    await req("POST", "/api/admin/evolutions/" + eid + "/addendum", {
      content: "Retificação registrada."
    });

    const lista = await req("GET", "/api/admin/patients/" + pid + "/evolutions");
    const original = lista.json.data.items.find((item) => item.id === eid);
    const adendo = lista.json.data.items.find((item) => item.parentEvolutionId === eid);
    checa("vínculo adendo -> original fecha em comparação estrita", Boolean(adendo));
    checa("original marcado como retificado", Boolean(original && original.hasAmendments));

    // Ciclo do prontuário. É onde mais divergem os dois bancos: BIGSERIAL volta
    // como string no driver, o UPDATE ... RETURNING dos contadores tem sintaxe
    // própria e o ON CONFLICT não existe no SQLite.
    // A evolução acima já abriu o prontuário: a chamada aqui pode responder
    // 201 (criou) ou 200 (já existia), e as duas estão certas.
    const prontuario = await req("POST", "/api/admin/patients/" + pid + "/clinical-record");
    checa(
      "abre prontuário",
      (prontuario.status === 200 || prontuario.status === 201) &&
        /^PRT-\d{6}$/.test(prontuario.json.data.recordNumber || ""),
      JSON.stringify(prontuario.json)
    );
    const rid = prontuario.json.data.id;

    const repetido = await req("POST", "/api/admin/patients/" + pid + "/clinical-record");
    checa(
      "abrir de novo devolve o mesmo prontuário",
      repetido.status === 200 && String(repetido.json.data.id) === String(rid)
    );

    const contrato = await req("PUT", "/api/admin/clinical-records/" + rid + "/blocks/contract", {
      sections: [{ id: "agreement", items: [{ id: "modality", answer: "Online, por vídeo" }] }]
    });
    checa("grava contrato", contrato.status === 200, JSON.stringify(contrato.json));

    const contratoEditado = await req(
      "PUT",
      "/api/admin/clinical-records/" + rid + "/blocks/contract",
      { sections: [{ id: "agreement", items: [{ id: "modality", answer: "Presencial" }] }] }
    );
    checa(
      "editar contrato guarda versão anterior",
      contratoEditado.status === 200 && contratoEditado.json.data.versionsCount === 1,
      "versionsCount=" + contratoEditado.json.data.versionsCount
    );

    const contratoLido = await req("GET", "/api/admin/clinical-records/" + rid + "/blocks/contract");
    checa(
      "contrato volta decifrado",
      contratoLido.json.data.block.payload.sections[0].items[0].answer === "Presencial"
    );

    const blocoPdf = await req(
      "GET",
      "/api/admin/clinical-records/" + rid + "/blocks/contract/export.pdf"
    );
    checa("exporta contrato", blocoPdf.status === 200 && blocoPdf.texto.indexOf("%PDF") === 0);

    const documento = await req("POST", "/api/admin/clinical-records/" + rid + "/documents", {
      documentType: "attendance_declaration",
      title: "Comparecimento",
      addressee: "A quem possa interessar",
      purpose: "Justificar ausência",
      body: "Compareceu ao atendimento nesta data."
    });
    checa(
      "emite documento numerado",
      documento.status === 201 && /^DOC-\d{6}$/.test(documento.json.data.documentNumber || ""),
      JSON.stringify(documento.json)
    );

    const docPdf = await req(
      "GET",
      "/api/admin/clinical-documents/" + documento.json.data.id + "/download"
    );
    checa("baixa documento", docPdf.status === 200 && docPdf.texto.indexOf("%PDF") === 0);

    const encerrado = await req("POST", "/api/admin/clinical-records/" + rid + "/close", {
      closingReason: "discharge",
      sections: [{ id: "closing", items: [{ id: "synthesis", answer: "Alta combinada." }] }]
    });
    checa(
      "encerra prontuário",
      encerrado.status === 200 && encerrado.json.data.status === "closed",
      JSON.stringify(encerrado.json)
    );

    const recusada = await req("POST", "/api/admin/evolutions", {
      patientId: pid,
      evolutionType: "session",
      content: "Depois do encerramento."
    });
    checa("prontuário encerrado recusa registro novo", recusada.status === 409, "status " + recusada.status);

    const anamneseDepois = await req("GET", "/api/admin/patients/" + pid + "/intake");
    checa(
      "encerrado devolve editable falso",
      anamneseDepois.json.data.intake === null ||
        anamneseDepois.json.data.intake.editable === false
    );

    const reaberto = await req("POST", "/api/admin/clinical-records/" + rid + "/reopen", {
      reason: "Retomada do acompanhamento."
    });
    checa("reabre prontuário", reaberto.status === 200 && reaberto.json.data.status === "open");

    const pdf = await req("GET", "/api/admin/patients/" + pid + "/clinical-record/export.pdf");
    checa("exporta prontuário", pdf.status === 200 && pdf.texto.indexOf("%PDF") === 0);

    // Parâmetro fora de faixa não pode virar 500 em nenhum dos dois bancos.
    for (const rota of [
      "/api/admin/finance/summary?year=999999",
      "/api/admin/receipts?month=1e30",
      "/api/admin/audit-logs?page=Infinity",
      "/api/admin/audit-logs?pageSize=1.5",
      "/api/admin/sessions?patientId=abc"
    ]) {
      const r = await req("GET", rota);
      checa("sem 5xx em " + rota, r.status < 500, "status " + r.status);
    }
  } finally {
    servidor.close();
    if (context.close) await context.close();
  }
}

async function main() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "cv2-verify-pg-"));
  console.info("[verify:postgres] banco:", url.replace(/:[^:@]*@/, ":***@"));

  try {
    await verificarMigracoes(raiz);
    await verificarAplicacao(raiz);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }

  const falhas = resultados.filter((r) => !r.ok);
  for (const r of resultados) {
    console.info((r.ok ? "ok   " : "FALHA") + "  " + r.nome + (r.ok ? "" : "  -> " + r.detalhe));
  }
  console.info("");
  console.info(resultados.length + " verificações, " + falhas.length + " falha(s)");

  if (falhas.length) {
    process.exitCode = 1;
  }
}

main().catch((erro) => {
  console.error("[verify:postgres] falhou:", erro.stack);
  process.exitCode = 1;
});
