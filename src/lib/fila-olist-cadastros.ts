import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAplicativoOlistConfig } from "@/lib/aplicativo";
import { listarServicosOlistApi, listarContatosOlistApi, listarVendedoresOlistApi, listarProdutosOlistApi, listarFormasRecebimentoOlistApi, obterCadastroFornecedorOlist, getValidOlistAccessToken } from "@/lib/olist";
import type { SelecoesFilaOlist, SelecoesFilaOlistParciais } from "@/lib/fila-olist-contrato";
export class ErroFilaOlist extends Error { constructor(message: string, readonly status = 400) { super(message); } }
const ErroFila = ErroFilaOlist;
function contatoDoCadastro(item: Record<string, unknown>): Record<string, unknown> | null {
  return item.contato && typeof item.contato === "object" && !Array.isArray(item.contato)
    ? item.contato as Record<string, unknown> : null;
}
export function nome(item: Record<string, unknown>) {
  return String(item.nome ?? contatoDoCadastro(item)?.nome ?? item.descricao ?? item.id);
}
function ativo(item: Record<string, unknown>) { return !["I", "E", "INATIVO", "2", "B"].includes(String(item.situacao ?? "A").toUpperCase()); }
// O marcador pode vir colado à composição, como "5%ELASTRef. 5168".
// Não usar aqui a regra de palavras isoladas da sincronização de catálogos.
function produtoComReferencia(item: Record<string, unknown>) {
  return /ref(?=$|[^\p{L}\p{N}_])/iu.test(nome(item).normalize("NFKC"));
}
// Contatos e vendedores usam B=Ativo e A=Ativo com acesso. Os demais
// recursos mantêm seu contrato próprio (incluindo B bloqueado quando aplicável).
function pessoaAtiva(item: Record<string, unknown>) {
  return ["A", "B"].includes(String(item.situacao ?? "A").trim().toUpperCase());
}
export async function consultarCadastrosFilaOlist(filialId: string, params: URLSearchParams, escopo?: { vendedorId: number | null }, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const recurso = params.get("recurso");
    await validarIntegracao(filialId);
    const filtros = z.object({ busca: z.string().max(120), pagina: z.coerce.number().int().min(1).max(1000) }).safeParse({ busca: params.get("busca") ?? "", pagina: params.get("pagina") ?? 1 });
    if (!filtros.success) throw new ErroFila("Pesquisa inválida.");
    const { busca, pagina } = filtros.data;
    const limit = 50, offset = (pagina - 1) * limit;
    if (recurso === "planos") {
      const formaId = z.coerce.number().int().positive().safeParse(params.get("formaId"));
      if (!formaId.success) throw new ErroFila("Selecione uma forma de recebimento.");
      const planos = await prisma.formaRecebimentoOlistPlano.findMany({ where: { aplicativoId: filialId, formaOlistId: String(formaId.data), planoPagamento: { ativo: true } }, take: 101, orderBy: { planoPagamentoId: "asc" }, select: { planoPagamento: { select: { id: true, nome: true } } } });
      if (planos.length > 100) throw new ErroFila("Há mais de 100 planos associados. Revise as associações em Formas de recebimento.");
      return ({ itens: planos.map((p) => p.planoPagamento) });
    }
    let resultado;
    if (recurso === "clientes") resultado = await listarContatosOlistApi(filialId, { nome: busca || undefined, idVendedor: escopo?.vendedorId ? String(escopo.vendedorId) : undefined, limit, offset });
    else if (recurso === "vendedores") resultado = await listarVendedoresOlistApi(filialId, { nome: busca || undefined, limit, offset });
    else if (recurso === "produtos") {
      const termo = busca.trim();
      // A pesquisa simples da Olist não encontra Ref no meio do nome.
      // O curinga mantém o filtro remoto e evita baixar todo o catálogo.
      const nomeProduto = !termo || termo.toLocaleLowerCase("pt-BR") === "ref" ? "%Ref%" : termo;
      resultado = await listarProdutosOlistApi(filialId, { nome: nomeProduto, situacao: "A", limit, offset, timeoutMs: 20_000, signal });
    }
    else if (recurso === "servicos") resultado = await listarServicosOlistApi(filialId, { nome: busca || undefined, limit, offset });
    else if (recurso === "formas") resultado = await listarFormasRecebimentoOlistApi(filialId, { nome: busca || undefined, situacao: 1, limit, offset });
    else throw new ErroFila("Consulta inválida.");
    // O termo digitado continua sendo pesquisado na Olist. A restrição por "ref"
    // também é aplicada aqui, sem depender de uma busca remota com semântica AND.
    // A paginação abaixo usa a página bruta, inclusive quando nenhum item passa.
    return ({ itens: resultado.itens.filter((i) => (recurso === "clientes" || recurso === "vendedores" ? pessoaAtiva(i as Record<string, unknown>) : ativo(i as Record<string, unknown>)) &&
      (recurso !== "produtos" || produtoComReferencia(i as Record<string, unknown>)) &&
      (recurso !== "vendedores" || !escopo?.vendedorId || Number(i.id) === escopo.vendedorId)).map((i) => {
      const item = i as Record<string, unknown>, precos = item.precos as Record<string, unknown> | undefined;
      return { id: Number(item.id), nome: nome(item), referencia: String((recurso === "vendedores" ? contatoDoCadastro(item)?.codigo : undefined) ?? item.codigo ?? item.sku ?? ""), preco: Number(precos?.preco ?? item.preco ?? 0) };
    }), pagina, mais: resultado.itens.length === limit });
}
async function validarIntegracao(filialId: string) {
  const config = await getAplicativoOlistConfig(filialId);
  if (!config.clientId || !config.clientSecret) throw new ErroFila("Configure o OAuth da Olist no aplicativo destinatário antes de continuar.");
  await getValidOlistAccessToken(filialId).catch((error: unknown) => {
    const detalhe = error instanceof Error ? error as Error & { code?: unknown; httpStatus?: unknown; codigoOAuth?: unknown; requerReconexao?: unknown } : null;
    // Não registrar o erro bruto: Axios inclui credenciais no config e Prisma pode incluir dados da consulta.
    const codigo = typeof detalhe?.code === "string" && /^(P\d{4}|E[A-Z_]{2,40}|ERR_[A-Z_]{2,40})$/.test(detalhe.code) ? detalhe.code : null;
    const codigoOAuth = typeof detalhe?.codigoOAuth === "string" && ["invalid_grant", "invalid_client", "unauthorized_client", "invalid_request", "invalid_scope", "unsupported_grant_type", "server_error", "temporarily_unavailable"].includes(detalhe.codigoOAuth) ? detalhe.codigoOAuth : null;
    console.error("[fila-olist] Falha ao obter ou renovar token da conta destinatária.", {
      filialId,
      codigo,
      httpStatus: typeof detalhe?.httpStatus === "number" ? detalhe.httpStatus : null,
      codigoOAuth,
      requerReconexao: typeof detalhe?.requerReconexao === "boolean" ? detalhe.requerReconexao : null,
      causa: detalhe?.message === "Falha no OAuth Olist/Tiny." ? "refresh_token_ausente"
        : codigoOAuth ? "renovacao_oauth_rejeitada"
        : codigo?.startsWith("P") ? "falha_banco"
        : codigo ? "falha_operacional" : "falha_nao_classificada",
    });
    throw new ErroFila("Conecte novamente a integração Olist da conta destinatária antes de continuar.");
  });
}
export type PessoasFilaOlistValidadas = { cliente: Record<string, unknown>; vendedor: Record<string, unknown> };
export async function validarSelecoesParciais(filialId: string, selecoes: SelecoesFilaOlistParciais, precisaLaser = false,
  pessoasValidadas?: PessoasFilaOlistValidadas) {
    if ((selecoes.formaId || selecoes.planoId) && selecoes.recursoForma !== "RECEBIMENTO") throw new ErroFila("Selecione novamente a forma e o plano de recebimento.");
    if (pessoasValidadas && (Number(pessoasValidadas.cliente.id) !== selecoes.clienteId || Number(pessoasValidadas.vendedor.id) !== selecoes.vendedorId)) {
      throw new ErroFila("Os cadastros validados não correspondem às seleções desta conta.");
    }
    if (selecoes.clienteId || selecoes.vendedorId || selecoes.formaId || selecoes.tecidos?.length || selecoes.laser) await validarIntegracao(filialId);
    const plano = selecoes.planoId && selecoes.formaId ? await prisma.formaRecebimentoOlistPlano.findFirst({ where: { aplicativoId: filialId, formaOlistId: String(selecoes.formaId), planoPagamentoId: selecoes.planoId, planoPagamento: { ativo: true } }, select: { planoPagamento: { select: { nome: true } } } }) : null;
    if (selecoes.planoId && !plano) throw new ErroFila("Plano não associado à forma de recebimento nesta conta destinatária.");
    const cliente = pessoasValidadas?.cliente ?? (selecoes.clienteId ? await obterCadastroFornecedorOlist(filialId, "contatos", selecoes.clienteId) : null);
    const forma = selecoes.formaId ? await obterCadastroFornecedorOlist(filialId, "formas-recebimento", selecoes.formaId) : null;
    if ((cliente && !pessoaAtiva(cliente)) || (forma && !ativo(forma))) throw new ErroFila("Cliente ou forma de recebimento inativos.");
    // Vendedores não possuem endpoint de detalhe. Valida por paginação na mesma conta.
    let vendedor: Record<string, unknown> | undefined = pessoasValidadas?.vendedor;
    for (let pagina = 0; !vendedor && selecoes.vendedorId && pagina < 100; pagina++) {
      const lista = await listarVendedoresOlistApi(filialId, { limit: 100, offset: pagina * 100 });
      vendedor = lista.itens.find((i) => Number(i.id) === selecoes.vendedorId);
      if (vendedor || lista.itens.length < 100) break;
    }
    if (selecoes.vendedorId && (!vendedor || !pessoaAtiva(vendedor))) throw new ErroFila("Vendedor indisponível na conta destinatária.");
    const nomes = new Map<string, string>();
    for (const produto of new Map((selecoes.tecidos ?? []).map(p => [p.id, p])).values()) {
      const cadastro = await obterCadastroFornecedorOlist(filialId, "produtos", produto.id);
      if (!ativo(cadastro)) throw new ErroFila("Produto ou serviço inativo na conta destinatária.");
      nomes.set(`P:${produto.id}`, nome(cadastro));
    }
    if (selecoes.laser) {
      const servico = await obterCadastroFornecedorOlist(filialId, "servicos", selecoes.laser.id);
      if (!ativo(servico)) throw new ErroFila("Serviço de laser inativo na conta destinatária.");
      nomes.set(`S:${selecoes.laser.id}`, nome(servico));
    }
    if (precisaLaser && !selecoes.laser) throw new ErroFila("Selecione o serviço de corte a laser e seu preço.");
    return { plano, cliente, forma, vendedor, nomes };
}

export async function validarCadastros(filialId: string, selecoes: SelecoesFilaOlist, precisaLaser: boolean,
  pessoasValidadas?: PessoasFilaOlistValidadas) {
  const resultado = await validarSelecoesParciais(filialId, selecoes, precisaLaser, pessoasValidadas);
  const { plano, cliente, forma, vendedor } = resultado;
  if (!plano || !cliente || !forma || !vendedor) throw new ErroFila("Complete os dados comerciais antes de criar o pedido.");
  return { ...resultado, plano, cliente, forma, vendedor };
}
