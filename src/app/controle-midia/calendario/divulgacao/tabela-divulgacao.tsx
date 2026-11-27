"use client";

import { PAGINA_DIVULGACAO, type EventoDivulgacao, type PaginaDivulgacao, type PerfilDivulgacao } from "@/lib/calendario-comercial/divulgacao";

const perfis: Record<PerfilDivulgacao, string> = {
  estoque: "Maior estoque com poucas saídas", saidas: "Mais movimentações de saída", sem_estoque: "Sem estoque disponível",
};
export const controleDivulgacao = "inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
const numero = new Intl.NumberFormat("pt-BR");
const data = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

export function TabelaDivulgacao({ dados, eventos, pagina, carregando, erro, onPagina, onAtualizar }: {
  dados: PaginaDivulgacao | null; eventos: EventoDivulgacao[]; pagina: number; carregando: boolean; erro: string;
  onPagina: (pagina: number) => void; onAtualizar: () => void;
}) {
  const porId = new Map(eventos.map((evento) => [evento.id, evento]));
  return <section aria-label="Produtos priorizados para divulgação" className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 text-sm text-slate-600">
        {dados && <><p>Saídas: {data.format(new Date(dados.inicioEm))} até {data.format(new Date(dados.referenciaEm))}.</p>
          <p className="mt-1 text-xs">Estoque e ordem consultados em {data.format(new Date(dados.referenciaEm))} (Brasília).</p></>}
        <p className="mt-1 text-xs">A contagem inclui todas as movimentações de saída, inclusive ajustes. Uma saída de várias unidades conta uma vez.</p>
      </div>
      <button type="button" className={controleDivulgacao} onClick={onAtualizar} disabled={carregando}>Atualizar</button>
    </div>
    {erro && <div role="alert" className="mb-4 rounded-md border border-red-200 p-3 text-sm text-red-700">{erro}</div>}
    {carregando && <p role="status" className="py-4 text-sm text-slate-600">Carregando produtos para divulgação...</p>}
    {!carregando && dados && !dados.produtos.length && <p role="status" className="py-4 text-sm text-slate-600">
      {pagina > 0 ? "Não há produtos nesta página. Atualize para voltar ao início." : eventos.length
        ? "Nenhum produto ativo associado aos eventos de divulgação deste mês. Volte ao calendário para associar produtos."
        : "Não há eventos de divulgação para o mês e a abrangência selecionados."}
    </p>}
    {!carregando && dados && dados.produtos.length > 0 && <>
      <div className="overflow-x-auto rounded-md border border-slate-200 focus-visible:outline focus-visible:outline-2"
        role="region" aria-label="Tabela de produtos; role horizontalmente em telas estreitas" tabIndex={0}>
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Ordem recomendada de divulgação. Produtos sem estoque ficam no fim da lista completa.</caption>
          <thead className="bg-slate-50 text-slate-700"><tr>
            <th scope="col" className="min-w-52 px-3 py-3 font-medium">Produto</th>
            <th scope="col" className="min-w-32 px-3 py-3 font-medium">SKU</th>
            <th scope="col" className="px-3 py-3 text-right font-medium">Movimentações de saída<br /><span className="whitespace-nowrap text-xs">12 meses</span></th>
            <th scope="col" className="px-3 py-3 text-right font-medium">Estoque atual</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-200">{dados.produtos.map((produto, indice) => {
            const principal = porId.get(produto.eventoPrincipal);
            return <tr key={produto.id} className={produto.estoque <= 0 ? "bg-slate-50" : ""}>
              <th scope="row" className="px-3 py-3 align-top font-normal">
                <p className="break-words font-medium text-slate-900"><span className="mr-2 text-xs text-slate-500">{pagina * PAGINA_DIVULGACAO + indice + 1}.</span>{produto.titulo}</p>
                <p className="mt-1 text-xs text-slate-600">{perfis[produto.perfil]}</p>
                {principal && <p className="mt-1 text-xs text-slate-600">{principal.nome} · potencial {principal.potencial.toLocaleLowerCase("pt-BR")}</p>}
                <details className="mt-1"><summary className="flex min-h-11 cursor-pointer items-center rounded text-xs text-slate-600 underline focus-visible:outline focus-visible:outline-2">Por que aparece aqui?</summary>
                  <div className="space-y-1 pb-1 text-xs text-slate-600">
                    <p>Eventos: {produto.eventos.map((id) => porId.get(id)?.nome ?? id).join(" · ")}.</p>
                    <p>{produto.perfil === "sem_estoque" ? "Saldo zero ou negativo: aparece depois de todos os produtos disponíveis."
                      : produto.perfil === "estoque" ? "Contagem até o corte do mês. Dentro do evento, priorizamos maior estoque e depois menos saídas."
                      : "Contagem acima do corte do mês. Dentro do evento, priorizamos mais saídas e depois maior estoque."}</p>
                    <p>Eventos são intercalados com peso moderado do potencial. Produtos com vários vínculos aparecem uma vez.</p>
                  </div>
                </details>
              </th>
              <td className="break-all px-3 py-3 align-top text-slate-700">{produto.sku}</td>
              <td className="px-3 py-3 text-right align-top tabular-nums text-slate-900">{numero.format(produto.saidas)}</td>
              <td className="px-3 py-3 text-right align-top tabular-nums"><span className={produto.estoque < 0 ? "text-red-700" : "text-slate-900"}>{numero.format(produto.estoque)}</span>
                {produto.estoque <= 0 && <span className="mt-1 block text-xs text-amber-700">{produto.estoque < 0 ? "Saldo negativo" : "Sem estoque"}</span>}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <p role="status" className="mt-3 text-xs text-slate-600">{dados.produtos.length} produtos nesta página · página {pagina + 1}.</p>
    </>}
    <nav aria-label="Paginação dos produtos" className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <button type="button" className={controleDivulgacao} onClick={() => onPagina(pagina - 1)} disabled={carregando || pagina === 0}>Anterior</button>
      <span className="text-xs text-slate-600">Página {pagina + 1}</span>
      <button type="button" className={controleDivulgacao} onClick={() => onPagina(pagina + 1)} disabled={carregando || !dados?.temMais || Boolean(erro) || pagina >= 10000}>Próxima</button>
    </nav>
    <details className="mt-4 border-t border-slate-200 pt-2"><summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-slate-700 focus-visible:outline focus-visible:outline-2">Como funciona a prioridade</summary>
      <div className="space-y-2 text-xs text-slate-600">
        <p>Entre produtos com saldo positivo, o ciclo destina 60% das posições a maior estoque com poucas saídas e 40% a mais saídas. Se um perfil não tiver candidatos suficientes, o outro completa.</p>
        <p>O corte parte da mediana das contagens do mês; quando ela coincide com o máximo apesar de haver contagens menores, recua ao nível imediatamente inferior. Empates não são separados artificialmente.</p>
        <p>Potencial dos eventos: muito alto 2 · alto 1,6 · moderado 1,3 · baixo 1. É uma avaliação editorial, não uma previsão de vendas. A diversidade considera eventos; variantes da mesma estampa podem aparecer próximas.</p>
        <p>Produtos com saldo zero ou negativo ficam depois de todos os positivos. A janela de 12 meses afeta apenas a contagem de saídas; o estoque usa todo o histórico até a consulta.</p>
        <p>Dados são consultados a cada página. Mudanças de estoque ou associações podem repetir ou deslocar produtos entre páginas. Atualizar volta ao início da lista.</p>
      </div>
    </details>
  </section>;
}
