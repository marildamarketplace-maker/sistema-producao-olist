export function useAuth() {
  const params = new URLSearchParams(location.search);
  return { loading: false, session: { access_token: "teste" }, usuario: {
    id: "usuario", aplicativo_id: "aplicativo", podeGerenciarFilaPedidos: false,
    podeCriarOlistPedido: params.has("manual"), podeSolicitarProducao: params.has("producao"),
  } };
}
