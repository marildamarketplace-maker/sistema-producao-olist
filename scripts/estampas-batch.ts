import "dotenv/config";

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { prisma } from "@/lib/prisma";
import {
  enviarProximoBatchEstampas,
  sincronizarBatchesEstampas,
} from "@/services/estampaAiBatchService";

async function main() {
  const acao = process.argv[2]?.trim().toLowerCase();
  if (acao === "submit") {
    const workerId = `${hostname()}-${process.pid}-${randomUUID()}`;
    console.info(await enviarProximoBatchEstampas(workerId));
    return;
  }
  if (acao === "sync") {
    console.info(await sincronizarBatchesEstampas());
    return;
  }
  throw new Error("Use npm run batch:estampas -- submit ou npm run batch:estampas -- sync.");
}

main()
  .catch((error) => {
    console.error("[estampas-batch] Falha.", error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
