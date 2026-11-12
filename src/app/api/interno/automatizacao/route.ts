import { createHash, timingSafeEqual } from "node:crypto";
import { lerCorpoLimitado } from "@/lib/ler-corpo-limitado";
import { z } from "zod";
import { operacaoWorker, operarFila } from "@/lib/automatizacao/fila";

const credenciais = z.array(z.object({
  id: z.string().min(1).max(80),
  // IDs legados válidos no Postgres não possuem necessariamente versão RFC.
  aplicativoId: z.guid(),
  tokenSha256: z.string().regex(/^[a-f0-9]{64}$/),
}));

export async function POST(request: Request) {
  const token = request.headers.get("authorization");
  if (!token?.startsWith("Bearer ") || token.length > 300) return new Response(null, { status: 401 });
  try {
    const hash = createHash("sha256").update(token.slice(7)).digest();
    const workers = credenciais.parse(JSON.parse(process.env.AUTOMATIZACAO_WORKERS ?? "[]"));
    const escopo = workers.find(({ tokenSha256 }) => timingSafeEqual(hash, Buffer.from(tokenSha256, "hex")));
    if (!escopo) return new Response(null, { status: 401 });
    const corpo = await lerCorpoLimitado(request, 3_000_000);
    if (corpo === null) return new Response(null, { status: 413 });
    const operacao = operacaoWorker.safeParse(JSON.parse(corpo));
    if (!operacao.success) return new Response(null, { status: 400 });
    const resultado = await operarFila(escopo, operacao.data);
    return resultado ? Response.json(resultado) : new Response(null, { status: 409 });
  } catch (error) {
    return new Response(null, { status: error instanceof SyntaxError ? 400 : 500 });
  }
}
