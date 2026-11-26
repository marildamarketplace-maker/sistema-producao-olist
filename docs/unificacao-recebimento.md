# Unificação de formas de recebimento

O contrato corrente identifica `selecoes.recursoForma = "RECEBIMENTO"`. `formaId`
passa a identificar exclusivamente GET `/formas-recebimento`; `planoId` continua
sendo o plano local, vinculado por `forma_recebimento_olist_plano` e aplicativo.
`plano_pagamento` é compartilhada com fornecedores e permanece intacta.
Não existe conversão de IDs ou cópia das antigas associações de pagamento.

## Implantação em duas etapas

1. Faça backup verificável de `usuario`, `forma_pagamento_olist_plano`,
   `olist_sync_configuracao`, `olist_sync_cobertura` e snapshots/prévias/tentativas.
   Guarde também DDL, constraints/grants/policies da tabela antiga. Ensaie a restauração
   em ambiente isolado e registre versão do código e ponto de recuperação.
2. Aplique **somente** `20261125210000_permissao_recebimento` antes do código novo.
   Ela transfere por OR a permissão antiga para recebimento, sem ativar usuários
   inativos nem ampliar aplicativos. Não apaga associações ou a coluna anterior.
3. Refaça as associações em **Olist → Formas de recebimento**, na empresa correta.
   Confira forma ativa e os planos locais ativos para cada conta que receberá pedidos.
4. Publique a versão nova de app, APIs, workers e cron de forma coordenada.
   Retire deployments antigos, consumidores externos/scripts e clientes abertos
   que possam enviar o contrato antigo. Bloqueie tráfego para versões antigas.
   Novas execuções com configuração que ainda contém `FORMA_PAGAMENTO` são recusadas
   no repositório central, inclusive pelo agendamento. Execuções anteriores podem
   terminar no consumidor atual; histórico continua consultável, sem novas decisões.
5. Drene as execuções ativas. Não cancele cegamente operações com efeito remoto:
   concilie resultados inconclusivos primeiro. Confira reservas de pedidos existentes;
   seus payloads, históricos e IDs de tentativa não podem ser substituídos.
6. Execute a migration de contração `20261125211000_unificacao_recebimento`
   somente após comprovar esses critérios. Ela exige que a mesma sessão SQL tenha
   `SET app.unificacao_recebimento_pronta = 'sim'`. O gate não deve ser configurado
   em variáveis globais do banco, no pool ou automaticamente pelo deploy.
   Também aborta se houver execução ativa de sincronização, sem alterações parciais.
7. A contração remove pagamento de configurações persistidas, incrementa sua versão
   e invalida readiness/cobertura corrente. Configurações que ficariam vazias são
   desativadas para revisão. Revalide a prontidão e a cobertura antes de reativar.
   Só então são removidas a tabela exclusiva de associações de pagamento e a coluna
   de permissão antiga; não há `CASCADE`. Históricos criptografados mantêm entidade
   e contexto originais. Não executar `prisma migrate deploy` global: o repositório
   possui migrations antigas que ainda exigem reconciliação própria.

## Pedidos existentes

- Pendentes editáveis: o editor pede nova forma e plano de recebimento. Cliente,
  vendedor, itens, metragem e preços são preservados.
- Prévias antigas: rejeitadas antes da reserva/criação remota, mesmo com cliente antigo.
- Recuperação entre contas: recebimento usa o recurso correto e plano associado com
  nome e condições equivalentes. `olistAnterior` de pagamento nunca restaura IDs
  comerciais, nem via estados antigos de recuperação. Outros cadastros recuperam
  normalmente. A recuperação usa preço da nova conta e mantém apenas pendências.
- Confirmações de criação já aceitas: os contratos parciais antigos e o hash original
  continuam legíveis. A verificação de novo contrato ocorre depois da recuperação
  idempotente, para que uma repetição não gere outro pedido.
- Reservas/incertos e pedidos concluídos: preservados integralmente; a conciliação
  verifica a conta e o identificador da tentativa original antes de liberar reenvio.

## Recuperação da implantação

Antes do primeiro snapshot novo, a expansão de permissão é compatível com a versão
anterior. Depois de gerar dados de recebimento, não volte para código que interprete
`formaId` como pagamento. Prefira correção adiante ou build de recuperação que leia
ambos os contratos e bloqueie novos envios legados. Após a contração, uma restauração
exige DDL/dados/grants do backup e código compatível; restaurar só a tabela não basta.
Não reverta payloads conciliáveis, hashes de idempotência ou pedidos remotos criados.

## Limites e verificação

Consultas de formas são paginadas (50 por chamada), planos limitados (100 por forma)
e projetados para ID/nome. Recuperação mantém limites de tempo/chamadas existentes,
sem carregar catálogos completos. As associações são substituídas em transação com
lock por aplicativo, evitando mistura de duas gravações concorrentes. Autorização e
escopo de empresa permanecem no servidor. Não há medição de economia monetária.
Validação em navegador usa dados simulados e viewports, sem envio de pedido real.

Validação desta implementação: 257 testes de domínio/API, 4 testes no Chrome headless,
TypeScript, lint e build passaram. Os testes de navegador incluem 390px/1440px e ambos
os temas, com mocks, sem dispositivo físico ou pedido real. A suíte antiga
`tests/fila-olist-origem-api.test.ts` apresentou as mesmas falhas numa cópia isolada
específica do HEAD anterior (9 falhas), portanto não foi alterada neste escopo.
As migrations foram revisadas, mas não executadas nem ensaiadas em PostgreSQL local;
o ensaio e as verificações de produção continuam como gates antes da contração.
