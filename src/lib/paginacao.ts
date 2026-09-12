type ResultadoPagina<T, E> = {
  data: T[] | null;
  error: E | null;
};

export async function carregarTodasPaginas<T, E>(
  buscarPagina: (inicio: number, fim: number) => Promise<ResultadoPagina<T, E>>,
  tamanhoPagina = 1000,
): Promise<{ data: T[]; error: E | null }> {
  if (!Number.isSafeInteger(tamanhoPagina) || tamanhoPagina <= 0) {
    throw new Error("O tamanho da página deve ser um número inteiro positivo.");
  }

  const dados: T[] = [];

  for (let inicio = 0; ; inicio += tamanhoPagina) {
    const pagina = await buscarPagina(inicio, inicio + tamanhoPagina - 1);

    if (pagina.error) {
      return { data: dados, error: pagina.error };
    }

    const itens = pagina.data ?? [];
    dados.push(...itens);

    if (itens.length < tamanhoPagina) {
      return { data: dados, error: null };
    }
  }
}
