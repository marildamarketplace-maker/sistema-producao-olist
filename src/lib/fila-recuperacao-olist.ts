import { z } from "zod";
import type { DadosPedidoFila } from "./fila-fornecedor-contrato";
import type { SelecoesFilaOlistParciais } from "./fila-olist-contrato";
import { nomeServicoSync, codigoServicoSync } from "./olist-sync/servicos";
import { normalizarDocumentoContato } from "./olist-sync/dominio";
import { consultarCorrespondenciaOlist, type CaminhoConsulta } from "./pedido-manual-correspondencia";
import { ErroFilaOlist } from "./fila-olist-cadastros";
import { prisma } from "./prisma";

type Cadastro = Record<string, unknown>;
type Recurso = "contatos" | "vendedores" | "produtos" | "servicos" | "formas-pagamento";
export type CampoRecuperacao = { chave: string; estado: "RECUPERADO" | "PENDENTE"; mensagem: string };
export const entradaRecuperacaoSchema = z.object({ acao: z.literal("recuperar"), versao: z.number().int().nonnegative(),
  filialId: z.guid(), chave: z.union([z.enum(["clienteId", "vendedorId", "formaId", "planoId", "laser"]), z.string().regex(/^tecido:[0-9a-f-]{36}$/i)]),
}).strict();
export interface DependenciasRecuperacao {
  consultar(app: string, caminho: CaminhoConsulta, parametros: Record<string, string>, timeout: number): Promise<unknown>;
  vinculo(origem: string, destino: string, recurso: Recurso, id: number): Promise<number | null>;
  planos(app: string, formaId: number): Promise<Array<{ id: string; nome: string }>>;
  agora?: () => number;
}
export const dependenciasRecuperacao: DependenciasRecuperacao = {
  consultar: consultarCorrespondenciaOlist,
  async vinculo(origem, destino, recurso, id) {
    const entidade = { contatos: "CONTATO", vendedores: "VENDEDOR", produtos: "PRODUTO", servicos: "SERVICO", "formas-pagamento": "FORMA_PAGAMENTO" }[recurso];
    if (recurso === "vendedores") return null;
    const fonte = await prisma.olistSyncEstado.findUnique({ where: { aplicativoId_entidade_remoteId: { aplicativoId: origem, entidade, remoteId: String(id) } }, select: { registroId: true, configuracaoId: true } });
    if (!fonte?.registroId) return null;
    const alvo = await prisma.olistSyncEstado.findUnique({ where: { registroId_aplicativoId: { registroId: fonte.registroId, aplicativoId: destino } },
      select: { remoteId: true, presente: true, configuracaoId: true, entidade: true } });
    return alvo?.presente && alvo.configuracaoId === fonte.configuracaoId && alvo.entidade === entidade ? identificador(alvo.remoteId) : null;
  },
  async planos(app, formaId) {
    const linhas = await prisma.formaPagamentoOlistPlano.findMany({ where: { aplicativoId: app, formaOlistId: String(formaId), planoPagamento: { ativo: true } },
      take: 101, select: { planoPagamento: { select: { id: true, nome: true } } } });
    if (linhas.length > 100) throw new Error("Muitos planos associados.");
    return linhas.map(l => l.planoPagamento);
  },
};
function objeto(v: unknown): v is Cadastro { return !!v && typeof v === "object" && !Array.isArray(v); }
function identificador(v: unknown) { const id = typeof v === "number" || typeof v === "string" && /^\d+$/.test(v) ? Number(v) : 0; return Number.isSafeInteger(id) && id > 0 ? id : null; }
function contato(c: Cadastro) { return objeto(c.contato) ? c.contato : c; }
function nome(c: Cadastro) { return nomeServicoSync(c.nome ?? contato(c).nome ?? c.descricao); }
function codigo(c: Cadastro) { return codigoServicoSync(c.codigo ?? c.sku); }
function ativo(c: Cadastro, recurso: Recurso) {
  const s = String(c.situacao ?? (recurso === "formas-pagamento" ? "1" : "A")).trim().toUpperCase();
  return recurso === "contatos" || recurso === "vendedores" ? ["A", "B"].includes(s) : recurso === "formas-pagamento" ? ["1", "A"].includes(s) : s === "A";
}
function doc(c: Cadastro) { return normalizarDocumentoContato(contato(c).cpfCnpj); }
/** Um nome nunca sobrepõe dois identificadores preenchidos e conflitantes. */
export function correspondeCadastro(origem: Cadastro, destino: Cadastro, pessoa = false) {
  const a = pessoa ? doc(origem) : codigo(origem), b = pessoa ? doc(destino) : codigo(destino);
  if (a && b) return a === b;
  return !!nome(origem) && nome(origem) === nome(destino);
}
export function condicoesPlano(nomePlano: string): number[] | null {
  const valor = nomePlano.trim().toLocaleLowerCase("pt-BR");
  if (valor === "a vista") return [0];
  if (!/^\d+(\s*\/\s*\d+)*$/.test(valor)) return null;
  const dias = valor.split("/").map(Number);
  return dias.every(Number.isSafeInteger) ? dias : null;
}
export function referenciaRecuperacao(dados: DadosPedidoFila, destinoId: string) {
  if (dados.olistAnterior) return dados.olistAnterior;
  return dados.olist?.filialId !== destinoId ? dados.olist : undefined;
}
export function chavesRecuperacao(dados: DadosPedidoFila, destinoId: string): string[] {
  if (!referenciaRecuperacao(dados, destinoId)) return [];
  return ["vendedorId", "clienteId", "formaId", ...[...new Set(dados.itens.map(i => i.tecido.id))].map(id => `tecido:${id}`),
    ...(dados.itens.some(i => i.corteLaser) ? ["laser"] : []), "planoId"];
}
export function estadoRecuperacao(dados: DadosPedidoFila, destinoId: string) {
  const chaves = chavesRecuperacao(dados, destinoId);
  if (!chaves.length) return null;
  const campos = dados.recuperacaoOlist?.filialId === destinoId ? dados.recuperacaoOlist.campos : [];
  return { campos, restantes: chaves.filter(chave => !campos.some(c => c.chave === chave)) };
}
/** Cada campo é uma unidade curta, persistida pelo chamador; nunca percorre catálogos inteiros. */
export async function recuperarCampoOlist(dados: DadosPedidoFila, destinoId: string, chave: string, vendedorFixoId: number | null,
  deps: DependenciasRecuperacao = dependenciasRecuperacao): Promise<{ selecoes: SelecoesFilaOlistParciais; campo: CampoRecuperacao }> {
  const ref = referenciaRecuperacao(dados, destinoId);
  if (!ref || !chavesRecuperacao(dados, destinoId).includes(chave)) throw new ErroFilaOlist("Campo sem referência para recuperação.", 400);
  const selecoes: SelecoesFilaOlistParciais = dados.olist?.filialId === destinoId ? structuredClone(dados.olist.selecoes) : { tipoVenda: ref.selecoes.tipoVenda };
  const pendente = (mensagem: string) => ({ selecoes, campo: { chave, estado: "PENDENTE" as const, mensagem } });
  if (chave.startsWith("tecido:") && selecoes.tecidos?.some(t => t.tecidoId === chave.slice(7)) && dados.recuperacaoOlist?.campos.some(c => c.chave.startsWith("tecido:") && c.estado === "RECUPERADO")) {
    return { selecoes, campo: { chave, estado: "RECUPERADO", mensagem: "Produto equivalente já recuperado nesta conta." } };
  }
  const agora = deps.agora ?? Date.now, prazo = agora() + 12_000;
  let chamadas = 0;
  async function consultar(app: string, caminho: CaminhoConsulta, params: Record<string, string> = {}) {
    if (++chamadas > 8 || agora() >= prazo) throw new Error("Limite de consulta.");
    const resposta = await deps.consultar(app, caminho, params, Math.min(5_000, prazo - agora()));
    if (agora() >= prazo) throw new Error("Prazo excedido.");
    return resposta;
  }
  async function lista(app: string, recurso: Recurso, params: Record<string, string>, offset = 0) {
    const resposta = await consultar(app, recurso, { ...params, limit: "50", offset: String(offset) });
    if (!objeto(resposta) || !Array.isArray(resposta.itens) || !resposta.itens.every(objeto) || resposta.itens.length > 50) throw new Error("Pesquisa incompleta.");
    const total = objeto(resposta.paginacao) ? resposta.paginacao.total : undefined;
    const completa = typeof total === "number" && Number.isSafeInteger(total) && total >= resposta.itens.length && total <= offset + resposta.itens.length && resposta.itens.length < 50;
    return { itens: resposta.itens, completa };
  }
  async function detalhe(app: string, recurso: Recurso, id: number) {
    if (recurso === "vendedores") {
      for (let pagina = 0; pagina < 4; pagina++) {
        const p = await lista(app, recurso, {}, pagina * 50);
        const item = p.itens.find(c => identificador(c.id) === id);
        if (item) return item;
        if (p.itens.length < 50) break;
      }
      throw new Error("Vendedor não localizado.");
    }
    const c = await consultar(app, `${recurso}/${id}`);
    if (!objeto(c) || identificador(c.id) !== id) throw new Error("Cadastro inválido.");
    return c;
  }
  async function pessoaCompleta(app: string, c: Cadastro, recurso: Recurso) {
    if (recurso === "contatos") return detalhe(app, recurso, identificador(c.id)!);
    const p = contato(c), idContato = identificador(p.id);
    return idContato && !Object.hasOwn(p, "cpfCnpj") ? { ...c, contato: await detalhe(app, "contatos", idContato) } : c;
  }
  try {
    if (chave === "planoId") {
      if (!selecoes.formaId || !ref.selecoes.formaId || !ref.selecoes.planoId) return pendente("Selecione a forma e um plano equivalente.");
      const origem = (await deps.planos(ref.filialId, ref.selecoes.formaId)).find(p => p.id === ref.selecoes.planoId);
      const condicoes = origem && condicoesPlano(origem.nome);
      if (!origem || !condicoes) return pendente("Condições do plano de origem indisponíveis.");
      const candidatos = (await deps.planos(destinoId, selecoes.formaId)).filter(p => nomeServicoSync(p.nome) === nomeServicoSync(origem.nome) && JSON.stringify(condicoesPlano(p.nome)) === JSON.stringify(condicoes));
      if (candidatos.length !== 1) return pendente("Selecione um plano com nome e condições equivalentes.");
      selecoes.planoId = candidatos[0].id;
    } else {
      const tecido = chave.startsWith("tecido:") ? chave.slice(7) : null;
      const recurso: Recurso = tecido ? "produtos" : chave === "laser" ? "servicos" : chave === "formaId" ? "formas-pagamento" : chave === "vendedorId" ? "vendedores" : "contatos";
      const idOrigem = tecido ? ref.selecoes.tecidos?.find(t => t.tecidoId === tecido)?.id : chave === "laser" ? ref.selecoes.laser?.id : chave === "formaId" ? ref.selecoes.formaId : chave === "vendedorId" ? ref.selecoes.vendedorId : ref.selecoes.clienteId;
      if (!idOrigem) return pendente("Cadastro de origem não informado. Selecione no destino.");
      const pessoal = recurso === "contatos" || recurso === "vendedores";
      let origem = await detalhe(ref.filialId, recurso, idOrigem);
      if (recurso === "vendedores") origem = await pessoaCompleta(ref.filialId, origem, recurso);
      const idVinculado = ref.filialId === destinoId ? idOrigem : chave === "vendedorId" && vendedorFixoId ? vendedorFixoId : await deps.vinculo(ref.filialId, destinoId, recurso, idOrigem);
      let candidato: Cadastro | undefined;
      if (idVinculado) {
        candidato = await detalhe(destinoId, recurso, idVinculado);
        if (recurso === "vendedores") candidato = await pessoaCompleta(destinoId, candidato, recurso);
        if (!ativo(candidato, recurso) || !correspondeCadastro(origem, candidato, pessoal)) return pendente("Vínculo incompatível com o cadastro de origem.");
      } else {
        const documento = pessoal ? doc(origem) : null, cod = pessoal ? null : codigo(origem);
        // Vendedores são pesquisados pelo nome; seu código pertence ao contato.
        const filtros: Record<string, string> = documento && recurso === "contatos" ? { cpfCnpj: documento } : cod ? { codigo: cod } : { nome: String(origem.nome ?? contato(origem).nome ?? origem.descricao ?? "") };
        if (!Object.values(filtros).some(v => !!v)) return pendente("Nome ou código de origem indisponível.");
        let p = await lista(destinoId, recurso, filtros);
        if (!p.completa) return pendente("Pesquisa incompleta: selecione o cadastro no destino.");
        if (!p.itens.length && (documento || cod)) p = await lista(destinoId, recurso, { nome: String(origem.nome ?? origem.descricao ?? "") });
        if (!p.completa) return pendente("Não foi possível comprovar uma correspondência única.");
        const candidatos: Cadastro[] = [];
        for (const c of p.itens) {
          if (!ativo(c, recurso)) continue;
          let completo = c;
          if (pessoal) completo = await pessoaCompleta(destinoId, c, recurso);
          if (ativo(completo, recurso) && correspondeCadastro(origem, completo, pessoal)) candidatos.push(completo);
        }
        if (candidatos.length !== 1) return pendente(candidatos.length ? "Mais de uma correspondência. Selecione o cadastro correto." : "Nenhuma correspondência. Selecione no destino.");
        candidato = candidatos[0];
        if (!pessoal) candidato = await detalhe(destinoId, recurso, identificador(candidato.id)!);
      }
      if (!ativo(candidato, recurso) || !correspondeCadastro(origem, candidato, pessoal)) return pendente("Cadastro alterado ou incompatível.");
      const id = identificador(candidato.id);
      if (!id) return pendente("Cadastro com identificador inválido.");
      if (chave === "clienteId") {
        if (vendedorFixoId) {
          const vendedor = objeto(candidato.vendedor) ? identificador(candidato.vendedor.id) : null;
          if (vendedor !== vendedorFixoId) return pendente("Cliente não pertence à carteira do vendedor neste aplicativo.");
        }
        selecoes.clienteId = id;
      } else if (chave === "vendedorId") selecoes.vendedorId = id;
      else if (chave === "formaId") { selecoes.formaId = id; delete selecoes.planoId; }
      else {
        const precos = objeto(candidato.precos) ? candidato.precos : candidato;
        const valor = precos.preco;
        const preco = typeof valor === "number" || typeof valor === "string" && valor.trim() ? Number(valor) : NaN;
        if (!Number.isFinite(preco) || preco < 0 || preco > 1e9) return pendente("Preço do novo aplicativo indisponível. Revise o cadastro.");
        if (tecido) {
          // O mesmo ID de origem pode representar vários tecidos locais: consulta única.
          const equivalentes = new Set(ref.selecoes.tecidos?.filter(t => t.id === idOrigem).map(t => t.tecidoId));
          selecoes.tecidos = [...(selecoes.tecidos ?? []).filter(t => !equivalentes.has(t.tecidoId)), ...dados.itens.filter(i => equivalentes.has(i.tecido.id)).map(i => i.tecido.id).filter((v, i, a) => a.indexOf(v) === i).map(tecidoId => ({ tecidoId, id, preco }))];
        } else selecoes.laser = { id, preco };
      }
    }
    return { selecoes, campo: { chave, estado: "RECUPERADO", mensagem: "Recuperado no aplicativo destinatário." } };
  } catch {
    // Não propagar erros de provedores, documentos, tokens ou payloads.
    return pendente("Consulta indisponível ou excedeu o limite. Selecione ou tente novamente este campo.");
  }
}
