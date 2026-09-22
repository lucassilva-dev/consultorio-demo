const { config } = require("../src/config");
const { createDatabase } = require("../src/db/database");
const { createAdminRepository } = require("../src/repositories/admin-repository");
const { createClinicRepository } = require("../src/repositories/clinic-repository");
const { createClinicalRepository } = require("../src/repositories/clinical-repository");
const { createPhase2Repository } = require("../src/repositories/phase2-repository");
const { createSiteRepository } = require("../src/repositories/site-repository");
const { ensureUploadDirectory } = require("../src/services/bootstrap");
const clinicalService = require("../src/services/clinical");
const { generateReceiptForSession } = require("../src/services/receipts");
const { buildDefaultPayload } = require("../src/lib/clinical-template");
const { clinicLocalToInstant, getClinicDateParts } = require("../src/lib/clinic-time");
const { hasClinicalEncryption } = require("../src/lib/clinical-crypto");
const { buildSchemas, validateWithSchema } = require("../src/lib/validation");
const {
  hashPassword,
  parseSerializedPasswordRecord,
  verifyPassword
} = require("../src/lib/password");

const DEMO_PHONE = "31900000000";

const DEMO_PATIENTS = [
  {
    patient: {
      fullName: "Helena Demonstração Ramos",
      preferredName: "Helena",
      birthDate: "1991-04-12",
      email: "helena.demo@exemplo.com",
      patientType: "adulto",
      sessionPrice: 180,
      defaultWeekday: "segunda",
      defaultTime: "19:00",
      modality: "online",
      status: "ativo"
    },
    withClinicalRecord: true,
    sessions: [
      { dayOffset: -21, hour: 19, status: "realizada", paymentStatus: "pago", paymentMethod: "pix", receipt: true },
      { dayOffset: -14, hour: 19, status: "realizada", paymentStatus: "pago", paymentMethod: "pix", receipt: true },
      { dayOffset: -7, hour: 19, status: "realizada", paymentStatus: "pendente", paymentMethod: "pix" },
      { dayOffset: 7, hour: 19, status: "agendada", paymentStatus: "pendente", paymentMethod: "pix" }
    ]
  },
  {
    patient: {
      fullName: "Otávio Exemplo Nogueira",
      preferredName: "Otávio",
      birthDate: "1998-09-03",
      email: "otavio.demo@exemplo.com",
      patientType: "jovem_adulto",
      sessionPrice: 150,
      defaultWeekday: "quarta",
      defaultTime: "18:00",
      modality: "online",
      status: "ativo"
    },
    sessions: [
      { dayOffset: -12, hour: 18, status: "realizada", paymentStatus: "pago", paymentMethod: "cartao" },
      { dayOffset: -5, hour: 18, status: "falta", paymentStatus: "pendente", paymentMethod: "pix" },
      { dayOffset: 2, hour: 18, status: "agendada", paymentStatus: "pendente", paymentMethod: "pix" }
    ]
  },
  {
    patient: {
      fullName: "Lívia Fictícia Moreira",
      preferredName: "Lívia",
      birthDate: "2010-02-20",
      email: "livia.demo@exemplo.com",
      patientType: "adolescente",
      guardianName: "Responsável Fictício Moreira",
      guardianPhone: DEMO_PHONE,
      sessionPrice: 160,
      defaultWeekday: "terca",
      defaultTime: "17:00",
      modality: "online",
      status: "ativo"
    },
    sessions: [
      { dayOffset: -9, hour: 17, status: "realizada", paymentStatus: "isento", paymentMethod: "outro" },
      { dayOffset: -2, hour: 17, status: "cancelada", paymentStatus: "cancelado", paymentMethod: "pix" },
      { dayOffset: 5, hour: 17, status: "agendada", paymentStatus: "pendente", paymentMethod: "pix" }
    ]
  },
  {
    patient: {
      fullName: "Caio Inventado Siqueira",
      preferredName: "Caio",
      birthDate: "1985-11-30",
      email: "caio.demo@exemplo.com",
      patientType: "adulto",
      sessionPrice: 200,
      defaultWeekday: "quinta",
      defaultTime: "20:00",
      modality: "online",
      status: "pausado",
      administrativeNote: "Paciente fictício para demonstração."
    },
    sessions: [
      { dayOffset: -30, hour: 20, status: "realizada", paymentStatus: "pago", paymentMethod: "dinheiro" },
      { dayOffset: 14, hour: 20, status: "agendada", paymentStatus: "pendente", paymentMethod: "pix" }
    ]
  }
];

const DEMO_INTAKE_ANSWERS = {
  main_complaint: "Relata cansaço constante e dificuldade de desligar do trabalho à noite.",
  symptoms: "Sono fragmentado, irritabilidade e preocupação antecipatória.",
  demand_duration: "Cerca de seis meses, desde a mudança de função no trabalho.",
  search_motivation: "Indicação de uma amiga depois de uma semana especialmente difícil.",
  previous_psychological: "Fez acompanhamento por um ano durante a graduação.",
  current_medication: "Não usa medicação.",
  sleep: "Dorme cerca de cinco horas por noite, com despertares.",
  work_studies: "Trabalha em regime híbrido, com jornadas longas.",
  support_network: "Conta com a irmã e um grupo pequeno de amigos.",
  therapy_expectation: "Entender o próprio ritmo e aprender a colocar limites.",
  initial_goals: "Organizar a rotina de descanso e nomear o que gera sobrecarga."
};

const DEMO_EVOLUTIONS = [
  {
    sessionIndex: 0,
    title: "Sessão inicial",
    content:
      "Conteúdo fictício. Primeira sessão dedicada ao acolhimento e ao levantamento da demanda. " +
      "A paciente descreveu a rotina de trabalho e os momentos em que a sobrecarga aparece. " +
      "Combinado o contrato terapêutico e a frequência semanal."
  },
  {
    sessionIndex: 1,
    title: "Rotina e limites",
    content:
      "Conteúdo fictício. Retomada dos episódios da semana. Surgiu a dificuldade de recusar " +
      "demandas extras e a culpa associada ao descanso. Trabalhado o mapeamento das situações " +
      "em que o limite é ultrapassado."
  }
];

function fail(message) {
  console.error(`[seed:demo] ${message}`);
  process.exit(1);
}

function buildScheduledAt(dayOffset, hour) {
  const today = getClinicDateParts();
  return clinicLocalToInstant(today.year, today.month, today.day + dayOffset, hour, 0).toISOString();
}

function buildPatientPayload(patient) {
  return {
    birthDate: "",
    age: "",
    phone: DEMO_PHONE,
    guardianName: "",
    guardianPhone: "",
    administrativeNote: "",
    ...patient
  };
}

function buildSessionPayload(patientId, patient, spec) {
  const scheduledAt = buildScheduledAt(spec.dayOffset, spec.hour);
  return {
    patientId,
    scheduledAt,
    durationMinutes: 50,
    status: spec.status,
    paymentStatus: spec.paymentStatus,
    price: patient.sessionPrice,
    paymentMethod: spec.paymentMethod,
    paidAt: spec.paymentStatus === "pago" ? scheduledAt : "",
    meetingUrl: "",
    administrativeNote: ""
  };
}

function buildIntakePayload() {
  const payload = buildDefaultPayload("intake");
  return {
    sections: payload.sections.map((section) => ({
      ...section,
      items: section.items.map((item) => ({
        ...item,
        answer: DEMO_INTAKE_ANSWERS[item.id] || item.answer || ""
      }))
    }))
  };
}

function resolvePasswordRecord(existingAdmin) {
  const seedPassword = process.env.SEED_ADMIN_PASSWORD || "";
  let record = existingAdmin || null;

  if (config.adminPasswordHash) {
    try {
      record = parseSerializedPasswordRecord(config.adminPasswordHash);
    } catch (error) {
      fail(`${error.message} Gere um hash com \`npm run admin:hash\` ou remova a variável e use SEED_ADMIN_PASSWORD.`);
    }
  }

  if (!record) {
    if (!seedPassword) {
      fail("Defina ADMIN_PASSWORD_HASH ou SEED_ADMIN_PASSWORD para criar o administrador.");
    }

    if (seedPassword.length < config.adminInitialPasswordMinLength) {
      fail(`SEED_ADMIN_PASSWORD deve ter pelo menos ${config.adminInitialPasswordMinLength} caracteres.`);
    }

    const hashed = hashPassword(seedPassword);
    return {
      record: {
        password_hash: hashed.hash,
        password_salt: hashed.salt,
        password_iterations: hashed.iterations
      },
      displayPassword: seedPassword
    };
  }

  if (seedPassword && !verifyPassword(seedPassword, record)) {
    fail(
      "SEED_ADMIN_PASSWORD não confere com a senha em vigor do administrador " +
        "(ADMIN_PASSWORD_HASH ou a já cadastrada). Use a mesma senha ou remova a variável."
    );
  }

  return {
    record,
    displayPassword: seedPassword || "(a mesma usada para gerar ADMIN_PASSWORD_HASH ou já cadastrada)"
  };
}

async function seedAdmin(repositories) {
  if (!config.adminEmail) {
    fail("Defina ADMIN_EMAIL antes de rodar o seed.");
  }

  const existingAdmin = await repositories.admins.findByEmail(config.adminEmail);
  const { record, displayPassword } = resolvePasswordRecord(existingAdmin);

  if (existingAdmin) {
    console.info(`[seed:demo] Administrador ${config.adminEmail} já existe.`);
    return { admin: existingAdmin, displayPassword };
  }

  const admin = await repositories.admins.createAdminUserFromRecord(config.adminEmail, record);
  console.info(`[seed:demo] Administrador ${config.adminEmail} criado.`);
  return { admin, displayPassword };
}

async function seedPatient(repositories, schemas, demo) {
  const existingPatients = await repositories.clinic.listPatients({});
  const existing = existingPatients.find((item) => item.email === demo.patient.email);
  if (existing) {
    console.info(`[seed:demo] Paciente ${existing.fullName} já existe.`);
    return existing;
  }

  const payload = validateWithSchema(schemas.patientSchema, buildPatientPayload(demo.patient));
  const created = await repositories.clinic.createPatient(payload);
  console.info(`[seed:demo] Paciente ${created.fullName} criado.`);
  return created;
}

async function seedSessions(repositories, schemas, patient, demo) {
  const existingSessions = await repositories.clinic.listSessions({ patientId: patient.id });
  if (existingSessions.length > 0) {
    return [...existingSessions].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  }

  const sessions = [];
  for (const spec of demo.sessions) {
    const payload = validateWithSchema(
      schemas.sessionSchema,
      buildSessionPayload(patient.id, demo.patient, spec)
    );
    sessions.push(await repositories.clinic.createSession(payload));
  }
  console.info(`[seed:demo] ${sessions.length} sessões criadas para ${patient.fullName}.`);
  return sessions;
}

async function seedReceipts(repositories, sessions, demo) {
  for (const [index, spec] of demo.sessions.entries()) {
    const session = sessions[index];
    if (!spec.receipt || !session || session.paymentStatus !== "pago") {
      continue;
    }

    const { receipt, reused } = await generateReceiptForSession({
      sessionId: session.id,
      repositories,
      runtimeConfig: config
    });
    console.info(
      `[seed:demo] Recibo ${receipt.receiptNumber} ${reused ? "já existia" : "gerado"} para a sessão ${session.id}.`
    );
  }
}

async function seedClinicalRecord(repositories, patient, sessions, adminUser) {
  const existingIntake = await repositories.clinical.getIntakeByPatientId(patient.id);
  if (!existingIntake) {
    await clinicalService.createIntakeForPatient({
      patientId: patient.id,
      payload: buildIntakePayload(),
      adminUser,
      repositories,
      runtimeConfig: config
    });
    console.info(`[seed:demo] Anamnese criada para ${patient.fullName}.`);
  }

  const existingEvolutions = await repositories.clinical.listEvolutionsByPatientId(patient.id);
  if (existingEvolutions.length > 0) {
    return;
  }

  for (const evolution of DEMO_EVOLUTIONS) {
    const session = sessions[evolution.sessionIndex];
    await clinicalService.createEvolution({
      payload: {
        patientId: patient.id,
        sessionId: session.id,
        evolutionDate: session.scheduledAt,
        evolutionType: "session",
        title: evolution.title,
        content: evolution.content
      },
      adminUser,
      repositories,
      runtimeConfig: config
    });
  }
  console.info(`[seed:demo] ${DEMO_EVOLUTIONS.length} evoluções criadas para ${patient.fullName}.`);
}

async function main() {
  if (config.isProduction && !process.argv.includes("--force")) {
    fail("Recusado com NODE_ENV=production. Use `npm run seed:demo -- --force` se tiver certeza.");
  }

  if (!hasClinicalEncryption(config)) {
    fail("Defina TOKEN_ENCRYPTION_KEY (32 bytes em base64) para gravar o prontuário criptografado.");
  }

  const db = createDatabase(config);

  try {
    const repositories = {
      admins: createAdminRepository(db),
      site: createSiteRepository(db),
      clinic: createClinicRepository(db),
      clinical: createClinicalRepository(db),
      phase2: createPhase2Repository(db, config)
    };
    const schemas = buildSchemas(config);

    await repositories.site.seedDefaults();
    await repositories.clinic.seedDefaults();
    await ensureUploadDirectory(config);
    console.info("[seed:demo] Conteúdo público e configurações padrão garantidos.");

    const { admin, displayPassword } = await seedAdmin(repositories);
    const adminUser = { sub: admin.id, email: admin.email };

    for (const demo of DEMO_PATIENTS) {
      const patient = await seedPatient(repositories, schemas, demo);
      const sessions = await seedSessions(repositories, schemas, patient, demo);
      await seedReceipts(repositories, sessions, demo);
      if (demo.withClinicalRecord) {
        await seedClinicalRecord(repositories, patient, sessions, adminUser);
      }
    }

    console.info("");
    console.info("[seed:demo] Pronto. Acesso ao painel em /admin/login:");
    console.info(`  e-mail: ${admin.email}`);
    console.info(`  senha:  ${displayPassword}`);
  } finally {
    if (db.kind === "postgres") {
      await db.end({ timeout: 5 });
    } else {
      db.close();
    }
  }
}

main().catch((error) => {
  console.error("[seed:demo] Falha no seed.", {
    message: error.message,
    name: error.name
  });
  process.exit(1);
});
