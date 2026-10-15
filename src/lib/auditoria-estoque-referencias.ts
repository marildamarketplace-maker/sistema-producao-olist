import { Prisma } from "@prisma/client";
import type { ListagemProdutosOlist } from "@/lib/olist";

export type LoteReferencia = { id: string; nome: string; saldo: string };
export type SaldoReferencia = {
  produtoBase: string;
  unidade: string;
  saldo: string;
  lotes: LoteReferencia[];
};
export type DependenciasAuditoria = {
  listar: (aplicativoId: string, filtros: { situacao: "A"; limit: number; offset: number }) => Promise<ListagemProdutosOlist>;
  obterEstoque: (aplicativoId: string, id: string) => Promise<unknown>;
};

export function lerEstoqueReferencia(payload: unknown, id: string) {
  if (!payload || typeof payload !== "object") throw new Error("Resposta de estoque inválida.");
  const item = payload as Record<string, unknown>;
  if (String(item.id) !== id || typeof item.unidade !== "string" || !item.unidade.trim()) {
    throw new Error("Identificação ou unidade de estoque inválida.");
  }
  if ((typeof item.saldo !== "number" && typeof item.saldo !== "string") ||
      !/^-?\d+(\.\d+)?$/.test(String(item.saldo))) {
    throw new Error("Saldo físico ausente ou inválido.");
  }
  return { saldo: new Prisma.Decimal(item.saldo), unidade: item.unidade.trim().toUpperCase() };
}

export async function auditarEstoqueReferencias(aplicativoId: string, deps: DependenciasAuditoria, limiteEm = Date.now() + 240_000) {
  const verificarPrazo = () => {
    if (Date.now() >= limiteEm) throw new Error("Prazo da auditoria excedido; resultado incompleto.");
  };
  const produtos = new Map<string, { id: string; nome: string }>();
  let offset = 0;
  // Não confiar no total sintetizado pelo cliente quando a API omite paginação.
  for (let pagina = 0; ; pagina++) {
    verificarPrazo();
    if (pagina >= 1_000) throw new Error("Limite de páginas excedido; auditoria incompleta.");
    // A busca textual da API não reproduz a busca da tela de estoque.
    // Percorrer o catálogo e aplicar contains localmente evita omitir referências.
    const resposta = await deps.listar(aplicativoId, { situacao: "A", limit: 100, offset });
    if (resposta.itens.length === 0) break;
    let novos = 0;
    for (const produto of resposta.itens) {
      const id = String(produto.id ?? "");
      const nome = produto.descricao?.trim() ?? "";
      if (!/^\d+$/.test(id) || !nome) throw new Error("Produto Olist sem identificação ou nome.");
      if (produtos.has(id)) throw new Error("Produto repetido na paginação; auditoria incompleta.");
      produtos.set(id, { id, nome });
      novos++;
    }
    if (!novos) throw new Error("Paginação de produtos sem progresso.");
    offset += resposta.itens.length;
  }
  const grupos = new Map<string, SaldoReferencia>();
  for (const { id, nome } of produtos.values()) {
    if (!/ref/i.test(nome)) continue;
    verificarPrazo();
    const { saldo, unidade } = lerEstoqueReferencia(await deps.obterEstoque(aplicativoId, id), id);
    verificarPrazo();
    const produtoBase = nome.replace(/\s*-\s*LOTE\s+\d+\s*$/i, "").trim();
    const chave = JSON.stringify([produtoBase.replace(/\s+/g, " ").toUpperCase(), unidade]);
    const grupo = grupos.get(chave) ?? { produtoBase, unidade, saldo: "0", lotes: [] };
    grupo.saldo = new Prisma.Decimal(grupo.saldo).plus(saldo).toString();
    grupo.lotes.push({ id, nome, saldo: saldo.toString() });
    grupos.set(chave, grupo);
  }
  return [...grupos.values()].sort((a, b) => a.produtoBase.localeCompare(b.produtoBase) || a.unidade.localeCompare(b.unidade));
}

export function criarMensagensAuditoria(grupos: SaldoReferencia[], executadoEm: Date) {
  const negativos = grupos.filter((grupo) => new Prisma.Decimal(grupo.saldo).isNegative());
  if (!negativos.length) return [];
  const data = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(executadoEm);
  const cabecalho = `*Estoque físico negativo por referência*\n${data}\n${negativos.length} referência(s) negativa(s) de ${grupos.length} analisada(s).\nSaldo físico: produto base + todos os lotes, sem descontar reservas.\n`;
  const formatar = (saldo: string) => new Prisma.Decimal(saldo).toFixed(Math.max(2, new Prisma.Decimal(saldo).decimalPlaces())).replace(".", ",");
  const linhas = negativos.flatMap((grupo) => [
    `\n${grupo.produtoBase}: *${formatar(grupo.saldo)} ${grupo.unidade}*`,
    ...[...grupo.lotes].sort((a, b) => a.id.localeCompare(b.id)).map((lote) => `• ${lote.nome} [ID ${lote.id}]: ${formatar(lote.saldo)} ${grupo.unidade}`),
  ]);
  // Partes completas, sem omitir referências ou lotes quando o relatório cresce.
  const mensagens: string[] = [];
  let atual = cabecalho;
  for (const linha of linhas) {
    for (let inicio = 0; inicio < linha.length; inicio += 2_000) {
      const trecho = linha.slice(inicio, inicio + 2_000);
      if (atual.length + trecho.length + 1 > 3_400) {
        mensagens.push(atual);
        atual = "*Estoque físico negativo — continuação*\n";
      }
      atual += `\n${trecho}`;
    }
  }
  mensagens.push(atual);
  return mensagens;
}
