# Pesquisa guiada de estampas no WhatsApp — piloto

Importe `workflow.json` no n8n. O arquivo fica inativo e exige configuração; não houve publicação, alteração da aplicação, banco do ERP ou envio de mensagens reais.

## Conversa

1. Usuário envia **pesquisar estampas** (ou **pesquisar**).
2. Bot pergunta tema/motivo, cores, estilo e linguagem visual.
3. Usuário escolhe todos os critérios obrigatórios, tema obrigatório com demais preferenciais, ou todos preferenciais. Havendo preferências, informa correspondência mínima de 1 a 100.
4. Bot mostra resumo; usuário responde **confirmar**.
5. Bot entrega link para `/controle-midia/estampas` com os critérios preenchidos. A tela faz a pesquisa após autenticação, conforme o código local.

Comandos: `pular` para critérios opcionais; `voltar` para corrigir; `cancelar`; `reiniciar`. Pelo menos um critério precisa estar preenchido. Cores são separadas por vírgulas, máximo dez; modo de cores TODAS. Não há interpretação por IA nem custo de modelo. Não inventa classificação: estilo e linguagem devem ser escolhidos nas listas do sistema.

## Configuração no n8n

1. Crie uma **Data Table** `meury_pesquisa_estampas` no projeto do workflow, com colunas **key** e **state**, ambas String. Selecione essa mesma tabela nos nós **Ler conversa** e **Salvar conversa**. A tabela é interna ao n8n; não usa o banco do sistema Meury.
2. No nó **Configurar piloto**, preencha `instanceId`, `instanceApi` (`https://api.z-api.io/instances/ID/token/TOKEN`), `webhookSecret` (aleatório, ao menos 32 caracteres) e `allowedPhones` (lista de números de teste autorizados, somente dígitos com DDI).
3. Crie credencial **Header Auth** com nome `Client-Token` e valor do token de segurança Z-API. Selecione-a no nó **Responder via Z-API**. A URL da instância contém um segredo por contrato da Z-API: proteja o acesso ao editor, não compartilhe exports preenchidos e não registre URLs completas.
4. Configure **processamento sequencial**, obrigatório para este piloto. Em n8n self-hosted com uma única instância em regular mode, configure `N8N_CONCURRENCY_PRODUCTION_LIMIT=1` e reinicie pelo seu processo habitual. O limite abrange a instância inteira, podendo atrasar outros workflows. Não combine testes manuais e execuções de produção simultaneamente. No Cloud, **não marque a opção como confirmada apenas por estar no plano Starter**: é necessário assegurar serialização por uma fila/controle externo, ou adaptar a persistência para transações com bloqueio por conversa antes de ativar. Data Table Get + Upsert não é um bloqueio atômico.
5. Só depois dessa configuração, marque `serialProcessingConfirmed: true` no nó **Configurar piloto**. O workflow recusa execução com configuração incompleta.
6. Copie a **Production URL** do webhook e acrescente `?key=SEU_SEGREDO`. Configure-a como webhook **Ao receber** na Z-API. Isso utiliza o segredo na URL como autenticação compartilhada; não comprova origem por assinatura. Preserve a query no proxy e redija-a dos logs. Não substitua um webhook existente sem revisar o fluxo atual: para compartilhar a instância, encaminhe os eventos pelo receptor já usado ou utilize instância dedicada.
7. Ative e teste somente os números autorizados. O workflow não está conectado às suas contas automaticamente.

## Segurança, entrega e limites

- Sessão isolada por `instanceId:phone`, com expiração lógica de 30 minutos. Grupos, mensagens próprias, edições, canais, mensagens vazias e remetentes fora da lista são ignorados. São aceitas apenas mensagens de texto.
- Guarda os últimos 100 IDs por conversa para evitar avanço duplicado, dentro da exigência de processamento sequencial. O estado é salvo **antes** do envio. Se o envio falhar, o estado permanece avançado e repetir o mesmo evento não reenviará a mensagem. Recuperação do piloto: envie `voltar` ou `reiniciar`; para entrega garantida em produção, implementar outbox, retries controlados e bloqueio transacional. Um timeout após a aceitação pela Z-API deixa a entrega incerta.
- HTTP 2xx sem identificador não comprova envio: o nó final exige `zaapId`, `messageId` ou `id`. Não há retry automático que possa duplicar respostas.
- O webhook responde imediatamente para não provocar reentregas por demora; falhas posteriores precisam de monitoramento no n8n. O artefato não inclui serviço externo de alertas.
- Histórico de dados de execução é desabilitado no JSON; execuções manuais ainda podem expor dados durante o teste. A tabela contém telefone na chave e critérios no estado. Apague linhas inativas após o piloto ou configure limpeza periódica conforme sua política: a expiração lógica não remove fisicamente a linha. Restrinja acesso ao projeto do n8n.
- O link contém somente filtros; nunca contém telefone, credencial do sistema ou token de login. O usuário precisa de conta e permissão na Meury. Para usuário deslogado, o comportamento de preservar o link após login ainda precisa ser validado no ambiente publicado.
- A aplicação local já lê os parâmetros. Não foi possível confirmar a versão publicada ou validar a interface autenticada; pode ser necessário publicar alterações anteriores da pesquisa caso ainda não estejam em produção.

## Validação e manutenção

Código da conversa separado de persistência e HTTP para testes, sem introduzir dependências no ERP. Para regenerar o JSON depois de editar `conversa.mjs` ou o gerador:

```sh
node integrations/n8n/pesquisa-estampas/gerar-workflow.mjs
node --import tsx --test tests/n8n-pesquisa-estampas.test.ts tests/preferencias-estampas.test.ts tests/pesquisa-estampas-profissional.test.ts
```

Testes locais verificam conversa, validação, replay, expiração, comandos, filtros e contrato das opções com a tela. O JSON usa nós oficiais Webhook, Code, Data Table e HTTP Request, conforme os parâmetros do código-fonte atual do n8n. Importação e execução na versão da sua conta ainda não foram validadas.

Aceite do piloto no WhatsApp: iniciar, corrigir um critério, cancelar/reiniciar, confirmar, receber link; repetir um evento sem avançar e verificar isolamento com dois números, sempre sequencialmente. Aceite web em desktop (1280–1440px) e mobile (360–390px): abrir o link estando conectado, conferir filtros e resultados, editar filtro e pesquisar novamente. Validar também usuário deslogado e sem permissão. Esses checks no navegador/dispositivo real permanecem pendentes.

Referências oficiais:

- [Data Table n8n](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.datatable/)
- [Concorrência self-hosted](https://docs.n8n.io/hosting/scaling/concurrency-control/)
- [Configurar webhook Ao receber](https://developer.z-api.io/webhooks/on-message-received)
- [Payloads Z-API](https://developer.z-api.io/webhooks/on-message-received-examples)
