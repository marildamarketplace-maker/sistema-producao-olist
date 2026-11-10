import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { horariosSchema } from "./contrato";

export function revisaoRotina(rotina: { nome: string; habilidadeId: string; ativa: boolean; horarios: Prisma.JsonValue }) {
  return createHash("sha256").update(JSON.stringify([
    rotina.nome, rotina.habilidadeId, rotina.ativa, horariosSchema.parse(rotina.horarios),
  ])).digest("hex");
}
