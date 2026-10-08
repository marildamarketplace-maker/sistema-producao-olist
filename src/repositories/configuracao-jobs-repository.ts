import { prisma } from "@/lib/prisma";

export const CHAVE_JOB_PROCESSAR_ESTAMPAS = "processar-estampas";

export async function processarEstampasEstaPausado(): Promise<boolean> {
  const configuracao = await prisma.configuracaoJob.findUnique({
    where: { chave: CHAVE_JOB_PROCESSAR_ESTAMPAS },
    select: { pausado: true },
  });
  // Ausência de configuração mantém o processamento desativado.
  return configuracao?.pausado ?? true;
}

export async function obterTermosIgnoradosNomeArquivoEstampas(): Promise<string[]> {
  const configuracao = await prisma.configuracaoJob.findUnique({
    where: { chave: CHAVE_JOB_PROCESSAR_ESTAMPAS },
    select: { termosIgnoradosNomeArquivo: true },
  });
  return configuracao?.termosIgnoradosNomeArquivo ?? [];
}
