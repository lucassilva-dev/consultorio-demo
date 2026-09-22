const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const request = require("supertest");
const { SAMPLE_PNG, createTestContext, destroyTestContext, loginAsAdmin } = require("./helpers");

test("expõe a página pública de privacidade e deixa o link visível no shell público", async () => {
  const context = createTestContext();

  try {
    const privacyPage = await request(context.app).get("/privacidade").expect(200);
    assert.match(privacyPage.text, /Como os dados administrativos são tratados/i);
    assert.match(privacyPage.text, /site não é canal de emergência/i);

    const homePage = await request(context.app).get("/").expect(200);
    assert.match(homePage.text, /href="\/privacidade"/i);
  } finally {
    await destroyTestContext(context);
  }
});

test("texto do site é guardado literalmente e não chega escapado duas vezes", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    const conteudo = await agent.get("/api/admin/content").expect(200);
    const home = conteudo.body.data.home;

    await agent
      .put("/api/admin/content/home")
      .send({
        ...home,
        title: "Acolhimento & escuta",
        subtitle: "5 < 10 pessoas por semana"
      })
      .expect(200);

    const publico = await agent.get("/api/public/content").expect(200);
    assert.equal(publico.body.data.home.title, "Acolhimento & escuta");
    assert.equal(publico.body.data.home.subtitle, "5 < 10 pessoas por semana");

    // Markup continua sendo removido — o que muda é só o escape duplo.
    await agent
      .put("/api/admin/content/home")
      .send({ ...home, title: "Titulo <script>alert(1)</script> limpo" })
      .expect(200);
    const semScript = await agent.get("/api/public/content").expect(200);
    assert.equal(semScript.body.data.home.title.includes("<script>"), false);
  } finally {
    await destroyTestContext(context);
  }
});

test("card de ajuda aceita imagem do storage externo configurado", async () => {
  const prefixo = "https://projeto.supabase.co/storage/v1/object/public/site-images/";
  const context = createTestContext(undefined, {
    allowedExternalImagePrefixes: [prefixo]
  });

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    const conteudo = await agent.get("/api/admin/content").expect(200);

    const salvo = await agent
      .put("/api/admin/content/help")
      .send({
        eyebrow: conteudo.body.data.help.eyebrow,
        title: conteudo.body.data.help.title,
        cards: [
          {
            title: "Card com imagem",
            description: "Descrição suficientemente longa.",
            assetType: "image",
            assetValue: `${prefixo}site/exemplo.webp`,
            sortOrder: 1
          }
        ]
      })
      .expect(200);

    const card = salvo.body.data.help.cards[0];
    assert.equal(card.assetType, "image");
    assert.equal(card.assetValue, `${prefixo}site/exemplo.webp`);
  } finally {
    await destroyTestContext(context);
  }
});

test("página inicial traz o SEO configurado já no HTML servido", async () => {
  // Com SITE_URL definida, og:image precisa sair como URL absoluta: crawler de
  // prévia não resolve caminho relativo.
  const context = createTestContext(undefined, { siteUrl: "https://exemplo.com" });

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    await agent
      .put("/api/admin/content/seo")
      .send({
        title: "Marina Alves | Psicóloga em BH",
        description: "Atendimento on-line e presencial para adultos e adolescentes.",
        shareImageUrl: "/uploads/compartilhamento.png"
      })
      .expect(200);

    const html = (await request(context.app).get("/").expect(200)).text;

    // Crawlers de prévia não executam JS: isso precisa estar no HTML servido.
    assert.ok(html.includes("<title>Marina Alves | Psicóloga em BH</title>"));
    assert.ok(html.includes("Atendimento on-line e presencial"));
    assert.ok(html.includes('property="og:image"'));
    assert.ok(
      html.includes('content="https://exemplo.com/uploads/compartilhamento.png"'),
      "og:image deve ser absoluta"
    );
    assert.equal(html.includes("Carregando conteúdo."), false);
  } finally {
    await destroyTestContext(context);
  }
});

test("sem SITE_URL a landing omite og:image em vez de publicar caminho relativo", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    await agent
      .put("/api/admin/content/seo")
      .send({
        title: "Título",
        description: "Descrição da página com tamanho suficiente.",
        shareImageUrl: "/uploads/compartilhamento.png"
      })
      .expect(200);

    const html = (await request(context.app).get("/").expect(200)).text;
    // Um og:image relativo não é carregado por nenhum crawler: melhor omitir.
    assert.equal(html.includes('property="og:image"'), false);
  } finally {
    await destroyTestContext(context);
  }
});

test("página de privacidade não republica e-mail que saiu do site", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    const conteudo = await agent.get("/api/admin/content").expect(200);

    // Remove todos os canais: nenhum e-mail pode ser inventado no lugar.
    await agent
      .put("/api/admin/content/contact")
      .send({
        ...conteudo.body.data.contact,
        whatsappNumber: "",
        socialLinks: []
      })
      .expect(200);

    const html = (await request(context.app).get("/privacidade").expect(200)).text;
    assert.equal(/@gmail.com/.test(html), false);
    assert.ok(html.includes("seção de contato"));

    // Com um canal configurado, ele aparece.
    await agent
      .put("/api/admin/content/contact")
      .send({
        ...conteudo.body.data.contact,
        whatsappNumber: "",
        socialLinks: [
          { platform: "email", label: "E-mail", url: "mailto:contato@exemplo.com" }
        ]
      })
      .expect(200);

    const comCanal = (await request(context.app).get("/privacidade").expect(200)).text;
    assert.ok(comCanal.includes("contato@exemplo.com"));
  } finally {
    await destroyTestContext(context);
  }
});

test("trocar a imagem de um bloco remove o arquivo anterior do storage", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    const upload = await agent
      .post("/api/admin/uploads")
      .attach("image", SAMPLE_PNG, { filename: "antiga.png", contentType: "image/png" })
      .expect(200);

    const caminhoAntigo = path.join(
      context.runtimeConfig.uploadDir,
      path.basename(upload.body.data.url)
    );
    assert.equal(fs.existsSync(caminhoAntigo), true);

    const conteudo = await agent.get("/api/admin/content").expect(200);
    await agent
      .put("/api/admin/content/home")
      .send({ ...conteudo.body.data.home, imageUrl: upload.body.data.url })
      .expect(200);

    // Troca por outra imagem: a anterior não pode ficar para trás.
    await agent
      .put("/api/admin/content/home")
      .send({ ...conteudo.body.data.home, imageUrl: "/assets/retrato.png" })
      .expect(200);

    assert.equal(fs.existsSync(caminhoAntigo), false);
  } finally {
    await destroyTestContext(context);
  }
});

test("imagem usada por outro bloco do site não é apagada", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);

    const upload = await agent
      .post("/api/admin/uploads")
      .attach("image", SAMPLE_PNG, { filename: "compartilhada.png", contentType: "image/png" })
      .expect(200);
    const url = upload.body.data.url;
    const caminho = path.join(context.runtimeConfig.uploadDir, path.basename(url));

    const conteudo = await agent.get("/api/admin/content").expect(200);

    // A mesma imagem em dois blocos.
    await agent
      .put("/api/admin/content/home")
      .send({ ...conteudo.body.data.home, imageUrl: url })
      .expect(200);
    await agent
      .put("/api/admin/content/seo")
      .send({ ...conteudo.body.data.seo, shareImageUrl: url })
      .expect(200);

    // Tirar de um bloco não pode apagar o arquivo que o outro ainda usa.
    await agent
      .put("/api/admin/content/home")
      .send({ ...conteudo.body.data.home, imageUrl: "/assets/retrato.png" })
      .expect(200);

    assert.equal(fs.existsSync(caminho), true);

    // Saindo do último bloco que a referenciava, aí sim o arquivo vai embora.
    await agent
      .put("/api/admin/content/seo")
      .send({ ...conteudo.body.data.seo, shareImageUrl: "/assets/retrato.png" })
      .expect(200);

    assert.equal(fs.existsSync(caminho), false);
  } finally {
    await destroyTestContext(context);
  }
});

test("corpo com cards ou socialLinks fora de formato responde 400, não 500", async () => {
  const context = createTestContext();

  try {
    const agent = request.agent(context.app);
    await loginAsAdmin(agent);
    const conteudo = await agent.get("/api/admin/content").expect(200);

    for (const valor of [null, "texto", 42, { a: 1 }]) {
      const r = await agent
        .put("/api/admin/content/help")
        .send({
          eyebrow: conteudo.body.data.help.eyebrow,
          title: conteudo.body.data.help.title,
          cards: valor
        });
      assert.ok(r.status < 500, `cards=${JSON.stringify(valor)} respondeu ${r.status}`);
    }

    const social = await agent
      .put("/api/admin/content/contact")
      .send({ ...conteudo.body.data.contact, socialLinks: null });
    assert.ok(social.status < 500, `socialLinks=null respondeu ${social.status}`);
  } finally {
    await destroyTestContext(context);
  }
});
