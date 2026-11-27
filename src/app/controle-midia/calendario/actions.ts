"use server";

import { z } from "zod";
import { autorizarProdutosCalendario, buscaProdutosSchema, eventoSchema, alteracoesProdutosSchema, ProdutoCalendarioIndisponivel } from "@/lib/calendario-comercial/produtos";
import { buscarProdutosEvento, contarProdutosEventos, salvarProdutosEvento } from "@/lib/calendario-comercial/produtos-repository";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { prisma } from "@/lib/prisma";
import { consultarCatalogoAutorizado } from "@/lib/calendario-comercial/acesso";
import { catalogoComercial } from "@/lib/calendario-comercial/catalogo";

export async function carregarCalendario(token: string) {
  return consultarCatalogoAutorizado(typeof token === "string" ? token : null, {
    autenticar: async (accessToken) => {
      const autenticado = await getUsuarioAutenticado(new Request("http://localhost/calendario", {
        headers: { authorization: `Bearer ${accessToken}` },
      }));
      return prisma.usuario.findFirst({
        where: { id: autenticado.id, aplicativoId: autenticado.aplicativoId, ativo: true },
        select: { ativo: true, podeVisualizarTarefasMidia: true },
      });
    },
    carregar: () => catalogoComercial,
  });
}

async function aplicativoCalendario(token: string) {
  if (typeof token !== "string" || !token || token.length > 16384) throw new Error("Sessão inválida.");
  const autenticado = await getUsuarioAutenticado(new Request("http://localhost/calendario", {
    headers: { authorization: `Bearer ${token}` },
  }));
  const usuario = await prisma.usuario.findFirst({
    where: { id: autenticado.id, aplicativoId: autenticado.aplicativoId, ativo: true },
    select: { ativo: true, aplicativoId: true, podeVisualizarTarefasMidia: true },
  });
  return autorizarProdutosCalendario(usuario);
}

export async function buscarProdutosCalendario(token: string, entrada: unknown) {
  const filtros = buscaProdutosSchema.safeParse(entrada);
  if (!filtros.success) return { ok: false as const, erro: "Filtros inválidos." };
  try {
    const aplicativoId = await aplicativoCalendario(token);
    return { ok: true as const, ...await buscarProdutosEvento(aplicativoId, filtros.data) };
  } catch {
    return { ok: false as const, erro: "Não foi possível consultar os produtos. Verifique sua sessão e tente novamente." };
  }
}

export async function contarProdutosCalendario(token: string, entrada: unknown) {
  const eventos = z.array(eventoSchema).max(catalogoComercial.length).safeParse(entrada);
  if (!eventos.success) return { ok: false as const, erro: "Eventos inválidos." };
  try {
    const aplicativoId = await aplicativoCalendario(token);
    return { ok: true as const, contagens: await contarProdutosEventos(aplicativoId, [...new Set(eventos.data)]) };
  } catch {
    return { ok: false as const, erro: "Não foi possível carregar as associações. Tente novamente." };
  }
}

export async function salvarProdutosCalendario(token: string, entrada: unknown) {
  const dados = alteracoesProdutosSchema.safeParse(entrada);
  if (!dados.success) return { ok: false as const, erro: "Seleção inválida. Altere até 100 produtos por salvamento." };
  try {
    const aplicativoId = await aplicativoCalendario(token);
    await salvarProdutosEvento(aplicativoId, dados.data);
    return { ok: true as const };
  } catch (erro) {
    return { ok: false as const, erro: erro instanceof ProdutoCalendarioIndisponivel
      ? erro.message : "Não foi possível salvar as associações. Verifique sua sessão e tente novamente." };
  }
}

export async function validarImportacaoCalendario(token: string, entrada: unknown) {
  const { entradaImportacaoSchema } = await import("@/lib/calendario-comercial/importacao");
  const { previaImportacaoCalendario } = await import("@/lib/calendario-comercial/importacao-repository");
  const dados = entradaImportacaoSchema.safeParse(entrada);
  if (!dados.success || new TextEncoder().encode(JSON.stringify(dados.data)).length > 750000) {
    return { ok: false as const, erro: "Arquivo inválido ou muito grande. Limite de 5.000 registros e 750 KB de dados de associação." };
  }
  try {
    const aplicativoId = await aplicativoCalendario(token);
    return { ok: true as const, previa: await previaImportacaoCalendario(aplicativoId, dados.data) };
  } catch {
    return { ok: false as const, erro: "Não foi possível validar a importação. Confira o acesso e os limites do arquivo." };
  }
}

export async function importarLoteCalendario(token: string, entrada: unknown) {
  const dados = z.object({ eventoId: eventoSchema, skus: z.array(z.string().trim().min(1).max(255)).min(1).max(100) }).strict().safeParse(entrada);
  if (!dados.success || new Set(dados.data.skus).size !== dados.data.skus.length) return { ok: false as const, erro: "Lote inválido. Use até 100 SKUs únicos e um evento válido." };
  try {
    const aplicativoId = await aplicativoCalendario(token);
    const produtos = await prisma.produto.findMany({
      where: { aplicativoId, ativo: true, sku: { in: dados.data.skus } }, select: { id: true }, take: 100,
    });
    if (produtos.length !== dados.data.skus.length) return { ok: false as const, erro: "Um SKU foi desativado ou não está disponível neste aplicativo. Valide o CSV novamente." };
    await salvarProdutosEvento(aplicativoId, { eventoId: dados.data.eventoId, adicionar: produtos.map(p => p.id), remover: [] });
    return { ok: true as const, processados: produtos.length };
  } catch {
    return { ok: false as const, erro: "Não foi possível confirmar este lote. Os lotes anteriores estão preservados; tente novamente ou valide o CSV para retomar." };
  }
}

export async function importarArquivoCalendario(token: string, entrada: unknown) {
  const { importacaoCompletaSchema } = await import("@/lib/calendario-comercial/importacao");
  const { salvarImportacaoCompleta } = await import("@/lib/calendario-comercial/importacao-repository");
  const dados = importacaoCompletaSchema.safeParse(entrada);
  if (!dados.success || new TextEncoder().encode(JSON.stringify(dados.data)).length > 750000) {
    return { ok: false as const, erro: "Importação inválida. Limite de 10.000 vínculos únicos e 750 KB de dados de associação." };
  }
  try {
    const aplicativoId = await aplicativoCalendario(token);
    return { ok: true as const, ...await salvarImportacaoCompleta(aplicativoId, dados.data.vinculos) };
  } catch {
    return { ok: false as const, erro: "Não foi possível confirmar a importação inteira. Verifique se os produtos continuam ativos e valide o CSV novamente. Se houve perda de conexão, a nova validação identifica vínculos já salvos, sem duplicar." };
  }
}
