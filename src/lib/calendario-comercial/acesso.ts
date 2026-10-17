import type { Evento } from "./planejamento";

type UsuarioCalendario = { ativo: boolean; podeVisualizarTarefasMidia: boolean };
export type ResultadoCatalogo = { ok: true; eventos: Evento[] } | { ok: false; erro: string };
export async function consultarCatalogoAutorizado(token: string | null, deps: {
  autenticar: (token: string) => Promise<UsuarioCalendario | null>;
  carregar: () => Evento[];
}): Promise<ResultadoCatalogo> {
  if (!token || token.length > 16384) return { ok: false, erro: "Sessão inválida. Entre novamente para consultar o calendário." };
  try {
    const usuario = await deps.autenticar(token);
    if (!usuario?.ativo || !usuario.podeVisualizarTarefasMidia) {
      return { ok: false, erro: "Seu usuário não possui permissão para acessar o calendário." };
    }
    return { ok: true, eventos: deps.carregar() };
  } catch {
    return { ok: false, erro: "Não foi possível carregar o calendário. Verifique sua sessão e tente novamente." };
  }
}
