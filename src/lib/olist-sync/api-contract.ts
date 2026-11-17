/** DTOs públicos: nenhum token, documento completo ou payload de escrita em listagens. */
export type EntidadeSyncApi = "PRODUTO" | "CONTATO" | "FORMA_PAGAMENTO" | "VENDEDOR";
export type ModoExecucaoSync = "AUDITAR" | "AUDITAR_E_APLICAR" | "APLICAR";
export type OrigemSyncTipo = "DESCONHECIDA" | "OBSERVADA_PELO_MODULO" | "DECLARADA_POR_USUARIO";
export type ProntidaoSync = {
  sincronizacaoNativaCompativel: boolean;
  semanticaPutValidada: boolean;
  incrementalValidado: boolean;
};
export type EmpresaSyncDto = { id: string; nome: string; habilitado: boolean };
export type JobSyncDto = { chave: string; permitidoNoPai: boolean; pausado: boolean };
export type ConfiguracaoSyncDto = {
  id: string;
  aplicativoPaiId: string;
  aplicativoPaiNome: string;
  versao: number;
  ativo: boolean;
  entidades: EntidadeSyncApi[];
  participantes: EmpresaSyncDto[];
  aplicativosElegiveis: EmpresaSyncDto[];
  aplicativosOrigem: EmpresaSyncDto[];
  horaDiaria: string;
  fusoHorario: string;
  limiteAlteracoes: number;
  proximaExecucaoEm: string | null;
  prontidao: ProntidaoSync;
  jobs: JobSyncDto[];
};
export type SalvarConfiguracaoSync = {
  versao: number;
  ativo: boolean;
  entidades: EntidadeSyncApi[];
  participantesIds: string[];
  horaDiaria: string;
  limiteAlteracoes: number;
  prontidao: ProntidaoSync;
};
export type ExecucaoSyncDto = {
  id: string;
  modo: ModoExecucaoSync;
  status: string;
  origem: string;
  criadoEm: string;
  iniciadoEm: string | null;
  finalizadoEm: string | null;
  contadores: Record<string, number>;
};
export type EtapaSyncDto = {
  id: string;
  entidade: EntidadeSyncApi;
  aplicativoId: string;
  fase: string;
  status: string;
  tentativas: number;
  disponivelEm: string;
};
export type ExecucaoSyncDetalheDto = ExecucaoSyncDto & { etapas: EtapaSyncDto[] };
export type PrevisaoValidacaoSyncDto = {
  execucaoId: string;
  calculadoEm: string;
  janelaInicio: string;
  janelaFim: string;
  validadosNaJanela: number;
  restantes: number;
  porMinuto: number | null;
  terminoPrevisto: string | null;
  estado: "ESTIMADA" | "SEM_RITMO" | "AMOSTRA_INSUFICIENTE" | "LISTANDO" | "LEITURA_CONCLUIDA" | "PAUSADA";
};
export type ResumoSyncDto = {
  sincronizados: number;
  divergentes: number;
  pendencias: number;
  erros: number;
  ultimaExecucao: ExecucaoSyncDto | null;
  execucaoAtiva: ExecucaoSyncDto | null;
};
export type PaginaSyncDto<T> = { itens: T[]; total: number; offset: number; limit: number };
export type RegistroSyncDto = {
  id: string;
  entidade: EntidadeSyncApi;
  chaveExibicao: string;
  nome: string | null;
  revisao: number;
  origemTipo: OrigemSyncTipo;
  aplicativoOrigemId: string | null;
  registroOlistOrigemId: string | null;
  origemRegistradaEm: string | null;
  ultimaFonteAppId: string | null;
  estados: { aplicativoId: string; status: string; verificadoEm: string | null }[];
};
export type PendenciaSyncDto = {
  id: string;
  registroId: string | null;
  entidade: EntidadeSyncApi;
  tipo: string;
  severidade: string;
  status: string;
  versao: number;
  criadoEm: string;
  resumo: string;
};
export type ValorComparacaoSync = string | number | boolean | null | ValorComparacaoSync[] | { [chave: string]: ValorComparacaoSync };
export type PendenciaSyncDetalheDto = PendenciaSyncDto & {
  comparacao: { aplicativoId: string; nome: string; registroOlistId: string; campos: Record<string, ValorComparacaoSync> }[];
  acoesPermitidas: AcaoDecisaoSync[];
};
export type AcaoDecisaoSync = "APROVAR" | "REJEITAR" | "IGNORAR" | "REAUDITAR" | "VINCULAR";
export type DecisaoSyncInput = {
  versao: number;
  acao: AcaoDecisaoSync;
  motivo: string;
  aplicativoFonteId?: string;
  vinculos?: { aplicativoId: string; registroOlistId: string }[];
};
export type DeclararOrigemSyncInput = {
  revisao: number;
  aplicativoOrigemId: string;
  registroOlistOrigemId: string;
  motivo: string;
  idempotencia: string;
};

export const ENTIDADES_SYNC_LABEL: Record<EntidadeSyncApi, string> = {
  PRODUTO: "Produtos e variações", CONTATO: "Contatos", FORMA_PAGAMENTO: "Formas de pagamento", VENDEDOR: "Vendedores",
};
export const ORIGENS_SYNC_LABEL: Record<OrigemSyncTipo, string> = {
  DESCONHECIDA: "Origem desconhecida", OBSERVADA_PELO_MODULO: "Origem observada", DECLARADA_POR_USUARIO: "Origem declarada",
};
export function execucaoSyncAtiva(status: string): boolean {
  return ["PENDENTE", "AUDITANDO", "APLICANDO", "AGUARDANDO_RETRY"].includes(status);
}

/** O polling só acompanha execuções em curso e nunca consulta catálogo completo. */
export function intervaloPollingSync(status: string | null, visivel: boolean, falhas: number): number | null {
  if (!visivel || !status || !execucaoSyncAtiva(status)) return null;
  return Math.min(60_000, 10_000 * 2 ** Math.min(3, Math.max(0, falhas)));
}

export function textoValorSync(valor: ValorComparacaoSync | undefined): string {
  if (valor === undefined) return "Não informado";
  if (valor === null) return "Vazio";
  if (typeof valor === "object") return JSON.stringify(valor, null, 2);
  if (typeof valor === "boolean") return valor ? "Sim" : "Não";
  return String(valor);
}
