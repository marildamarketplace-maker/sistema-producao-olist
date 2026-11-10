# Operação da Automatização

## Primeira implantação

1. Aplique a migration aditiva em homologação antes de publicar o ERP. Ela adiciona permissões desabilitadas por padrão. Conceda acesso de leitura e as permissões de escrita ou intervenção na administração de usuários.
2. Configure o WhatsApp e habilite `NOTIFICAR` para o aplicativo. O cron de agendamento usa `CRON_SECRET` e a mesma infraestrutura dos outros crons da Vercel.
3. Gere uma credencial aleatória de 256 bits por worker e mantenha a credencial bruta somente na VM. Na Vercel, configure `AUTOMATIZACAO_WORKERS` como uma lista JSON. Cada entrada contém `id` exclusivo, `aplicativoId` e `tokenSha256` em hexadecimal minúsculo. Cada credencial dá acesso somente ao aplicativo indicado e ao executor de prompts. Para revogar a credencial, retire a entrada e publique a configuração.
4. Na VM Linux, configure `AUTOMATIZACAO_ERP_URL` (HTTPS), `AUTOMATIZACAO_WORKER_TOKEN`, `CODEX_API_KEY` e `AUTOMATIZACAO_CODEX_VERSION` com a versão exata do CLI instalado. Use uma conta de serviço dedicada e armazene as variáveis em arquivo de ambiente acessível somente à conta do serviço. Rode `npm run worker:automatizacao` a partir do checkout com as dependências do projeto. Configure o serviço para reiniciar em falha e dar até seis minutos para encerramento gracioso.
5. Crie uma habilidade de teste e uma rotina com um horário próximo. Confira resultado, tentativa, transição de WhatsApp e recepção. Use dados sintéticos para verificar falha final, bloqueio do horário seguinte e reabertura da mesma execução. A tela de histórico distingue aceite da Z-API e falha de envio.

A fila faz uma reserva por vez, renova a cada 15 segundos e expira a reserva em 60 segundos. Os logs do worker registram duração e desfecho sem copiar prompt ou resultado. Monitore o atraso da fila comparando o instante atual com `disponivelEm` do trabalho elegível mais antigo. A hora da última tentativa e `reservaAte` ajudam no diagnóstico enquanto há trabalho reservado. O worker de prompts usa diretório temporário, chave de projeto e ferramentas desabilitadas.

## Piloto e corte de mockups

Use Linux x86 com 2 vCPUs e 4 GiB de RAM. Rode o piloto existente em um ambiente dedicado, com login do Codex para mockups e referências autorizadas.

```sh
/usr/bin/time -v npm run worker:mockups -- --piloto saida.webp modelo.png estampa.png
```

Registre pico de RAM, latência e qualidade visual em um conjunto representativo, incluindo layouts. Conte tentativas e créditos consumidos para estimar o custo por imagem aprovada. Valide a escrita e leitura no bucket privado de teste com o worker atual. O consumidor de mockups existente fica ativo até o aceite desse piloto e a integração do adaptador de imagem à fila comum.

No ensaio de corte, suspenda novas solicitações, pare o consumidor antigo e confira reservas e objetos privados já existentes. A migração deve enfileirar só as saídas faltantes. Teste um lote com trabalho concluído, um objeto gravado sem confirmação no banco e uma saída pendente. Confira o mesmo lote após o corte e ensaie o rollback conciliando objetos e resultados antes de religar o consumidor anterior.

## Retirada das tabelas de mídia

A retirada das rotas e o descarte físico são fases separadas. As permissões legadas continuam sendo usadas pelo Calendário Comercial e por Produtos e Mockups. Preserve essas permissões na remoção do schema de tarefas e categorias.

1. Na homologação, faça um inventário de FKs de entrada, views, funções, triggers, integrações e consumidores externos para `categorias_olist`, `tarefas_midia` e `ocorrencias_tarefas_midia`.
2. Exporte as três tabelas em formato restaurável do Postgres para armazenamento privado. Restaure em um banco isolado com os pré-requisitos do ERP e compare contagens, chaves e amostras.
3. Depois de publicar e validar a retirada das páginas e APIs, promova o SQL de `docs/migrations-condicionais/retirada-controle-midia.sql` a uma migration nova, junto à remoção de modelos, tipos e relações correspondentes no Prisma. O SQL exige que dependências remanescentes sejam resolvidas explicitamente. Preserve os arquivos históricos de migration.
