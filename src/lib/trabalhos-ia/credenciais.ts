import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ErroTrabalhoIa, type WorkerIa } from "./contrato";

const configuracao=z.array(z.object({
  id:z.string().min(1).max(80),aplicativoId:z.guid(),tokenSha256:z.string().regex(/^[a-f0-9]{64}$/),
  tipos:z.array(z.string().min(1).max(100)).min(1).max(20),grupo:z.string().min(1).max(80),
}));
export function autenticarWorkerIa(request: Request, configurado=process.env.TRABALHOS_IA_WORKERS): WorkerIa {
  const authorization=request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ") || authorization.length>300) throw new ErroTrabalhoIa("Credencial inválida.",401);
  const workers=configuracao.parse(JSON.parse(configurado ?? "[]"));
  if (new Set(workers.map(w=>w.id)).size!==workers.length || new Set(workers.map(w=>w.tokenSha256)).size!==workers.length) throw new Error("Configuração ambígua de workers.");
  const hash=createHash("sha256").update(authorization.slice(7)).digest();
  const worker=workers.find(w=>timingSafeEqual(hash,Buffer.from(w.tokenSha256,"hex")));
  if (!worker) throw new ErroTrabalhoIa("Credencial inválida.",401);
  return {id:worker.id,aplicativoId:worker.aplicativoId,tipos:worker.tipos,grupo:worker.grupo};
}
