import axios from "axios";
import { z } from "zod";
import { getAplicativoOlistConfig } from "@/lib/aplicativo";
import { getValidOlistAccessToken } from "@/lib/olist";
import { ErroFilaOlist } from "@/lib/fila-olist-cadastros";
import { resolverContaPedidoManual, listarReferenciasPedidoManual } from "@/lib/pedido-manual-acesso";
import { validarVendedorPedidoOlist } from "@/lib/olist-escopo-vendedor";
import { ErroAutorizacaoOlist } from "@/lib/olist-autorizacao";
import { chaveContatoPorNome, normalizarDocumentoContato } from "@/lib/olist-sync/dominio";
import { normalizarNomeDirecionamento, UFS_DIRECIONAMENTO } from "@/lib/direcionamento-pedidos-contrato";
import { referenciaPedidoManualSchema, type ReferenciaPedidoManual } from "./pedido-manual-referencia";
import { nomeServicoSync } from "./olist-sync/servicos";

export type UsuarioCorrespondenciaPedidoManual = {
  id: string; aplicativoId: string;
};
export type CorrespondenciaPedidoManual = {
  clienteId: number; vendedorId: number; vendedorFixo: boolean;
  /** Exclusivo do servidor: não serializar nas respostas HTTP. */
  cadastros: { cliente: Record<string, unknown>; vendedor: Record<string, unknown> };
};
export type OpcoesCorrespondenciaPedidoManual = { validarDadosDirecionamento?: boolean };
export type CaminhoConsulta = "contatos" | "vendedores" | "produtos" | "servicos" | "formas-recebimento" |
  `contatos/${number}` | `produtos/${number}` | `servicos/${number}` | `formas-recebimento/${number}`;
type PessoaReferencia = ReferenciaPedidoManual["vendedor"];
type EntradaReferencia = { aplicativoOrigemId?: string; vendedorOrigemId: number; clienteOrigemId: number };
export interface DependenciasCorrespondenciaPedidoManual {
  listarAplicativos(aplicativoId: string): Promise<Array<{ id: string; nome: string; fornecedorId?: string }>>;
  autorizarConta(usuario: UsuarioCorrespondenciaPedidoManual, aplicativoId: string): Promise<{ vendedorId: number | null }>;
  consultar(aplicativoId: string, caminho: CaminhoConsulta, parametros: Record<string, string>, timeoutMs: number): Promise<unknown>;
  agora?: () => number;
}

const LIMITE_PAGINA = 100;
const MAXIMO_PAGINAS_VENDEDOR_ORIGEM = 4;
const MAXIMO_CONSULTAS = 12;
const PRAZO_RESOLUCAO_MS = 12_000;
const MAXIMO_RESPOSTA_BYTES = 512 * 1024;
const AVISO_CLIENTE_SEM_DOCUMENTO = "Cadastre o CPF/CNPJ do cliente no aplicativo de referência antes de criar o pedido.";
const entradaReferenciaSchema = z.object({ aplicativoOrigemId: z.guid().optional(),
  vendedorOrigemId: z.number().int().positive().max(2147483647), clienteOrigemId: z.number().int().positive().max(2147483647),
}).strict();
const ufs = new Set<string>(UFS_DIRECIONAMENTO);

function objeto(valor: unknown): valor is Record<string, unknown> {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor);
}
function idRemoto(valor: unknown): number {
  if (typeof valor !== "number" && (typeof valor !== "string" || !/^\d+$/.test(valor))) throw new ErroFilaOlist("Cadastro Olist com identificador inválido.", 502);
  const id = Number(valor);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) throw new ErroFilaOlist("Cadastro Olist com identificador inválido.", 502);
  return id;
}
function cadastroAtivo(valor: Record<string, unknown>) {
  return ["A", "B"].includes(String(valor.situacao ?? "A").trim().toUpperCase());
}
function pessoaAtiva(valor: Record<string, unknown>, rotulo: string) {
  if (!cadastroAtivo(valor)) throw new ErroFilaOlist(`${rotulo} indisponível neste aplicativo.`, 409);
}
function documento(valor: Record<string, unknown>): string | null {
  // Um resumo sem esse campo não comprova que a pessoa não tem documento.
  if (!Object.hasOwn(valor, "cpfCnpj")) throw new ErroFilaOlist("Não foi possível confirmar o documento do cadastro Olist.", 502);
  const bruto = valor.cpfCnpj;
  if (bruto === null || typeof bruto === "string" && bruto.trim() === "") return null;
  const normalizado = normalizarDocumentoContato(bruto);
  if (!normalizado) throw new ErroFilaOlist("Documento do cadastro Olist não pôde ser identificado.", 409);
  return normalizado;
}
function pessoa(valor: Record<string, unknown>, id: number): PessoaReferencia {
  if (typeof valor.nome !== "string" || !valor.nome.trim() || valor.nome.length > 200 || /\p{Cc}/u.test(valor.nome)) {
    throw new ErroFilaOlist("Nome do cadastro Olist indisponível.", 502);
  }
  const cpfCnpj = documento(valor);
  if (cpfCnpj === null && !chaveContatoPorNome(valor.nome)) throw new ErroFilaOlist("Cadastro sem documento e sem nome que permita identificação segura.", 409);
  return { id, nome: valor.nome.normalize("NFKC").trim().replace(/\s+/gu, " "), cpfCnpj };
}
function mesmaPessoa(a: PessoaReferencia, b: PessoaReferencia) {
  if (a.cpfCnpj !== null || b.cpfCnpj !== null) return a.cpfCnpj !== null && a.cpfCnpj === b.cpfCnpj;
  const chave = chaveContatoPorNome(a.nome);
  return chave !== null && chave === chaveContatoPorNome(b.nome);
}
function validarHomonimoDocumentado(ref: PessoaReferencia, candidato: PessoaReferencia, rotulo: string) {
  if (ref.cpfCnpj === null && candidato.cpfCnpj !== null && chaveContatoPorNome(ref.nome) === chaveContatoPorNome(candidato.nome)) {
    throw new ErroFilaOlist(`${rotulo} com o mesmo nome e documento preenchido torna a correspondência ambígua. Revise os cadastros.`, 409);
  }
}

const dependenciasPadrao: DependenciasCorrespondenciaPedidoManual = {
  async listarAplicativos(aplicativoId) {
    return listarReferenciasPedidoManual(aplicativoId);
  },
  autorizarConta: resolverContaPedidoManual,
  async consultar(aplicativoId, caminho, parametros, timeoutMs) {
    const inicio = Date.now();
    const config = await getAplicativoOlistConfig(aplicativoId);
    if (!config.clientId || !config.clientSecret) throw new ErroFilaOlist("Configure a integração Olist deste aplicativo antes de continuar.", 409);
    const base = new URL(config.apiBaseUrl);
    if (base.origin !== "https://api.tiny.com.br" || base.pathname.replace(/\/$/, "") !== "/public-api/v3" ||
        base.username || base.password || base.search || base.hash) throw new ErroFilaOlist("A URL da integração Olist não é permitida.", 409);
    const url = new URL(caminho, `${base.origin}/public-api/v3/`);
    for (const [chave, valor] of Object.entries(parametros)) url.searchParams.set(chave, valor);
    let token = await getValidOlistAccessToken(aplicativoId);
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const restante = timeoutMs - (Date.now() - inicio);
      if (restante <= 0) throw new ErroFilaOlist("A consulta à Olist excedeu o prazo. Tente novamente.", 503);
      const resposta = await axios.get<unknown>(url.toString(), { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        timeout: restante, signal: AbortSignal.timeout(restante), maxRedirects: 0, maxContentLength: MAXIMO_RESPOSTA_BYTES,
        validateStatus: () => true });
      if (resposta.status === 401 && tentativa === 0) { token = await getValidOlistAccessToken(aplicativoId, { tokenRejeitado: token }); continue; }
      if (resposta.status === 429) throw new ErroFilaOlist("Limite de consultas da Olist atingido. Aguarde e tente novamente.", 503);
      if (resposta.status < 200 || resposta.status >= 300) throw new ErroFilaOlist("Não foi possível consultar os cadastros neste aplicativo. Verifique a integração Olist.", 502);
      return resposta.data;
    }
    throw new ErroFilaOlist("Reconecte a integração Olist deste aplicativo.", 502);
  },
};

/** Leitura com URL permitida, timeout, limite de resposta e renovação OAuth limitada. */
export const consultarCorrespondenciaOlist = dependenciasPadrao.consultar;

/** Serviço limitado a leituras; cada operação tem orçamento próprio e não repete mutações. */
export function criarServicoCorrespondenciaPedidoManual(deps: DependenciasCorrespondenciaPedidoManual = dependenciasPadrao) {
  const agora = deps.agora ?? Date.now;
  async function autorizar(usuario: UsuarioCorrespondenciaPedidoManual, aplicativoId: string) {
    try { return await deps.autorizarConta(usuario, aplicativoId); }
    catch (error) {
      if (error instanceof ErroFilaOlist) throw error;
      if (error instanceof ErroAutorizacaoOlist) throw new ErroFilaOlist(error.message, error.status);
      throw new ErroFilaOlist("Não foi possível validar o acesso ao aplicativo. Tente novamente.", 502);
    }
  }
  function contexto() {
    const prazo = agora() + PRAZO_RESOLUCAO_MS;
    let consultas = 0;
    return async (app: string, caminho: CaminhoConsulta, parametros: Record<string, string> = {}) => {
      const restante = prazo - agora();
      if (++consultas > MAXIMO_CONSULTAS || restante <= 0) throw new ErroFilaOlist("A busca não pôde ser concluída dentro do limite. Refine ou revise os cadastros e tente novamente.", 503);
      try {
        const resposta = await deps.consultar(app, caminho, parametros, Math.min(restante, 5_000));
        if (agora() >= prazo) throw new ErroFilaOlist("A consulta à Olist excedeu o prazo. Tente novamente.", 503);
        return resposta;
      }
      catch (error) {
        if (error instanceof ErroFilaOlist) throw error;
        // Erros Axios/OAuth podem conter documento, token e payload: nunca os propagar.
        throw new ErroFilaOlist("Não foi possível consultar os cadastros Olist. Tente novamente ou reconecte a integração.", 502);
      }
    };
  }
  type Consultar = ReturnType<typeof contexto>;
  function pagina(payload: unknown, completa: boolean) {
    if (!objeto(payload) || !Array.isArray(payload.itens) || payload.itens.length > LIMITE_PAGINA ||
        !objeto(payload.paginacao) || typeof payload.paginacao.total !== "number" || !Number.isSafeInteger(payload.paginacao.total) ||
        payload.paginacao.total < payload.itens.length || !payload.itens.every(objeto)) throw new ErroFilaOlist("A Olist retornou uma pesquisa incompleta ou inválida.", 502);
    const itens = payload.itens as Record<string, unknown>[];
    if (new Set(itens.map(i => idRemoto(i.id))).size !== itens.length) throw new ErroFilaOlist("A Olist retornou cadastros duplicados na pesquisa.", 409);
    if (completa && (payload.paginacao.total > itens.length || itens.length >= LIMITE_PAGINA)) throw new ErroFilaOlist("A pesquisa não comprovou uma correspondência única. Revise os cadastros.", 409);
    return { itens, total: payload.paginacao.total };
  }
  async function lerContato(app: string, id: number, consultar: Consultar) {
    const cadastro = await consultar(app, `contatos/${id}`);
    if (!objeto(cadastro) || idRemoto(cadastro.id) !== id) throw new ErroFilaOlist("Cliente indisponível neste aplicativo.", 502);
    return cadastro;
  }
  async function detalheCliente(app: string, id: number, consultar: Consultar) {
    const cadastro = await lerContato(app, id, consultar);
    pessoaAtiva(cadastro, "Cliente");
    return cadastro;
  }
  async function identidadeVendedor(app: string, cadastro: Record<string, unknown>, consultar: Consultar) {
    pessoaAtiva(cadastro, "Vendedor");
    let contato = objeto(cadastro.contato) ? cadastro.contato : cadastro;
    if (!Object.hasOwn(contato, "cpfCnpj") && contato.id !== undefined) contato = await detalheCliente(app, idRemoto(contato.id), consultar);
    return pessoa(contato, idRemoto(cadastro.id));
  }
  async function vendedorPorId(app: string, id: number, consultar: Consultar) {
    for (let indice = 0; indice < MAXIMO_PAGINAS_VENDEDOR_ORIGEM; indice++) {
      const p = pagina(await consultar(app, "vendedores", { offset: String(indice * LIMITE_PAGINA), limit: String(LIMITE_PAGINA) }), false);
      const cadastro = p.itens.find(item => idRemoto(item.id) === id);
      if (cadastro) return { cadastro, referencia: await identidadeVendedor(app, cadastro, consultar) };
      if (p.itens.length < LIMITE_PAGINA || (indice + 1) * LIMITE_PAGINA >= p.total) break;
      if (indice === MAXIMO_PAGINAS_VENDEDOR_ORIGEM - 1) throw new ErroFilaOlist("A localização do vendedor excedeu o limite da pesquisa. Revise seu cadastro antes de continuar.", 409);
    }
    throw new ErroFilaOlist("Vendedor não encontrado no aplicativo de referência.", 409);
  }
  async function contatosPorIdentidade(app: string, ref: PessoaReferencia, consultar: Consultar) {
    const filtros: Record<string, string> = ref.cpfCnpj !== null ? { cpfCnpj: ref.cpfCnpj } : { nome: ref.nome };
    let p = pagina(await consultar(app, "contatos", { ...filtros, limit: String(LIMITE_PAGINA), offset: "0" }), true);
    // Algumas pesquisas podem depender da representação armazenada no ERP.
    // Só tente a máscara quando a consulta canônica não retornar registros;
    // identidade e unicidade continuam sendo conferidas abaixo.
    if (p.total === 0 && ref.cpfCnpj !== null) {
      const doc = ref.cpfCnpj;
      const formatado = /^\d{11}$/.test(doc)
        ? doc.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4")
        : /^\d{14}$/.test(doc) ? doc.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : doc;
      if (formatado !== doc) p = pagina(await consultar(app, "contatos", {
        cpfCnpj: formatado, limit: String(LIMITE_PAGINA), offset: "0",
      }), true);
    }
    const encontrados: Record<string, unknown>[] = [];
    for (const resumo of p.itens) {
      // Excluídos/inativos podem aparecer na pesquisa e não são candidatos.
      if (!cadastroAtivo(resumo)) continue;
      if (Object.hasOwn(resumo, "cpfCnpj")) {
        const candidato = pessoa(resumo, idRemoto(resumo.id));
        const homonimoDocumentado = ref.cpfCnpj === null && candidato.cpfCnpj !== null &&
          chaveContatoPorNome(ref.nome) === chaveContatoPorNome(candidato.nome);
        if (!mesmaPessoa(ref, candidato) && !homonimoDocumentado) continue;
      }
      // A situação do resumo pode estar desatualizada. Confirme no detalhe
      // antes de contar correspondências, sem ocultar falhas da integração.
      const cadastro = await lerContato(app, idRemoto(resumo.id), consultar);
      if (!cadastroAtivo(cadastro)) continue;
      const candidato = pessoa(cadastro, idRemoto(cadastro.id));
      validarHomonimoDocumentado(ref, candidato, "Cliente");
      if (!mesmaPessoa(ref, candidato)) throw new ErroFilaOlist("Cliente alterado durante a resolução. Revise o pedido.", 409);
      encontrados.push(cadastro);
    }
    return encontrados;
  }
  async function vendedoresPorIdentidade(app: string, ref: PessoaReferencia, consultar: Consultar) {
    const encontrados = new Map<number, { cadastro: Record<string, unknown>; referencia: PessoaReferencia }>();
    const filtros: Record<string, string>[] = [];
    if (ref.cpfCnpj !== null) {
      const contatos = await contatosPorIdentidade(app, ref, consultar);
      for (const resumo of contatos) {
        const contato = typeof resumo.codigo === "string" && resumo.codigo.trim() ? resumo : await detalheCliente(app, idRemoto(resumo.id), consultar);
        if (typeof contato.codigo !== "string" || !contato.codigo.trim() || contato.codigo.length > 120) throw new ErroFilaOlist("Não foi possível localizar o vendedor pelo código do contato neste aplicativo.", 409);
        const codigo = contato.codigo.trim();
        if (!filtros.some(f => f.codigo === codigo)) filtros.push({ codigo });
      }
    } else filtros.push({ nome: ref.nome });
    for (const filtro of filtros) {
      const p = pagina(await consultar(app, "vendedores", { ...filtro, limit: String(LIMITE_PAGINA), offset: "0" }), true);
      for (const cadastro of p.itens) {
        const candidato = await identidadeVendedor(app, cadastro, consultar);
        validarHomonimoDocumentado(ref, candidato, "Vendedor");
        if (mesmaPessoa(ref, candidato)) encontrados.set(candidato.id, { cadastro, referencia: candidato });
      }
    }
    return [...encontrados.values()];
  }
  async function lerOrigem(usuario: UsuarioCorrespondenciaPedidoManual, entrada: EntradaReferencia, consultar: Consultar,
    esperada?: ReferenciaPedidoManual, exigirDocumentoCliente = false) {
    const parsed = entradaReferenciaSchema.safeParse(entrada);
    if (!parsed.success) throw new ErroFilaOlist("Selecione vendedor e cliente válidos no aplicativo de referência.");
    let origem = parsed.data.aplicativoOrigemId;
    if (!esperada) {
      const aplicativos = await deps.listarAplicativos(usuario.aplicativoId);
      if (!aplicativos.length || aplicativos.length > 1000) throw new ErroFilaOlist("Não foi possível definir o aplicativo de referência.", 409);
      const internos = aplicativos.filter(app => !app.fornecedorId);
      const filhos = internos.filter(app => app.id !== usuario.aplicativoId);
      const primeiro = (filhos.length ? filhos : internos)[0];
      if (!primeiro) throw new ErroFilaOlist("Nenhum aplicativo de referência autorizado.", 403);
      if (origem && origem !== primeiro.id && !aplicativos.some(app => app.id === origem && app.fornecedorId)) {
        throw new ErroFilaOlist("Use o primeiro aplicativo de referência definido pelo sistema ou um fornecedor autorizado.", 403);
      }
      origem ??= primeiro.id;
    }
    if (!origem) throw new ErroFilaOlist("Aplicativo de referência inválido.");
    const { vendedorId } = await autorizar(usuario, origem);
    if (vendedorId !== null && vendedorId !== entrada.vendedorOrigemId) throw new ErroFilaOlist("Use o vendedor vinculado no aplicativo de referência.", 403);
    const cadastroCliente = await detalheCliente(origem, entrada.clienteOrigemId, consultar);
    if (vendedorId !== null) validarVendedorPedidoOlist(cadastroCliente, vendedorId);
    if ((!esperada || exigirDocumentoCliente) && documento(cadastroCliente) === null) throw new ErroFilaOlist(AVISO_CLIENTE_SEM_DOCUMENTO, 409);
    const cliente = pessoa(cadastroCliente, entrada.clienteOrigemId);
    let vendedor: { cadastro: Record<string, unknown>; referencia: PessoaReferencia };
    if (esperada) {
      // Na origem já conhecemos o ID. O código do contato não é
      // necessariamente o código do vendedor; não o use para reencontrá-lo.
      // Sem documento, preserve a busca conservadora de homônimos.
      const candidatos = esperada.vendedor.cpfCnpj !== null
        ? [await vendedorPorId(origem, esperada.vendedor.id, consultar)]
        : await vendedoresPorIdentidade(origem, esperada.vendedor, consultar);
      if (esperada.vendedor.cpfCnpj === null && candidatos.length > 1) throw new ErroFilaOlist("Há mais de um vendedor com o mesmo nome no aplicativo de referência. Revise os cadastros.", 409);
      const encontrado = candidatos.find(v => v.referencia.id === esperada.vendedor.id && mesmaPessoa(esperada.vendedor, v.referencia));
      if (!encontrado) throw new ErroFilaOlist("O vendedor de referência foi alterado ou está indisponível.", 409);
      vendedor = encontrado;
      if (!mesmaPessoa(esperada.cliente, cliente)) throw new ErroFilaOlist("O cliente de referência foi alterado. Revise o pedido.", 409);
    } else vendedor = await vendedorPorId(origem, entrada.vendedorOrigemId, consultar);
    const ufBruta = objeto(cadastroCliente.endereco) ? cadastroCliente.endereco.uf : null;
    const uf = typeof ufBruta === "string" ? ufBruta.trim().toUpperCase() : "";
    return { referencia: referenciaPedidoManualSchema.parse({ aplicativoId: origem, vendedor: vendedor.referencia,
      cliente: { ...cliente, uf: ufs.has(uf) ? uf : null } }), cadastroCliente, cadastroVendedor: vendedor.cadastro, vendedorFixo: vendedorId !== null };
  }
  async function obterReferenciaPedidoManual(usuario: UsuarioCorrespondenciaPedidoManual, entrada: EntradaReferencia) {
    return (await lerOrigem(usuario, entrada, contexto())).referencia;
  }
  async function resolverCorrespondenciaPedidoManual(usuario: UsuarioCorrespondenciaPedidoManual, valor: ReferenciaPedidoManual, destinoId: string,
    opcoes: OpcoesCorrespondenciaPedidoManual = {}): Promise<CorrespondenciaPedidoManual> {
    const parsed = referenciaPedidoManualSchema.safeParse(valor);
    if (!parsed.success || !z.guid().safeParse(destinoId).success) throw new ErroFilaOlist("Referência ou destino inválido.");
    const ref = parsed.data;
    if (opcoes.validarDadosDirecionamento && ref.cliente.cpfCnpj === null) throw new ErroFilaOlist(AVISO_CLIENTE_SEM_DOCUMENTO, 409);
    const consultar = contexto();
    const origem = await lerOrigem(usuario, { aplicativoOrigemId: ref.aplicativoId, clienteOrigemId: ref.cliente.id, vendedorOrigemId: ref.vendedor.id }, consultar, ref,
      opcoes.validarDadosDirecionamento);
    // Na criação, essa identidade acabou de fundamentar a regra. Na fila,
    // nome/UF históricos não redirecionam uma decisão que já foi persistida.
    if (opcoes.validarDadosDirecionamento && (ref.cliente.uf !== origem.referencia.cliente.uf ||
        normalizarNomeDirecionamento(ref.cliente.nome) !== normalizarNomeDirecionamento(origem.referencia.cliente.nome))) {
      throw new ErroFilaOlist("Dados do cliente alterados durante a resolução. Revise o direcionamento antes de incluir na fila.", 409);
    }
    const { vendedorId: fixo } = await autorizar(usuario, destinoId);
    if (destinoId === ref.aplicativoId) {
      if (fixo !== null && fixo !== ref.vendedor.id) throw new ErroFilaOlist("Vínculo do vendedor alterado. Revise o pedido.", 409);
      if (fixo !== null) validarVendedorPedidoOlist(origem.cadastroCliente, fixo);
      return { clienteId: ref.cliente.id, vendedorId: ref.vendedor.id, vendedorFixo: fixo !== null,
        cadastros: { cliente: origem.cadastroCliente, vendedor: origem.cadastroVendedor } };
    }
    // O vínculo fornece o ID local do vendedor; código de contato não
    // comprova o código do vendedor. Confira a identidade após ler esse ID.
    // Sem documento, mantenha a detecção conservadora de homônimos.
    const vendedores = fixo !== null && origem.referencia.vendedor.cpfCnpj !== null
      ? [await vendedorPorId(destinoId, fixo, consultar)]
      : await vendedoresPorIdentidade(destinoId, origem.referencia.vendedor, consultar);
    if (vendedores.length !== 1) throw new ErroFilaOlist(vendedores.length ? "Há mais de um vendedor correspondente no aplicativo destinatário." : "Vendedor não encontrado no aplicativo destinatário.", 409);
    const vendedor = vendedores[0];
    if (fixo !== null && (fixo !== vendedor.referencia.id || !mesmaPessoa(origem.referencia.vendedor, vendedor.referencia))) throw new ErroFilaOlist("O vínculo do vendedor no aplicativo destinatário corresponde a outra pessoa.", 403);
    const clientes = await contatosPorIdentidade(destinoId, origem.referencia.cliente, consultar);
    if (clientes.length !== 1) throw new ErroFilaOlist(clientes.length ? "Há mais de um cliente correspondente no aplicativo destinatário." : "Cliente não encontrado no aplicativo destinatário.", 409);
    const clienteId = idRemoto(clientes[0].id);
    // A busca já confirmou identidade e situação no detalhe deste ID.
    const cliente = clientes[0];
    if (fixo !== null) validarVendedorPedidoOlist(cliente, vendedor.referencia.id);
    return { clienteId, vendedorId: vendedor.referencia.id, vendedorFixo: fixo !== null, cadastros: { cliente, vendedor: vendedor.cadastro } };
  }
  async function validarReferenciaPersistidaPedidoManual(usuario: UsuarioCorrespondenciaPedidoManual, ref: ReferenciaPedidoManual, destinoId: string,
    selecoes: { clienteId?: number; vendedorId?: number }, escolhaExplicita = false) {
    if (escolhaExplicita) {
      if (!selecoes.clienteId || !selecoes.vendedorId) throw new ErroFilaOlist("Selecione cliente e vendedor no destino.");
      const consultar = contexto();
      const origem = await lerOrigem(usuario, { aplicativoOrigemId: ref.aplicativoId, clienteOrigemId: ref.cliente.id, vendedorOrigemId: ref.vendedor.id }, consultar, ref);
      const { vendedorId: fixo } = await autorizar(usuario, destinoId);
      if (fixo !== null && fixo !== selecoes.vendedorId) throw new ErroFilaOlist("Preserve o vínculo do vendedor nesta conta.", 403);
      const cliente = await detalheCliente(destinoId, selecoes.clienteId, consultar);
      const vendedor = await vendedorPorId(destinoId, selecoes.vendedorId, consultar);
      const compativel = (a: PessoaReferencia, b: PessoaReferencia) => a.cpfCnpj && b.cpfCnpj
        ? a.cpfCnpj === b.cpfCnpj : nomeServicoSync(a.nome) === nomeServicoSync(b.nome);
      if (!compativel(origem.referencia.cliente, pessoa(cliente, selecoes.clienteId)) || !compativel(origem.referencia.vendedor, vendedor.referencia)) {
        throw new ErroFilaOlist("Cliente ou vendedor selecionado não corresponde à identidade de origem.", 409);
      }
      if (fixo !== null) validarVendedorPedidoOlist(cliente, fixo);
      return { clienteId: selecoes.clienteId, vendedorId: selecoes.vendedorId, vendedorFixo: fixo !== null,
        cadastros: { cliente, vendedor: vendedor.cadastro } };
    }
    const correspondencia = await resolverCorrespondenciaPedidoManual(usuario, ref, destinoId);
    if (selecoes.clienteId !== correspondencia.clienteId || selecoes.vendedorId !== correspondencia.vendedorId) throw new ErroFilaOlist("Cliente ou vendedor do pedido não correspondem à referência de origem. Revise o pedido.", 409);
    return correspondencia;
  }
  return { obterReferenciaPedidoManual, resolverCorrespondenciaPedidoManual, validarReferenciaPersistidaPedidoManual };
}

const servico = criarServicoCorrespondenciaPedidoManual();
export const obterReferenciaPedidoManual = servico.obterReferenciaPedidoManual;
export const resolverCorrespondenciaPedidoManual = servico.resolverCorrespondenciaPedidoManual;
export const validarReferenciaPersistidaPedidoManual = servico.validarReferenciaPersistidaPedidoManual;
