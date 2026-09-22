-- Sem efeito no SQLite: as restrições abaixo já existem nas definições de tabela
-- das migrações 003 e 005, aplicadas no CREATE TABLE.
--
-- Este arquivo existe para manter as duas fontes de migração alinhadas (há um
-- teste que compara os nomes). O conteúdo real está na versão Postgres, em
-- src/db/run-migrations.js, onde as mesmas colunas foram criadas como TEXT livre
-- e aceitavam qualquer status.
SELECT 1;
