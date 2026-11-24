import { GET as listarAplicativosPai } from "../aplicativos-pai/route";

// Compatibilidade para abas antigas, sem listar usuários ou dados comerciais.
export async function GET(request: Request) {
  return listarAplicativosPai(request);
}
