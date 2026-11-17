import axios from "axios";
import {
  CAPACIDADES_SYNC, FalhaSync, type CamposSync, type ClienteSync, type EntidadeSync,
  type IdentidadeContaSync, type JsonValue, type OpcoesConsultaSync, type OpcoesListagemSync, type OpcoesMutacaoSync, type PaginaSync, type ResultadoMutacaoSync,
} from "./contrato";
import { identificadorRemoto, normalizarDocumento, observarRegistro, prepararImagens, prepararPayload, prepararVariacao } from "./dominio";
import { serializarCanonico } from "./cripto";
import { cotaDaRespostaSync, interpretarCotaSync, type CotaLeituraSync } from "./ritmo";

const RECURSOS = { PRODUTO: "produtos", CONTATO: "contatos", FORMA_PAGAMENTO: "formas-pagamento", VENDEDOR: "vendedores" } as const;
const MAXIMO_RESPOSTA = 2 * 1024 * 1024;

export interface RequisicaoSync {
  metodo: "GET" | "POST" | "PUT";
  url: string;
  token: string;
  payload?: JsonValue;
  timeoutMs: number;
}
export interface RespostaHttpSync {
  status: number;
  dados: unknown;
  retryAfter?: string | number;
  cotaLeitura?: CotaLeituraSync;
}
export interface DependenciasClienteSync {
  configurar(aplicativoId: string): Promise<{ apiBaseUrl: string }>;
  token(aplicativoId: string, opcoes?: { tokenRejeitado?: string }): Promise<string>;
  http(requisicao: RequisicaoSync): Promise<RespostaHttpSync>;
}

const dependenciasPadrao: DependenciasClienteSync = {
  async configurar(aplicativoId) {
    const { getAplicativoOlistConfig } = await import("@/lib/aplicativo");
    return getAplicativoOlistConfig(aplicativoId);
  },
  async token(aplicativoId, opcoes) {
    const { getValidOlistAccessToken } = await import("@/lib/olist");
    return getValidOlistAccessToken(aplicativoId, opcoes);
  },
  async http(requisicao) {
    const resposta = await axios.request<unknown>({
      method: requisicao.metodo, url: requisicao.url, data: requisicao.payload,
      headers: { Authorization: `Bearer ${requisicao.token}`, Accept: "application/json" },
      timeout: requisicao.timeoutMs, signal: AbortSignal.timeout(requisicao.timeoutMs),
      maxRedirects: 0, maxContentLength: MAXIMO_RESPOSTA, maxBodyLength: MAXIMO_RESPOSTA,
      validateStatus: () => true,
    });
    const retryAfter: unknown = resposta.headers["retry-after"];
    const cota = interpretarCotaSync(resposta.headers["x-ratelimit-limit"], resposta.headers["x-ratelimit-remaining"], resposta.headers["x-ratelimit-reset"]);
    return { status: resposta.status, dados: resposta.data, retryAfter: typeof retryAfter === "string" || typeof retryAfter === "number" ? retryAfter : undefined, ...(cota ? { cotaLeitura: cota } : {}) };
  },
};

export function retryAfterSync(valor: unknown, agora = Date.now()): number {
  if (typeof valor !== "string" && typeof valor !== "number") return 0;
  const segundos = Number(valor);
  const ms = Number.isFinite(segundos) ? segundos * 1000 : Date.parse(String(valor)) - agora;
  return Number.isFinite(ms) ? Math.min(24 * 60 * 60 * 1000, Math.max(0, Math.ceil(ms))) : 0;
}

function objeto(valor: unknown): valor is Record<string, unknown> {
  return !!valor && typeof valor === "object" && !Array.isArray(valor);
}

function contratoInvalido(): never {
  throw new FalhaSync("CONTRATO", "A resposta da Olist não corresponde ao formato esperado.");
}

function interpretarIdentidade(payload: unknown): IdentidadeContaSync {
  if (!objeto(payload)) return contratoInvalido();
  const documento = normalizarDocumento(payload.cpfCnpj);
  const nome = payload.razaoSocial ?? payload.fantasia;
  if (!documento || typeof nome !== "string" || !nome.trim()) return contratoInvalido();
  return { documento, nome };
}

function interpretarPagina(entidade: EntidadeSync, payload: unknown, limit: number): PaginaSync {
  if (!objeto(payload) || !Array.isArray(payload.itens) || payload.itens.length > limit || !objeto(payload.paginacao)) return contratoInvalido();
  const total = payload.paginacao.total;
  if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0 || total < payload.itens.length) return contratoInvalido();
  const itens = payload.itens.map(item => observarRegistro(entidade, item, { completo: entidade === "FORMA_PAGAMENTO" || entidade === "VENDEDOR" }));
  if (new Set(itens.map(item => item.id)).size !== itens.length) return contratoInvalido();
  return { itens, total };
}

export interface ClienteSyncSubrecursos extends ClienteSync {
  listarImagens(aplicativoId: string, produtoId: string): Promise<CamposSync[]>;
  substituirImagens(aplicativoId: string, produtoId: string, imagens: JsonValue, contratoValidado: boolean): Promise<ResultadoMutacaoSync>;
  criarVariacao(aplicativoId: string, produtoId: string, campos: CamposSync, contratoValidado: boolean): Promise<ResultadoMutacaoSync>;
  atualizarVariacao(aplicativoId: string, produtoId: string, variacaoId: string, campos: CamposSync, contratoValidado: boolean): Promise<ResultadoMutacaoSync>;
}

export function criarClienteSync(dependencias: DependenciasClienteSync = dependenciasPadrao): ClienteSyncSubrecursos {
  async function prepararRequisicao(aplicativoId: string, caminho: string, parametros: Record<string, string> = {}) {
    if (!aplicativoId || aplicativoId.length > 150) throw new FalhaSync("APLICATIVO_INVALIDO", "O aplicativo da integração é inválido.");
    try {
      const configuracao = await dependencias.configurar(aplicativoId);
      const base = new URL(configuracao.apiBaseUrl);
      if (base.origin !== "https://api.tiny.com.br" || base.pathname.replace(/\/$/, "") !== "/public-api/v3" || base.username || base.password || base.search || base.hash) {
        throw new FalhaSync("CONFIGURACAO_OLIST", "A URL da integração Olist não é permitida.");
      }
      const url = new URL(caminho, `${base.origin}/public-api/v3/`);
      for (const [chave, valor] of Object.entries(parametros)) url.searchParams.set(chave, valor);
      const token = await dependencias.token(aplicativoId);
      if (!token || token.length > 16_384 || /\s/.test(token)) throw new FalhaSync("CONEXAO_OLIST", "Reconecte a integração Olist antes de continuar.");
      return { url: url.toString(), token };
    } catch (erro) {
      if (erro instanceof FalhaSync) throw erro;
      throw new FalhaSync("CONEXAO_OLIST", "Reconecte a integração Olist antes de continuar.");
    }
  }

  async function executarRequisicao(metodo: "GET" | "POST" | "PUT", preparado: { url: string; token: string }, payload?: JsonValue) {
    try {
      return await dependencias.http({ metodo, url: preparado.url, token: preparado.token, payload, timeoutMs: 20_000 });
    } catch {
      throw new FalhaSync(metodo === "GET" ? "REDE" : "MUTACAO_INCONCLUSIVA",
        metodo === "GET" ? "A consulta à Olist foi interrompida." : "O resultado da alteração na Olist precisa ser reconciliado antes de outra tentativa.",
        metodo === "GET", metodo !== "GET");
    }
  }

  function validarResposta(metodo: "GET" | "POST" | "PUT", resposta: RespostaHttpSync) {
    if (resposta.status < 200 || resposta.status >= 300) {
      const temporaria = resposta.status === 408 || resposta.status === 429 || resposta.status >= 500;
      const inconclusivo = metodo !== "GET" && (resposta.status === 408 || resposta.status >= 500 || resposta.status >= 300 && resposta.status < 400);
      const autenticacao = resposta.status === 401 || resposta.status === 403;
      throw new FalhaSync(inconclusivo ? "MUTACAO_INCONCLUSIVA" : `OLIST_${resposta.status}`,
        inconclusivo ? "O resultado da alteração precisa ser reconciliado antes de outra tentativa." : autenticacao ? "Reconecte a integração Olist antes de continuar." : "A Olist não concluiu a solicitação.",
        temporaria && !inconclusivo, inconclusivo, resposta.status, retryAfterSync(resposta.retryAfter), cotaDaRespostaSync(resposta) ?? undefined);
    }
    if (resposta.status === 202) throw new FalhaSync("MUTACAO_INCONCLUSIVA", "A Olist ainda não confirmou a conclusão da solicitação.", false, metodo !== "GET", resposta.status);
    return resposta;
  }

  async function validarContaPreparada(preparado: { token: string }, opcoes: OpcoesConsultaSync) {
    const info = validarResposta("GET", await executarRequisicao("GET", {
      url: "https://api.tiny.com.br/public-api/v3/info", token: preparado.token,
    }));
    const identidade = interpretarIdentidade(info.dados);
    let permitida = false;
    try { permitida = opcoes.validarConta(identidade) === true; } catch { /* Falha fechada sem expor a validação. */ }
    if (!permitida) throw new FalhaSync("CONTA_ALTERADA", "A conexão aponta para outra conta Olist. Execute uma nova auditoria.");
  }

  async function requisitar(aplicativoId: string, metodo: "GET" | "POST" | "PUT", caminho: string, parametros: Record<string, string> = {}, payload?: JsonValue, opcoes?: OpcoesConsultaSync) {
    const preparado = await prepararRequisicao(aplicativoId, caminho, parametros);
    if (opcoes) {
      await validarContaPreparada(preparado, opcoes);
      try { await opcoes.antesDeConsultar?.(); }
      catch (error) {
        if (error instanceof FalhaSync) throw error;
        throw new FalhaSync("VALIDACAO_CONSULTA", "Não foi possível confirmar a autorização da consulta.", true);
      }
    }
    let resposta = await executarRequisicao(metodo, preparado, payload);
    // Leituras protegidas mantêm o token vinculado ao /info. Só GET comum pode
    // renovar; escritas nunca entram em retry automático.
    if (metodo === "GET" && !opcoes && resposta.status === 401) {
      let token: string;
      try { token = await dependencias.token(aplicativoId, { tokenRejeitado: preparado.token }); }
      catch { throw new FalhaSync("CONEXAO_OLIST", "Reconecte a integração Olist antes de continuar.", false, false, 401); }
      resposta = await executarRequisicao(metodo, { ...preparado, token }, payload);
    }
    return validarResposta(metodo, resposta);
  }

  function caminhoEntidade(entidade: EntidadeSync, id?: string) {
    if (!Object.hasOwn(RECURSOS, entidade)) throw new FalhaSync("ENTIDADE_INVALIDA", "A entidade não é suportada.");
    return `${RECURSOS[entidade]}${id === undefined ? "" : `/${identificadorRemoto(id)}`}`;
  }

  async function mutar(aplicativoId: string, metodo: "POST" | "PUT", caminho: string, payload: JsonValue, id?: string, opcoes?: OpcoesMutacaoSync): Promise<ResultadoMutacaoSync> {
    serializarCanonico(payload);
    let resposta: RespostaHttpSync;
    if (opcoes) {
      // O token fica apenas nesta chamada. Uma reconexão durante /info não pode
      // trocar a conta usada no POST/PUT, e nenhuma escrita renova credenciais.
      const preparado = await prepararRequisicao(aplicativoId, caminho);
      await validarContaPreparada(preparado, opcoes);
      try { await opcoes.antesDeEscrever?.(); }
      catch (error) {
        if (error instanceof FalhaSync) throw error;
        throw new FalhaSync("VALIDACAO_ESCRITA", "Não foi possível confirmar a autorização da alteração.", true);
      }
      resposta = validarResposta(metodo, await executarRequisicao(metodo, preparado, payload));
    } else {
      resposta = await requisitar(aplicativoId, metodo, caminho, {}, payload);
    }
    if (metodo === "PUT") return { id: id ?? null };
    try {
      if (!objeto(resposta.dados)) return contratoInvalido();
      return { id: identificadorRemoto(resposta.dados.id) };
    } catch {
      // Um POST aceito com resposta incompleta também pode já ter criado o registro.
      throw new FalhaSync("MUTACAO_INCONCLUSIVA", "A criação foi enviada, mas seu resultado precisa ser reconciliado.", false, true, resposta.status);
    }
  }

  return {
    async listar(aplicativoId, entidade, opcoes: OpcoesListagemSync) {
      if (!Number.isSafeInteger(opcoes.offset) || opcoes.offset < 0 || !Number.isSafeInteger(opcoes.limit) || opcoes.limit < 1 || opcoes.limit > 100) {
        throw new FalhaSync("PAGINACAO_INVALIDA", "Informe uma página entre 1 e 100 registros e um deslocamento válido.");
      }
      const caminho = caminhoEntidade(entidade);
      const parametros: Record<string, string> = { offset: String(opcoes.offset), limit: String(opcoes.limit) };
      if (opcoes.desde !== undefined) {
        if (!opcoes.incrementalValidado || !CAPACIDADES_SYNC[entidade].incremental ||
          !/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(opcoes.desde) || !Number.isFinite(Date.parse(opcoes.desde))) {
          throw new FalhaSync("INCREMENTAL_NAO_VALIDADO", "O filtro incremental precisa de uma data válida e de validação prévia para esta conta.");
        }
        parametros[entidade === "PRODUTO" ? "dataAlteracao" : "dataAtualizacao"] = opcoes.desde;
      }
      const resposta = await requisitar(aplicativoId, "GET", caminho, parametros);
      const cota = cotaDaRespostaSync(resposta);
      return { ...interpretarPagina(entidade, resposta.dados, opcoes.limit), ...(cota ? { cotaLeitura: cota } : {}) };
    },
    async buscarPorChave(aplicativoId, entidade, chave, opcoes) {
      const caminho = caminhoEntidade(entidade);
      if (entidade !== "PRODUTO" && entidade !== "CONTATO") throw new FalhaSync("BUSCA_NAO_SUPORTADA", "Esta entidade exige mapeamento humano.");
      const normalizada = entidade === "CONTATO" ? normalizarDocumento(chave) : chave;
      if (!normalizada || !normalizada.trim() || normalizada.length > 255) throw new FalhaSync("IDENTIDADE_INVALIDA", "A chave de correspondência é inválida.");
      const resposta = await requisitar(aplicativoId, "GET", caminho, { [entidade === "PRODUTO" ? "codigo" : "cpfCnpj"]: normalizada, offset: "0", limit: "100" }, undefined, opcoes);
      const pagina = interpretarPagina(entidade, resposta.dados, 100);
      if ((pagina.total !== null && pagina.total > pagina.itens.length) || pagina.itens.length >= 100) throw new FalhaSync("BUSCA_TRUNCADA", "A busca não comprovou a ausência de duplicidades. Revise o cadastro antes de continuar.");
      return pagina.itens.filter(item => item.chave === normalizada);
    },
    async detalhar(aplicativoId, entidade, id, opcoes) {
      const caminho = caminhoEntidade(entidade, id);
      if (!CAPACIDADES_SYNC[entidade].detalhar) throw new FalhaSync("DETALHE_NAO_SUPORTADO", "A API não oferece detalhamento desta entidade; utilize a listagem completa.");
      const resposta = await requisitar(aplicativoId, "GET", caminho, {}, undefined, opcoes);
      const observacao = observarRegistro(entidade, resposta.dados, { completo: true });
      if (observacao.id !== identificadorRemoto(id)) return contratoInvalido();
      const cota = cotaDaRespostaSync(resposta);
      return { ...observacao, ...(cota ? { cotaLeitura: cota } : {}) };
    },
    async identidadeConta(aplicativoId) {
      const resposta = await requisitar(aplicativoId, "GET", "info");
      const cota = cotaDaRespostaSync(resposta);
      return { ...interpretarIdentidade(resposta.dados), ...(cota ? { cotaLeitura: cota } : {}) };
    },
    async criar(aplicativoId, entidade, payload, opcoes) {
      const caminho = caminhoEntidade(entidade);
      const seguro = prepararPayload(entidade, payload, { operacao: "CRIAR" });
      return mutar(aplicativoId, "POST", caminho, seguro, undefined, opcoes);
    },
    async atualizar(aplicativoId, entidade, id, payload, opcoes) {
      const caminho = caminhoEntidade(entidade, id);
      const seguro = prepararPayload(entidade, payload, { operacao: "ATUALIZAR" });
      return mutar(aplicativoId, "PUT", caminho, seguro, id, opcoes);
    },
    async listarImagens(aplicativoId, produtoId) {
      const resposta = await requisitar(aplicativoId, "GET", `produtos/${identificadorRemoto(produtoId)}/anexos`);
      // O contrato deste subrecurso é uma lista, não a paginação de produtos.
      if (!Array.isArray(resposta.dados)) return contratoInvalido();
      return prepararImagens(resposta.dados, true);
    },
    async substituirImagens(aplicativoId, produtoId, imagens, contratoValidado) {
      const seguro = prepararImagens(imagens, contratoValidado);
      return mutar(aplicativoId, "PUT", `produtos/${identificadorRemoto(produtoId)}/anexos`, seguro, produtoId);
    },
    async criarVariacao(aplicativoId, produtoId, campos, contratoValidado) {
      const seguro = prepararVariacao(campos, contratoValidado);
      return mutar(aplicativoId, "POST", `produtos/${identificadorRemoto(produtoId)}/variacoes`, seguro);
    },
    async atualizarVariacao(aplicativoId, produtoId, variacaoId, campos, contratoValidado) {
      if (!contratoValidado) throw new FalhaSync("VARIACAO_REQUER_VALIDACAO", "Valide o contrato de variações antes de aplicar alterações.");
      const seguro = prepararPayload("PRODUTO", { ...campos, tipo: "S", tipoVariacao: "N", grade: null }, { operacao: "ATUALIZAR" });
      return mutar(aplicativoId, "PUT", `produtos/${identificadorRemoto(produtoId)}/variacoes/${identificadorRemoto(variacaoId)}`, seguro, variacaoId);
    },
  };
}

export const clienteSync = criarClienteSync();
