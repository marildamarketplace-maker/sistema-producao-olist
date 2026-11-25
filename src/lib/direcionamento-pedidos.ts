import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { avaliarDirecionamentoPedido, configuracaoDirecionamentoSchema, type ConfiguracaoDirecionamento, type DadosClienteDirecionamento, type DecisaoDirecionamento } from "@/lib/direcionamento-pedidos-contrato";

export class ErroDirecionamentoPedidos extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}
const select = { versao: true, aplicativoPadraoId: true, regras: true } as const;
export async function obterConfiguracaoDirecionamento(aplicativoPaiId: string): Promise<ConfiguracaoDirecionamento | null> {
  const config = await prisma.direcionamentoPedidos.findUnique({ where: { aplicativoPaiId }, select });
  if (!config) return null;
  const parsed = configuracaoDirecionamentoSchema.safeParse(config);
  if (!parsed.success) throw new ErroDirecionamentoPedidos("Configuração de direcionamento inválida. Corrija em Configurações.");
  return parsed.data;
}
export async function resolverDirecionamentoPedido(aplicativoPaiId: string, cliente: DadosClienteDirecionamento): Promise<DecisaoDirecionamento> {
  const filhos = await prisma.aplicativo.findMany({ where: { aplicativoPaiId }, select: { id: true }, take: 1001 });
  if (filhos.length > 1000) throw new ErroDirecionamentoPedidos("O grupo excede o limite de aplicativos.");
  if (!filhos.length) return { tipo: "CONTA_UNICA", regraId: null, regraNome: null, versao: 0, aplicativoId: aplicativoPaiId, motivo: "Única conta disponível." };
  const config = await obterConfiguracaoDirecionamento(aplicativoPaiId);
  if (!config) throw new ErroDirecionamentoPedidos("Configure o aplicativo padrão para criar pedidos multiempresa.");
  const decisao = avaliarDirecionamentoPedido(config, cliente);
  if (!filhos.some(f => f.id === config.aplicativoPadraoId) || !filhos.some(f => f.id === decisao.aplicativoId)) throw new ErroDirecionamentoPedidos("Destino ou aplicativo padrão indisponível. Corrija a configuração.");
  return decisao;
}
/** Serializa a inclusão com edição e mudanças na hierarquia (FK dos filhos no pai). */
export async function validarVersaoDirecionamento(tx: Prisma.TransactionClient, paiId: string, decisao: DecisaoDirecionamento) {
  const pais = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM aplicativo WHERE id=${paiId}::uuid FOR UPDATE`;
  if (!pais.length) throw new ErroDirecionamentoPedidos("Aplicativo não encontrado.", 404);
  if (decisao.tipo === "CONTA_UNICA") {
    const filho = await tx.aplicativo.findFirst({ where: { aplicativoPaiId: paiId }, select: { id: true } });
    if (filho || decisao.aplicativoId !== paiId || decisao.versao !== 0) throw new ErroDirecionamentoPedidos("Contas alteradas. Revise o direcionamento.");
    return;
  }
  const configs = await tx.$queryRaw<Array<{ versao: number; aplicativoPadraoId: string }>>`SELECT versao, aplicativo_padrao_id AS "aplicativoPadraoId" FROM direcionamento_pedidos WHERE aplicativo_pai_id=${paiId}::uuid FOR SHARE`;
  if (configs[0]?.versao !== decisao.versao) throw new ErroDirecionamentoPedidos("Regras alteradas. Revise o direcionamento antes de incluir.");
  const destino = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM aplicativo WHERE id=${decisao.aplicativoId}::uuid AND aplicativo_pai_id=${paiId}::uuid FOR SHARE`;
  if (!destino.length) throw new ErroDirecionamentoPedidos("Destino não autorizado.", 403);
  const padrao = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM aplicativo WHERE id=${configs[0].aplicativoPadraoId}::uuid AND aplicativo_pai_id=${paiId}::uuid FOR SHARE`;
  if (!padrao.length) throw new ErroDirecionamentoPedidos("Aplicativo padrão indisponível. Corrija a configuração.");
}
export async function salvarConfiguracaoDirecionamento(paiId: string, usuarioId: string, entrada: ConfiguracaoDirecionamento) {
  const config = configuracaoDirecionamentoSchema.parse(entrada);
  if (config.versao === 2147483647) throw new ErroDirecionamentoPedidos("Limite de versões da configuração atingido.");
  return prisma.$transaction(async tx => {
    // Mesma ordem da inclusão: usuário antes do pai; revalida revogação de permissão.
    await tx.$queryRaw`SELECT id FROM usuario WHERE id=${usuarioId}::uuid FOR SHARE`;
    const usuario = await tx.usuario.findUnique({ where: { id: usuarioId }, select: { ativo: true, aplicativoId: true, podeEditarConfiguracao: true } });
    if (!usuario?.ativo || usuario.aplicativoId !== paiId || !usuario.podeEditarConfiguracao) throw new ErroDirecionamentoPedidos("Permissões alteradas. Atualize a página.", 403);
    const pais = await tx.$queryRaw<Array<{ aplicativoPaiId: string | null }>>`SELECT aplicativo_pai_id AS "aplicativoPaiId" FROM aplicativo WHERE id=${paiId}::uuid FOR UPDATE`;
    if (!pais.length || pais[0].aplicativoPaiId) throw new ErroDirecionamentoPedidos("Somente o aplicativo pai configura direcionamento.", 403);
    const ids = [...new Set([config.aplicativoPadraoId, ...config.regras.map(r => r.aplicativoId)])].sort();
    const destinos = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM aplicativo WHERE aplicativo_pai_id=${paiId}::uuid AND id::text IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`;
    if (destinos.length !== ids.length) throw new ErroDirecionamentoPedidos("Selecione somente filhos diretos deste aplicativo.", 400);
    const atual = await tx.direcionamentoPedidos.findUnique({ where: { aplicativoPaiId: paiId }, select: { versao: true } });
    if ((atual?.versao ?? 0) !== config.versao) throw new ErroDirecionamentoPedidos("Configuração alterada por outro usuário. Recarregue antes de salvar.");
    const data = { aplicativoPadraoId: config.aplicativoPadraoId, regras: config.regras as Prisma.InputJsonValue, versao: config.versao + 1, atualizadoPorId: usuarioId };
    await tx.direcionamentoPedidos.upsert({ where: { aplicativoPaiId: paiId }, create: { aplicativoPaiId: paiId, ...data }, update: data });
    return { ...config, versao: config.versao + 1 };
  });
}
