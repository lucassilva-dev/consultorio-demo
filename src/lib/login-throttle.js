// Limite de tentativas de login.
//
// Sem isso, POST /api/admin/login aceita tentativas ilimitadas. E como a
// verificação de senha usa PBKDF2 com centenas de milhares de iterações, cada
// tentativa também consome CPU: a força bruta vira, de quebra, negação de
// serviço.
//
// O estado é de processo. Em serverless (Vercel) cada instância tem o seu, então
// isto não é uma barreira absoluta — é um freio que encarece muito o ataque e
// protege o caso de uma instância só (Docker, Render). Um limite compartilhado
// exigiria armazenamento externo, que o projeto hoje não tem.

const MAX_TENTATIVAS = 5;
const JANELA_MS = 15 * 60 * 1000;

// Bloqueio progressivo a partir da 5ª falha: 1 min, 5 min, 15 min, 1 h.
// Vale para a chave de IP, que é quem carrega o ataque.
const ESCADA_DE_BLOQUEIO_MS = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000];

// A chave de e-mail existe para conter quem troca de IP, mas NÃO pode escalar:
// este é um consultório com uma única administradora, e um bloqueio de uma hora
// preso ao e-mail dela a tranca fora do próprio painel — sem ninguém para
// destravar. Um minuto fixo já derruba a taxa de tentativas para 5 por minuto,
// que é o que importa, e ela recupera o acesso sozinha em seguida.
const ESCADA_POR_EMAIL_MS = [60 * 1000];

function createLoginThrottle(options = {}) {
  const maxTentativas = options.maxTentativas ?? MAX_TENTATIVAS;
  const janelaMs = options.janelaMs ?? JANELA_MS;
  const escada = options.escadaDeBloqueioMs ?? ESCADA_DE_BLOQUEIO_MS;
  const escadaEmail = options.escadaPorEmailMs ?? ESCADA_POR_EMAIL_MS;
  const agora = options.now ?? (() => Date.now());

  const registros = new Map();

  // O registro guarda a escada de reincidência, então só pode ser descartado
  // bem depois do fim do bloqueio — senão cada ciclo recomeça no primeiro
  // degrau e a progressão não existe na prática.
  function podeDescartar(registro, momento) {
    const referencia = Math.max(registro.ultimaFalhaEm, registro.bloqueadoAte);
    return momento - referencia > janelaMs;
  }

  function limpar(momento) {
    for (const [chave, registro] of registros) {
      if (podeDescartar(registro, momento)) {
        registros.delete(chave);
      }
    }
  }

  function ler(chave, momento) {
    const registro = registros.get(chave);
    if (!registro) {
      return null;
    }

    if (podeDescartar(registro, momento)) {
      registros.delete(chave);
      return null;
    }

    return registro;
  }

  function escadaDaChave(chave) {
    return String(chave).startsWith("email:") ? escadaEmail : escada;
  }

  return {
    // Chaves separadas para IP e e-mail: um atacante trocando de e-mail continua
    // preso pelo IP, e um alvo específico continua contido mesmo vindo de IPs
    // diferentes. As duas têm escadas distintas — ver ESCADA_POR_EMAIL_MS.
    buildKeys(ipAddress, email) {
      const chaves = [];
      if (ipAddress) {
        chaves.push(`ip:${ipAddress}`);
      }
      if (email) {
        chaves.push(`email:${String(email).trim().toLowerCase()}`);
      }
      return chaves;
    },

    // Quanto falta de bloqueio, em segundos. Zero significa liberado.
    // `apenas` restringe a consulta a um tipo de chave.
    retryAfterSeconds(chaves, apenas = null) {
      const momento = agora();
      let maiorEspera = 0;

      for (const chave of chaves) {
        if (apenas && !String(chave).startsWith(apenas)) {
          continue;
        }
        const registro = ler(chave, momento);
        if (registro && momento < registro.bloqueadoAte) {
          maiorEspera = Math.max(maiorEspera, registro.bloqueadoAte - momento);
        }
      }

      return maiorEspera > 0 ? Math.ceil(maiorEspera / 1000) : 0;
    },

    // Bloqueio que nega a requisição sem nem olhar a senha. Só a chave de IP:
    // negar pela chave de e-mail permitiria a um atacante anônimo trancar a
    // única conta de administradora do consultório, sem ninguém para destravar.
    retryAfterSecondsHard(chaves) {
      return this.retryAfterSeconds(chaves, "ip:");
    },

    registerFailure(chaves) {
      const momento = agora();
      limpar(momento);

      for (const chave of chaves) {
        const registro = ler(chave, momento) || {
          falhas: 0,
          bloqueios: 0,
          ultimaFalhaEm: momento,
          bloqueadoAte: 0
        };

        registro.falhas += 1;
        registro.ultimaFalhaEm = momento;

        const escadaAtual = escadaDaChave(chave);
        if (registro.falhas >= maxTentativas) {
          // O degrau é escolhido pelo número de bloqueios JÁ aplicados, e o
          // contador de bloqueios só cresce enquanto o registro existir. Antes,
          // a limpeza da janela apagava o registro entre um ciclo e outro e a
          // escada recomeçava no primeiro degrau — o bloqueio de 1 hora era
          // inalcançável.
          const duracao = escadaAtual[Math.min(registro.bloqueios, escadaAtual.length - 1)];
          registro.bloqueadoAte = momento + duracao;
          registro.bloqueios += 1;
          registro.falhas = 0;
        }

        registros.set(chave, registro);
      }
    },

    registerSuccess(chaves) {
      for (const chave of chaves) {
        registros.delete(chave);
      }
    },

    // Só para teste.
    reset() {
      registros.clear();
    }
  };
}

module.exports = {
  createLoginThrottle
};
