import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

type UsuarioRow = {
  id: string;
  nome: string;
  email: string;
  aplicativo_id: string;
  vendedor_olist_id: number | null;
  pode_visualizar_dashboard: boolean;
  pode_visualizar_fornecedores: boolean;
  pode_visualizar_produtos_fornecedor: boolean;
  pode_visualizar_categorias_midia: boolean;
  pode_visualizar_olist_produtos: boolean;
  pode_visualizar_olist_contatos: boolean;
  pode_visualizar_olist_pedidos: boolean;
  pode_criar_olist_pedido: boolean;
  pode_visualizar_olist_vendedores: boolean;
  pode_visualizar_estoque: boolean;
  pode_editar_estoque: boolean;
  pode_visualizar_tipos_produto: boolean;
  pode_editar_tipos_produto: boolean;
  pode_visualizar_tamanhos: boolean;
  pode_editar_tamanhos: boolean;
  pode_visualizar_estampas: boolean;
  pode_editar_estampas: boolean;
  pode_visualizar_variantes: boolean;
  pode_editar_variantes: boolean;
  pode_visualizar_baixa: boolean;
  pode_solicitar_baixa: boolean;
  pode_visualizar_devolucao: boolean;
  pode_solicitar_devolucao: boolean;
  pode_solicitar_producao: boolean;
  pode_visualizar_producao: boolean;
  pode_confirmar_producao: boolean;
  pode_visualizar_configuracao: boolean;
  pode_editar_configuracao: boolean;
};

type AplicativoRow = {
  nome: string;
};

export async function GET(request: Request) {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;

  if (!token) {
    return NextResponse.json({ error: "Token de autenticação ausente." }, { status: 401 });
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
  const email = authData.user?.email;

  if (authError || !email) {
    return NextResponse.json({ error: "Token de autenticação inválido." }, { status: 401 });
  }

  const emailNormalizado = email.trim();
  const { data: usuarioData, error: usuarioError } = await supabaseAdmin
    .from("usuario")
    .select(
      `
        id,
        nome,
        email,
        aplicativo_id,
        vendedor_olist_id,
        pode_visualizar_dashboard,
        pode_visualizar_fornecedores,
        pode_visualizar_produtos_fornecedor,
        pode_visualizar_categorias_midia,
        pode_visualizar_olist_produtos,
        pode_visualizar_olist_contatos,
        pode_visualizar_olist_pedidos,
        pode_criar_olist_pedido,
        pode_visualizar_olist_vendedores,
        pode_visualizar_estoque,
        pode_editar_estoque,
        pode_visualizar_tipos_produto,
        pode_editar_tipos_produto,
        pode_visualizar_tamanhos,
        pode_editar_tamanhos,
        pode_visualizar_estampas,
        pode_editar_estampas,
        pode_visualizar_variantes,
        pode_editar_variantes,
        pode_visualizar_baixa,
        pode_solicitar_baixa,
        pode_visualizar_devolucao,
        pode_solicitar_devolucao,
        pode_solicitar_producao,
        pode_visualizar_producao,
        pode_confirmar_producao,
        pode_visualizar_configuracao,
        pode_editar_configuracao
      `,
    )
    .ilike("email", emailNormalizado)
    .eq("ativo", true)
    .limit(1)
    .maybeSingle();

  if (usuarioError) {
    return NextResponse.json(
      { error: `Erro ao validar acesso: ${usuarioError.message}` },
      { status: 500 },
    );
  }

  if (!usuarioData) {
    return NextResponse.json(
      { error: "Usuário autenticado, mas sem cadastro ativo neste aplicativo." },
      { status: 403 },
    );
  }

  const usuario = usuarioData as UsuarioRow;
  const { data: aplicativoData } = await supabaseAdmin
    .from("aplicativo")
    .select("nome")
    .eq("id", usuario.aplicativo_id)
    .maybeSingle();
  const aplicativo = aplicativoData as AplicativoRow | null;

  return NextResponse.json({
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    aplicativo_id: usuario.aplicativo_id,
    vendedorOlistId: usuario.vendedor_olist_id,
    aplicativo: aplicativo ? { nome: aplicativo.nome } : null,
    podeVisualizarDashboard: Boolean(usuario.pode_visualizar_dashboard),
    podeVisualizarFornecedores: Boolean(usuario.pode_visualizar_fornecedores),
    podeVisualizarProdutosFornecedor: Boolean(usuario.pode_visualizar_produtos_fornecedor),
    podeVisualizarCategoriasMidia: Boolean(usuario.pode_visualizar_categorias_midia),
    podeVisualizarOlistProdutos: Boolean(usuario.pode_visualizar_olist_produtos),
    podeVisualizarOlistContatos: Boolean(usuario.pode_visualizar_olist_contatos),
    podeVisualizarOlistPedidos: Boolean(usuario.pode_visualizar_olist_pedidos),
    podeCriarOlistPedido: Boolean(usuario.pode_criar_olist_pedido),
    podeVisualizarOlistVendedores: Boolean(usuario.pode_visualizar_olist_vendedores),
    podeVisualizarEstoque: Boolean(usuario.pode_visualizar_estoque),
    podeEditarEstoque: Boolean(usuario.pode_editar_estoque),
    podeVisualizarTiposProduto: Boolean(usuario.pode_visualizar_tipos_produto),
    podeEditarTiposProduto: Boolean(usuario.pode_editar_tipos_produto),
    podeVisualizarTamanhos: Boolean(usuario.pode_visualizar_tamanhos),
    podeEditarTamanhos: Boolean(usuario.pode_editar_tamanhos),
    podeVisualizarEstampas: Boolean(usuario.pode_visualizar_estampas),
    podeEditarEstampas: Boolean(usuario.pode_editar_estampas),
    podeVisualizarVariantes: Boolean(usuario.pode_visualizar_variantes),
    podeEditarVariantes: Boolean(usuario.pode_editar_variantes),
    podeVisualizarBaixa: Boolean(usuario.pode_visualizar_baixa),
    podeSolicitarBaixa: Boolean(usuario.pode_solicitar_baixa),
    podeVisualizarDevolucao: Boolean(usuario.pode_visualizar_devolucao),
    podeSolicitarDevolucao: Boolean(usuario.pode_solicitar_devolucao),
    podeSolicitarProducao: Boolean(usuario.pode_solicitar_producao),
    podeVisualizarProducao: Boolean(usuario.pode_visualizar_producao),
    podeConfirmarProducao: Boolean(usuario.pode_confirmar_producao),
    podeVisualizarConfiguracao: Boolean(usuario.pode_visualizar_configuracao),
    podeEditarConfiguracao: Boolean(usuario.pode_editar_configuracao),
  });
}
