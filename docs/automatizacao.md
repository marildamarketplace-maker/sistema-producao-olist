# Operação da Automatização

## Primeira implantação

1. Aplique a migration aditiva em homologação antes de publicar o ERP. Ela adiciona permissões desabilitadas por padrão. Conceda acesso de leitura e as permissões de escrita ou intervenção na administração de usuários.
2. Configure o WhatsApp e habilite `NOTIFICAR` para o aplicativo. O cron de agendamento usa `CRON_SECRET` e a mesma infraestrutura dos outros crons da Vercel.
3. Gere uma credencial aleatória de 256 bits por worker e mantenha a credencial bruta somente na VM. Na Vercel, configure `AUTOMATIZACAO_WORKERS` como uma lista JSON. Cada entrada contém `id` exclusivo, `aplicativoId` e `tokenSha256` em hexadecimal minúsculo. Cada credencial dá acesso somente ao aplicativo indicado e ao executor de prompts. Para revogar a credencial, retire a entrada e publique a configuração.
4. Na VM Linux, configure `AUTOMATIZACAO_ERP_URL` (HTTPS), `AUTOMATIZACAO_WORKER_TOKEN` e `AUTOMATIZACAO_CODEX_VERSION` com a versão exata do CLI instalado. Use uma conta de serviço dedicada e armazene as variáveis em arquivo de ambiente acessível somente à conta do serviço. Rode `npm run worker:automatizacao` a partir do checkout com as dependências do projeto. Configure o serviço para reiniciar em falha e dar até seis minutos para encerramento gracioso.
5. Crie uma habilidade de teste e uma rotina com um horário próximo. Confira resultado, tentativa, transição de WhatsApp e recepção. Use dados sintéticos para verificar falha final, bloqueio do horário seguinte e reabertura da mesma execução. A tela de histórico distingue aceite da Z-API e falha de envio.

A fila faz uma reserva por vez, renova a cada 15 segundos e expira a reserva em 60 segundos. Os logs do worker registram duração e desfecho sem copiar prompt ou resultado. Monitore o atraso da fila comparando o instante atual com `disponivelEm` do trabalho elegível mais antigo. A hora da última tentativa e `reservaAte` ajudam no diagnóstico enquanto há trabalho reservado. O worker de prompts usa diretório de trabalho temporário e ferramentas desabilitadas. A autenticação é exclusivamente ChatGPT (`forced_login_method="chatgpt"`), usando a sessão persistida em `CODEX_HOME` ou `~/.codex` do usuário do serviço. API keys não são encaminhadas. O consumo segue os limites da assinatura. Faça `codex login --device-auth` e `codex login status` como o mesmo usuário do serviço antes de iniciar. Proteja o diretório de credenciais e não compartilhe `auth.json`. A sessão pode expirar e exigir novo login.

## Piloto e corte de mockups

O botão **Testar rotina** agora enfileira a habilidade real como `EXECUTAR_PROMPT`,
inclusive para rotinas pausadas, sem ativar ou alterar o calendário. Usa a versão
mais recente da habilidade e o fluxo normal de histórico e notificações. Reutiliza
execução não concluída e exige retry pelo Histórico após falha final. Os antigos
registros `TESTE_ROTINA` permanecem diagnósticos sintéticos. O executor de prompts
mantém shell desabilitado; o acesso ao browser exige a configuração abaixo.

## Browser no worker Ubuntu

Integração opcional por Playwright MCP via STDIO, sem porta pública. Mantém o
MCP local com `default_tools_approval_mode="approve"` somente para a lista
explícita de ferramentas de navegação e interação. A política global continua
`approval_policy="never"`; não habilite aprovações globais nem shell para resolver
bloqueios de ferramentas. O operador autoriza as ações ao cadastrar/disparar a
habilidade; esse modo pode realizar alterações externas sem confirmação por clique.
Mantém o
login ChatGPT do CLI e um perfil Chromium persistente por aplicativo. Não acessa
automaticamente as janelas ou sessões do Firefox já instalado. Use apenas um
worker por perfil e um usuário Ubuntu dedicado por aplicativo. O MCP é um
processo confiável com acesso à rede e ao usuário do serviço; o modo read-only
do Codex não isola o MCP. Não dê sudo ao processo. Páginas não são instruções
confiáveis. Não há garantia de efeito externo exatamente uma vez: após queda
da VM/perda de reserva, concilie o marketplace antes de reabrir a execução.

Instale como `operador`, fora do ERP, com versão resolvida gravada no lockfile:

```sh
mkdir -p ~/.local/share/meury-browser
cd ~/.local/share/meury-browser
npm init -y
npm install --save-exact @playwright/mcp
node node_modules/playwright/cli.js install chromium
```

Se faltarem bibliotecas do sistema, um administrador deve executar
`sudo node /home/operador/.local/share/meury-browser/node_modules/playwright/cli.js install-deps chromium`.
O worker nunca instala pacotes em tempo de execução. Preserve package-lock.json;
use `npm ci` para reinstalar a mesma versão.

Adicione ao arquivo privado `~/.config/meury-worker/worker.env`:

```dotenv
AUTOMATIZACAO_BROWSER_ENABLED=true
AUTOMATIZACAO_BROWSER_MCP_CLI=/home/operador/.local/share/meury-browser/node_modules/@playwright/mcp/cli.js
AUTOMATIZACAO_BROWSER_PROFILE=/home/operador/.local/share/meury-browser/profile
AUTOMATIZACAO_BROWSER_HEADLESS=false
DISPLAY=:0
XAUTHORITY=/home/operador/.Xauthority
```

Confirme `DISPLAY` e `XAUTHORITY` no terminal da sessão XFCE; ajuste os caminhos
caso sejam diferentes. O worker inicia o MCP por execução, que abre a janela
quando a primeira ferramenta de navegação for chamada. Para autenticar antes,
pare o worker e, no terminal gráfico, abra o mesmo perfil:

```sh
node ~/.local/share/meury-browser/node_modules/playwright/cli.js open --browser chromium --user-data-dir ~/.local/share/meury-browser/profile https://seller.shopee.com.br
```

Faça login, feche essa janela e inicie o worker normalmente. Para operação sem
interface, use `AUTOMATIZACAO_BROWSER_HEADLESS=true`. Sessões ficam no perfil;
CAPTCHA/MFA precisam de intervenção. Preserve Chromium sandbox, sem `--no-sandbox`.
Timeout de browser: 15 minutos. Não configure systemd para encerrar uma execução
em andamento antes disso se deseja parada graciosa.

`concluida=false` é falha final com a pendência no Histórico. Erros de browser
não geram retentativa automática; erros de autenticação do Codex mantêm o
executor indisponível. O shell, JavaScript arbitrário no browser e upload local
permanecem desabilitados. Publicação de vídeos exige uma entrega própria para
acesso controlado a arquivos e compactação; habilitar browser não cobre isso.
Valide primeiro uma habilidade de navegação somente leitura e depois o piloto
real com uma conta. Não marque as quatro rotinas ativas apenas por este ajuste.

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
