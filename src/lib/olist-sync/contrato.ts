export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type CamposSync = Record<string, JsonValue>;
export type EntidadeSync = "PRODUTO" | "CONTATO" | "FORMA_PAGAMENTO" | "VENDEDOR";

export const ENTIDADES_SYNC: readonly EntidadeSync[] = ["PRODUTO", "CONTATO", "FORMA_PAGAMENTO", "VENDEDOR"];

export interface ObservacaoRemota {
  id: string;
  chave: string | null;
  nome: string;
  situacao: string;
  alteradoEm: string | null;
  tipo?: string;
  paiId?: string | null;
  /** Resumos de listagem nunca podem estabelecer uma base de comparação. */
  completo: boolean;
  campos: CamposSync;
  /** Códigos estáveis, sem valores pessoais ou payload do provedor. */
  pendencias: string[];
}

export interface PaginaSync {
  itens: ObservacaoRemota[];
  total: number | null;
}

export interface OpcoesListagemSync {
  offset: number;
  limit: number;
  /** Apenas após validar o filtro incremental desta conta e entidade. */
  desde?: string;
  incrementalValidado?: boolean;
}

export interface IdentidadeContaSync {
  documento: string;
  nome: string;
}

export interface ResultadoMutacaoSync { id: string | null }

export interface OpcoesConsultaSync {
  /** Valida a identidade usando a mesma credencial que será usada no recurso. */
  validarConta: (identidade: IdentidadeContaSync) => boolean;
  /** Respeita a janela da conta e revalida a reserva antes de ler o recurso. */
  antesDeConsultar?: () => Promise<void>;
}

export interface OpcoesMutacaoSync extends Pick<OpcoesConsultaSync, "validarConta"> {
  /** Verifica autorização e reserva após a leitura remota, antes de enviar a escrita. */
  antesDeEscrever?: () => Promise<void>;
}

export interface ClienteSync {
  listar(aplicativoId: string, entidade: EntidadeSync, opcoes: OpcoesListagemSync): Promise<PaginaSync>;
  buscarPorChave(aplicativoId: string, entidade: EntidadeSync, chave: string, opcoes?: OpcoesConsultaSync): Promise<ObservacaoRemota[]>;
  detalhar(aplicativoId: string, entidade: EntidadeSync, id: string, opcoes?: OpcoesConsultaSync): Promise<ObservacaoRemota>;
  identidadeConta(aplicativoId: string): Promise<IdentidadeContaSync>;
  criar(aplicativoId: string, entidade: EntidadeSync, payload: CamposSync, opcoes?: OpcoesMutacaoSync): Promise<ResultadoMutacaoSync>;
  atualizar(aplicativoId: string, entidade: EntidadeSync, id: string, payload: CamposSync, opcoes?: OpcoesMutacaoSync): Promise<ResultadoMutacaoSync>;
}

export const CAPACIDADES_SYNC = {
  PRODUTO: { listar: true, detalhar: true, criar: true, atualizar: true, incremental: true },
  CONTATO: { listar: true, detalhar: true, criar: true, atualizar: true, incremental: true },
  FORMA_PAGAMENTO: { listar: true, detalhar: true, criar: false, atualizar: false, incremental: false },
  VENDEDOR: { listar: true, detalhar: false, criar: false, atualizar: false, incremental: false },
} as const;

export class FalhaSync extends Error {
  constructor(
    public readonly codigo: string,
    mensagem: string,
    public readonly recuperavel = false,
    public readonly inconclusivo = false,
    public readonly status: number | null = null,
    public readonly retryAfterMs = 0,
  ) {
    super(mensagem);
    this.name = "FalhaSync";
  }
}

export type TipoOrigemSync = "DESCONHECIDA" | "OBSERVADA_PELO_MODULO" | "DECLARADA_POR_USUARIO";
export interface OrigemSync { tipo: TipoOrigemSync; aplicativoId: string | null }

export interface ReplicaComparacao {
  aplicativoId: string;
  observacao: ObservacaoRemota | null;
  /** Ausência de uma réplica anteriormente vinculada exige revisão, nunca recriação. */
  existia?: boolean;
}

export interface DecisaoSync {
  status: "SINCRONIZADO" | "PROPAGAR" | "AGUARDANDO_REVISAO";
  motivos: string[];
  campos: CamposSync | null;
  hashes: Record<string, string>;
  fontesPorCampo: Record<string, string[]>;
  aplicativosCriar: string[];
  aplicativosAtualizar: string[];
}
