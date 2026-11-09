import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { setTimeout as esperar } from "node:timers/promises";
import { z } from "zod";
import { MAX_ESTAMPAS_LAYOUT } from "@/lib/fila-mockups-contrato";
import { GeradorMockupCodex, lerArquivoImagem } from "@/services/gerarMockupCodexService";
import { GoogleStorageServiceError, verificarGoogleStorageBucketPrivado } from "@/services/googleStorageService";
import { ImageAnalysisProviderError } from "@/services/image-analysis/ImageAnalysisProviderError";

const ajuda = `Worker local de mockups

npm run worker:mockups
  Processa uma saída da fila do aplicativo configurado e encerra.

npm run worker:mockups -- --watch
  Processa continuamente, uma saída por vez. Ctrl+C encerra após a saída atual.

npm run worker:mockups -- --piloto saida.webp modelo.png estampa.png [outras-estampas...]
  Testa a geração com arquivos locais. Use --layout após --piloto para testar um layout.
  Até ${MAX_ESTAMPAS_LAYOUT} estampas por layout. Grava um WebP novo sem acessar a fila ou o bucket.

Requer Codex CLI autenticado via ChatGPT (codex login).
A fila requer POSTGRES_PRISMA_URL, MOCKUPS_APLICATIVO_ID e GOOGLE_CLOUD_MOCKUPS_BUCKET,
além das credenciais Google Cloud e das migrations de fila_mockups aplicadas.
Resultados de fila ficam no bucket privado, em mockups-gerados/.
Configurações opcionais: CODEX_CLI_PATH, MOCKUPS_CODEX_MODEL e MOCKUPS_CODEX_TIMEOUT_MS.`;

async function main(args: string[]) {
  if (args.includes("--help") || args.includes("-h")) {
    console.info(ajuda);
    return;
  }

  const gerador = new GeradorMockupCodex();
  if (args[0] === "--piloto") {
    const layout = args[1] === "--layout";
    const [saida, modelo, ...estampas] = args.slice(layout ? 2 : 1);
    if (!saida?.toLowerCase().endsWith(".webp") || !modelo || !estampas.length
      || estampas.length > (layout ? MAX_ESTAMPAS_LAYOUT : 1)) {
      throw new ConfiguracaoWorkerError("Informe saída .webp, modelo e estampas válidas. Consulte --help.");
    }
    await gerador.verificarDisponibilidade();
    const [base, ...artes] = await Promise.all([modelo, ...estampas].map(lerArquivoImagem));
    const resultado = await gerador.gerar(base, artes, layout);
    await writeFile(saida, resultado.buffer, { flag: "wx", mode: 0o600 });
    console.info(`Piloto salvo em ${saida} (${resultado.width} × ${resultado.height} px). Aguardando revisão visual.`);
    return;
  }

  const watch = args.length === 1 && args[0] === "--watch";
  if (args.length && !watch) throw new ConfiguracaoWorkerError("Opção inválida. Consulte --help.");
  const aplicativo = z.uuid().safeParse(process.env.MOCKUPS_APLICATIVO_ID?.trim());
  const bucket = process.env.GOOGLE_CLOUD_MOCKUPS_BUCKET?.trim();
  if (!aplicativo.success || !bucket || !process.env.POSTGRES_PRISMA_URL
    || !process.env.GOOGLE_CLOUD_CLIENT_EMAIL || !process.env.GOOGLE_CLOUD_PRIVATE_KEY) {
    throw new ConfiguracaoWorkerError("Configure o aplicativo, o banco e o bucket privado no .env antes de iniciar.");
  }

  await gerador.verificarDisponibilidade();
  try {
    await verificarGoogleStorageBucketPrivado(bucket, AbortSignal.timeout(45_000));
  } catch {
    throw new ConfiguracaoWorkerError("Verifique as credenciais e ative a prevenção de acesso público no bucket de mockups.");
  }

  const { prisma } = await import("@/lib/prisma");
  const controller = new AbortController();
  const encerrar = () => controller.abort();
  process.once("SIGINT", encerrar);
  process.once("SIGTERM", encerrar);
  try {
    const { processarProximaSaidaMockup } = await import("@/services/processarFilaMockupsService");
    while (!controller.signal.aborted) {
      const resultado = await processarProximaSaidaMockup({ aplicativoId: aplicativo.data, bucket, gerador });
      if (resultado) console.info("[mockups-worker]", resultado);
      if (!watch) {
        if (!resultado) console.info("[mockups-worker] Nenhuma saída pronta.");
        if (resultado && resultado.status !== "COMPLETED") process.exitCode = 1;
        break;
      }
      if (!resultado || (resultado.status === "RETRY" && resultado.erro === "RATE_LIMIT")) {
        const espera = resultado ? 5 * 60_000 : 5_000;
        await esperar(espera, undefined, { signal: controller.signal }).catch(() => {});
      }
    }
  } finally {
    process.off("SIGINT", encerrar);
    process.off("SIGTERM", encerrar);
    await prisma.$disconnect();
  }
}

class ConfiguracaoWorkerError extends Error {}

main(process.argv.slice(2)).catch((error) => {
  const mensagem = error instanceof ImageAnalysisProviderError || error instanceof ConfiguracaoWorkerError
    ? error.message
    : error && typeof error === "object" && "code" in error && error.code === "EEXIST"
      ? "O arquivo de piloto já existe. Escolha outro nome."
      : error instanceof GoogleStorageServiceError
        ? "Verifique as credenciais e as permissões do bucket privado de mockups."
        : "Falha na execução. Confira as migrations, a conexão e os arquivos de entrada.";
  console.error("[mockups-worker]", mensagem);
  process.exitCode = 1;
});
