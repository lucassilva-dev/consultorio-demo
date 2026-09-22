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
npm run dev
```

O comando `admin:hash` gera o hash da senha para preencher `ADMIN_PASSWORD_HASH`. O site sobe em `http://localhost:3000` e o painel em `/admin/login`.

## Testes

```bash
npm test
```

Suíte de integração sobre a API com SQLite em memória, cobrindo autenticação, permissões, prontuário, recibos e o comportamento dos dois provedores de persistência.

## Estrutura

```
src/
  routes.js          entrada HTTP e validação
  services/          regra de negócio
  repositories/      acesso a dados (sqlite e postgres)
  lib/               criptografia, sessão, sanitização, validação
  db/migrations/     schema versionado
  views/             renderização server-side
public/              assets e scripts do cliente
tests/               testes de integração
```

## Stack

Node.js 22, Express, Zod, better-sqlite3, postgres, Supabase Storage, pdf-lib, googleapis, Helmet, sanitize-html.
