# Consultório — site público + painel administrativo

Aplicação Node.js + Express que entrega um site institucional editável e um painel administrativo com agenda, prontuário criptografado e emissão de recibos em PDF.

Esta é uma **versão demonstrativa**. Nome, registro profissional, contatos, imagens e domínio foram substituídos por dados fictícios, e o repositório foi criado sem o histórico do projeto original. Nenhum dado de paciente existe aqui: prontuários, uploads e documentos ficam fora do versionamento.

## O que a aplicação faz

- Site público renderizado no servidor a partir de conteúdo editável no banco
- Painel administrativo com login por cookie assinado
- Cadastro de pacientes, agenda de sessões e controle de pagamento
- Prontuário clínico com anamnese e evoluções, armazenado criptografado
- Recibos em PDF vinculados às sessões pagas, com numeração sequencial
- Sincronização opcional com Google Calendar
- Trilha de auditoria das ações administrativas

## Arquitetura

O fluxo de uma requisição atravessa três camadas com responsabilidades separadas:

```
routes.js  →  services/  →  repositories/  →  banco
```

- **routes**: entrada HTTP, validação de contrato com Zod, autenticação e tradução de erro em status code
- **services**: regra de negócio (prontuário, recibos, agenda, conteúdo público). Não conhece SQL nem framework HTTP
- **repositories**: acesso a dados atrás de uma interface única, com duas implementações

A persistência é plugável por variável de ambiente. `DATA_PROVIDER=sqlite` roda local e nos testes; `DATA_PROVIDER=postgres` roda em produção. O mesmo vale para arquivos: `STORAGE_PROVIDER` alterna entre disco local e Supabase Storage. Cada repositório tem o par `sqlite-*` e `postgres-*` implementando o mesmo contrato, o que mantém o teste rápido sem divergir do comportamento de produção.

Migrations são arquivos SQL numerados em `src/db/migrations/`, aplicados por um runner próprio. Em produção elas não rodam na subida da aplicação: existe um script de migração controlada.

## Segurança

O projeto lida com dado de saúde, então a segurança não é acessório:

- **Prontuário criptografado em repouso** com AES-256-GCM e prefixo de versão no valor armazenado, separando conteúdo clínico de outros segredos do sistema
- **Senha** com PBKDF2-SHA256 e 310.000 iterações
- **Sessão** em cookie `HttpOnly` assinado, com epoch de invalidação para revogar sessões ativas
- **Throttle de login** com bloqueio progressivo por IP e por e-mail, que também protege contra negação de serviço, já que cada tentativa custa CPU no PBKDF2
- **Auditoria** com lista de bloqueio de chaves: campos sensíveis nunca entram no metadado do log
- **Sanitização** de HTML no conteúdo editável e cabeçalhos de segurança via Helmet
- **Tokens do Google** guardados criptografados, com chave dedicada

## Como rodar

```bash
cp .env.example .env
npm install
npm run migrate
npm run admin:hash
npm run seed:demo
npm run dev
```

O comando `admin:hash` gera o hash da senha para preencher `ADMIN_PASSWORD_HASH`. O site sobe em `http://localhost:3000` e o painel em `/admin/login`.

### Dados de demonstração

O `seed:demo` roda depois das migrations e deixa o painel pronto para navegar com dados fictícios. O seed precisa de `ADMIN_EMAIL`, de `TOKEN_ENCRYPTION_KEY` (chave de 32 bytes em base64, usada para cifrar o prontuário) e de uma senha para o admin, por um destes caminhos:

- `ADMIN_PASSWORD_HASH` preenchido com a saída de `npm run admin:hash`
- `SEED_ADMIN_PASSWORD` com a senha em texto (mínimo de 10 caracteres), deixando `ADMIN_PASSWORD_HASH` vazio. O seed gera o hash com o mesmo `src/lib/password.js` da aplicação

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

O comando acima gera um valor válido para `TOKEN_ENCRYPTION_KEY`. Guarde a chave: sem ela o prontuário gravado pelo seed não pode ser lido.

O que o seed cria:

- conteúdo público, modelos de mensagem e configurações a partir de `src/default-content.js` e `src/default-clinic-data.js`
- o administrador, se ainda não existir
- quatro pacientes fictícios (e-mails `@exemplo.com`, telefone `31900000000`) com sessões passadas e futuras e pagamentos pagos, pendentes, isentos e cancelados
- anamnese e duas evoluções para uma das pacientes, gravadas pelos mesmos serviços da aplicação, portanto criptografadas
- recibos para sessões pagas, usando a numeração sequencial

Rodar de novo não duplica nada: cada item é procurado antes de ser criado. Com `NODE_ENV=production` o seed se recusa a rodar, a não ser que receba `npm run seed:demo -- --force`. No fim ele imprime o e-mail e a senha de acesso ao painel. Se a senha veio só por `ADMIN_PASSWORD_HASH`, o seed não tem como conhecê-la e indica que é a mesma usada no `admin:hash`.

## Testes

```bash
npm test
```

Suíte de integração sobre a API com SQLite em memória, cobrindo autenticação, permissões, prontuário, recibos e o comportamento dos dois provedores de persistência.

Cada domínio tem seu arquivo em `tests/` (`auth`, `site-content`, `leads-patients`, `sessions-finance`, `receipts`, `clinical`, `google-calendar`, `persistence`, `error-handling`), e o setup comum, que cria o app isolado com banco temporário e faz login, fica em `tests/helpers.js`. O `npm test` roda todos os `tests/*.test.js` em sequência.

## Estrutura

```
src/
  routes.js          criação do app, cabeçalhos de segurança e ponto único de registro das rotas
  routes/            rotas de cada domínio, helpers de rota e boot das dependências
  services/          regra de negócio
  repositories/      acesso a dados (sqlite e postgres)
  lib/               criptografia, sessão, sanitização, validação
  db/migrations/     schema versionado
  views/             renderização server-side
public/              assets e scripts do cliente
tests/               testes de integração
```

`public/assets/` e `public/colors_and_type.css` não são versionados: `scripts/prepare-static.js` os copia de `assets/` e `colors_and_type.css` na raiz, e roda em `npm run build` e antes de `npm run dev` e `npm start`. Edite sempre os arquivos da raiz.

## Stack

Node.js 22, Express, Zod, better-sqlite3, postgres, Supabase Storage, pdf-lib, googleapis, Helmet, sanitize-html.
