# Fila de pedidos do fornecedor

Em **Solicitações em produção**, a ação **Enviar para fila do Fornecedor** abre a seleção do fornecedor e grava um snapshot dos itens atuais. O envio direto para a Olist permanece disponível como fluxo independente.

## Persistência

A migration `20261016170000_pedido_fornecedor_queue` cria `pedido_fornecedor_queue` com:

- `id`: UUID do registro.
- `aplicativo_solicitante_id`: aplicativo do usuário autenticado.
- `solicitacao_producao_id`: solicitação em produção pertencente à origem.
- `aplicativo_fornecedor_id`: aplicativo pai vinculado ao cadastro do fornecedor.
- `fornecedor_id`: fornecedor selecionado, pertencente ao aplicativo solicitante.
- `dados_pedido`: JSONB com versão, itens e observação geral.
- `created_at`: instante do envio.

O campo `fornecedores.aplicativo_id` representa a origem do cadastro. O destino de novos pedidos da fila é obtido de `fornecedores.aplicativo_pai_id`, independentemente do usuário vendedor. A fila não exige configuração de pagamento nem cria pedido na Olist.

Cada item preserva SKU, produto, tecido (ID, nome e referência), quantidade em unidades, consumo total de tecido em metros, estampa, variante opcional, corte a laser, tamanho e tipo de produto. O consumo vem do vínculo do produto com o tecido do fornecedor selecionado. Itens sem esse vínculo bloqueiam o envio completo. O JSON é um snapshot; alterações posteriores da produção não o atualizam.

Há no máximo um registro de fila por solicitação, garantido por UNIQUE no banco. Nova tentativa retorna HTTP 409; não altera nem duplica o snapshot existente. O bloqueio da solicitação e a gravação ocorrem na mesma transação. Não há consumidor automático nem criação de pedido na Olist nesta etapa. A administração e o direcionamento para filiais são descritos abaixo.

## Segurança e API

`GET /api/fornecedores/fila` lista fornecedores elegíveis da origem. `POST` aceita somente `fornecedorId` e `solicitacaoId`; os aplicativos e o conteúdo são derivados no servidor. Ambas as operações exigem sessão ativa e `podeSolicitarProducao`. A nova tabela tem RLS habilitada e acesso direto de `anon` e `authenticated` revogado; o acesso ocorre pela API com Prisma.

## Aceite e validação

- Desktop (1280–1440px): localizar a ação, abrir diálogo, selecionar pelo teclado, enviar, obter sucesso; Escape/cancelar devolvem o foco à ação de origem.
- Mobile (360–390px): localizar a ação pela rolagem contida da tabela, selecionar fornecedor, ler mensagens longas e concluir sem botões ocultos; diálogo tem largura limitada ao viewport, altura máxima e rolagem própria, controles de pelo menos 44px.
- Ambos os temas: texto, campos e feedback legíveis; erro mantém seleção; durante envio o formulário bloqueia repetição e fechamento.
- Testes automatizados: snapshot, unidades, variante opcional, laser, quantidades inválidas, autenticação, autorização, filtros por aplicativo, fornecedor/tecido inválido, origem/destino derivados no servidor, conflito UNIQUE e erro interno sanitizado.

Validação visual autenticada, dispositivo mobile real, aplicação da migration e concorrência em PostgreSQL real devem ser verificadas no ambiente de destino. Os testes de API usam banco simulado e não comprovam RLS ou locks reais.


## Administração pelo aplicativo fornecedor

Acesse **Pedidos → Fila de pedidos** (`/fornecedor/fila-pedidos`). Requer a permissão específica **Gerenciar fila de pedidos** (`podeGerenciarFilaPedidos`), validada também na API. Não há comparação por nome de aplicativo nem IDs fixos: qualquer aplicativo com essa permissão administra apenas a fila cujo `aplicativo_fornecedor_id` corresponda ao seu próprio ID.

A tela lista 20 pedidos por página, do mais antigo ao mais recente, com filtros **Aguardando filial**, **Direcionados** e **Todos**. Cada card exibe origem, identificadores, datas e consulta expansível do snapshot dos itens. Selecionar **Direcionar pedido** grava a filial escolhida. O filtro de direcionados permite trocar essa filial. Enquanto não houver criação na Olist, a atribuição é reversível por essa troca; não há ação de criação nem consumo automático da fila.

Somente filiais diretas (`aplicativo.aplicativo_pai_id = aplicativo_fornecedor_id`) são elegíveis. Aplicativos independentes, a própria matriz e filiais de outros grupos são rejeitados no servidor. O snapshot original e o aplicativo fornecedor destinatário permanecem intactos; a filial é um campo separado.

A migration `20261016190000_direcionamento_fila_fornecedor` acrescenta:

- `aplicativo_filial_id`: filial escolhida, inicialmente nula.
- `direcionado_por_id` e `direcionado_em`: autor e data da última atribuição (não é um histórico de todas as trocas).
- `versao`: contador iniciado em zero, incrementado em cada atribuição.

`GET /api/fornecedores/fila/administracao?situacao=pendente&pagina=1` retorna a página, total e filiais. `PATCH` aceita estritamente `{ pedidoId, filialId, versao }`. A atualização exige a versão lida pelo cliente; uma edição concorrente retorna 409, mantém a seleção na tela e pede atualização da fila. Um lock `FOR SHARE` mantém o vínculo da filial com a matriz estável durante a transação. Dados internos do banco não são retornados em falhas.

A migration mantém pedidos existentes sem atribuição e preserva a RLS e as restrições de acesso direto da fila. Ela deve ser aplicada após as migrations da fila e da hierarquia de aplicativos. `prisma db push` não substitui as instruções SQL de permissões/constraints das migrations.

### Aceite da administração

- Desktop: localizar o menu, filtrar a fila, expandir os itens por Enter, selecionar filial, enviar pelo teclado, receber confirmação e consultar o pedido em Direcionados.
- Mobile: cards em coluna, controles de pelo menos 44px, nomes e observações extensos com quebra, sem overflow da página; selecionar, salvar e corrigir erros no próprio card.
- Erros recuperáveis mantêm a seleção; envios duplicados pelo card são bloqueados; conflito impede nova tentativa com versão antiga e oferece atualização da fila.
- Estados vazios, sem filiais, carregamento, erro, sucesso e salvamento precisam ser distinguíveis por texto. A confirmação de sucesso recebe foco para orientar a navegação após a retirada do card da lista de pendentes.

### Evidências desta implementação

- Testes de API com banco simulado: sessão, permissão, paginação e filtros, isolamento dos pedidos recebidos, vínculo de filial, payload inválido, proteção de snapshot, reatribuição e duas gravações concorrentes com mesma versão (uma aceita, uma rejeitada).
- Teste SQL de chaves e constraints disponível via `APLICATIVO_TEST_DATABASE_URL`; ignorado quando esse banco de teste não está configurado.
- Navegador: componente real com CSS do projeto e dados/respostas fictícios em memória; sem sessão ou banco reais. Conferidos detalhes por teclado, atribuição, troca de filial, foco no sucesso, conflito preservando seleção, ausência de filiais, lista vazia e falha no carregamento. Larguras CSS de 360 e 390px sem overflow horizontal e controles com altura de aproximadamente 44px; tema escuro também conferido. Desktop conferido separadamente.
- Esses testes não comprovam integração autenticada, persistência ou locks reais no PostgreSQL, RLS remota nem uso em aparelho mobile real. A criação de pedido na Olist foi expressamente deixada para a próxima etapa.


## Aplicativo pai no fornecedor

O cadastro e a edição exigem **Aplicativo pai**, e a lista **Fornecedores cadastrados** exibe esse relacionamento. São oferecidos somente aplicativos sem pai (matrizes); a lista contém apenas ID/nome e continua protegida pela permissão de fornecedores. O proprietário do cadastro (`aplicativo_id`) e o vendedor Olist são preservados.

A migration `20261016200000_fornecedor_aplicativo_pai` acrescenta uma FK obrigatória e um índice. Somente vínculos nulos são preenchidos com `00000000-0000-0000-0000-000000000002`, conforme solicitado. Não há default para novos cadastros: o aplicativo deve ser escolhido explicitamente. Triggers impedem associar fornecedor a uma filial e transformar em filial uma matriz que tenha fornecedores vinculados; usam privilégios do chamador, sem SECURITY DEFINER.

O envio para fila usa a matriz explicitamente vinculada; não depende mais de vendedor ativo para determinar o destino. Pedidos já enfileirados preservam o destino e o snapshot originais. O envio direto existente para Olist continua com suas regras originais.

Aceite de UI: selecionar/editar e identificar a matriz na tabela; seletor em uma coluna no mobile, duas no desktop, área mínima de 44px e tabela com rolagem horizontal contida. Esta alteração de cadastro requer validação visual autenticada em ambos os contextos.

Validação do vínculo do fornecedor nesta entrega: migration aplicada no projeto Supabase e leitura posterior confirmou o fornecedor MV Tecidos com `aplicativo_pai_id = 00000000-0000-0000-0000-000000000002`, mantendo `aplicativo_id = 00000000-0000-0000-0000-000000000001`. Testes em transação com rollback no banco real rejeitaram filial como matriz, vínculo nulo e transformação da matriz vinculada em filial; aceitaram a matriz válida. A auditoria de segurança não apontou as novas funções. A migration SQL é idempotente para posterior sincronização com o histórico Prisma.

Criação e edição usam `POST /api/fornecedores/salvar`, que valida sessão, permissão de fornecedores, matriz selecionada e aplicativo de origem. A gravação usa o servidor para respeitar as restrições da tabela de aplicativos sem conceder acesso adicional ao navegador. Valores do enum de tipo de venda são traduzidos para os identificadores Prisma, preservando os valores comerciais existentes no banco.


A permissão `pode_gerenciar_fila_pedidos` inicia desabilitada e é configurável em Usuários, incluindo criação, edição e ações de ativar/desativar todas. Menu, tela, GET e PATCH da administração exigem essa permissão; Editar configurações isoladamente não concede acesso à fila. A permissão não autoriza administrar usuários nem criar pedidos na Olist.

## Revisão editável antes do envio

O diálogo possui duas etapas: selecionar fornecedor e revisar/editar o pedido. A prévia é calculada no servidor (`POST` com `acao: "preview"`), sem inserir na fila. A confirmação envia `dadosEditados` e `revisao` para a mesma API.

São editáveis tecido (somente materiais cadastrados para o fornecedor e aplicativo de origem), quantidade de peças, consumo de tecido em metros, estampa, variante opcional, laser, tamanho, tipo e observação. Quantidades em unidades e metros são independentes e os rótulos explicitam isso. Identificadores, SKU da solicitação, dados cadastrais do tecido e aplicativos são definidos no servidor. A edição não altera a produção original nem cria pedidos na Olist. A coleção de itens deve corresponder à solicitação; não é possível inserir/remover/trocar produtos pelo payload.

Um hash do snapshot e da matriz destinatária detecta alterações entre prévia e confirmação. Se a origem mudar, a API retorna 409 e exige recarregar os dados; o hash não substitui autorização, validação de produtos nem validação de tecido. Fornecedor diferente invalida a edição anterior; voltar sem trocar fornecedor mantém os valores. Falhas mantêm a edição, e a mensagem de erro recebe foco para ficar visível no conteúdo rolável.

Aceite: desktop em duas colunas e mobile em uma, ações em rodapé fixo dentro do diálogo, campos e botões com 44px, rolagem dos itens sem ocultar ações, foco no título da revisão/erro/sucesso e restauração ao fechar. Testes de API e de domínio cobrem preview sem gravação, edição persistida, isolamento, itens/tecidos inválidos, limites de entrada e revisão desatualizada. Navegador com componente/CSS reais e respostas fictícias cobre navegação entre etapas, edição, envio e erro preservando valores em 360/390px, além do desktop e tema escuro. Sessão autenticada e persistência real desse novo fluxo não foram testadas nesta etapa.

## Intervalo inicial de Solicitações cadastradas

Ao abrir a tela, os filtros de criação usam o dia atual no calendário de São Paulo e sete dias anteriores, com limites inclusivos (por exemplo 09/10/2026–16/10/2026). Os campos ficam visíveis e editáveis; limpar filtros remove o intervalo. Entrega e outros filtros continuam avançados. A seção de solicitações em produção não recebe esse filtro. Testes cobrem viradas de dia UTC e de ano; a consulta continua limitada ao conjunto carregado pela tela, conforme o aviso existente.
