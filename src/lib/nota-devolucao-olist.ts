import type { PrismaClient } from "@prisma/client";
import { RetornoOlistError } from "@/lib/retorno-estoque-olist-domain";

type Registro = Record<string, unknown>;
export type NotaDevolucaoResumo = { id: string; numero: string; serie: string; situacao: string; autorizada: boolean; link: string | null };
export type ValidacaoNotaPedido = {
  pedido_olist_id: string;
  estado: "encontrada" | "nao_encontrada" | "inconclusiva" | "erro";
  mensagem: string;
  notas: NotaDevolucaoResumo[];
};
export type ValidacaoNotasRetorno = { pedidos: ValidacaoNotaPedido[] };
type ConsultaNotas = {
  obterPedido(aplicativoId: string, pedidoId: string): Promise<Registro>;
  listarNotas(aplicativoId: string, filtros: { idVenda?: string; cpfCnpj?: string }): Promise<Registro[]>;
  obterNota(aplicativoId: string, notaId: string): Promise<Registro>;
  obterLinkNota(aplicativoId: string, notaId: string): Promise<string>;
};
const SITUACOES: Record<string, string> = {
  "1": "Pendente", "2": "Emitida", "3": "Cancelada", "4": "Aguardando recibo", "5": "Rejeitada",
  "6": "Autorizada", "7": "Emitida DANFE", "8": "Registrada", "9": "Aguardando protocolo", "10": "Denegada",
};
function objeto(value: unknown): Registro {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Registro : {};
}
function id(value: unknown) {
  const texto = typeof value === "string" || typeof value === "number" ? String(value) : "";
  return /^\d+$/.test(texto) && !/^0+$/.test(texto) ? texto : "";
}

/** Só confirma vínculo direto com a venda ou referência explícita à nota original. */
export function criarValidadorNotaDevolucao(db: Pick<PrismaClient, "retornoEstoqueOlist">, olist: ConsultaNotas) {
  return async function validar(aplicativoId: string, retornoId: string): Promise<ValidacaoNotasRetorno> {
    const retorno = await db.retornoEstoqueOlist.findFirst({
      where: { id: retornoId, aplicativoId },
      select: { itens: { select: { itemBaixa: { select: { pedidoOlistId: true } } } } },
    });
    if (!retorno) throw new RetornoOlistError("Retorno não encontrado neste aplicativo.", 404);
    const pedidos: ValidacaoNotaPedido[] = [];
    const pedidosIds = [...new Set(retorno.itens.map((item) => item.itemBaixa.pedidoOlistId))];
    // Reutiliza consultas do mesmo cliente durante este clique, sem cache entre usuários/aplicativos.
    const notasPorDocumento = new Map<string, Registro[]>();
    const detalhesPorNota = new Map<string, Registro>();
    for (const pedidoId of pedidosIds) {
      const base = { pedido_olist_id: pedidoId ?? "", notas: [] };
      if (!pedidoId || !id(pedidoId)) {
        pedidos.push({ ...base, estado: "inconclusiva", mensagem: "Retorno sem identificador de pedido válido para consulta." }); continue;
      }
      try {
        const pedido = await olist.obterPedido(aplicativoId, pedidoId);
        const notaOriginal = id(objeto(pedido.notaFiscal).id) || id(pedido.idNotaFiscal);
        const documento = String(objeto(pedido.cliente).cpfCnpj ?? "").replace(/\D/g, "");
        const diretas = await olist.listarNotas(aplicativoId, { idVenda: pedidoId });
        let doCliente: Registro[] = [];
        if (notaOriginal && [11, 14].includes(documento.length)) {
          if (!notasPorDocumento.has(documento)) notasPorDocumento.set(documento, await olist.listarNotas(aplicativoId, { cpfCnpj: documento }));
          doCliente = notasPorDocumento.get(documento)!;
        }
        const idsDiretos = new Set(diretas.map((nota) => id(nota.id)).filter(Boolean));
        const candidatas = new Map([...diretas, ...doCliente].map((nota) => [id(nota.id), nota]));
        if (candidatas.has("")) throw new Error("Resposta de nota sem identificador.");
        const notas: NotaDevolucaoResumo[] = [];
        let semVinculo = false;
        for (const [notaId, resumo] of candidatas) {
          const origemResumo = objeto(resumo.origem);
          // Não detalhar notas de outros pedidos do mesmo cliente.
          const origemConhecida = ["venda", "notafiscal"].includes(String(origemResumo.tipo));
          const vinculoResumo = (origemResumo.tipo === "venda" && id(origemResumo.id) === pedidoId)
            || (origemResumo.tipo === "notafiscal" && Boolean(notaOriginal) && id(origemResumo.id) === notaOriginal);
          if (!idsDiretos.has(notaId) && origemConhecida && !vinculoResumo) continue;
          if (!detalhesPorNota.has(notaId)) {
            if (detalhesPorNota.size >= 100) throw new Error("Consulta de detalhes excedeu o limite seguro.");
            detalhesPorNota.set(notaId, await olist.obterNota(aplicativoId, notaId));
          }
          const nota = detalhesPorNota.get(notaId)!;
          if (id(nota.id) !== notaId) throw new Error("Identificador de nota inconsistente.");
          if (!["E", "S"].includes(String(nota.tipo))) throw new Error("Tipo de nota indisponível.");
          if (String(nota.tipo) !== "E") continue;
          if (!/^(?:[1-9]|10)$/.test(String(nota.finalidade))) throw new Error("Finalidade fiscal indisponível.");
          if (!["4", "8"].includes(String(nota.finalidade))) continue;
          const origem = objeto(nota.origem);
          const vinculo = (origem.tipo === "venda" && id(origem.id) === pedidoId)
            || (origem.tipo === "notafiscal" && Boolean(notaOriginal) && id(origem.id) === notaOriginal);
          // O filtro oficial idVenda comprova o vínculo quando a origem não contradiz a venda.
          const contradiz = (origem.tipo === "venda" && Boolean(id(origem.id)) && id(origem.id) !== pedidoId)
            || (origem.tipo === "notafiscal" && Boolean(notaOriginal) && Boolean(id(origem.id)) && id(origem.id) !== notaOriginal);
          if (!vinculo && (!idsDiretos.has(notaId) || contradiz)) { semVinculo = true; continue; }
          let link: string | null = null;
          try {
            const url = new URL(await olist.obterLinkNota(aplicativoId, notaId));
            if (url.protocol === "https:" && !url.username && !url.password) link = url.href;
          } catch { /* Falha no link não invalida a existência ou a situação fiscal da nota. */ }
          notas.push({ id: notaId, numero: String(nota.numero ?? resumo.numero ?? "Não informado"), serie: String(nota.serie ?? resumo.serie ?? ""),
            situacao: SITUACOES[String(nota.situacao)] ?? "Situação não informada",
            autorizada: String(nota.situacao) === "6", link });
        }
        pedidos.push({ ...base, notas, estado: notas.length ? "encontrada" : semVinculo ? "inconclusiva" : "nao_encontrada",
          mensagem: notas.length ? notas.some((nota) => nota.autorizada)
            ? "Nota de devolução encontrada com autorização confirmada na Olist."
            : "Nota de devolução encontrada, mas a autorização não foi confirmada na Olist."
            : semVinculo ? "Há nota de devolução do cliente sem vínculo verificável com este pedido. Confira na Olist."
              : "Nenhuma nota de devolução vinculada a este pedido foi encontrada na Olist." });
      } catch {
        pedidos.push({ ...base, estado: "erro", mensagem: "Não foi possível concluir a consulta na Olist. Tente novamente; a ausência de nota não foi confirmada." });
      }
    }
    return { pedidos };
  };
}
