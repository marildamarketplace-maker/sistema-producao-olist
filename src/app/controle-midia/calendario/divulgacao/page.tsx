"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AccessGuard } from "@/components/access-guard";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";
import { escreverFiltros, MESES, mesAtualBrasil, REGIOES, type Regiao } from "@/lib/calendario-comercial/planejamento";
import { filtrosDivulgacaoSchema, type OrdemDivulgacao, type ResultadoDivulgacao } from "@/lib/calendario-comercial/divulgacao";
import { carregarDivulgacao } from "./actions";
import { controleDivulgacao, TabelaDivulgacao } from "./tabela-divulgacao";

function DivulgacaoConteudo() {
  const { session, usuario } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [mesAtual] = useState(() => mesAtualBrasil());
  const mes = Number(params.get("mes") ?? mesAtual);
  const regiao = params.get("regiao") ?? "Nacional";
  const pagina = Number(params.get("pagina") ?? 0);
  const ordem = params.get("ordem") ?? "prioridade";
  const filtros = filtrosDivulgacaoSchema.safeParse({ mes, regiao, pagina, ordem });
  const visao = params.get("visao") === "anual" ? "anual" : "mensal";
  const token = session?.access_token;
  const permitido = Boolean(usuario?.podeVisualizarTarefasMidia && (usuario.podeVisualizarEstoque || usuario.podeEditarEstoque));
  const resultadoRef = useRef<HTMLDivElement>(null);
  const focarResultado = useRef(false);
  const [revisao, setRevisao] = useState(0);
  const [resposta, setResposta] = useState<{ chave: string; resultado: ResultadoDivulgacao } | null>(null);
  const chave = JSON.stringify([token, usuario?.aplicativo_id, permitido, mes, regiao, pagina, ordem, revisao]);
  useEffect(() => {
    if (!token || !permitido) return;
    const entrada = filtrosDivulgacaoSchema.safeParse({ mes, regiao, pagina, ordem });
    if (!entrada.success) return;
    let vigente = true;
    carregarDivulgacao(token, entrada.data).then((resultado) => {
      if (vigente) setResposta({ chave, resultado });
    }).catch(() => {
      if (vigente) setResposta({ chave, resultado: { ok: false, erro: "Não foi possível carregar a lista. Tente novamente." } });
    });
    return () => { vigente = false; };
  }, [token, permitido, mes, regiao, pagina, ordem, chave]);
  const resultado = resposta?.chave === chave ? resposta.resultado : null;
  useEffect(() => {
    if (!resultado || !focarResultado.current) return;
    focarResultado.current = false;
    resultadoRef.current?.focus({ preventScroll: true });
    resultadoRef.current?.scrollIntoView({ block: "start" });
  }, [resultado]);
  const consulta = params.toString();
  function atualizarPagina(nova: number) {
    focarResultado.current = true;
    const proximo = new URLSearchParams(consulta);
    if (nova === 0) proximo.delete("pagina"); else proximo.set("pagina", String(nova));
    router.replace(`/controle-midia/calendario/divulgacao?${proximo}`, { scroll: false });
  }
  function mudarOrdem(nova: OrdemDivulgacao) {
    const proximo = new URLSearchParams(consulta);
    if (nova === "prioridade") proximo.delete("ordem"); else proximo.set("ordem", nova);
    proximo.delete("pagina");
    focarResultado.current = true;
    router.replace(`/controle-midia/calendario/divulgacao?${proximo}`, { scroll: false });
  }
  function atualizar() { focarResultado.current = true; if (pagina === 0) setRevisao((v) => v + 1); else atualizarPagina(0); }
  function mudarFiltros(novoMes: number, novaRegiao: Regiao) {
    router.replace(`/controle-midia/calendario/divulgacao?${escreverFiltros({ mes: novoMes, regioes: novaRegiao === "Nacional" ? ["Nacional"] : ["Nacional", novaRegiao], etapa: "divulgar", visao })}`, { scroll: false });
  }
  const retorno = `/controle-midia/calendario?${escreverFiltros({ mes: filtros.success ? filtros.data.mes : mesAtual,
    regioes: filtros.success && filtros.data.regiao !== "Nacional" ? ["Nacional", filtros.data.regiao] : ["Nacional"], etapa: "divulgar", visao })}`;
  return <div className="min-w-0 space-y-5">
    <Link href={retorno} className={controleDivulgacao}>Voltar ao calendário</Link>
    <PageHeader title={`Produtos para divulgar${filtros.success ? ` · ${MESES[mes - 1]}` : ""}`}
      description="Produtos associados aos eventos de divulgação do mês, priorizados por estoque, saídas e potencial do evento." />
    {!filtros.success ? <div role="alert" className="rounded-lg border border-red-200 bg-white p-5 text-sm text-red-700">Mês, abrangência ou página inválidos. Volte ao calendário para selecionar o período.</div> : <>
      <div className="flex flex-wrap gap-4 rounded-lg border border-slate-200 bg-white p-4">
        <label className="min-w-0 text-sm font-medium text-slate-700">Mês
          <select value={mes} className="input mt-1 min-h-11" onChange={(e) => mudarFiltros(Number(e.target.value), filtros.data.regiao)}>
            {MESES.map((nome, i) => <option key={nome} value={i + 1}>{nome}</option>)}
          </select></label>
        <label className="min-w-0 text-sm font-medium text-slate-700">Abrangência
          <select value={regiao} className="input mt-1 min-h-11" onChange={(e) => { const valor = REGIOES.find((r) => r === e.target.value); if (valor) mudarFiltros(mes, valor); }}>
            {REGIOES.map((nome) => <option key={nome}>{nome}</option>)}
          </select></label>
        <label className="min-w-0 text-sm font-medium text-slate-700">Ordenar por
          <select value={ordem} className="input mt-1 min-h-11" onChange={(e) => {
            const valor = e.target.value;
            if (valor === "prioridade" || valor === "estoque_desc" || valor === "estoque_asc") mudarOrdem(valor);
          }}>
            <option value="prioridade">Prioridade para divulgar</option>
            <option value="estoque_desc">Maior estoque</option>
            <option value="estoque_asc">Menor estoque</option>
          </select>
        </label>
      </div>
      <div ref={resultadoRef} tabIndex={-1} className="min-w-0 scroll-mt-4 outline-offset-4">
      <TabelaDivulgacao dados={resultado?.ok ? resultado.dados : null} eventos={resultado?.ok ? resultado.eventos : []}
        ordem={filtros.data.ordem} onOrdenarEstoque={() => mudarOrdem(ordem === "estoque_desc" ? "estoque_asc" : "estoque_desc")} pagina={pagina} carregando={!resultado} erro={resultado && !resultado.ok ? resultado.erro : ""}
        onPagina={atualizarPagina} onAtualizar={atualizar} />
      </div>
    </>}
  </div>;
}
export default function DivulgacaoPage() {
  return <AccessGuard permissions={["podeVisualizarTarefasMidia"]}>
    <AccessGuard permissions={["podeVisualizarEstoque", "podeEditarEstoque"]}><DivulgacaoConteudo /></AccessGuard>
  </AccessGuard>;
}
