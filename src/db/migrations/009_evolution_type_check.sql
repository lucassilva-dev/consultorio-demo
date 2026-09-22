-- Sem efeito no SQLite: o CHECK de evolution_type já vem da migração 005, na
-- definição da tabela.
--
-- A migração 008 levou para o Postgres os CHECKs de status, mas deixou este de
-- fora — evolution_type continuava sendo TEXT livre lá. O conteúdo real está na
-- versão Postgres, em src/db/run-migrations.js.
SELECT 1;
