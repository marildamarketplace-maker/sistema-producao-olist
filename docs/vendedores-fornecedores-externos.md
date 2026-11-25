# Vendedores e pedidos de aplicativos clientes

O cliente cadastra a matriz fornecedora em `fornecedores`. A matriz pode configurar
vendedores dos usuários daquele cliente para a própria conta e suas filiais diretas.
Isso não muda o aplicativo do usuário nem permite alterar sua conta, senha ou permissões.
Quando o aplicativo cliente é uma filial da própria matriz fornecedora, seus usuários
podem receber vínculos externos na matriz e nas filiais irmãs. A conta própria do
cliente e seus filhos diretos continuam sob gestão nativa: não aparecem nas opções
externas, mesmo sem vendedor cadastrado, e o banco impede sobrepor ou converter
um vínculo nativo em externo. Encerrar o fornecedor preserva os vínculos nativos.

## Fluxo

- A página Usuários mantém a administração local e acrescenta a seção paginada
  **Usuários de aplicativos clientes**. A API `/api/usuarios/clientes` exige
  administrador ativo da matriz e `podeEditarConfiguracao`. O DTO externo não expõe
  e-mail, permissões ou vínculos de outros fornecedores.
- A confirmação seleciona explicitamente as empresas. A versão do usuário protege
  a edição; a revisão de cada vínculo protege prévias contra alteração/revogação.
  Salvar sem mudar uma empresa não invalida sua revisão.
  O detalhe externo lê identidade, vigência, versão e vínculos na mesma transação
  `REPEATABLE READ` (espera máxima de 5 s e duração de 10 s), evitando combinar
  vínculos antigos com a versão de uma edição concorrente. Salvar um detalhe
  anterior a outra edição retorna conflito e preserva a confirmação mais recente.
  Novas revisões usam também o contador persistente do usuário, protegido por lock.
  Excluir e recriar um vínculo nativo com o mesmo vendedor, inclusive em lotes na
  mesma transação, não recupera a revisão de uma prévia/proveniência antiga.
  O protocolo nativo mantém exclusão e inserção em statements separados sob o
  lock do usuário; o trigger que versiona cada statement conserva a geração
  entre eles, sem acrescentar campo ao contrato público.
- Criar pedido na fila permite selecionar uma matriz fornecedora ativa como referência.
  Referência e destino exigem vendedor confirmado, com carteira filtrada. Sem vínculo,
  o fluxo externo fica bloqueado; não há fallback para consulta geral.
- O pedido continua `MANUAL`, com autor e aplicativo solicitante do cliente,
  fornecedor cadastrado e matriz destinatária do fornecedor. Suas regras decidem
  a conta Olist final. O despacho usa `EnvioPedidoManual`, sem inventar solicitação
  de produção. O autor consulta o comprovante, mas não recebe gestão da fila externa.
- Trocar referência limpa os IDs comerciais dependentes, preservando itens livres
  e observação. IDs iguais em empresas distintas não comprovam identidade.

## Encerramento e histórico

`DELETE /api/fornecedores/salvar` encerra logicamente o cadastro e preserva suas
referências. Repetir o encerramento é idempotente. Alterar a matriz encerra o registro
anterior e cria outro, sem transportar IDs comerciais entre contas. A UI permite
consultar cadastros encerrados, que não entram nas opções de novas operações.

Encerrar o último cadastro ativo do par cliente/matriz revoga seus vendedores externos
na mesma transação. Cadastros duplicados ativos mantêm a relação vigente. Recadastrar
o fornecedor não reativa vendedores: é preciso confirmá-los novamente por empresa.
Vínculos internos e de outros fornecedores ficam preservados.

O banco serializa cada par por `fornecedor_relacao_bloquear`, inclusive na ausência
de registros. APIs obtêm esse lock antes dos usuários e das contas/fila; triggers
protegem os invariantes e a revogação também contra escritores internos. A mutação de
cadastro limita espera de lock a 5 s e statement a 10 s, com transação de até 15 s.
Uma operação que exceda o prazo falha integralmente; não confirma encerramento parcial.
Não se mediu o volume real em produção: medir duração/contagem antes de operações em
grande escala e usar manutenção durável em lotes se os limites deixarem de atender.

Na produção, snapshots novos registram origem `VINCULO` com usuário/conta/revisão ou
`MANUAL` após escolha explícita. Pendências antigas sem origem exigem revisão manual;
prévia antiga sem proveniência é rejeitada. A origem vinculada é revalidada na reserva.
O fornecedor pode optar explicitamente por uma seleção comercial manual na revisão.

O ponto de corte é a autorização da reserva durável. Revogar antes da reserva bloqueia
novo despacho; uma reserva anterior pode concluir mesmo que o HTTP comece depois.
Nunca manter transação aberta durante HTTP. Encerramento/revogação não libera
`RESERVADO`/`INCERTO`, não repete POST e não impede conciliar resultados históricos
na conta autorizada da tentativa.

## Aplicação e publicação coordenadas

Esta implementação não aplica migrations nem publica automaticamente.

1. Conferir o estado das migrations anteriores, especialmente a normalização de
   vendedores e a fila manual. Não executar `db push` nem `migrate deploy` global
   para aplicar este escopo: há decisões independentes no histórico do repositório.
2. Validar em banco descartável a migration
   `20261125183000_vendedores_fornecedores_externos/migration.sql`. Ela acrescenta
   estado de fornecedor, proveniência/revisão, índices e constraints, substitui
   triggers e retira DML direto de `PUBLIC`, `anon` e `authenticated` em fornecedores.
   Preserva leitura autorizada e a privacidade da tabela de vendedores.
3. Em janela coordenada de manutenção, impedir novas operações do fluxo, aplicar
   somente a migration autorizada e publicar todos os consumidores compatíveis.
   Retirar instâncias antigas e instruir recarga das abas antigas antes de liberar
   a configuração de vendedores externos. O DELETE antigo do navegador deixará
   de funcionar após a revogação de grants; a UI nova usa a API autorizada.
4. Não permitir coexistência em escrita após liberar vínculos externos: versões
   antigas podem apagá-los ou interpretar revogados como ativos. Conferir a versão
   ativa de todas as instâncias antes de encerrar a manutenção.
5. Validar com contas de teste autorizadas o cadastro, confirmação, pedido externo,
   revisão e encerramento. Validar localmente não comprova aceite real da Olist.

Rollback exige manter os fluxos externos bloqueados e preservar snapshots, vínculos
e reservas. Não voltar a leitores/escritores antigos com vínculos externos já criados
nem remover os campos novos automaticamente. Conciliar tentativas incertas antes
de qualquer nova tentativa ou mudança operacional que afete seu destino.

## Validação local

Os testes cobrem APIs com provedores simulados, migrations/constraints/triggers com
PGlite e interação no Chrome em viewports mobile/desktop e ambos os temas. Esses
testes não usam integrações reais nem equivalem a teste em dispositivo físico.

A suíte `tests/vendedores-fornecedores-concorrencia.test.ts` exige PostgreSQL real
isolado: variável **exclusiva de teste** `VENDEDORES_CONCURRENCY_TEST_DATABASE_URL`,
host `localhost`/`127.0.0.1` e banco vazio `vendedores_test_concurrency[_sufixo]`.
Não reutilizar URLs/credenciais do banco da aplicação. As barreiras verificam espera
real entre sessões para exclusões duplicadas, encerramento/salvamento, recadastro e
reparentamento. PGlite não comprova esse protocolo de concorrência. Se a suíte for
omitida por falta desse ambiente, a liberação em produção permanece condicionada
à sua execução bem-sucedida.

Use `pnpm exec tsc --noEmit`, `pnpm exec eslint <arquivos>` e os testes relacionados
com `pnpm exec node --import tsx --test ...`, além de `pnpm build`. Se o lançador não
conseguir verificar a versão configurada do gerenciador, não desative a verificação
de assinatura: os binários locais instalados podem validar o código, registrando
essa limitação e mantendo o lockfile intacto.

As listagens externas usam projeção mínima, página padrão 50/máximo 100 e detalhe
sob demanda. Opções de contas são limitadas; pesquisas Olist consultam só a conta
selecionada. Há consultas adicionais pequenas de vigência/revisão em operações
protegidas, sem polling ou varredura recorrente. Custos e volume real não foram medidos.
