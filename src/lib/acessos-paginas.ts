import { paginasPermitidas, rankingPaginas, type ContagemPagina } from "./navigation";
import type { PermissionSet } from "./permissions";

type UsuarioAcessos = Partial<PermissionSet> & { id: string };
type Dependencias = {
  autenticar: (request: Request) => Promise<UsuarioAcessos | null>;
  listar: (usuarioId: string) => Promise<ContagemPagina[]>;
  incrementar: (usuarioId: string, pagina: string) => Promise<void>;
};

export function criarHandlersAcessos(deps: Dependencias) {
  async function executar(request: Request, registrar: boolean) {
    try {
      const usuario = await deps.autenticar(request);
      if (!usuario) return Response.json({ error: "Autenticação necessária." }, { status: 401 });
      if (registrar) {
        let body: unknown;
        try { body = await request.json(); } catch {
          return Response.json({ error: "JSON inválido." }, { status: 400 });
        }
        const pagina = body && typeof body === "object" && "pagina" in body ? body.pagina : null;
        if (typeof pagina !== "string" || !paginasPermitidas(usuario).some((item) => item.href === pagina)) {
          return Response.json({ error: "Página inválida ou sem permissão." }, { status: 403 });
        }
        await deps.incrementar(usuario.id, pagina);
        return new Response(null, { status: 204 });
      }
      const contagens = await deps.listar(usuario.id);
      return Response.json({ paginas: rankingPaginas(usuario, contagens) }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return Response.json({ error: "Não foi possível carregar ou registrar os acessos." }, { status: 503 });
    }
  }
  return { GET: (request: Request) => executar(request, false), POST: (request: Request) => executar(request, true) };
}
