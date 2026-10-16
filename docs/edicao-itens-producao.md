# Edição dos itens na página de detalhes

A página `/solicitacoes-producao/[id]` permite editar quantidades solicitadas e produzidas, adicionar produtos e remover itens em qualquer status. A permissão `podeSolicitarProducao` é exigida na interface e no servidor. Quem possui apenas `podeVisualizarProducao` continua com acesso de leitura.

As alterações preservam o status da solicitação, a foto de evidência, os vínculos Olist e, nos itens mantidos, SKU, imagem, corte e observação. Produtos novos precisam estar ativos e pertencer ao aplicativo; os dados comerciais vêm do banco, não do cliente. Itens históricos de produtos inativos podem ter suas quantidades corrigidas. A edição exige entre 1 e 500 itens, com quantidades inteiras não negativas.

## Estoque

- `concluida`: calcula o saldo líquido dos movimentos da solicitação (`PRODUCAO`, `AJUSTE_PRODUCAO`, `CANCELAMENTO_PRODUCAO`) e registra somente a diferença para a nova quantidade produzida por produto. Movimentos existentes são preservados. As novas entradas/saídas usam `AJUSTE_PRODUCAO` e identificam o usuário responsável na observação.
- Demais status, incluindo `cancelada`: atualiza os itens sem confirmar, reabrir ou gerar movimentos de estoque.
- Remover ou substituir um produto de uma produção concluída reverte o saldo desse produto e registra o saldo do novo, quando aplicável.
- Cancelar uma produção concluída considera o saldo corrigido. Por exemplo, 50 unidades com uma correção de saída de 10 resultam em estorno de 40, não 50.

## Concorrência e falhas

O GET dos detalhes fornece `revisao`, calculada a partir do status e dos dados atuais dos itens. O PATCH exige essa revisão e executa leitura, validação, gravação dos itens e ajustes de estoque em uma transação `Serializable`. Versões desatualizadas e conflitos de transação retornam HTTP 409, sem repetir a mutação automaticamente. O formulário preserva o rascunho nos erros e oferece descarte explícito para recarregar em caso de conflito.

Não há nova migration ou mudança de status implícita neste fluxo. As edições anteriores da página Anotar produção mantêm seu comportamento existente.

## Verificação local

Testes cobrem permissões, isolamento por aplicativo, quantidades inválidas, itens de outra solicitação, produto novo inativo, todos os status, correções sucessivas sem duplicidade, remoção/substituição, cancelamento após correção, revisão desatualizada e rollback com dependências simuladas. A garantia da transação depende do PostgreSQL; os testes locais não substituem a aceitação em um banco de homologação.

A interface pode ser conferida em uma prévia com dados fictícios e respostas simuladas para erro e sucesso, separadamente dos testes do serviço. Essa prévia não confirma persistência no ambiente remoto nem execução em celular real.
