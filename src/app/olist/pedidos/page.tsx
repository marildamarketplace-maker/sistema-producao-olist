"use client";

import { FormEvent, Fragment, useCallback, useEffect, useState } from "react";
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

function classeSituacao(situacao: string) {
  const classes: Record<string, string> = {
    "8": "bg-orange-100 text-orange-800",
    "0": "bg-slate-100 text-slate-700",
    "3": "bg-emerald-100 text-emerald-800",
    "4": "bg-amber-100 text-amber-800",
    "1": "bg-violet-100 text-violet-800",
    "7": "bg-cyan-100 text-cyan-800",
    "5": "bg-blue-100 text-blue-800",
    "6": "bg-green-100 text-green-800",
    "2": "bg-red-100 text-red-800",
    "9": "bg-rose-100 text-rose-800",
  };
  return classes[situacao] ?? "bg-slate-100 text-slate-700";
}

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

function textoCliente(pedido: Pedido, ...chaves: string[]) {
  const cliente = objeto(pedido.cliente);
  for (const chave of chaves) {
    const valor = cliente[chave];
    if (valor !== null && valor !== undefined && String(valor).trim()) return String(valor);
  }
  return "—";
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

function formatarInfoAdicional(infoAdicional: unknown) {
  if (typeof infoAdicional !== "string" || !infoAdicional.trim()) return "—";
  const estampas = [...infoAdicional.matchAll(/<ESTAMPA>([\s\S]*?)<\/ESTAMPA>/gi)].map((resultado) => {
    const bloco = resultado[1];
    const codigo = extrairTag(bloco, "COD");
    const variante = extrairTag(bloco, "VAR");
    const quantidade = extrairTag(bloco, "QTD");
    const unidade = extrairTag(bloco, "UN");
    const codigoVariante = [codigo, variante].filter(Boolean).join("-");
    return `Estampa: ${codigoVariante || "Sem estampa"}  ${quantidade} ${unidade}`.trim();
  });
  return estampas.length > 0 ? estampas.join("\n") : infoAdicional;
}

function campoCsv(valor: unknown) {
  const texto = String(valor ?? "").replace(/"/g, '""');
  return `"${texto}"`;
}

function PedidoMobileCard({ pedido, selecionado, aberto, carregando, detalhe, exportando, onSelect, onToggle }: { pedido: Pedido; selecionado: boolean; aberto: boolean; carregando: boolean; detalhe?: Pedido; exportando: boolean; onSelect: () => void; onToggle: () => void }) {
  const id = texto(pedido, "id");
  const situacao = texto(pedido, "situacao", "idSituacao");
  const itensDetalhe = Array.isArray(detalhe?.itens) ? detalhe.itens.map(objeto) : [];
  const nomeCliente = texto(pedido, "nomeCliente") !== "—" ? texto(pedido, "nomeCliente") : textoCliente(pedido, "nome", "fantasia");
  return <article className={`rounded-lg border p-4 ${selecionado ? "border-emerald-300 bg-emerald-50/60" : "border-slate-200 bg-white"}`}><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-slate-900">Pedido #{texto(pedido, "numero", "numeroPedido", "id")}</p><p className="text-xs text-slate-500">ID {id}</p></div><input type="checkbox" aria-label={`Selecionar pedido ${id}`} disabled={id === "—" || exportando} checked={selecionado} onChange={onSelect} className="mt-1 h-4 w-4" /></div><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div className="col-span-2"><dt className="text-xs uppercase text-slate-500">Cliente</dt><dd className="font-medium text-slate-800">{nomeCliente}</dd></div><div><dt className="text-xs uppercase text-slate-500">Criação</dt><dd className="text-slate-700">{dataFormatada(texto(pedido, "dataCriacao", "dataPedido", "data"))}</dd></div><div><dt className="text-xs uppercase text-slate-500">Situação</dt><dd><span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${classeSituacao(situacao)}`}>{SITUACOES[situacao] ?? situacao}</span></dd></div><div className="col-span-2"><dt className="text-xs uppercase text-slate-500">Valor</dt><dd className="font-semibold text-slate-900">{valorFormatado(texto(pedido, "valor", "valorTotal", "total"))}</dd></div></dl><button type="button" disabled={carregando} onClick={onToggle} className="mt-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">{carregando ? "Carregando..." : aberto ? "Fechar detalhes ▲" : "Exibir detalhes ▼"}</button>{aberto && <div className="mt-4 border-t border-slate-200 pt-4">{carregando ? <p className="text-sm text-slate-500">Carregando detalhes...</p> : detalhe ? <div className="space-y-4"><dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs uppercase text-slate-500">E-commerce</dt><dd>{texto(detalhe, "numeroPedidoEcommerce", "numeroEcommerce")}</dd></div><div><dt className="text-xs uppercase text-slate-500">CNPJ</dt><dd>{textoCliente(detalhe, "cpfCnpj")}</dd></div><div><dt className="text-xs uppercase text-slate-500">Código cliente</dt><dd>{textoCliente(detalhe, "codigo")}</dd></div><div><dt className="text-xs uppercase text-slate-500">Fantasia</dt><dd>{textoCliente(detalhe, "fantasia")}</dd></div></dl><div><p className="mb-2 text-xs font-semibold uppercase text-slate-500">Itens ({itensDetalhe.length})</p><div className="space-y-2">{itensDetalhe.map((item, indice) => { const produto = objeto(item.produto); return <div key={`${String(produto.id ?? produto.sku ?? indice)}`} className="rounded-md border border-slate-200 bg-white p-3 text-sm"><p className="font-medium text-slate-900">{String(produto.sku ?? "—")} — {String(produto.descricao ?? "—")}</p><p className="mt-1 text-slate-600">Qtd: {String(item.quantidade ?? "—")} · Unitário: {valorFormatado(String(item.valorUnitario ?? "—"))}</p><p className="mt-2 whitespace-pre-wrap text-xs text-slate-500">{formatarInfoAdicional(item.infoAdicional)}</p></div>; })}</div></div></div> : <p className="text-sm text-slate-500">Detalhes não disponíveis.</p>}</div>}</article>;
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
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [detalhesAbertos, setDetalhesAbertos] = useState<Record<string, boolean>>({});
  const [detalhesPedidos, setDetalhesPedidos] = useState<Record<string, Pedido>>({});
  const [detalhesCarregando, setDetalhesCarregando] = useState<Record<string, boolean>>({});

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

  async function alternarDetalhes(id: string) {
    const abrir = !detalhesAbertos[id];
    setDetalhesAbertos((atuais) => ({ ...atuais, [id]: abrir }));
    if (!abrir || detalhesPedidos[id] || !session?.access_token) return;
    setDetalhesCarregando((atuais) => ({ ...atuais, [id]: true }));
    try {
      const response = await fetch(`/api/olist/pedidos/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const pedido = await response.json() as Pedido & { error?: string };
      if (!response.ok) throw new Error(pedido.error ?? "Não foi possível carregar os detalhes do pedido.");
      setDetalhesPedidos((atuais) => ({ ...atuais, [id]: pedido }));
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Erro ao carregar os detalhes do pedido.");
    } finally {
      setDetalhesCarregando((atuais) => ({ ...atuais, [id]: false }));
    }
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
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white"><button type="button" aria-expanded={filtrosAbertos} onClick={() => setFiltrosAbertos((abertos) => !abertos)} className="flex w-full items-center justify-between px-5 py-4 text-left"><span className="font-semibold text-slate-900">Filtros</span><span className="text-sm text-slate-500">{filtrosAbertos ? "Fechar ▲" : "Abrir ▼"}</span></button>{filtrosAbertos && <form onSubmit={pesquisar} className="grid gap-4 border-t border-slate-200 p-5 md:grid-cols-3 xl:grid-cols-5 md:items-end">
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
    </form>}</section>
    {erro && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</div>}
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4"><div><h3 className="font-semibold text-slate-900">Pedidos</h3><span className="text-sm text-slate-500">{total.toLocaleString("pt-BR")} encontrados · {Object.keys(selecionados).length} selecionados</span></div><div className="flex flex-wrap gap-2"><button type="button" disabled={exportando || Object.keys(selecionados).length === 0} onClick={() => void exportarSelecionados("pedidos")} className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{exportando ? "Exportando CSV..." : "Exportar Pedidos CSV"}</button><button type="button" disabled={exportando || Object.keys(selecionados).length === 0} onClick={() => void exportarSelecionados("estampas")} className="rounded-md bg-indigo-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{exportando ? "Exportando CSV..." : "Exportar Estampas CSV"}</button></div></div>
      {carregando ? <p className="p-6 text-sm text-slate-600">Consultando a Olist...</p> : itens.length === 0 ? <p className="p-6 text-sm text-slate-600">Nenhum pedido encontrado.</p> : <><div className="space-y-3 p-4 sm:hidden">{itens.map((pedido, indice) => { const id = texto(pedido, "id"); return <PedidoMobileCard key={`${id}-${indice}`} pedido={pedido} selecionado={Boolean(selecionados[id])} aberto={Boolean(detalhesAbertos[id])} carregando={Boolean(detalhesCarregando[id])} detalhe={detalhesPedidos[id]} exportando={exportando} onSelect={() => alternarPedido(pedido)} onToggle={() => void alternarDetalhes(id)} />; })}</div><div className="hidden overflow-x-auto sm:block"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-4 py-3"><input type="checkbox" aria-label="Selecionar pedidos desta página" checked={itens.every((pedido) => texto(pedido, "id") === "—" || Boolean(selecionados[texto(pedido, "id")]))} onChange={alternarPagina} /></th><th className="px-4 py-3">Pedido</th><th className="px-4 py-3">Cliente</th><th className="px-4 py-3">Criação</th><th className="px-4 py-3">Situação</th><th className="px-4 py-3">Valor</th><th className="px-4 py-3">Detalhes</th></tr></thead><tbody className="divide-y divide-slate-100">{itens.map((pedido, indice) => { const situacao = texto(pedido, "situacao", "idSituacao"); const id = texto(pedido, "id"); const aberto = Boolean(detalhesAbertos[id]); const detalhe = detalhesPedidos[id]; const itensDetalhe = Array.isArray(detalhe?.itens) ? detalhe.itens.map(objeto) : []; return <Fragment key={`${id}-${indice}`}><tr className={selecionados[id] ? "bg-emerald-50/50" : undefined}><td className="px-4 py-3"><input type="checkbox" aria-label={`Selecionar pedido ${id}`} disabled={id === "—" || exportando} checked={Boolean(selecionados[id])} onChange={() => alternarPedido(pedido)} /></td><td className="whitespace-nowrap px-4 py-3"><div className="font-medium text-slate-900">#{texto(pedido, "numero", "numeroPedido", "id")}</div><div className="text-xs text-slate-500">ID {id}</div></td><td className="min-w-56 px-4 py-3 font-medium text-slate-800">{texto(pedido, "nomeCliente") !== "—" ? texto(pedido, "nomeCliente") : textoCliente(pedido, "nome", "fantasia")}</td><td className="whitespace-nowrap px-4 py-3 text-slate-600">{dataFormatada(texto(pedido, "dataCriacao", "dataPedido", "data"))}</td><td className="whitespace-nowrap px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-medium ${classeSituacao(situacao)}`}>{SITUACOES[situacao] ?? situacao}</span></td><td className="whitespace-nowrap px-4 py-3 font-medium">{valorFormatado(texto(pedido, "valor", "valorTotal", "total"))}</td><td className="px-4 py-3"><button type="button" aria-expanded={aberto} disabled={Boolean(detalhesCarregando[id])} onClick={() => void alternarDetalhes(id)} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50">{detalhesCarregando[id] ? "Carregando..." : aberto ? "Fechar ▲" : "Exibir ▼"}</button></td></tr>{aberto && <tr className="bg-slate-50/70"><td colSpan={7} className="px-6 py-4">{detalhesCarregando[id] ? <p className="text-sm text-slate-500">Carregando detalhes e itens...</p> : detalhe ? <div className="space-y-5"><div className="grid gap-3 text-sm sm:grid-cols-3"><div><span className="block text-xs font-medium uppercase text-slate-500">Pedido e-commerce</span>{texto(detalhe, "numeroPedidoEcommerce", "numeroEcommerce")}</div><div><span className="block text-xs font-medium uppercase text-slate-500">CPF/CNPJ</span>{texto(detalhe, "cpfCnpj", "cpfCnpjCliente") !== "—" ? texto(detalhe, "cpfCnpj", "cpfCnpjCliente") : textoCliente(detalhe, "cpfCnpj")}</div><div><span className="block text-xs font-medium uppercase text-slate-500">Código do cliente</span>{textoCliente(detalhe, "codigo")}</div><div><span className="block text-xs font-medium uppercase text-slate-500">Fantasia</span>{textoCliente(detalhe, "fantasia")}</div><div><span className="block text-xs font-medium uppercase text-slate-500">Origem</span>{texto(detalhe, "origemPedido", "origem")}</div></div><div><h4 className="mb-2 text-xs font-semibold uppercase text-slate-500">Itens ({itensDetalhe.length})</h4><div className="overflow-x-auto rounded-md border border-slate-200 bg-white"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Produto</th><th className="px-3 py-2">Quantidade</th><th className="px-3 py-2">Valor unitário</th><th className="px-3 py-2">Informação adicional</th></tr></thead><tbody className="divide-y divide-slate-100">{itensDetalhe.map((item, itemIndice) => { const produto = objeto(item.produto); return <tr key={`${String(produto.id ?? produto.sku ?? itemIndice)}`}><td className="whitespace-nowrap px-3 py-2 font-medium">{String(produto.sku ?? "—")}</td><td className="min-w-56 px-3 py-2">{String(produto.descricao ?? "—")}</td><td className="px-3 py-2">{String(item.quantidade ?? "—")}</td><td className="px-3 py-2">{valorFormatado(String(item.valorUnitario ?? "—"))}</td><td className="min-w-64 whitespace-pre-wrap px-3 py-2 text-xs text-slate-600">{formatarInfoAdicional(item.infoAdicional)}</td></tr>; })}</tbody></table></div></div></div> : <p className="text-sm text-slate-500">Detalhes não disponíveis.</p>}</td></tr>}</Fragment>; })}</tbody></table></div></>}
      <div className="flex items-center justify-between border-t border-slate-200 px-5 py-4"><span className="text-sm text-slate-500">Página {pagina} de {paginas}</span><div className="flex gap-2"><button type="button" disabled={carregando || offset === 0} onClick={() => setOffset((atual) => Math.max(0, atual - LIMITE))} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50">Anterior</button><button type="button" disabled={carregando || offset + LIMITE >= total} onClick={() => setOffset((atual) => atual + LIMITE)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50">Próxima</button></div></div>
    </section>
  </div>;
}

export default function PedidosOlistAccessPage() {
  return <AccessGuard permissions={["podeVisualizarOlistPedidos"]}><PedidosOlistPage /></AccessGuard>;
}
