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
