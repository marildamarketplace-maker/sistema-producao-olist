# Vendedor Olist por usuário e aplicativo

O vínculo comercial está em `usuario_vendedor_olist`, cuja chave é `(usuario_id, aplicativo_id)`.
Um usuário pode possuir um ID na conta própria e IDs diferentes nos filhos diretos.
IDs não são copiados entre contas. Mais de um usuário pode compartilhar o mesmo vendedor.
O vínculo identifica o vendedor em cada conta e restringe consultas de pedidos e contatos.
Não concede acesso à conta: permissões e escopo de empresas continuam obrigatórios.

## Fluxos e contratos

- APIs gerais Olist validam a permissão no servidor e usam a conta autorizada no fluxo.
  Esta refatoração do vendedor não adiciona um seletor geral de empresas; eventuais mudanças
  desse seletor são uma implementação independente no workspace compartilhado.
  Pedidos e contatos aplicam no servidor o vendedor vinculado à empresa selecionada.
  Usuário com vínculo em alguma empresa do grupo não consulta uma empresa sem vínculo.
  Detalhes e exportações de pedidos rejeitam vendedor diferente ou ausente; usuários
  sem nenhum vínculo no grupo mantêm as consultas gerais conforme suas permissões.
  A criação sugere o vínculo da conta própria, permite trocar o vendedor e pesquisa os clientes
  pelo vendedor selecionado.
- A fila continua usando a conta destinatária autorizada. Precedência: seleção salva no próprio
  pedido, vínculo do usuário logado na conta, seleção manual. Uma mudança de configuração ou
  refresh da sessão não altera o snapshot nem uma edição em andamento.
  Os destinos incluem o aplicativo próprio do fornecedor e seus filhos diretos. Assim, um
  fornecedor independente, sem filhos, também pode receber pedidos pela fila na própria conta.
  A seleção permanece explícita e exige as permissões existentes. Os campos técnicos
  `filialId`, `filiais` e `aplicativo_filial_id` são preservados por compatibilidade; nesses
  contratos, representam o aplicativo destinatário, que pode ser o próprio.
- O botão de envio direto foi retirado; `POST /api/fornecedores/enviar` responde `410`, não
  cria nem enfileira pedidos. `enviarFornecedor` permanece sendo utilizado pela fila.
- Cadastro de fornecedor aceita somente `id`, `aplicativo_pai_id`, `nome` e `endereco`.
  Configurações comerciais antigas são preservadas no banco, sem consumidores novos.
  `/api/fornecedores/aplicativos-pai` fornece ID/nome das matrizes; `/vendedores` é alias
  temporário sem consulta global de usuários ou formas de pagamento.
- `GET /api/usuarios?pagina=1&limite=50` retorna resumo paginado, com limite máximo de 100;
  ordenação por nome e ID. Detalhe e permissões: `GET /api/usuarios?usuarioId=<uuid>`.
  Opções do cadastro: `GET /api/usuarios?recurso=aplicativos` (próprio e filhos diretos).
- `POST /api/usuarios` aceita `vendedoresOlist: [{aplicativoId,vendedorOlistId}]`.
  `PATCH` aceita a coleção em `profile`, com `vinculosOlistVersao` lida no detalhe.
  Coleção omitida preserva; `[]` remove todos. A versão divergente retorna `409`.
  A versão é monotônica e pode avançar mais de uma unidade numa substituição.
  Operações de permissões não modificam vínculos.
- O formato antigo `vendedorOlistId` continua aceito para alterar somente a conta própria;
  nunca apaga os filhos. Não pode ser enviado junto da coleção.
- `/api/usuario/me` mantém `vendedorOlistId` como projeção de compatibilidade e oferece
  `vendedorOlist: {aplicativoId,vendedorOlistId} | null`. Esses valores são derivados da
  associação, não usados para autorizar. O fallback do browser não consulta a tabela privada
  e não exibe vendedor enquanto não houver confirmação pelo servidor.

## Publicação em etapas — não aplicar migrations globalmente

As etapas abaixo exigem publicação e aplicação isolada autorizadas. Preparar os arquivos e
passar em testes locais não significa que o banco ou a aplicação em produção foram alterados.
O schema Prisma descreve a aplicação final; as colunas legadas extras ficam temporariamente
no banco expandido. Não usar `db push` para removê-las nem executar `migrate deploy` global:
o histórico deste repositório tem migrations com decisões independentes pendentes.

1. **Pré-verificação:** inventariar usuários com ID inválido, escritores diretos das colunas
   antigas e `envio_fornecedor` sem `fila_id`. Identificar especialmente `RESERVADO` e `INCERTO`.
   Conferir essas tentativas na conta histórica; a conciliação da fila exige uma filial válida
   e não resolve automaticamente um envio antigo em conta diferente. Não mudar destino,
   liberar reserva ou repetir POST como estratégia de migração. Preservar payload e autoria.
2. **Expandir:** aplicar somente `20261124223231_usuario_vendedor_olist/migration.sql`.
   A transação aborta em ID inválido. A cópia é somente para `usuario.aplicativo_id`.
   A ponte SQL temporária `usuario -> usuario_vendedor_olist` mantém a linha própria quando
   uma instância antiga grava o escalar. Filhos não são afetados por esse escritor.
   RLS e revogação de grants impedem acesso público à tabela nova.
3. **Publicar código compatível:** a configuração padrão
   `OLIST_VENDEDORES_COMPAT_LEGADO=true` mantém escritas da conta própria pela ponte;
   filhos são escritos na tabela. Todas as leituras novas usam a associação.
   Testar uma conta comum e um usuário do pai com dois filhos, além do envio pela fila.
4. **Cortar escritores antigos:** retirar todas as instâncias e ferramentas antigas.
   Publicar `OLIST_VENDEDORES_COMPAT_LEGADO=false` em todas as instâncias novas.
   A aplicação passa a escrever somente na associação. Não voltar a executar uma versão
   que lê o escalar: a coluna antiga deixa de ser espelhada nesta etapa.
5. **Contrair:** com o corte confirmado e tentativas diretas incertas conciliadas, aplicar
   isoladamente `20261124230059_remove_usuario_vendedor_olist/migration.sql`. Esta migration
   substitui o antigo script manual `docs/sql/vendedor-olist-contracao.sql` e não deve ser
   aplicada junto da expansão ou por um deploy global. Ela remove somente a ponte e o
   escalar do usuário; preserva a associação normalizada, os campos do fornecedor,
   configurações comerciais, snapshots, históricos, autoria e pedidos. A coluna legada
   `fornecedores.vendedor_olist_id` fica preservada para uma limpeza independente.
   Continuar com a configuração `false`; reativar a ponte após a contração causará erro.

Antes da etapa 4 é possível retornar ao código anterior, mantendo o banco expandido.
Após a etapa 4, um rollback para código antigo exige restaurar primeiro o valor próprio do
escalar a partir da associação, sob janela coordenada de escrita. Não executar rollback
automático que restaure IDs antigos ou perca vínculos criados nos filhos.

## Concorrência, egress e validação

O cadastro usa lock do usuário e comparação de versão antes da escrita. Triggers validam a
hierarquia e atualizam a versão também para escritores antigos. Reparentamentos incompatíveis
são rejeitados até remover os vínculos. Consultas são parametrizadas; falha de banco não é
interpretada como ausência de vínculo.

A atomicidade é local ao banco da aplicação. Mudanças de nome/e-mail no Authentication são
operações externas: o precheck evita alterações inválidas conhecidas antes da chamada, mas
uma falha posterior do banco pode exigir conciliação do perfil entre os dois serviços. Não
manter transações abertas durante HTTP nem afirmar atomicidade distribuída.

O resolvedor faz uma consulta indexada, projetando apenas o ID do vendedor e verificando a
relação atual com a conta. Não adiciona chamadas Olist, polling, cache compartilhado ou coleção
de filhos a todas as autenticações. Detalhes são carregados sob demanda. A listagem de
vendedores é limitada à página remota e aos usuários efetivamente associados àquela conta.

Testes incluem PostgreSQL WASM descartável para expansão, ponte, hierarquia, RLS, revisão
otimista e contração; APIs com provedores simulados; e telas em viewports estreitas/largas.
Nenhum desses testes confirma aceitação de pedidos em produção nem equivale a dispositivo
mobile real. Consulte a entrega da implementação para os checks efetivamente executados.
