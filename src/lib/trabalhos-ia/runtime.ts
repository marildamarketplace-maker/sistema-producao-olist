import { prisma } from "@/lib/prisma";
import { bancoPrismaIa } from "./banco";
import { criarRegistroIa } from "./registro";
import { relatorioSkuIa } from "./relatorio-sku";
import { criarServicoTrabalhosIa } from "./servico";

export const bancoIa = bancoPrismaIa(prisma);
export const registroIa = criarRegistroIa([relatorioSkuIa]);
export const trabalhosIa = criarServicoTrabalhosIa(bancoIa,registroIa);
