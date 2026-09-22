-- Numeração de recibo em contador próprio.
--
-- Antes o próximo número era MAX(sequence_number) + 1 lido da própria tabela de
-- recibos. Isso tem dois problemas: apagar o último recibo (o que acontecia em
-- cascata ao excluir sessão ou paciente) devolvia o número ao pool, e dois
-- recibos diferentes podiam sair com o mesmo número; e a leitura acontecia fora
-- de transação, com render de PDF e upload no meio, então duas emissões
-- simultâneas colidiam na constraint de unicidade.
--
-- O contador só avança. Buracos na sequência são aceitáveis (o documento não
-- substitui nota fiscal); número repetido não é.
CREATE TABLE IF NOT EXISTS receipt_sequence (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  next_value INTEGER NOT NULL
);

INSERT INTO receipt_sequence (id, next_value)
SELECT 1, COALESCE((SELECT MAX(sequence_number) FROM receipts), 0) + 1
WHERE NOT EXISTS (SELECT 1 FROM receipt_sequence WHERE id = 1);
