const normalizar = (nome: string) => nome.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");

/** Percorre a pesquisa sem tratar um resultado parcial como confirmação do nome. */
export async function pesquisarTecidoOlist<T extends { nome: string }>(nome: string, carregar: (pagina: number) => Promise<{ itens: T[]; mais: boolean }>): Promise<T | null> {
  if (!nome.trim() || nome.trim().length > 120) throw new Error("Informe um nome de tecido com até 120 caracteres para pesquisar.");
  for (let pagina = 1; pagina <= 1000; pagina++) {
    const resultado = await carregar(pagina);
    const encontrado = resultado.itens.find((item) => normalizar(item.nome) === normalizar(nome));
    if (encontrado) return encontrado;
    if (!resultado.mais) return null;
  }
  throw new Error("Pesquisa muito ampla. Refine o nome do tecido.");
}
