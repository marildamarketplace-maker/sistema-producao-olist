const endpoint = "/api/controle-midia/mockups";

export async function requisitarMockups(token: string, query = "", options?: RequestInit) {
  const response = await fetch(endpoint + query, {
    ...options,
    headers: { ...options?.headers, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error ?? "Não foi possível acessar os mockups.");
  }
  return response;
}

export function mensagemMockups(error: unknown) {
  return error instanceof Error ? error.message : "Tente novamente.";
}

