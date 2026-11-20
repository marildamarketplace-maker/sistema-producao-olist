import { z } from "zod";
import { bancoIa, trabalhosIa } from "@/lib/trabalhos-ia/runtime";
import { corpoIa, erroIa, jsonIa, sessaoIa } from "@/lib/trabalhos-ia/http";
import { ErroTrabalhoIa, solicitarIaSchema, TIPO_RELATORIO_SKU } from "@/lib/trabalhos-ia/contrato";
import { relatorioSkuIa } from "@/lib/trabalhos-ia/relatorio-sku";
import { lerRelatorioIa } from "@/lib/trabalhos-ia/relatorio-leitura";
import { criarExcelBuscaSku, criarPdfBuscaSku } from "@/lib/exportar-busca-sku";
import { COLUNAS_ORDENACAO_SKU, DIRECOES_ORDENACAO_SKU } from "@/lib/anotar-sku/ordenacao";

export const runtime = "nodejs";
export const maxDuration = 60;
type Contexto = { params: Promise<{ id: string }> };
export async function POST(request: Request, contexto: Contexto) {
  try {
    const escopo = await sessaoIa(request), id = z.uuid().parse((await contexto.params).id);
    const { chave } = solicitarIaSchema.parse(await corpoIa(request));
    const trabalho = await trabalhosIa.solicitar(escopo, TIPO_RELATORIO_SKU, id, chave);
    return jsonIa({ trabalho, statusUrl: `/api/trabalhos-ia/${trabalho.id}` }, 202);
  } catch (error) { return erroIa(error); }
}
const consulta = z.object({ trabalho: z.uuid().optional(), offset: z.coerce.number().int().min(0).max(1_000_000).default(0), formato: z.enum(["csv", "xlsx", "pdf"]).optional(), ordenarPor: z.enum(COLUNAS_ORDENACAO_SKU).default("quantidade"), direcao: z.enum(DIRECOES_ORDENACAO_SKU).default("desc") });
const celulaCsv = (texto: string) => `"${(/^(?:\s*[=+@\-]|[\t\r\n])/.test(texto) ? "'" + texto : texto).replaceAll('"', '""')}"`;
export async function GET(request: Request, contexto: Contexto) {
  try {
    const escopo = await sessaoIa(request), id = z.uuid().parse((await contexto.params).id);
    await relatorioSkuIa.autorizar(bancoIa, escopo, "ler");
    const { trabalho, offset, formato, ordenarPor, direcao } = consulta.parse(Object.fromEntries(new URL(request.url).searchParams));
    const ordem = { coluna: ordenarPor, direcao };
    const primeira = await lerRelatorioIa(bancoIa, escopo.aplicativoId, id, trabalho, formato ? 0 : offset, formato ? 500 : 50, ordem);
    if (!formato) return jsonIa(primeira);
    // Exportação curta e limitada; processamento da IA permanece no worker.
    if (primeira.total > 10_000) throw new ErroTrabalhoIa("A exportação aceita até 10.000 SKUs. Consulte o relatório paginado na tela.", 413);
    const itens = [...primeira.itens];
    let proxima = primeira.proximaPagina;
    while (proxima !== null) {
      const pagina = await lerRelatorioIa(bancoIa, escopo.aplicativoId, id, primeira.id, proxima, 500, ordem);
      itens.push(...pagina.itens); proxima = pagina.proximaPagina;
    }
    const data = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(primeira.criadoEm));
    const linhas = itens.map(item => ({ ...item, tituloProduto: item.produto }));
    const corpo = formato === "csv" ? "\uFEFFSKU;PRODUTO;TECIDO;QTD\r\n" + itens.map(item => [celulaCsv(item.sku), celulaCsv(item.produto), celulaCsv(item.tecido), item.quantidade].join(";")).join("\r\n")
      : Buffer.from(formato === "xlsx" ? criarExcelBuscaSku(data, linhas, true) : criarPdfBuscaSku(data, linhas, true));
    if (Buffer.byteLength(corpo) > 4_000_000) throw new ErroTrabalhoIa("O arquivo excede 4 MB. Use CSV ou consulte as páginas do relatório.", 413);
    return new Response(corpo, { headers: {
      "Content-Type": formato === "csv" ? "text/csv; charset=utf-8" : formato === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="relatorio-ia-${primeira.id}.${formato}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return erroIa(error); }
}
