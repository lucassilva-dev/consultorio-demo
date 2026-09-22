-- Revogação de sessão no logout.
--
-- O token de sessão é stateless e assinado: limpar o cookie no logout não o
-- invalida, então um token capturado seguia válido por 7 dias. Este contador é
-- incluído no token e incrementado a cada logout — tokens emitidos antes passam
-- a não bater e são recusados.
ALTER TABLE admin_users ADD COLUMN session_epoch INTEGER NOT NULL DEFAULT 0;
