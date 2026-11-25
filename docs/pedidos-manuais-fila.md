# Pedidos manuais na fila própria

`/olist/pedidos/criar` usa o fluxo aplicativo → vendedor → cliente → itens → dados comerciais → revisão. A confirmação grava `PENDENTE`; somente a confirmação posterior na administração da fila cria na Olist. Não há novo worker nem envio automático.

## Acesso e dados

- `podeCriarOlistPedido`: criação e consulta de comprovantes próprios.
- `podeSelecionarFilialFornecedor`: seleção de filhos diretos. A conta própria é o padrão, mesmo sem essa permissão.
- `podeGerenciarFilaPedidos`: consulta administrativa, revisão, direcionamento, cancelamento e envio.
- O vínculo em qualquer conta elegível caracteriza usuário vendedor. Ele precisa de vínculo na conta escolhida; o vendedor fica fixo e os clientes são restritos à carteira. Busca, aceite e envio posterior conferem o escopo no servidor.
- Vendedor e cliente são obrigatórios e validados no aceite. Contatos e vendedores aceitam os estados A e B; recursos de produto, serviço e pagamento preservam seus próprios estados. Os demais dados comerciais são opcionais ao enfileirar e são validados na revisão e novamente antes do envio efetivo. A revisão do administrador usa o vendedor do autor, nunca o vínculo do administrador.
- Itens usam UUID próprio, sem fornecedor ou solicitação fictícios. São permitidos até 100 itens, com peças inteiras positivas, metragem positiva e campos textuais limitados. As divisões do pedido manual informam peças em UN, inclusive sem laser; a cobrança de tecido e serviço continua em MT.
- Trocar a conta no formulário preserva os itens descritivos e remove seleções comerciais. Redirecionar na administração também invalida essas seleções e as prévias anteriores.
- Novas reservas ficam em `envio_pedido_manual`, sem acesso pelas roles públicas do Supabase. O backend mantém autorização e isolamento por aplicativo.

## API

`/api/olist/pedidos/manuais` requer Bearer da sessão existente:

- `GET`: contas permitidas, conta padrão e sinal de habilitação.
- `GET ?aplicativoId=UUID`: conta autorizada e vendedor fixo, quando houver.
- `GET ?aplicativoId=UUID&recurso=clientes|vendedores|produtos|servicos|formas&busca=...&pagina=...`: consultas limitadas a 50 resultados por página, até página 1000. O filtro de carteira vem do servidor.
- `GET ?aplicativoId=UUID&recurso=planos&formaId=ID`: planos locais ativos associados.
- `POST`: entrada validada por `pedidoManualSchema`; retorna 201 com protocolo, status, data e conta. A chave de idempotência é única por aplicativo/autor. Repetição idêntica retorna o mesmo protocolo; conteúdo diferente retorna 409.
- `GET ?pedidoId=UUID`: comprovante limitado ao autor no aplicativo atual, sem snapshot comercial ou dados de outros pedidos.

A administração usa os endpoints já existentes em `/api/fornecedores/fila`. O endpoint antigo de criação direta permanece compatível, mas a nova tela não o utiliza.

A tentativa de enfileiramento fica em `sessionStorage`, segregada pelo usuário, para repetir exatamente a mesma confirmação após perda de rede ou reload. Respostas definitivas de erro devolvem os campos para correção. Em 403/409, a conta e o vínculo são reconsultados; se o vendedor mudar, o cliente anterior é limpo e os itens são preservados. O botão Atualizar conta permite recuperar o vínculo mesmo sem filial alternativa; o comprovante tem URL recarregável. Não há polling contínuo.

## Segurança do envio

A reserva é persistida antes do POST Olist; não há retry automático desse POST. Lock da fila, versão e estado impedem confirmação duplicada, cancelamento ou redirecionamento concorrentes. O vínculo fixo é conferido novamente sob lock do autor antes de reservar.

Falhas ambíguas tornam o envio `INCERTO` e bloqueiam reenvio. Reserva interrompida por mais de dez minutos é exposta para conciliação. Vincular um pedido existente exige o marcador exato `Pedido manual da fila: UUID` nas observações internas da conta da tentativa. Liberar outra tentativa exige conferência explícita de ausência e justificativa. Se houver ID Olist salvo, a ausência não pode ser registrada.

## Implantação gradual

1. Aplicar a migration Prisma `20261125010000_pedidos_manuais_fila` pelo procedimento habitual, mantendo `PEDIDOS_MANUAIS_HABILITADOS` ausente ou `false`.
2. Publicar todos os consumidores compatíveis com as origens `PRODUCAO` e `MANUAL`. A migration mantém os registros existentes como `PRODUCAO`; versões antigas não devem receber registros manuais.
3. Configurar **somente no servidor** `PEDIDOS_MANUAIS_HABILITADOS=true` e publicar/reiniciar a aplicação para habilitar a criação.
4. Conferir criação PENDENTE e comprovante com usuário autorizado; só testar criação real na Olist quando explicitamente autorizada.

Desabilitar a flag interrompe novas criações e buscas do formulário, mas preserva comprovantes e administração de pedidos já aceitos. Depois do primeiro pedido manual, rollback exige manter consumidores compatíveis; não retornar ao código antigo que pressupõe solicitação obrigatória.

## Egress e validação

A interface consulta cadastros sob demanda e cancela buscas obsoletas. Não carrega todos os clientes ou produtos. O aceite consulta somente cliente e vendedor: com token válido e o vendedor na primeira página, são duas chamadas externas, independentemente de haver 1 ou 100 produtos opcionais no snapshot. Pagamento, produtos e serviço de laser não são consultados no aceite; a revisão administrativa e a confirmação de criação os validam. Produtos repetidos compartilham a leitura dentro da mesma validação. O validador legado de vendedor pode percorrer até 100 páginas de 100 registros na conta; não há cache novo nem estimativa de economia monetária.

Testes cobrem estados A/B de pessoas sem liberar produtos bloqueados, nomes de vendedores em contato, atualização de vínculo após rejeição/reload, limite de chamadas no aceite, contratos, permissões, carteira, migração em PostgreSQL WASM, idempotência, reserva, falhas, conciliação e UI com Chrome headless em 360, 390 e 1440px, temas claro e escuro. Esses testes usam dados fictícios e não comprovam operação em produção ou em aparelho físico.
