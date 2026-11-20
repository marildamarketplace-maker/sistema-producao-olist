import type { TrabalhoIaResumo } from "@/lib/trabalhos-ia/contrato";

export function StatusTrabalhoIa({ trabalho: t }: { trabalho: TrabalhoIaResumo }) {
  const fases = { PREPARAR: "Preparando dados", GERAR: "Gerando relatório IA", REVISAR: "Revisando relatório IA", PUBLICAR: "Publicando relatório IA" };
  const texto = t.status === "CONCLUIDO" ? "Relatório IA concluído" : t.status === "FALHOU" ? "Não foi possível concluir o relatório IA" : t.status === "CANCELADO" ? "Relatório IA cancelado" : t.status === "AGUARDANDO_RETRY" ? "Nova tentativa agendada" : t.status === "PENDENTE" && t.fase === "PREPARAR" ? "Relatório IA na fila" : fases[t.fase];
  return <div role="status" className="space-y-2 text-sm">
    <p className="font-medium text-slate-900">{texto}</p>
    {!["CONCLUIDO", "CANCELADO"].includes(t.status) && t.total > 0 && <><progress className="h-2 w-full accent-slate-700 dark:accent-slate-300" aria-label="SKUs revisados" max={t.total} value={t.processados} /><p className="text-slate-600">{t.processados} de {t.total} SKUs revisados.</p></>}
    {t.erro && <p className="break-words text-red-700">{t.erro}</p>}
  </div>;
}
