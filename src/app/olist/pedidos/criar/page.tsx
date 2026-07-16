"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";
import { AccessGuard } from "@/components/access-guard";
import { CampoTipoProduto, type TipoProdutoOpcao } from "@/components/campo-tipo-produto";
import { CampoTamanho, type TamanhoOpcao } from "@/components/campo-tamanho";
import { Switch } from "@/components/switch";
import { extrairTamanhoSku, extrairTipoProdutoSku } from "@/lib/olist-pedido";

type Vendedor = { id?: number; contato?: { nome?: string | null; codigo?: string | null; cpfCnpj?: string | null } | null };
type Cliente = { id?: number; nome?: string | null; fantasia?: string | null; codigo?: string | null; cpfCnpj?: string | null };
type Produto = { id?: number; sku?: string; descricao?: string; unidade?: string; precos?: { preco?: number | string | null; precoPromocional?: number | string | null } | null };
type Estampa = { id: string; codigo: string; descricao: string | null };
type Variante = { id: string; estampaId: string | null; codigo: string; descricao: string | null };
type Divisao = {
  id: string;
  quantidade: string;
  estampaId: string;
  estampaCodigo: string;
  varianteId: string;
  varianteCodigo: string;
  tipo: string;
  tamanho: string;
  laser: boolean;
};
type ItemPedido = {
  id: string;
  produto: Produto;
  quantidade: string;
  valorUnitario: string;
  tipo: string;
  tamanho: string;
  laser: boolean;
  divisoes: Divisao[];
};
type Dados = { vendedores: Vendedor[]; clientes: Cliente[]; produtos: Produto[]; estampas: Estampa[]; variantes: Variante[]; tiposProduto: TipoProdutoOpcao[]; tamanhos: TamanhoOpcao[]; vendedorOlistId?: number | null; error?: string };
type DivisaoPreview = { estampa: string; variante: string; quantidade: string; unidade: string; tamanho: string; tipo: string; laser: string };
type PedidoPreview = {
  idContato: number;
  vendedor: { id: number };
  situacao: number;
  data: string;
  observacoes: string;
  itens: Array<{
    produto: { id: number; tipo: string };
    quantidade: number;
    valorUnitario?: number;
    infoAdicional: string;
  }>;
};

function extrairDivisoesPreview(info: string): DivisaoPreview[] {
  return Array.from(info.matchAll(/<ESTAMPA>([\s\S]*?)<\/ESTAMPA>/g)).map((match) => {
    const bloco = match[1];
    const valor = (tag: string) => bloco.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))?.[1] ?? "";
    return {
      estampa: valor("COD"),
      variante: valor("VAR"),
      quantidade: valor("QTD"),
      unidade: valor("UN"),
      tamanho: valor("TAM"),
      tipo: valor("TIPO"),
      laser: valor("LASER") || "false",
    };
  });
}

function novoId() { return crypto.randomUUID(); }
function normalizarPrecoOlist(valor: unknown) {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  const texto = String(valor ?? "").trim();
  if (!texto) return null;
  const normalizado = texto.includes(",")
    ? texto.replace(/\./g, "").replace(",", ".")
    : texto;
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : null;
}

function precoProduto(produto: Produto) {
  const promocional = normalizarPrecoOlist(produto.precos?.precoPromocional);
  if (promocional !== null && promocional > 0) return promocional;
  return normalizarPrecoOlist(produto.precos?.preco);
}
function numero(valor: string) {
  return Number(valor.includes(",") ? valor.replace(/\./g, "").replace(",", ".") : valor);
}
function formatarValorCentavos(valor: string | number) {
  const centavos = typeof valor === "number"
    ? Math.round(valor * 100)
    : Number(String(valor).replace(/\D/g, "") || "0");
  return (centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function produtoSublime(produto: Produto) { return /\bSUBLIME\b/i.test(produto.descricao ?? ""); }

function CampoCodigo({ rotulo, placeholder, opcoes, codigo, onChange, desabilitado = false }: { rotulo: string; placeholder: string; opcoes: Array<{ id: string; codigo: string; descricao: string | null }>; codigo: string; onChange: (id: string, codigo: string) => void; desabilitado?: boolean }) {
  const [busca, setBusca] = useState(codigo);
  const [aberto, setAberto] = useState(false);
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const filtradas = opcoes.filter((opcao) =>
    !termo || [opcao.codigo, opcao.descricao].some((valor) => String(valor ?? "").toLocaleLowerCase("pt-BR").includes(termo)),
  );

  return <div className="relative"><input aria-label={rotulo} placeholder={placeholder} disabled={desabilitado} value={busca} onFocus={() => setAberto(true)} onBlur={() => window.setTimeout(() => setAberto(false), 150)} onChange={(event) => { setBusca(event.target.value); onChange("", event.target.value); setAberto(true); }} className="w-full rounded-md border border-slate-300 px-3 py-2 disabled:bg-slate-100" />{aberto && !desabilitado && <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg"><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setBusca(""); onChange("", ""); setAberto(false); }} className="block w-full px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-50">Sem {rotulo.toLocaleLowerCase("pt-BR")}</button>{filtradas.map((opcao) => <button key={opcao.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setBusca(opcao.codigo); onChange(opcao.id, opcao.codigo); setAberto(false); }} className="block w-full border-t border-slate-100 px-3 py-2 text-left hover:bg-slate-50"><span className="block text-sm font-medium text-slate-900">{opcao.codigo}</span>{opcao.descricao && <span className="block text-xs text-slate-500">{opcao.descricao}</span>}</button>)}</div>}</div>;
}

function ListaClientes({ clientes, clienteId, carregando, onSelect }: { clientes: Cliente[]; clienteId: string; carregando: boolean; onSelect: (id: string) => void }) {
  if (!carregando && clientes.length === 0) return <div className="mt-4 rounded-md border border-slate-200 px-4 py-6 text-center text-sm text-slate-500">Nenhum cliente encontrado.</div>;
  return <div className="mt-4"><div className="space-y-2 sm:hidden">{clientes.map((cliente) => { const id = String(cliente.id ?? ""); const selecionado = clienteId === id; return <button key={id} type="button" onClick={() => onSelect(id)} className={`w-full rounded-lg border p-4 text-left ${selecionado ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-white"}`}><div className="flex items-start gap-3"><input type="radio" name="cliente-mobile" checked={selecionado} onChange={() => onSelect(id)} className="mt-1" /><div className="min-w-0"><p className="font-medium text-slate-900">{cliente.nome ?? cliente.fantasia ?? "Cliente"}</p><p className="mt-1 text-sm text-slate-600">Código: {cliente.codigo ?? "—"}</p><p className="mt-1 text-sm text-slate-600">CNPJ: {cliente.cpfCnpj ?? "—"}</p></div></div></button>; })}</div><div className="hidden max-h-[28rem] overflow-auto rounded-md border border-slate-200 sm:block"><table className="min-w-full text-sm"><thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="w-12 px-4 py-3">Sel.</th><th className="px-4 py-3">Cliente</th><th className="px-4 py-3">Código</th><th className="px-4 py-3">CNPJ</th></tr></thead><tbody className="divide-y divide-slate-100">{clientes.map((cliente) => { const id = String(cliente.id ?? ""); const selecionado = clienteId === id; return <tr key={id} onClick={() => onSelect(id)} className={`cursor-pointer ${selecionado ? "bg-emerald-50" : "hover:bg-slate-50"}`}><td className="px-4 py-3"><input type="radio" name="cliente" checked={selecionado} onChange={() => onSelect(id)} /></td><td className="min-w-52 px-4 py-3 font-medium text-slate-900">{cliente.nome ?? cliente.fantasia ?? "Cliente"}</td><td className="px-4 py-3 text-slate-600">{cliente.codigo ?? "—"}</td><td className="whitespace-nowrap px-4 py-3 text-slate-600">{cliente.cpfCnpj ?? "—"}</td></tr>; })}</tbody></table></div></div>;
}

function CriarPedidoOlistPage() {
  const { session } = useAuth();
  const [etapa, setEtapa] = useState(1);
  const [dados, setDados] = useState<Dados>({ vendedores: [], clientes: [], produtos: [], estampas: [], variantes: [], tiposProduto: [], tamanhos: [] });
  const [vendedorId, setVendedorId] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [produtoId, setProdutoId] = useState("");
  const [produtoBuscaAberta, setProdutoBuscaAberta] = useState(false);
  const [quantidadeNova, setQuantidadeNova] = useState("1");
  const [itens, setItens] = useState<ItemPedido[]>([]);
  const [itensAbertos, setItensAbertos] = useState<string[]>([]);
  const [buscas, setBuscas] = useState({ vendedor: "", cliente: "", produto: "" });
  const [carregando, setCarregando] = useState(true);
  const [buscando, setBuscando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [preparandoConfirmacao, setPreparandoConfirmacao] = useState(false);
  const [confirmacaoAberta, setConfirmacaoAberta] = useState(false);
  const [pedidoPreview, setPedidoPreview] = useState<PedidoPreview | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<{ id?: number; numeroPedido?: string } | null>(null);
  const clientesCarregados = useRef("");
  const produtosCarregados = useRef(false);

  const carregar = useCallback(async () => {
    if (!session?.access_token) return;
    setCarregando(true); setErro(null);
    try {
      const response = await fetch("/api/olist/pedidos/criar", { headers: { Authorization: `Bearer ${session.access_token}` } });
      const json = await response.json() as Dados;
      if (!response.ok) throw new Error(json.error ?? "Não foi possível carregar os dados.");
      setDados((atuais) => ({ ...atuais, ...json }));
      const vendedorPadraoId = json.vendedorOlistId;
      if (vendedorPadraoId) {
        setVendedorId(String(vendedorPadraoId));
        setEtapa(2);
      }
    } catch (error) { setErro(error instanceof Error ? error.message : "Erro inesperado."); }
    finally { setCarregando(false); }
  }, [session?.access_token]);
  useEffect(() => { void carregar(); }, [carregar]);

  useEffect(() => {
    if (etapa !== 2 || !vendedorId || !session?.access_token || clientesCarregados.current === vendedorId) return;
    clientesCarregados.current = vendedorId;
    setBuscando(true); setErro(null);
    const params = new URLSearchParams({ recurso: "clientes", idVendedor: vendedorId });
    void fetch(`/api/olist/pedidos/criar?${params}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (response) => {
        const json = await response.json() as { itens?: Cliente[]; error?: string };
        if (!response.ok) throw new Error(json.error ?? "Não foi possível carregar os clientes.");
        setDados((atuais) => ({ ...atuais, clientes: json.itens ?? [] }));
        setClienteId("");
      })
      .catch((error) => {
        clientesCarregados.current = "";
        setErro(error instanceof Error ? error.message : "Erro ao carregar clientes.");
      })
      .finally(() => setBuscando(false));
  }, [etapa, session?.access_token, vendedorId]);

  useEffect(() => {
    if (etapa !== 3 || !session?.access_token || produtosCarregados.current) return;
    produtosCarregados.current = true;
    setBuscando(true); setErro(null);
    const params = new URLSearchParams({ recurso: "produtos" });
    void fetch(`/api/olist/pedidos/criar?${params}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (response) => {
        const json = await response.json() as { itens?: Produto[]; error?: string };
        if (!response.ok) throw new Error(json.error ?? "Não foi possível carregar os produtos.");
        setDados((atuais) => ({ ...atuais, produtos: json.itens ?? [] }));
      })
      .catch((error) => {
        produtosCarregados.current = false;
        setErro(error instanceof Error ? error.message : "Erro ao carregar produtos.");
      })
      .finally(() => setBuscando(false));
  }, [etapa, session?.access_token]);

  function adicionarProduto() {
    const produto = dados.produtos.find((item) => String(item.id) === produtoId);
    const quantidade = numero(quantidadeNova);
    if (!produto || !Number.isFinite(quantidade) || quantidade < 1) { setErro("Selecione um produto e informe uma quantidade mínima de 1."); return; }
    if (itens.some((item) => String(item.produto.id) === String(produto.id))) {
      setErro(`O produto ${produto.sku ?? produto.id} já foi adicionado ao pedido.`);
      return;
    }
    const preco = precoProduto(produto);
    const sku = produto.sku ?? "";
    const itemId = novoId();
    setItens((atuais) => [...atuais, {
      id: itemId, produto, quantidade: String(quantidade), valorUnitario: preco === null ? "0,00" : formatarValorCentavos(preco),
      tipo: extrairTipoProdutoSku(sku),
      tamanho: extrairTamanhoSku(sku),
      laser: /(?:^|[-/])LASER(?:[-/]|$)/i.test(sku),
      divisoes: produtoSublime(produto) ? [{
        id: novoId(),
        quantidade: String(quantidade),
        estampaId: "",
        estampaCodigo: "",
        varianteId: "",
        varianteCodigo: "",
        tipo: extrairTipoProdutoSku(sku),
        tamanho: extrairTamanhoSku(sku),
        laser: /(?:^|[-/])LASER(?:[-/]|$)/i.test(sku),
      }] : [],
    }]);
    setItensAbertos((ids) => [...ids, itemId]);
    setProdutoId(""); setQuantidadeNova("1"); setBuscas((atuais) => ({ ...atuais, produto: "" })); setErro(null);
  }

  function atualizarItem(itemId: string, atualizacao: Partial<ItemPedido>) {
    setItens((atuais) => atuais.map((item) => item.id === itemId ? { ...item, ...atualizacao } : item));
  }

  function toggleItemAberto(itemId: string) {
    setItensAbertos((ids) => ids.includes(itemId) ? ids.filter((id) => id !== itemId) : [...ids, itemId]);
  }

  useEffect(() => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>("form section"))
      .filter((section) => section.querySelector("h4"));
    cards.forEach((card, index) => {
      const item = itens[index];
      const header = card.firstElementChild as HTMLElement | null;
      if (!item || !header) return;
      card.classList.add("pedido-produto-dropdown");
      card.dataset.open = itensAbertos.includes(item.id) ? "true" : "false";
      header.setAttribute("role", "button");
      header.setAttribute("tabindex", "0");
      header.setAttribute("aria-expanded", String(itensAbertos.includes(item.id)));
      header.onclick = (event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        toggleItemAberto(item.id);
      };
      header.onkeydown = (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        toggleItemAberto(item.id);
      };
    });
    return () => cards.forEach((card) => {
      const header = card.firstElementChild as HTMLElement | null;
      if (header) { header.onclick = null; header.onkeydown = null; }
    });
  }, [itens, itensAbertos]);
  function atualizarDivisao(itemId: string, divisaoId: string, atualizacao: Partial<Divisao>) {
    setItens((atuais) => atuais.map((item) => item.id !== itemId ? item : {
      ...item, divisoes: item.divisoes.map((divisao) => divisao.id === divisaoId ? { ...divisao, ...atualizacao } : divisao),
    }));
  }

  function validarItens() {
    if (itens.length === 0) return "Adicione ao menos um produto.";
    for (const item of itens) {
      const qtd = numero(item.quantidade);
      if (!produtoSublime(item.produto)) {
        if (!Number.isFinite(qtd) || qtd < 1) return `A quantidade mínima para ${item.produto.sku} é 1.`;
        continue;
      }
      const soma = item.divisoes.reduce((total, divisao) => total + numero(divisao.quantidade), 0);
      if (!Number.isFinite(qtd) || qtd < 1) return `A quantidade mínima para ${item.produto.sku} é 1.`;
      if (item.divisoes.some((divisao) => !Number.isFinite(numero(divisao.quantidade)) || numero(divisao.quantidade) <= 0)) return `Há uma divisão inválida em ${item.produto.sku}.`;
      if (Math.abs(qtd - soma) > 0.0001) return `As divisões de ${item.produto.sku} somam ${soma}, mas a quantidade é ${qtd}.`;
    }
    return null;
  }

  function divisaoValida(item: ItemPedido) {
    if (!produtoSublime(item.produto)) return true;
    const soma = item.divisoes.reduce((total, divisao) => total + (numero(divisao.quantidade) || 0), 0);
    return Math.abs(soma - numero(item.quantidade)) <= 0.0001;
  }

  function montarPayloadPedido(acao: "preview" | "enviar") {
    return {
      acao,
      vendedorId: Number(vendedorId), clienteId: Number(clienteId),
      itens: itens.map((item) => ({
        produtoId: item.produto.id, produtoCodigo: item.produto.sku, produtoDescricao: item.produto.descricao,
        produtoUnidade: item.produto.unidade, quantidade: numero(item.quantidade),
        tipo: item.tipo, tamanho: item.tamanho, laser: item.laser,
        valorUnitario: item.valorUnitario ? numero(item.valorUnitario) : null,
            divisoes: produtoSublime(item.produto) ? item.divisoes.map((divisao) => ({
              quantidade: numero(divisao.quantidade),
              estampa: divisao.estampaCodigo || dados.estampas.find((estampa) => estampa.id === divisao.estampaId)?.codigo || "",
              variante: divisao.varianteCodigo || dados.variantes.find((variante) => variante.id === divisao.varianteId)?.codigo || "",
              tipo: divisao.tipo,
              tamanho: divisao.tamanho,
              laser: divisao.laser,
            })) : [],
      })),
    };
  }

  async function abrirConfirmacao(event: FormEvent) {
    event.preventDefault();
    const validacao = validarItens();
    if (validacao) { setErro(validacao); return; }
    if (!session?.access_token) { setErro("Sessão expirada."); return; }
    setPreparandoConfirmacao(true); setErro(null);
    try {
      const response = await fetch("/api/olist/pedidos/criar", {
        method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify(montarPayloadPedido("preview")),
      });
      const json = await response.json() as { pedido?: PedidoPreview; error?: string };
      if (!response.ok || !json.pedido) throw new Error(json.error ?? "Não foi possível preparar a confirmação.");
      setPedidoPreview(json.pedido);
      setConfirmacaoAberta(true);
    } catch (error) { setErro(error instanceof Error ? error.message : "Erro inesperado."); }
    finally { setPreparandoConfirmacao(false); }
  }

  async function criarPedido() {
    if (!session?.access_token) { setErro("Sessão expirada."); return; }
    setEnviando(true); setErro(null);
    try {
      const response = await fetch("/api/olist/pedidos/criar", {
        method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify(montarPayloadPedido("enviar")),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Não foi possível criar o pedido.");
      setSucesso(json); setItens([]); setConfirmacaoAberta(false); setPedidoPreview(null);
    } catch (error) { setErro(error instanceof Error ? error.message : "Erro inesperado."); }
    finally { setEnviando(false); }
  }

  const itensValidos = itens.length > 0 && validarItens() === null;
  const totalPedido = itens.reduce((total, item) => total + (numero(item.quantidade) || 0) * (numero(item.valorUnitario) || 0), 0);
  const totalPedidoFormatado = totalPedido.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const termoVendedor = buscas.vendedor.trim().toLocaleLowerCase("pt-BR");
  const vendedoresFiltrados = termoVendedor ? dados.vendedores.filter((vendedor) =>
    [vendedor.contato?.nome, vendedor.contato?.codigo, vendedor.contato?.cpfCnpj, vendedor.id]
      .some((valor) => String(valor ?? "").toLocaleLowerCase("pt-BR").includes(termoVendedor))
  ) : dados.vendedores;
  const termoCliente = buscas.cliente.trim().toLocaleLowerCase("pt-BR");
  const clientesFiltrados = termoCliente ? dados.clientes.filter((cliente) =>
    [cliente.nome, cliente.fantasia, cliente.codigo, cliente.cpfCnpj]
      .some((valor) => String(valor ?? "").toLocaleLowerCase("pt-BR").includes(termoCliente))
  ) : dados.clientes;
  const termoProduto = buscas.produto.trim().toLocaleLowerCase("pt-BR");
  const produtosFiltrados = dados.produtos.filter((produto) => {
    if (itens.some((item) => String(item.produto.id) === String(produto.id))) return false;
    return !termoProduto || [produto.sku, produto.descricao]
      .some((valor) => String(valor ?? "").toLocaleLowerCase("pt-BR").includes(termoProduto));
  });
  const produtosSugeridos = produtosFiltrados.slice(0, 100);

  if (carregando) return <div className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6 text-sm text-slate-600">Carregando vendedores, clientes e produtos...</div>;

  return <div className="space-y-6">
    <PageHeader title="Criar pedido Olist" description="Selecione vendedor, cliente e distribua os produtos entre estampas e variantes." />
    <ol className="grid grid-cols-3 gap-1.5 sm:gap-2">{["Vendedor", "Cliente", "Produtos"].map((nome, indice) => <li key={nome} className={`flex min-w-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg border px-1 py-2.5 font-medium sm:justify-start sm:gap-1.5 sm:px-4 sm:py-3 sm:text-sm ${etapa === indice + 1 ? "border-slate-900 bg-slate-900 text-white" : etapa > indice + 1 ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-500"}`}><span className="text-xs font-bold sm:text-sm">{indice + 1}.</span><span className="truncate text-[10px] sm:text-sm">{nome}</span></li>)}</ol>
    {erro && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</div>}
    {sucesso && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-emerald-800"><p className="font-semibold">Pedido criado com sucesso.</p><p className="mt-1 text-sm">Pedido {sucesso.numeroPedido ?? sucesso.id ?? "criado"}.</p><Link href="/olist/pedidos" className="mt-3 inline-block text-sm font-medium underline">Voltar para pedidos</Link></div>}

    {!sucesso && etapa === 1 && <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6"><h3 className="font-semibold text-slate-900">Selecione o vendedor</h3><input placeholder="Filtrar por nome, código, CPF/CNPJ ou ID" value={buscas.vendedor} onChange={(e) => setBuscas({ ...buscas, vendedor: e.target.value })} className="mt-4 w-full rounded-md border border-slate-300 px-3 py-2" /><p className="mt-2 text-xs text-slate-500">{vendedoresFiltrados.length} de {dados.vendedores.length} vendedores ativos</p><div className="mt-4 overflow-x-auto rounded-md border border-slate-200"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="w-12 px-4 py-3">Sel.</th><th className="px-4 py-3">Vendedor</th><th className="px-4 py-3">Código</th><th className="px-4 py-3">ID</th></tr></thead><tbody className="divide-y divide-slate-100">{vendedorId && !dados.vendedores.some((vendedor) => String(vendedor.id) === vendedorId) && <tr className="bg-emerald-50"><td className="px-4 py-3"><input type="radio" checked readOnly /></td><td className="px-4 py-3 font-medium">Vendedor padrão</td><td className="px-4 py-3 text-slate-500">—</td><td className="px-4 py-3">{vendedorId}</td></tr>}{vendedoresFiltrados.map((vendedor) => { const id = String(vendedor.id ?? ""); const selecionado = vendedorId === id; return <tr key={id} onClick={() => setVendedorId(id)} className={`cursor-pointer ${selecionado ? "bg-emerald-50" : "hover:bg-slate-50"}`}><td className="px-4 py-3"><input type="radio" name="vendedor" checked={selecionado} onChange={() => setVendedorId(id)} /></td><td className="px-4 py-3 font-medium text-slate-900">{vendedor.contato?.nome ?? `Vendedor ${vendedor.id}`}</td><td className="px-4 py-3 text-slate-600">{vendedor.contato?.codigo ?? "—"}</td><td className="px-4 py-3 text-slate-600">{vendedor.id ?? "—"}</td></tr>; })}{vendedoresFiltrados.length === 0 && !vendedorId && <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-500">Nenhum vendedor encontrado.</td></tr>}</tbody></table></div><div className="mt-6 flex justify-stretch sm:justify-end"><button disabled={!vendedorId} onClick={() => setEtapa(2)} className="w-full rounded-md bg-slate-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-50 sm:w-auto">Continuar</button></div></section>}

    {!sucesso && etapa === 2 && <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6"><h3 className="font-semibold text-slate-900">Selecione o cliente</h3><input placeholder="Filtrar por nome, código ou CPF/CNPJ" value={buscas.cliente} onChange={(e) => setBuscas({ ...buscas, cliente: e.target.value })} className="mt-4 w-full rounded-md border border-slate-300 px-3 py-2" /><p className="mt-2 text-xs text-slate-500">{buscando ? "Carregando todos os clientes do vendedor..." : `${clientesFiltrados.length} de ${dados.clientes.length} clientes`}</p><ListaClientes clientes={clientesFiltrados} clienteId={clienteId} carregando={buscando} onSelect={setClienteId} /><div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between"><button onClick={() => setEtapa(1)} className="w-full rounded-md border border-slate-300 px-5 py-2 text-sm sm:w-auto">Voltar</button><button disabled={!clienteId} onClick={() => setEtapa(3)} className="w-full rounded-md bg-slate-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-50 sm:w-auto">Continuar</button></div></section>}

    {!sucesso && etapa === 3 && <form onSubmit={abrirConfirmacao} className="space-y-4 pb-24 sm:space-y-5 sm:pb-0"><section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6"><div className="flex items-center justify-between gap-3"><h3 className="font-semibold text-slate-900">Adicionar produto</h3><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{itens.length} no pedido</span></div><div className="mt-4 grid grid-cols-[minmax(0,3fr)_minmax(72px,1fr)] gap-3 md:grid-cols-[1fr_180px_auto] md:items-end"><label className="relative min-w-0 text-sm text-slate-700">Produto<input placeholder="Busque por nome ou SKU" value={buscas.produto} onChange={(e) => { setBuscas({ ...buscas, produto: e.target.value }); setProdutoId(""); setProdutoBuscaAberta(true); }} onFocus={() => setProdutoBuscaAberta(true)} onBlur={() => window.setTimeout(() => setProdutoBuscaAberta(false), 150)} className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2" />{produtoBuscaAberta && <div className="absolute z-30 mt-1 max-h-[50vh] w-full overflow-y-auto overscroll-contain rounded-md border border-slate-200 bg-white shadow-xl">{buscando ? <div className="px-3 py-4 text-sm text-slate-500">Carregando produtos...</div> : produtosSugeridos.length > 0 ? produtosSugeridos.map((produto) => <button key={produto.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setProdutoId(String(produto.id ?? "")); setBuscas({ ...buscas, produto: `${produto.sku ?? ""} — ${produto.descricao ?? ""}` }); setProdutoBuscaAberta(false); }} className="block min-h-14 w-full border-b border-slate-100 px-3 py-3 text-left last:border-0 hover:bg-slate-50"><span className="block text-sm font-semibold text-slate-900">{produto.sku ?? produto.id}</span><span className="mt-0.5 block line-clamp-2 text-xs text-slate-500">{produto.descricao ?? "Sem descrição"} · {produto.unidade ?? "Sem unidade"}</span></button>) : <div className="px-3 py-4 text-sm text-slate-500">Nenhum produto encontrado.</div>}</div>}</label><label className="text-sm text-slate-700">Qtd.<input aria-label="Quantidade do novo produto" type="number" min="1" step="0.01" inputMode="decimal" value={quantidadeNova} onChange={(e) => setQuantidadeNova(e.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2" /></label><button type="button" disabled={!produtoId} onClick={adicionarProduto} className="col-span-2 min-h-11 w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 md:col-span-1 md:w-auto">Adicionar</button></div><p className="mt-2 text-xs text-slate-500">{produtosFiltrados.length} de {dados.produtos.length} produtos disponíveis{produtosFiltrados.length > 100 ? " · refine a busca para ver resultados mais específicos" : ""}</p></section>
      {itens.map((item) => <section key={item.id} className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h4 className="truncate font-semibold text-slate-900">{item.produto.sku}</h4><p className="mt-1 line-clamp-2 text-sm text-slate-500">{item.produto.descricao}</p></div><button type="button" onClick={() => setItens((atuais) => atuais.filter((atual) => atual.id !== item.id))} className="shrink-0 rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-600">Remover</button></div><div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4"><label className="text-sm text-slate-700">Quantidade<input type="number" min="1" step="0.01" inputMode="decimal" value={item.quantidade} onChange={(e) => atualizarItem(item.id, { quantidade: e.target.value })} className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2" /></label><label className="text-sm text-slate-700">Valor unitário<input type="text" inputMode="numeric" value={item.valorUnitario} onChange={(e) => atualizarItem(item.id, { valorUnitario: formatarValorCentavos(e.target.value) })} onFocus={(e) => e.currentTarget.select()} aria-label="Valor unitário em reais" className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-right tabular-nums" /></label></div>{produtoSublime(item.produto) && <div className="mt-5 border-t border-slate-100 pt-4"><div><h5 className="text-sm font-semibold text-slate-800">Divisão por estampa</h5></div><div className="mt-3 space-y-3">{item.divisoes.map((divisao) => { const variantes = dados.variantes.filter((variante) => variante.estampaId === divisao.estampaId); return <div key={divisao.id} className="rounded-md bg-slate-50 p-3"><div className="grid gap-3 md:grid-cols-4"><label className="text-sm text-slate-700">Quantidade da divisão<input type="number" min="0.01" step="0.01" inputMode="decimal" value={divisao.quantidade} onChange={(e) => atualizarDivisao(item.id, divisao.id, { quantidade: e.target.value })} className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2" /></label><div><label className="mb-1 block text-sm text-slate-700">Estampa</label><CampoCodigo rotulo="Estampa" placeholder="Código da estampa" opcoes={dados.estampas} codigo={divisao.estampaCodigo} onChange={(estampaId, estampaCodigo) => atualizarDivisao(item.id, divisao.id, { estampaId, estampaCodigo, varianteId: "", varianteCodigo: "" })} /></div><div><label className="mb-1 block text-sm text-slate-700">Variante</label><CampoCodigo rotulo="Variante" placeholder="Código da variante" opcoes={variantes} codigo={divisao.varianteCodigo} onChange={(varianteId, varianteCodigo) => atualizarDivisao(item.id, divisao.id, { varianteId, varianteCodigo })} /></div><label className="text-sm text-slate-700">Tipo do produto (TIPO)<div className="mt-1"><CampoTipoProduto opcoes={dados.tiposProduto} valor={divisao.tipo} onChange={(tipo) => atualizarDivisao(item.id, divisao.id, { tipo })} /></div></label><label className="text-sm text-slate-700">Tamanho (TAM)<div className="mt-1"><CampoTamanho opcoes={dados.tamanhos} valor={divisao.tamanho} onChange={(tamanho) => atualizarDivisao(item.id, divisao.id, { tamanho })} /></div></label><div className="flex items-end"><div className="flex min-h-11 items-center gap-3"><Switch checked={divisao.laser} onCheckedChange={(laser) => atualizarDivisao(item.id, divisao.id, { laser })} label="Corte a laser" /><span className="text-sm text-slate-700">Corte a laser</span></div></div><div className="flex items-end md:col-span-2"><button type="button" disabled={item.divisoes.length === 1} onClick={() => atualizarItem(item.id, { divisoes: item.divisoes.filter((atual) => atual.id !== divisao.id) })} className="min-h-11 rounded-md border border-red-200 px-3 py-2 text-sm text-red-600 disabled:opacity-30">Excluir divisão</button></div></div></div>; })}<div className="flex justify-end"><button type="button" onClick={() => atualizarItem(item.id, { divisoes: [...item.divisoes, { id: novoId(), quantidade: "1", estampaId: "", estampaCodigo: "", varianteId: "", varianteCodigo: "", tipo: item.tipo, tamanho: item.tamanho, laser: item.laser }] })} className="min-h-11 rounded-md border border-dashed border-blue-300 px-4 py-2 text-sm font-medium text-blue-700">+ Adicionar divisão</button></div></div><p className={`mt-2 rounded-md px-3 py-2 text-xs font-medium ${divisaoValida(item) ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>Total dividido: {item.divisoes.reduce((total, divisao) => total + (numero(divisao.quantidade) || 0), 0)} de {item.quantidade}</p></div>}</section>)}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between"><button type="button" onClick={() => setEtapa(2)} className="w-full rounded-md border border-slate-300 px-5 py-2.5 text-sm sm:w-auto">Voltar</button><button disabled={preparandoConfirmacao || !itensValidos} className="hidden rounded-md bg-emerald-700 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50 sm:block">{preparandoConfirmacao ? "Preparando confirmação..." : "Criar pedido na Olist"}</button></div>
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-8px_24px_rgba(15,23,42,0.12)] backdrop-blur sm:hidden"><div className="mx-auto flex max-w-lg items-center gap-3"><div className="min-w-0 flex-1"><p className="text-xs text-slate-500">{itens.length} {itens.length === 1 ? "produto" : "produtos"}</p><p className="truncate text-sm font-semibold text-slate-900">{totalPedidoFormatado}</p></div><button disabled={preparandoConfirmacao || !itensValidos} className="min-h-11 rounded-md bg-emerald-700 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">{preparandoConfirmacao ? "Preparando..." : "Criar pedido"}</button></div></div>
    </form>}

    {confirmacaoAberta && pedidoPreview && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
        <div className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-xl bg-white shadow-xl">
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
            <div><h3 className="text-lg font-semibold text-slate-900">Confirmar pedido na Olist</h3><p className="mt-1 text-sm text-slate-600">Revise os dados e itens antes de confirmar o envio.</p></div>
            <button type="button" disabled={enviando} onClick={() => setConfirmacaoAberta(false)} className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 disabled:opacity-50">Fechar</button>
          </div>
          <div className="space-y-5 overflow-y-auto p-5">
            <section className="rounded-lg border border-slate-200 p-4">
              <h4 className="font-semibold text-slate-900">Dados do pedido</h4>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-sm text-slate-700">ID do cliente<input disabled value={pedidoPreview.idContato} className="mt-1 w-full rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-500" /></label>
                <label className="text-sm text-slate-700">ID do vendedor<input disabled value={pedidoPreview.vendedor.id} className="mt-1 w-full rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-500" /></label>
                <label className="text-sm text-slate-700">Situação<input disabled value={pedidoPreview.situacao} className="mt-1 w-full rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-500" /></label>
                <label className="text-sm text-slate-700">Data<input disabled value={pedidoPreview.data} className="mt-1 w-full rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-500" /></label>
              </div>
              <label className="mt-4 block text-sm text-slate-700">Observações<textarea disabled value={pedidoPreview.observacoes} className="mt-1 min-h-28 w-full rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-500" /></label>
            </section>
            {pedidoPreview.itens.map((item, index) => (
              <section key={`${item.produto.id}-${index}`} className="rounded-lg border border-slate-200 p-4">
                <h4 className="font-semibold text-slate-900">{item.produto.tipo === "S" ? "Serviço" : "Produto"} {index + 1}</h4>
                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="text-sm text-slate-700">ID do produto<input disabled value={item.produto.id} className="mt-1 w-full rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-500" /></label>
                  <label className="text-sm text-slate-700">Tipo<input disabled value={item.produto.tipo} className="mt-1 w-full rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-500" /></label>
                  <label className="text-sm text-slate-700">Quantidade<input disabled value={item.quantidade} className="mt-1 w-full rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-500" /></label>
                  <label className="text-sm text-slate-700">Preço unitário<input disabled value={item.valorUnitario ?? ""} className="mt-1 w-full rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-500" /></label>
                </div>
                {extrairDivisoesPreview(item.infoAdicional).map((divisao, divisaoIndex) => (
                  <div key={divisaoIndex} className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Estampa/variante {divisaoIndex + 1}</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <label className="text-sm text-slate-700">Estampa<input disabled value={divisao.estampa} className="mt-1 w-full rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-500" /></label>
                      <label className="text-sm text-slate-700">Variante<input disabled value={divisao.variante} className="mt-1 w-full rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-500" /></label>
                      <label className="text-sm text-slate-700">Quantidade da divisão<input disabled value={divisao.quantidade} className="mt-1 w-full rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-500" /></label>
                      <label className="text-sm text-slate-700">Unidade<input disabled value={divisao.unidade} className="mt-1 w-full rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-500" /></label>
                      <label className="text-sm text-slate-700">Tamanho<input disabled value={divisao.tamanho} className="mt-1 w-full rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-500" /></label>
                      <label className="text-sm text-slate-700">Tipo do produto<input disabled value={divisao.tipo} className="mt-1 w-full rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-500" /></label>
                      <div className="flex items-end"><div className="flex min-h-10 items-center gap-3"><Switch disabled checked={divisao.laser === "true"} onCheckedChange={() => undefined} label="Corte a laser" /><span className="text-sm text-slate-500">Corte a laser</span></div></div>
                    </div>
                  </div>
                ))}
                <label className="mt-4 block text-sm text-slate-700">Informação adicional<textarea disabled value={item.infoAdicional} className="mt-1 min-h-24 w-full rounded-md border border-slate-300 bg-slate-100 px-3 py-2 font-mono text-xs text-slate-500" /></label>
              </section>
            ))}
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 p-5">
            <button type="button" disabled={enviando} onClick={() => setConfirmacaoAberta(false)} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">Voltar</button>
            <button type="button" disabled={enviando} onClick={() => void criarPedido()} className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{enviando ? "Criando pedido..." : "Confirmar e criar pedido"}</button>
          </div>
        </div>
      </div>
    )}
  </div>;
}

export default function CriarPedidoOlistAccessPage() {
  return <AccessGuard permissions={["podeCriarOlistPedido"]}><CriarPedidoOlistPage /></AccessGuard>;
}
