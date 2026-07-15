import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { deleteGoogleStorageObject, uploadToGoogleStorage } from "@/services/googleStorageService";

const TIPOS = new Set(["HOME_PC", "HOME_MOBILE", "CATEGORIA", "STORY", "FEED"]);
const MAX_FILE_SIZE = 20 * 1024 * 1024;

export async function GET(request: NextRequest) {
  const usuario = await getUsuarioAutenticado(request);
  const midias = await prisma.midia.findMany({
    where: { aplicativoId: usuario.aplicativoId },
    include: { categoria: { select: { id: true, nome: true, caminho: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ midias });
}

export async function POST(request: NextRequest) {
  try {
    const usuario = await getUsuarioAutenticado(request);
    const form = await request.formData();
    const arquivo = form.get("arquivo");
    const tipo = String(form.get("tipo") ?? "");
    const categoriaId = String(form.get("categoriaId") ?? "") || null;
    const titulo = String(form.get("titulo") ?? "").trim() || null;
    if (!(arquivo instanceof File)) return NextResponse.json({ error: "Selecione um arquivo." }, { status: 400 });
    if (!TIPOS.has(tipo)) return NextResponse.json({ error: "Tipo de mídia inválido." }, { status: 400 });
    if (!arquivo.type.startsWith("image/") && !arquivo.type.startsWith("video/")) return NextResponse.json({ error: "Envie uma imagem ou vídeo." }, { status: 400 });
    if (arquivo.size > MAX_FILE_SIZE) return NextResponse.json({ error: "O arquivo deve ter no máximo 20 MB." }, { status: 400 });
    if (tipo === "CATEGORIA" && !categoriaId) return NextResponse.json({ error: "Selecione a categoria do banner." }, { status: 400 });

    const extensao = arquivo.name.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "") || "bin";
    const path = `controle-midia/${tipo.toLowerCase()}/${randomUUID()}.${extensao}`;
    const uploaded = await uploadToGoogleStorage({ path, buffer: Buffer.from(await arquivo.arrayBuffer()), contentType: arquivo.type });
    const midia = await prisma.midia.create({ data: {
      aplicativoId: usuario.aplicativoId, categoriaId, tipo, titulo,
      arquivoUrl: uploaded.publicUrl, storagePath: uploaded.path, contentType: arquivo.type,
    }});
    return NextResponse.json({ midia }, { status: 201 });
  } catch (error) {
    console.error("Erro ao cadastrar mídia:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro inesperado" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const usuario = await getUsuarioAutenticado(request);
    const id = request.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Mídia não informada." }, { status: 400 });
    const midia = await prisma.midia.findFirst({ where: { id, aplicativoId: usuario.aplicativoId } });
    if (!midia) return NextResponse.json({ error: "Mídia não encontrada." }, { status: 404 });
    await deleteGoogleStorageObject(midia.storagePath);
    await prisma.midia.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro inesperado" }, { status: 500 });
  }
}
