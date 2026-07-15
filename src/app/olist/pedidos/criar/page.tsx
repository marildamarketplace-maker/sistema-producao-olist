"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";

type Vendedor = { id?: number; contato?: { nome?: string | null; codigo?: string | null } | null };
type Cliente = { id?: number; nome?: string | null; fantasia?: string | null; codigo?: string | null; cpfCnpj?: string | null };
type Produto = { id?: number; sku?: string; descricao?: string; precos?: { preco?: number | null; precoPromocional?: number | null } | null };
type Estampa = { id: string; codigo: string; descricao: string | null };
type Variante = { id: string; estampaId: string | null; codigo: string; descricao: string | null };
type Divisao = { id: string; quantidade: string; estampaId: string; varianteId: string };
type ItemPedido = { id: string; produto: Produto; quantidade: string; valorUnitario: string; divisoes: Divisao[] };
type Dados = { vendedores: Vendedor[]; clientes: Cliente[]; produtos: Produto[]; estampas: Estampa[]; variantes: Variante[]; error?: string };

function novoId() { return crypto.randomUUID(); }
function precoProduto(produto: Produto) { return produto.precos?.precoPromocional ?? produto.precos?.preco ?? null; }
function numero(valor: string) { return Number(valor.replace(",", ".")); }

function identificarBusca(recurso: "vendedores" | "clientes" | "produtos", termo: string) {
  const limpo = termo.trim();
  const apenasDigitos = limpo.replace(/\D/g, "");
  if (recurso !== "produtos" && /^\d{11}(\d{3})?$/.test(apenasDigitos)) return { cpfCnpj: apenasDigitos };
  if (/^\d+$/.test(limpo) || (/^[A-Za-z0-9._/-]+$/.test(limpo) && /\d/.test(limpo))) return { codigo: limpo };
  return { nome: limpo };
}

export default function CriarPedidoOlistPage() {
  const { session } = useAuth();
  const [etapa, setEtapa] = useState(1);
  const [dados, setDados] = useState<Dados>({ vendedores: [], clientes: [], produtos: [], estampas: [], variantes: [] });
  const [vendedorId, setVendedorId] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [produtoId, setProdutoId] = useState("");
  const [quantidadeNova, setQuantidadeNova] = useState("1");
  const [itens, setItens] = useState<ItemPedido[]>([]);
  const [buscas, setBuscas] = useState({ vendedor: "", cliente: "", produto: "" });
  const [carregando, setCarregando] = useState(true);
  const [buscando, setBuscando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<{ id?: number; numeroPedido?: string } | null>(null);
  const ultimaBusca = useRef("");

  const carregar = useCallback(async () => {
    if (!session?.access_token) return;
    setCarregando(true); setErro(null);
    try {
      const response = await fetch("/api/olist/pedidos/criar", { headers: { Authorization: `Bearer ${session.access_token}` } });
      const json = await response.json() as Dados;
      if (!response.ok) throw new Error(json.error ?? "Não foi possível carregar os dados.");
      setDados((atuais) => ({ ...atuais, ...json }));
    } catch (error) { setErro(error instanceof Error ? error.message : "Erro inesperado."); }
    finally { setCarregando(false); }
  }, [session?.access_token]);
  useEffect(() => { void carregar(); }, [carregar]);

  const buscarRecurso = useCallback(async (recurso: "vendedores" | "clientes" | "produtos", termo: string, repetir = false) => {
    if (!session?.access_token) return;
    if (!termo.trim()) { setErro("Informe o nome, o código ou o CPF/CNPJ para pesquisar."); return; }
    const chaveBusca = `${recurso}:${termo.trim().toLowerCase()}`;
    if (!repetir && ultimaBusca.current === chaveBusca) return;
    ultimaBusca.current = chaveBusca;
    setBuscando(true); setErro(null);
    const params = new URLSearchParams({ recurso });
    const filtro = identificarBusca(recurso, termo);
    Object.entries(filtro).forEach(([chave, valor]) => params.set(chave, valor));
    try {
      const response = await fetch(`/api/olist/pedidos/criar?${params}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
      const json = await response.json() as { itens?: unknown[]; error?: string };
      if (!response.ok) throw new Error(json.error ?? "Erro na pesquisa.");
      setDados((atuais) => ({ ...atuais, [recurso]: json.itens ?? [] }));
      if (recurso === "vendedores") setVendedorId("");
      if (recurso === "clientes") setClienteId("");
      if (recurso === "produtos") setProdutoId("");
      if (json.itens?.length === 1) {
        const unico = json.itens[0] as { id?: number };
        if (recurso === "vendedores") setVendedorId(String(unico.id ?? ""));
        if (recurso === "clientes") setClienteId(String(unico.id ?? ""));
        if (recurso === "produtos") setProdutoId(String(unico.id ?? ""));
      }
      if (!json.itens?.length) setErro("Nenhum resultado ativo encontrado para a pesquisa.");
    } catch (error) { ultimaBusca.current = ""; setErro(error instanceof Error ? error.message : "Erro inesperado."); }
    finally { setBuscando(false); }
  }, [session?.access_token]);

  useEffect(() => {
    const atual = etapa === 1
      ? { recurso: "vendedores" as const, termo: buscas.vendedor }
      : etapa === 2
        ? { recurso: "clientes" as const, termo: buscas.cliente }
        : { recurso: "produtos" as const, termo: buscas.produto };
    if (atual.termo.trim().length < 3) return;
    const timer = window.setTimeout(() => { void buscarRecurso(atual.recurso, atual.termo); }, 600);
    return () => window.clearTimeout(timer);
  }, [buscas.cliente, buscas.produto, buscas.vendedor, buscarRecurso, etapa]);

  function adicionarProduto() {
    const produto = dados.produtos.find((item) => String(item.id) === produtoId);
    const quantidade = numero(quantidadeNova);
    if (!produto || !Number.isFinite(quantidade) || quantidade <= 0) { setErro("Selecione um produto e informe uma quantidade válida."); return; }
    const preco = precoProduto(produto);
    setItens((atuais) => [...atuais, {
      id: novoId(), produto, quantidade: String(quantidade), valorUnitario: preco === null ? "" : String(preco),
      divisoes: [{ id: novoId(), quantidade: String(quantidade), estampaId: "", varianteId: "" }],
    }]);
    setProdutoId(""); setQuantidadeNova("1"); setErro(null);
  }

  function atualizarItem(itemId: string, atualizacao: Partial<ItemPedido>) {
    setItens((atuais) => atuais.map((item) => item.id === itemId ? { ...item, ...atualizacao } : item));
  }
  function atualizarDivisao(itemId: string, divisaoId: string, atualizacao: Partial<Divisao>) {
    setItens((atuais) => atuais.map((item) => item.id !== itemId ? item : {
      ...item, divisoes: item.divisoes.map((divisao) => divisao.id === divisaoId ? { ...divisao, ...atualizacao } : divisao),
    }));
  }

  function validarItens() {
    if (itens.length === 0) return "Adicione ao menos um produto.";
    for (const item of itens) {
      const qtd = numero(item.quantidade);
      const soma = item.divisoes.reduce((total, divisao) => total + numero(divisao.quantidade), 0);
      if (!Number.isFinite(qtd) || qtd <= 0) return `Quantidade inválida para ${item.produto.sku}.`;
      if (item.divisoes.some((divisao) => !Number.isFinite(numero(divisao.quantidade)) || numero(divisao.quantidade) <= 0)) return `Há uma divisão inválida em ${item.produto.sku}.`;
      if (Math.abs(qtd - soma) > 0.0001) return `As divisões de ${item.produto.sku} somam ${soma}, mas a quantidade é ${qtd}.`;
    }
    return null;
  }

  function divisaoValida(item: ItemPedido) {
    const soma = item.divisoes.reduce((total, divisao) => total + (numero(divisao.quantidade) || 0), 0);
    return Math.abs(soma - numero(item.quantidade)) <= 0.0001;
  }

  async function criarPedido(event: FormEvent) {
    event.preventDefault();
    const validacao = validarItens();
    if (validacao) { setErro(validacao); return; }
    if (!session?.access_token) { setErro("Sessão expirada."); return; }
    setEnviando(true); setErro(null);
    try {
      const response = await fetch("/api/olist/pedidos/criar", {
        method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          vendedorId: Number(vendedorId), clienteId: Number(clienteId),
          itens: itens.map((item) => ({
            produtoId: item.produto.id, produtoCodigo: item.produto.sku, quantidade: numero(item.quantidade),
            valorUnitario: item.valorUnitario ? numero(item.valorUnitario) : null,
            divisoes: item.divisoes.map((divisao) => ({
              quantidade: numero(divisao.quantidade),
              estampa: dados.estampas.find((estampa) => estampa.id === divisao.estampaId)?.codigo ?? "",
              variante: dados.variantes.find((variante) => variante.id === divisao.varianteId)?.codigo ?? "",
            })),
          })),
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Não foi possível criar o pedido.");
      setSucesso(json); setItens([]);
    } catch (error) { setErro(error instanceof Error ? error.message : "Erro inesperado."); }
    finally { setEnviando(false); }
  }

  const itensValidos = itens.length > 0 && validarItens() === null;

  function buscarComEnter(
    event: KeyboardEvent<HTMLInputElement>,
    recurso: "vendedores" | "clientes" | "produtos",
    termo: string,
  ) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void buscarRecurso(recurso, termo, true);
  }

  if (carregando) return <div className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6 text-sm text-slate-600">Carregando vendedores, clientes e produtos...</div>;

  return <div className="space-y-6">
    <PageHeader title="Criar pedido Olist" description="Selecione vendedor, cliente e distribua os produtos entre estampas e variantes." />
    <ol className="grid grid-cols-1 gap-2 sm:grid-cols-3">{["Vendedor", "Cliente", "Produtos"].map((nome, indice) => <li key={nome} className={`rounded-lg border px-4 py-3 text-sm font-medium ${etapa === indice + 1 ? "border-slate-900 bg-slate-900 text-white" : etapa > indice + 1 ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-500"}`}>{indice + 1}. {nome}</li>)}</ol>
    {erro && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</div>}
    {sucesso && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-emerald-800"><p className="font-semibold">Pedido criado com sucesso.</p><p className="mt-1 text-sm">Pedido {sucesso.numeroPedido ?? sucesso.id ?? "criado"}.</p><Link href="/olist/pedidos" className="mt-3 inline-block text-sm font-medium underline">Voltar para pedidos</Link></div>}

    {!sucesso && etapa === 1 && <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6"><h3 className="font-semibold text-slate-900">Selecione o vendedor</h3><div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]"><input placeholder="Nome, código ou CPF/CNPJ do vendedor" value={buscas.vendedor} onChange={(e) => setBuscas({ ...buscas, vendedor: e.target.value })} onKeyDown={(e) => buscarComEnter(e, "vendedores", buscas.vendedor)} className="rounded-md border border-slate-300 px-3 py-2" /><button type="button" disabled={buscando} onClick={() => buscarRecurso("vendedores", buscas.vendedor, true)} className="w-full rounded-md bg-slate-700 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50 md:w-auto">{buscando ? "Buscando..." : "Buscar"}</button></div><select value={vendedorId} onChange={(e) => setVendedorId(e.target.value)} className="mt-4 w-full rounded-md border border-slate-300 bg-white px-3 py-2"><option value="">Selecione nos resultados...</option>{dados.vendedores.map((vendedor) => <option key={vendedor.id} value={vendedor.id}>{vendedor.contato?.nome ?? `Vendedor ${vendedor.id}`} {vendedor.contato?.codigo ? `(${vendedor.contato.codigo})` : ""}</option>)}</select><div className="mt-6 flex justify-stretch sm:justify-end"><button disabled={!vendedorId} onClick={() => setEtapa(2)} className="w-full rounded-md bg-slate-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-50 sm:w-auto">Continuar</button></div></section>}

    {!sucesso && etapa === 2 && <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6"><h3 className="font-semibold text-slate-900">Selecione o cliente</h3><div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]"><input placeholder="Nome, código ou CPF/CNPJ do cliente" value={buscas.cliente} onChange={(e) => setBuscas({ ...buscas, cliente: e.target.value })} onKeyDown={(e) => buscarComEnter(e, "clientes", buscas.cliente)} className="rounded-md border border-slate-300 px-3 py-2" /><button type="button" disabled={buscando} onClick={() => buscarRecurso("clientes", buscas.cliente, true)} className="w-full rounded-md bg-slate-700 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50 md:w-auto">{buscando ? "Buscando..." : "Buscar"}</button></div><select value={clienteId} onChange={(e) => setClienteId(e.target.value)} className="mt-4 w-full rounded-md border border-slate-300 bg-white px-3 py-2"><option value="">Selecione nos resultados...</option>{dados.clientes.map((cliente) => <option key={cliente.id} value={cliente.id}>{cliente.nome ?? cliente.fantasia ?? `Cliente ${cliente.id}`} {cliente.cpfCnpj ? `— ${cliente.cpfCnpj}` : ""}</option>)}</select><div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between"><button onClick={() => setEtapa(1)} className="w-full rounded-md border border-slate-300 px-5 py-2 text-sm sm:w-auto">Voltar</button><button disabled={!clienteId} onClick={() => setEtapa(3)} className="w-full rounded-md bg-slate-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-50 sm:w-auto">Continuar</button></div></section>}

    {!sucesso && etapa === 3 && <form onSubmit={criarPedido} className="space-y-5"><section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6"><h3 className="font-semibold text-slate-900">Adicionar produto fabricado</h3><div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]"><input placeholder="Nome ou código/SKU do produto" value={buscas.produto} onChange={(e) => setBuscas({ ...buscas, produto: e.target.value })} onKeyDown={(e) => buscarComEnter(e, "produtos", buscas.produto)} className="rounded-md border border-slate-300 px-3 py-2" /><button type="button" disabled={buscando} onClick={() => buscarRecurso("produtos", buscas.produto, true)} className="w-full rounded-md bg-slate-700 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50 md:w-auto">{buscando ? "Buscando..." : "Buscar"}</button></div><div className="mt-3 grid gap-3 md:grid-cols-[1fr_140px_auto]"><select value={produtoId} onChange={(e) => setProdutoId(e.target.value)} className="min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2"><option value="">Selecione nos resultados...</option>{dados.produtos.map((produto) => <option key={produto.id} value={produto.id}>{produto.sku} — {produto.descricao ?? produto.id}</option>)}</select><input type="number" min="0.01" step="0.01" value={quantidadeNova} onChange={(e) => setQuantidadeNova(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2" /><button type="button" onClick={adicionarProduto} className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white md:w-auto">Adicionar</button></div></section>
      {itens.map((item) => <section key={item.id} className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"><div><h4 className="font-semibold text-slate-900">{item.produto.sku}</h4><p className="text-sm text-slate-500">{item.produto.descricao}</p></div><button type="button" onClick={() => setItens((atuais) => atuais.filter((atual) => atual.id !== item.id))} className="text-sm text-red-600">Remover</button></div><div className="mt-4 grid gap-4 md:grid-cols-2"><label className="text-sm text-slate-700">Quantidade<input type="number" min="0.01" step="0.01" value={item.quantidade} onChange={(e) => atualizarItem(item.id, { quantidade: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label><label className="text-sm text-slate-700">Valor unitário<input type="number" min="0" step="0.01" value={item.valorUnitario} onChange={(e) => atualizarItem(item.id, { valorUnitario: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label></div><div className="mt-5"><div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between"><h5 className="text-sm font-semibold text-slate-800">Divisão por estampa/variante</h5><button type="button" onClick={() => atualizarItem(item.id, { divisoes: [...item.divisoes, { id: novoId(), quantidade: "1", estampaId: "", varianteId: "" }] })} className="text-sm font-medium text-blue-600">+ Adicionar divisão</button></div><div className="mt-3 space-y-3">{item.divisoes.map((divisao) => { const variantes = dados.variantes.filter((variante) => variante.estampaId === divisao.estampaId); return <div key={divisao.id} className="grid gap-3 rounded-md bg-slate-50 p-3 md:grid-cols-[120px_1fr_1fr_auto]"><input aria-label="Quantidade da divisão" type="number" min="0.01" step="0.01" value={divisao.quantidade} onChange={(e) => atualizarDivisao(item.id, divisao.id, { quantidade: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2" /><select aria-label="Estampa" value={divisao.estampaId} onChange={(e) => atualizarDivisao(item.id, divisao.id, { estampaId: e.target.value, varianteId: "" })} className="min-w-0 w-full rounded-md border border-slate-300 bg-white px-3 py-2"><option value="">Sem estampa</option>{dados.estampas.map((estampa) => <option key={estampa.id} value={estampa.id}>{estampa.codigo}</option>)}</select><select aria-label="Variante" disabled={!divisao.estampaId} value={divisao.varianteId} onChange={(e) => atualizarDivisao(item.id, divisao.id, { varianteId: e.target.value })} className="min-w-0 w-full rounded-md border border-slate-300 bg-white px-3 py-2 disabled:bg-slate-100"><option value="">Sem variante</option>{variantes.map((variante) => <option key={variante.id} value={variante.id}>{variante.codigo}</option>)}</select><button type="button" disabled={item.divisoes.length === 1} onClick={() => atualizarItem(item.id, { divisoes: item.divisoes.filter((atual) => atual.id !== divisao.id) })} className="px-2 text-sm text-red-600 disabled:opacity-30">Excluir</button></div>; })}</div><p className={`mt-2 text-xs font-medium ${divisaoValida(item) ? "text-emerald-700" : "text-red-600"}`}>Total dividido: {item.divisoes.reduce((total, divisao) => total + (numero(divisao.quantidade) || 0), 0)} de {item.quantidade}</p></div></section>)}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between"><button type="button" onClick={() => setEtapa(2)} className="w-full rounded-md border border-slate-300 px-5 py-2 text-sm sm:w-auto">Voltar</button><button disabled={enviando || !itensValidos} className="w-full rounded-md bg-emerald-700 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50 sm:w-auto">{enviando ? "Criando pedido..." : "Criar pedido na Olist"}</button></div>
    </form>}
  </div>;
}
