type CorpoWorker = { acao: string; [campo: string]: unknown };

export class ErroComunicacaoFila extends Error {
  constructor() {
    super("Falha de comunicação com a fila; diagnóstico registrado sem credenciais.");
    this.name = "ErroComunicacaoFila";
  }
}

function motivoTransporte(error: unknown) {
  if (!(error instanceof Error)) return "REDE_INDISPONIVEL";
  if (error.name === "TimeoutError" || error.name === "AbortError") return "TEMPO_LIMITE";
  const causa = error.cause;
  const codigo = causa && typeof causa === "object" && "code" in causa ? causa.code : undefined;
  if (codigo === "ENOTFOUND" || codigo === "EAI_AGAIN") return "DNS_INDISPONIVEL";
  if (codigo === "ECONNREFUSED") return "CONEXAO_RECUSADA";
  if (codigo === "ECONNRESET" || codigo === "UND_ERR_SOCKET") return "CONEXAO_INTERROMPIDA";
  if (codigo === "UND_ERR_CONNECT_TIMEOUT" || codigo === "ETIMEDOUT") return "TEMPO_LIMITE";
  if (["CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "ERR_TLS_CERT_ALTNAME_INVALID"].includes(String(codigo))) return "CERTIFICADO_RECUSADO";
  return "REDE_INDISPONIVEL";
}

// O diagnóstico usa apenas metadados permitidos. Não lê o corpo de respostas de
// erro nem registra URL, Authorization, reserva, prompt ou mensagens de exceções.
export function criarClienteFilaWorker(opcoes: {
  destino: URL;
  token: string;
  registrarFalha: (evento: string) => void;
  requisitar?: typeof fetch;
}) {
  const requisitar = opcoes.requisitar ?? fetch;
  return async (corpo: CorpoWorker, timeoutMs = 10_000): Promise<unknown> => {
    const inicio = performance.now();
    let resposta: Response | undefined;
    const registrar = (motivo: string) => {
      const id = resposta?.headers.get("x-vercel-id");
      const tipo = resposta?.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
      opcoes.registrarFalha(JSON.stringify({
        horario: new Date().toISOString(), etapa: "FALHA_API_FILA",
        acao: ["reservar", "renovar", "finalizar"].includes(corpo.acao) ? corpo.acao : "desconhecida",
        motivo, duracaoMs: Math.round(performance.now() - inicio),
        ...(resposta ? {
          statusHttp: resposta.status,
          formatoResposta: tipo === "application/json" ? "JSON" : tipo === "text/html" ? "HTML" : "OUTRO",
          desafioVercel: resposta.headers.get("x-vercel-mitigated") === "challenge",
        } : {}),
        ...(id && /^(?:[a-z]{3}\d:{1,2}){1,8}[a-z0-9-]{1,120}$/i.test(id) ? { requisicaoId: id } : {}),
      }));
    };
    try {
      resposta = await requisitar(opcoes.destino, {
        method: "POST", redirect: "error",
        headers: { Authorization: `Bearer ${opcoes.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(corpo), signal: AbortSignal.timeout(Math.max(1, Math.floor(timeoutMs))),
      });
    } catch (error) {
      registrar(motivoTransporte(error));
      throw new ErroComunicacaoFila();
    }
    if (!resposta.ok) {
      registrar(resposta.status === 409 ? "RESERVA_RECUSADA"
        : resposta.status === 401 ? "AUTENTICACAO_RECUSADA"
        : resposta.status === 403 ? "ACESSO_RECUSADO" : "HTTP_ERRO");
      await resposta.body?.cancel().catch(() => {});
      // Preserva a interrupção imediata em perda de posse/autorização e as
      // tentativas existentes para falhas transitórias, sem repetir mutações aqui.
      if (resposta.status === 409 || (corpo.acao === "renovar" && [401, 403].includes(resposta.status))) return null;
      throw new ErroComunicacaoFila();
    }
    try {
      return await resposta.json();
    } catch (error) {
      registrar(error instanceof SyntaxError ? "JSON_INVALIDO" : motivoTransporte(error));
      throw new ErroComunicacaoFila();
    }
  };
}
