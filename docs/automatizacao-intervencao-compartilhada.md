# CAPTCHA, autenticação e retomada segura

Habilidade auxiliar: `Compartilhada | CAPTCHA, autenticação e retomada segura`.
Não necessita de rotina ou agenda própria. Não resolve CAPTCHA autonomamente.

## Fluxo

1. A rotina identifica o impedimento na interface e interrompe somente o canal afetado.
2. Preserva aba e sessão, registra ações confirmadas, pendências e envios incertos.
3. Prossegue em canais independentes e termina `BLOQUEADA` se houver pendência obrigatória.
4. O executor enfileira a notificação consolidada existente, com captura segura quando disponível.
5. O operador resolve o impedimento no mesmo navegador e usa **Retentar** no histórico.
6. A nova tentativa verifica conta, liberação e estado remoto dos itens antes de qualquer envio.

Não há espera ativa, resolução automática, nova agenda ou envio extra de WhatsApp.
A retomada é solicitada pelo operador; o agendador mantém suas regras existentes.
Não há garantia de execução exatamente uma vez em interfaces externas: submissões incertas
exigem reconciliação e permanecem pendentes quando a ausência não puder ser comprovada.

## Integração

`src/lib/automatizacao/intervencao-compartilhada.ts` contém o padrão seguro e o compositor.
Na reserva de trabalho, `fila.ts` lê a última versão não arquivada da habilidade auxiliar
do mesmo aplicativo. Ausência ou nomes duplicados usam o padrão local. Testes de rotina
mantêm o contrato `TESTE_ROTINA_OK`, sem habilidade auxiliar nem contexto histórico.
O compositor substitui a cópia distribuída e acrescenta o último relatório disponível da
mesma execução como dado histórico limitado a 8.000 caracteres. O relatório não é autorização
nem prova de persistência. O conteúdo da tarefa continua vinculado à versão da execução;
o módulo compartilhado é atualizado na reserva.

O editor de habilidades já possui autorização e versionamento. Nenhuma alteração de schema
ou permissão é necessária. O módulo é instrução para o agente, não um detector determinístico
nem uma barreira de segurança no nível das ferramentas.

## Instalação e compatibilidade

`node --import tsx scripts/instalar-habilidade-intervencao.ts UUID_DO_APLICATIVO` gera SQL
revisável, sem executar banco ou ler credenciais. A instalação usa transação, lock por aplicativo
e locks das habilidades, preserva versões anteriores e não altera rotinas, agendas ou execuções.
Uma segunda aplicação sem alterações não cria versões extras.

Para o executor já publicado, o instalador acrescenta uma cópia versionada às habilidades
ativas existentes que ainda não possuem o marcador. Não atualiza cópias já distribuídas:
para evoluções posteriores, publique o carregamento centralizado ou distribua nova versão
explicitamente. Habilidades acima do limite de 32.000 caracteres são ignoradas e precisam
de revisão. Verifique as versões e a cobertura após instalar.

Em 14/11/2026, foi cadastrada a habilidade auxiliar no aplicativo Meury Shop e distribuída
às sete habilidades ativas, com leitura posterior para confirmar conteúdo e cobertura.
Isso afeta execuções criadas com as novas versões; não modifica execuções já enfileiradas.
O carregamento centralizado e o contexto anterior dependem da publicação do código do ERP.
Não exigem mudança de contrato ou atualização do worker.

## Validação

Testes cobrem composição e substituição do módulo, limite e natureza histórica do contexto,
seleção por aplicativo, fallback em ambiguidade, retomada com relatório anterior, bloqueio e
deduplicação de notificações. Não foi executada uma rotina comercial nem testado um CAPTCHA
real. O envio real de evidências e a retomada após intervenção na VM não foram validados aqui.
