import { z } from "zod";
export type ErrosComerciaisFila = Record<string, string>;
/** Mensagens permitidas: nunca serializa valores, mensagens brutas ou estrutura interna do Zod. */
export function detalharErrosFilaOlist(erro: z.ZodError) {
  const campos: ErrosComerciaisFila = {};
  for (const issue of erro.issues) {
    const caminho = issue.path[0] === "selecoes" ? issue.path.slice(1) : issue.path;
    const chave = caminho.map(String).join(".");
    const mensagens: Record<string, string> = {
      clienteId: "Selecione um cliente válido na conta destinatária.",
      vendedorId: "Selecione um vendedor válido na conta destinatária.",
      formaId: "Selecione uma forma de pagamento válida.",
      planoId: "Selecione um plano de pagamento associado à forma escolhida.",
      tipoVenda: "Selecione o tipo de venda: Venda, Venda G ou Venda PC.",
      laser: "Selecione o serviço de corte a laser e informe o preço por metro.",
      "laser.id": "Selecione um serviço de corte a laser válido.",
      "laser.preco": "Informe um preço válido para o corte a laser, entre R$ 0 e R$ 1.000.000.000.",
      tecidos: "Associe os produtos aos tecidos do pedido (máximo de 1.000 associações).",
      previaId: "A prévia está inválida. Volte à revisão e gere uma nova prévia.",
      versao: "A versão do pedido está inválida. Feche e atualize a fila.",
      justificativa: "Informe uma justificativa entre 10 e 1.000 caracteres.",
      pedidoOlistId: "Informe o número válido do pedido existente na Olist.",
      ausenciaConfirmada: "Confirme a conferência de ausência do pedido na Olist.",
    };
    if (mensagens[chave]) campos[chave] = mensagens[chave];
    else if (caminho[0] === "tecidos" && typeof caminho[1] === "number") {
      const item = caminho[1] + 1;
      campos[chave] = caminho[2] === "preco" ? `Produto ${item}: informe um preço por metro entre R$ 0 e R$ 1.000.000.000.`
        : caminho[2] === "id" ? `Produto ${item}: selecione um produto válido na conta destinatária.`
        : `Produto ${item}: a associação com o tecido está inválida. Atualize a fila e associe novamente.`;
    }
  }
  const mensagens = [...new Set(Object.values(campos))];
  return { error: mensagens.length ? mensagens.join(" ") : "Os dados salvos do pedido estão inválidos. Atualize a fila e revise as associações antes de gerar uma nova prévia.", campos };
}

export function errosComerciaisCriacao(selecoes: { formaId?: number; planoId?: string; laser?: { id: number; preco?: number | null } | null }, precisaLaser: boolean): ErrosComerciaisFila {
  const campos: ErrosComerciaisFila = {};
  if (!selecoes.formaId || !Number.isSafeInteger(selecoes.formaId) || selecoes.formaId < 1) campos.formaId = "Selecione uma forma de pagamento.";
  if (!z.guid().safeParse(selecoes.planoId).success) campos.planoId = "Selecione um plano de pagamento associado à forma escolhida.";
  if (precisaLaser) {
    if (!selecoes.laser?.id || !Number.isSafeInteger(selecoes.laser.id) || selecoes.laser.id < 1) campos.laser = "Selecione o serviço de corte a laser da conta destinatária.";
    if (selecoes.laser?.id && (selecoes.laser.preco == null || !Number.isFinite(selecoes.laser.preco) || selecoes.laser.preco < 0 || selecoes.laser.preco > 1e9)) campos["laser.preco"] = "Informe um preço válido por metro para o corte a laser.";
  }
  return campos;
}
/** Aplicar somente em novos aceites; confirmações históricas continuam idempotentes. */
export function exigirComerciaisCriacao(selecoes: Parameters<typeof errosComerciaisCriacao>[0], precisaLaser: boolean) {
  const campos = errosComerciaisCriacao(selecoes, precisaLaser);
  if (Object.keys(campos).length) throw new z.ZodError(Object.entries(campos).map(([campo, message]) => ({ code: "custom", path: ["selecoes", ...campo.split(".")], message })));
}
