"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";
import { AccessGuard } from "@/components/access-guard";

type Pedido = Record<string, unknown>;
type Resposta = { itens: Pedido[]; paginacao: { total: number }; error?: string };
type DivisaoEstampa = { codigo: string; variante: string; quantidade: string };
const LIMITE = 50;
const SITUACOES: Record<string, string> = {
  "8": "Dados incompletos", "0": "Aberta", "3": "Aprovada", "4": "Preparando envio",
  "1": "Faturada", "7": "Pronto para envio", "5": "Enviada", "6": "Entregue",
  "2": "Cancelada", "9": "Não entregue",
};

function texto(pedido: Pedido, ...chaves: string[]) {
  for (const chave of chaves) {
    const valor = pedido[chave];
    if (valor !== null && valor !== undefined && typeof valor !== "object" && String(valor).trim()) return String(valor);
  }
  return "—";
}

function dataFormatada(valor: string) {
  if (valor === "—") return valor;
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? valor : data.toLocaleString("pt-BR");
}

function valorFormatado(valor: string) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : valor;
}

function objeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor as Record<string, unknown> : {};
}

function extrairTag(bloco: string, tag: string) {
  const resultado = bloco.match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, "i"));
  return resultado?.[1]?.trim() ?? "";
}

function extrairEstampas(infoAdicional: unknown): DivisaoEstampa[] {
  if (typeof infoAdicional !== "string") return [];
  return [...infoAdicional.matchAll(/<ESTAMPA>([\s\S]*?)<\/ESTAMPA>/gi)].map((resultado) => ({
    codigo: extrairTag(resultado[1], "COD"),
    variante: extrairTag(resultado[1], "VAR"),
    quantidade: extrairTag(resultado[1], "QTD"),
  }));
}

function campoCsv(valor: unknown) {
  const texto = String(valor ?? "").replace(/"/g, '""');
  return `"${texto}"`;
}

function PedidosOlistPage() {
  const { session } = useAuth();
  const iniciais = { numero: "", nomeCliente: "", cpfCnpj: "", numeroPedidoEcommerce: "", dataInicial: "", dataFinal: "", dataAtualizacao: "", situacao: "", origemPedido: "", orderBy: "desc" };
  const [filtros, setFiltros] = useState(iniciais);
  const [consulta, setConsulta] = useState(iniciais);
  const [itens, setItens] = useState<Pedido[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [selecionados, setSelecionados] = useState<Record<string, Pedido>>({});
  const [exportando, setExportando] = useState(false);

  const carregar = useCallback(async () => {
    if (!session?.access_token) return;
    setCarregando(true); setErro(null);
    const params = new URLSearchParams({ limit: String(LIMITE), offset: String(offset) });
    Object.entries(consulta).forEach(([chave, valor]) => { if (valor) params.set(chave, valor); });
    try {
      const response = await fetch(`/api/olist/pedidos?${params}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
      const data = await response.json() as Resposta;
      if (!response.ok) throw new Error(data.error ?? "Não foi possível consultar os pedidos.");
      setItens(data.itens ?? []); setTotal(data.paginacao?.total ?? 0);
    } catch (error) {
      setItens([]); setTotal(0); setErro(error instanceof Error ? error.message : "Erro inesperado.");
    } finally { setCarregando(false); }
  }, [consulta, offset, session?.access_token]);

  useEffect(() => { void carregar(); }, [carregar]);
  function pesquisar(event: FormEvent) { event.preventDefault(); setOffset(0); setConsulta({ ...filtros }); }

  function alternarPedido(pedido: Pedido) {
    const id = texto(pedido, "id");
    if (id === "—") return;
    setSelecionados((atuais) => {
      const proximos = { ...atuais };
      if (proximos[id]) delete proximos[id]; else proximos[id] = pedido;
      return proximos;
    });
  }

  function alternarPagina() {
    const validos = itens.filter((pedido) => texto(pedido, "id") !== "—");
    const todosSelecionados = validos.every((pedido) => selecionados[texto(pedido, "id")]);
    setSelecionados((atuais) => {
      const proximos = { ...atuais };
      validos.forEach((pedido) => {
        const id = texto(pedido, "id");
        if (todosSelecionados) delete proximos[id]; else proximos[id] = pedido;
      });
      return proximos;
    });
  }

  async function exportarSelecionados(tipo: "pedidos" | "estampas") {
    const pedidosLista = Object.values(selecionados);
    if (pedidosLista.length === 0 || !session?.access_token) return;
    setExportando(true); setErro(null);
    try {
      const detalhes: Pedido[] = [];
      for (const pedidoLista of pedidosLista) {
        const id = texto(pedidoLista, "id");
        const response = await fetch(`/api/olist/pedidos/${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const pedido = await response.json() as Pedido & { error?: string };
        if (!response.ok) throw new Error(pedido.error ?? `Não foi possível obter os itens do pedido ${id}.`);
        detalhes.push(pedido);
      }
      const linhas = detalhes.flatMap((pedido) => {
        const id = texto(pedido, "id");
        const numeroPedido = texto(pedido, "numeroPedido", "numero", "id");
        const itensPedido = Array.isArray(pedido.itens) ? pedido.itens.map(objeto) : [];
        return itensPedido.map((item) => ({ id, numeroPedido, item, produto: objeto(item.produto), estampas: extrairEstampas(item.infoAdicional) }));
      });
      if (linhas.length === 0) throw new Error("Os pedidos selecionados não possuem itens para exportar.");
      let cabecalho: unknown[];
      let registros: unknown[][];
      if (tipo === "estampas") {
        const agrupadas = new Map<string, { sku: string; codigo: string; variante: string; quantidade: number }>();
        linhas.forEach((linha) => linha.estampas.forEach((estampa) => {
          if (!estampa.codigo) return;
          const sku = String(linha.produto.sku ?? "").trim();
          const chave = `${sku}\u0000${estampa.codigo}\u0000${estampa.variante}`;
          const atual = agrupadas.get(chave) ?? { sku, codigo: estampa.codigo, variante: estampa.variante, quantidade: 0 };
          const quantidade = Number(String(estampa.quantidade).replace(",", "."));
          atual.quantidade += Number.isFinite(quantidade) ? quantidade : 0;
          agrupadas.set(chave, atual);
        }));
        if (agrupadas.size === 0) throw new Error("Os pedidos selecionados não possuem estampas para exportar.");
        cabecalho = ["SKU", "Estampa", "Variante", "Quantidade"];
        registros = [...agrupadas.values()]
          .sort((a, b) => a.sku.localeCompare(b.sku, "pt-BR", { numeric: true }) || a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true }) || a.variante.localeCompare(b.variante, "pt-BR"))
          .map((estampa) => [estampa.sku, estampa.codigo, estampa.variante, estampa.quantidade]);
      } else {
        cabecalho = ["Pedido", "ID Pedido", "Produto ID", "SKU", "Descrição", "Quantidade", "Valor unitário", "Estampa", "Variante", "Qtd estampa"];
        registros = linhas.flatMap(({ id, numeroPedido, item, produto, estampas }) => {
          const dadosProduto: unknown[] = [numeroPedido, id, produto.id, produto.sku, produto.descricao, item.quantidade, item.valorUnitario];
          if (estampas.length === 0) return [[...dadosProduto, "", "", ""]];
          return estampas.map((estampa) => [...dadosProduto, estampa.codigo, estampa.variante, estampa.quantidade]);
        });
      }
      const csv = `\uFEFF${[cabecalho, ...registros].map((linha) => linha.map(campoCsv).join(";")).join("\r\n")}`;
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url; link.download = `${tipo}-selecionados-${new Date().toISOString().slice(0, 10)}.csv`; link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Erro inesperado ao exportar o pedido.");
    } finally { setExportando(false); }
  }
  const pagina = Math.floor(offset / LIMITE) + 1;
  const paginas = Math.max(1, Math.ceil(total / LIMITE));

  return <div className="space-y-6">
    <PageHeader title="Pedidos Olist" description="Consulte os pedidos diretamente na integração Olist." />
    <form onSubmit={pesquisar} className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 md:grid-cols-3 xl:grid-cols-5 md:items-end">
      <label className="text-sm font-medium text-slate-700">Número<input inputMode="numeric" value={filtros.numero} onChange={(e) => setFiltros({ ...filtros, numero: e.target.value.replace(/\D/g, "") })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label>
      <label className="text-sm font-medium text-slate-700">Cliente<input value={filtros.nomeCliente} onChange={(e) => setFiltros({ ...filtros, nomeCliente: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label>
      <label className="text-sm font-medium text-slate-700">CPF/CNPJ<input value={filtros.cpfCnpj} onChange={(e) => setFiltros({ ...filtros, cpfCnpj: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label>
      <label className="text-sm font-medium text-slate-700">Pedido e-commerce<input value={filtros.numeroPedidoEcommerce} onChange={(e) => setFiltros({ ...filtros, numeroPedidoEcommerce: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label>
      <label className="text-sm font-medium text-slate-700">Situação<select value={filtros.situacao} onChange={(e) => setFiltros({ ...filtros, situacao: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"><option value="">Todas</option>{Object.entries(SITUACOES).map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}</select></label>
      <label className="text-sm font-medium text-slate-700">Data inicial<input type="date" value={filtros.dataInicial} onChange={(e) => setFiltros({ ...filtros, dataInicial: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label>
      <label className="text-sm font-medium text-slate-700">Data final<input type="date" value={filtros.dataFinal} onChange={(e) => setFiltros({ ...filtros, dataFinal: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label>
      <label className="text-sm font-medium text-slate-700">Data de atualização<input type="date" value={filtros.dataAtualizacao} onChange={(e) => setFiltros({ ...filtros, dataAtualizacao: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label>
      <label className="text-sm font-medium text-slate-700">Origem<select value={filtros.origemPedido} onChange={(e) => setFiltros({ ...filtros, origemPedido: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"><option value="">Todas</option><option value="0">Pedido de venda</option><option value="1">PDV</option></select></label>
      <label className="text-sm font-medium text-slate-700">Ordenação<select value={filtros.orderBy} onChange={(e) => setFiltros({ ...filtros, orderBy: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"><option value="desc">Mais recentes</option><option value="asc">Mais antigos</option></select></label>
      <button disabled={carregando} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">Pesquisar</button>
    </form>
    {erro && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</div>}
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4"><div><h3 className="font-semibold text-slate-900">Pedidos</h3><span className="text-sm text-slate-500">{total.toLocaleString("pt-BR")} encontrados · {Object.keys(selecionados).length} selecionados</span></div><div className="flex flex-wrap gap-2"><button type="button" disabled={exportando || Object.keys(selecionados).length === 0} onClick={() => void exportarSelecionados("pedidos")} className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{exportando ? "Exportando CSV..." : "Exportar Pedidos CSV"}</button><button type="button" disabled={exportando || Object.keys(selecionados).length === 0} onClick={() => void exportarSelecionados("estampas")} className="rounded-md bg-indigo-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{exportando ? "Exportando CSV..." : "Exportar Estampas CSV"}</button></div></div>
      {carregando ? <p className="p-6 text-sm text-slate-600">Consultando a Olist...</p> : itens.length === 0 ? <p className="p-6 text-sm text-slate-600">Nenhum pedido encontrado.</p> : <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-4 py-3"><input type="checkbox" aria-label="Selecionar pedidos desta página" checked={itens.every((pedido) => texto(pedido, "id") === "—" || Boolean(selecionados[texto(pedido, "id")]))} onChange={alternarPagina} /></th><th className="px-4 py-3">Pedido</th><th className="px-4 py-3">E-commerce</th><th className="px-4 py-3">Cliente</th><th className="px-4 py-3">Criação</th><th className="px-4 py-3">Situação</th><th className="px-4 py-3">Valor</th></tr></thead><tbody className="divide-y divide-slate-100">{itens.map((pedido, indice) => { const situacao = texto(pedido, "situacao", "idSituacao"); const id = texto(pedido, "id"); return <tr key={`${texto(pedido, "id", "numero", "numeroPedido")}-${indice}`} className={selecionados[id] ? "bg-emerald-50/50" : undefined}><td className="px-4 py-3"><input type="checkbox" aria-label={`Selecionar pedido ${id}`} disabled={id === "—" || exportando} checked={Boolean(selecionados[id])} onChange={() => alternarPedido(pedido)} /></td><td className="whitespace-nowrap px-4 py-3"><div className="font-medium text-slate-900">#{texto(pedido, "numero", "numeroPedido", "id")}</div><div className="text-xs text-slate-500">ID {id}</div></td><td className="whitespace-nowrap px-4 py-3 text-slate-600">{texto(pedido, "numeroPedidoEcommerce", "numeroEcommerce")}</td><td className="min-w-56 px-4 py-3"><div>{texto(pedido, "nomeCliente", "cliente")}</div><div className="text-xs text-slate-500">{texto(pedido, "cpfCnpj", "cpfCnpjCliente")}</div></td><td className="whitespace-nowrap px-4 py-3 text-slate-600">{dataFormatada(texto(pedido, "dataCriacao", "dataPedido", "data"))}</td><td className="whitespace-nowrap px-4 py-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{SITUACOES[situacao] ?? situacao}</span></td><td className="whitespace-nowrap px-4 py-3 font-medium">{valorFormatado(texto(pedido, "valor", "valorTotal", "total"))}</td></tr>; })}</tbody></table></div>}
      <div className="flex items-center justify-between border-t border-slate-200 px-5 py-4"><span className="text-sm text-slate-500">Página {pagina} de {paginas}</span><div className="flex gap-2"><button type="button" disabled={carregando || offset === 0} onClick={() => setOffset((atual) => Math.max(0, atual - LIMITE))} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50">Anterior</button><button type="button" disabled={carregando || offset + LIMITE >= total} onClick={() => setOffset((atual) => atual + LIMITE)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50">Próxima</button></div></div>
    </section>
  </div>;
}

export default function PedidosOlistAccessPage() {
  return <AccessGuard permissions={["podeVisualizarOlistPedidos"]}><PedidosOlistPage /></AccessGuard>;
}
