# Operação da Automatização

## Agendas semanais e mensais

Cada horário usa `{ "dia": 0..6, "hora": "HH:mm" }` para a semana (domingo = 0)
ou `{ "diaMes": 1..31, "hora": "HH:mm" }` para execução mensal. Os dois campos de
dia não podem coexistir no mesmo horário. Datas e horas usam `America/Sao_Paulo`.
Dias inexistentes são ignorados, sem antecipação: dia 31 não executa em fevereiro.
Agendas semanais existentes permanecem compatíveis e não há mudança de schema.

A tela de rotinas permite selecionar a frequência por horário. A API valida
criação, edição e ativação com o contrato compartilhado. A proteção de 15 minutos
considera viradas de mês e semana; ao comparar mensal com semanal, protege qualquer
dia da semana em que a data mensal possa cair. Isso pode reservar o mesmo horário
semanal em outros meses, evitando uma colisão futura.

O agendador reutiliza a fila, os locks, a versão da habilidade e o histórico existentes.
Mantém a janela de recuperação de 15 minutos: indisponibilidade maior no horário
agendado exige conferir o histórico e executar manualmente se necessário. Não há
polling novo nem consultas adicionais por rotina; o payload acrescenta apenas o
campo de dia mensal em substituição ao dia semanal.

Critérios de interface: escolher frequência e dia, preservar a hora ao alternar,
salvar/editar e identificar o calendário no cartão em desktop e mobile. Verificar
foco de teclado, controles de toque, erro recuperável, textos longos e ambos os temas.

## Intervalo entre rotinas

O cadastro, a edição e a ativação recusam intervalos menores que 15 minutos,
no calendário semanal de São Paulo, inclusive na passagem da meia-noite e da
semana. Exatamente 15 minutos é permitido. A comparação considera os próprios
horários e as outras rotinas ativas não arquivadas do mesmo aplicativo, excluindo
a rotina em edição. Rotinas pausadas não reservam horário, mas seu cadastro e
edição também são conferidos contra as ativas; ativá-las exige nova conferência.
Pausar ou arquivar continua permitido mesmo se houver conflitos legados.

A API mantém autorização e revisão otimista e serializa as gravações de rotinas
por aplicativo com lock transacional. Escritas diretas no banco não passam por
essa validação. O intervalo é entre inícios previstos e não garante que uma
execução longa termine antes da próxima.

Critérios de aceite desktop (1280–1440px) e mobile (360–390px): localizar a regra
junto aos horários, preencher o formulário, receber mensagem com a rotina e o
horário conflitantes sem perder os campos, corrigir para pelo menos 15 minutos
e concluir o salvamento. Mensagens usam o feedback com `role="alert"` existente,
sem nova largura fixa ou alteração de controles. A validação automatizada cobre
os limites de horário e os fluxos da API; a conferência visual, teclado, toque e
os dois temas deve ser executada no ambiente de homologação.

## Primeira implantação

1. Aplique a migration aditiva em homologação antes de publicar o ERP. Ela adiciona permissões desabilitadas por padrão. Conceda acesso de leitura e as permissões de escrita ou intervenção na administração de usuários.
2. Configure o WhatsApp e habilite `NOTIFICAR` para o aplicativo. O cron de agendamento usa `CRON_SECRET` e a mesma infraestrutura dos outros crons da Vercel.
3. Gere uma credencial aleatória de 256 bits por worker e mantenha a credencial bruta somente na VM. Na Vercel, configure `AUTOMATIZACAO_WORKERS` como uma lista JSON. Cada entrada contém `id` exclusivo, `aplicativoId` e `tokenSha256` em hexadecimal minúsculo. Cada credencial dá acesso somente ao aplicativo indicado e ao executor de prompts. Para revogar a credencial, retire a entrada e publique a configuração.
4. Na VM Linux, configure `AUTOMATIZACAO_ERP_URL` (HTTPS), `AUTOMATIZACAO_WORKER_TOKEN` e `AUTOMATIZACAO_CODEX_VERSION` com a versão exata do CLI instalado. Use uma conta de serviço dedicada e armazene as variáveis em arquivo de ambiente acessível somente à conta do serviço. Rode `npm run worker:automatizacao` a partir do checkout com as dependências do projeto. Configure o serviço para reiniciar em falha e dar até seis minutos para encerramento gracioso.
5. Crie uma habilidade de teste e uma rotina com um horário próximo. Confira resultado, tentativa, transição de WhatsApp e recepção. Use dados sintéticos para verificar falha final restrita ao próprio horário, execução do horário seguinte e reabertura da mesma execução. A tela de histórico distingue aceite da Z-API e falha de envio.

A fila faz uma reserva por vez, renova a cada 15 segundos e expira a reserva em 60 segundos. Os logs do worker registram duração e desfecho sem copiar prompt ou resultado. Monitore o atraso da fila comparando o instante atual com `disponivelEm` do trabalho elegível mais antigo. A hora da última tentativa e `reservaAte` ajudam no diagnóstico enquanto há trabalho reservado. O worker de prompts usa diretório de trabalho temporário e ferramentas desabilitadas. A autenticação é exclusivamente ChatGPT (`forced_login_method="chatgpt"`), usando a sessão persistida em `CODEX_HOME` ou `~/.codex` do usuário do serviço. API keys não são encaminhadas. O consumo segue os limites da assinatura. Faça `codex login --device-auth` e `codex login status` como o mesmo usuário do serviço antes de iniciar. Proteja o diretório de credenciais e não compartilhe `auth.json`. A sessão pode expirar e exigir novo login.

## Diagnóstico de falhas do worker

`FINALIZADA` indica que o resultado foi registrado; confira `desfecho` para saber
se houve sucesso. `PROVIDER_TEMPORARY_ERROR` é uma classificação genérica do
executor e não comprova indisponibilidade do provedor. Com browser habilitado,
uma falha técnica continua terminal: não repetimos automaticamente uma ação no
marketplace cujo efeito pode ter ocorrido antes da falha.

O worker registra `FALHA_API_FILA` com ação, status HTTP, duração, formato da
resposta e identificador Vercel quando reconhecido. Distingue 401, 403, 409,
falhas de transporte e JSON inválido, inclusive durante o heartbeat. Nenhuma
resposta de erro, URL, token, reserva ou corpo de requisição é copiado ao log.
O campo `desafioVercel` indica apenas se o cabeçalho de desafio foi recebido;
sua ausência não exclui outros bloqueios de acesso.

Falhas do subprocesso geram `FALHA_EXECUTOR`, com código, motivo reconhecido,
código de saída e sinal quando disponíveis. O histórico recebe uma descrição
fixa e o WhatsApp um resumo legível. Há distinção entre MCP indisponível, schema
recusado, DNS, conexão, certificado, timeout e interrupção por reserva. Essa
classificação usa padrões da saída, não comprova causa raiz; erros desconhecidos
continuam explicitamente não classificados. A saída bruta é descartada porque
pode conter prompts, dados de páginas e credenciais.

Para investigar uma falha nova, correlacione `FALHA_EXECUTOR` com os eventos
`FALHA_API_FILA` e a tentativa no ERP. O primeiro heartbeat ocorre em 15 segundos,
enquanto a reserva vale 60 segundos; uma recusa de posse/autorização interrompe
imediatamente, e erros de transporte mantêm as tentativas dentro do prazo.
Os “OK” do `iniciar-worker.sh` validam dependências e evidências, sem comprovar
conectividade Codex/MCP. Confira também o serviço do navegador na VM; não basta
reinstalar dependências. Um aviso de URI externa não suportada no desktop precisa
ser correlacionado com a falha, não presumido como causa do executor.

Esta melhoria exige atualizar e reiniciar o worker na VM. Não exige migration
nem alteração do contrato da API; não recupera detalhes descartados das tentativas
antigas. Não acrescenta chamadas à API/banco, polling nem retries. Acrescenta apenas
metadados curtos em falhas e um texto curto ao resultado já persistido/notificado.
Validação local com requisições e subprocessos simulados não comprova o fluxo
real na VM. Antes de retentar uma rotina, confira possíveis efeitos parciais no
marketplace.

## Piloto e corte de mockups

O botão **Testar rotina** agora enfileira a habilidade real como `EXECUTAR_PROMPT`,
inclusive para rotinas pausadas, sem ativar ou alterar o calendário. Usa a versão
mais recente da habilidade ao criar uma execução e o fluxo normal de histórico e
notificações. Não há limite diário. Após falha final, o botão reabre a mesma execução
com a versão original, preservando tentativas e incrementando a rodada. Se estiver
pendente ou aguardando retry, antecipa sua disponibilidade para agora. Se estiver
executando, informa isso sem iniciar outro processo em paralelo. Os antigos
registros `TESTE_ROTINA` permanecem diagnósticos sintéticos. O executor de prompts
mantém shell desabilitado; o acesso ao browser exige a configuração abaixo.

## Browser no worker Ubuntu

O worker registra `AGUARDANDO_TAREFA`, `INICIANDO_CODEX`, `EXECUTANDO`,
`REGISTRANDO_RESULTADO`, `FINALIZADA` e perda de reserva. Durante a execução,
registra a etapa e o nome da rotina a cada 30 segundos com reserva renovada.
Esses registros confirmam a atividade do worker, não o avanço das ações do
modelo no site. Não incluem prompt, resultado, token de reserva ou credenciais.
O nome vem da API atualizada; workers novos continuam compatíveis com API antiga,
usando um nome genérico até a publicação do ERP.

Integração opcional por Playwright MCP, sem porta pública. O modo recomendado
usa um Chromium independente e um serviço MCP HTTP local que se conecta por CDP;
o STDIO anterior
permanece como compatibilidade e encerra seu navegador junto com cada Codex.
Mantém o
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

Crie `~/.config/meury-worker/browser.env`, com permissão 600, sem tokens do ERP:

```dotenv
AUTOMATIZACAO_BROWSER_ENABLED=true
AUTOMATIZACAO_BROWSER_MCP_CLI=/home/operador/.local/share/meury-browser/node_modules/@playwright/mcp/cli.js
AUTOMATIZACAO_BROWSER_PROFILE=/home/operador/.local/share/meury-browser/profile
AUTOMATIZACAO_BROWSER_HEADLESS=false
DISPLAY=:0
XAUTHORITY=/home/operador/.Xauthority
```

Confirme `DISPLAY` e `XAUTHORITY` no terminal da sessão XFCE; ajuste os caminhos
caso sejam diferentes. Na primeira transição, pare o worker e feche uma única
vez o Chromium antigo aberto pelo comando `playwright open`, para liberar o perfil.
Instale o serviço preparado neste repositório (ajuste os caminhos se necessário):

```sh
sudo install -m 644 docs/systemd/meury-browser.service /etc/systemd/system/meury-browser.service
sudo systemctl daemon-reload
sudo systemctl enable --now meury-browser
```

No arquivo privado `worker.env`, mantenha token, URL do ERP e versão do Codex e
adicione:

```dotenv
AUTOMATIZACAO_BROWSER_ENABLED=true
AUTOMATIZACAO_BROWSER_MCP_URL=http://127.0.0.1:8931/mcp
```

Inicie o worker normalmente. Ele conecta ao serviço existente, sem lançar outro
browser. A primeira navegação abre a janela no XFCE, com o perfil já autenticado.
O serviço abre o Chromium antes do MCP, mantendo o processo independente. O MCP
se conecta via CDP em `127.0.0.1:9222`, e o worker usa MCP em `127.0.0.1:8931`.
Somente `--shared-browser-context` e `--idle-timeout 0` não bastavam: o MCP pode
fechar o navegador que criou quando o último cliente desconecta. Com o Chromium
externo, encerrar o cliente não encerra a janela. Não abra outro Chromium com esse perfil.
Para login, pare somente o worker, use a janela que ficou aberta no Compartilhamento
de Tela e retome o worker após autenticar. Não é necessário fechar o navegador.
Não inicie dois workers nesse serviço/perfil, nem compartilhe o serviço entre
aplicativos. O endpoint controla sessões autenticadas e não tem autenticação própria:
fica exclusivamente em 127.0.0.1, nunca publique ou encaminhe as portas 8931/9222.
Se alguma delas já estiver ocupada, o serviço falha em vez de conectar a outro
perfil. Após atualizar esse código, reinicie `meury-browser` como root, com o
worker ocioso/parado. O mesmo perfil e browser.env são preservados. Não precisa
reinstalar a unit se ela já usa `scripts/automatizacao-browser.ts`.

`browser_close` é bloqueado. As habilidades listam abas antes de navegar,
reutilizam uma principal por marketplace e removem apenas duplicatas sem trabalho
em andamento. Essa organização é conduzida pelo agente, não uma trava do Chromium:
popups de login e abas criadas manualmente podem coexistir temporariamente.
Os screenshots automáticos ficam no diretório privado `artefatos` ao lado do
perfil; são arquivos locais, não anexos publicados no ERP. Faça retenção privada
conforme necessário. As versões 2 das quatro habilidades foram criadas no Supabase,
preservando as versões 1. Retentativas existentes preservam a versão original;
as regras de sessão do wrapper atualizado também se aplicam a elas.

Para operação sem interface, use `AUTOMATIZACAO_BROWSER_HEADLESS=true` no browser.env.
Sessões ficam no perfil; CAPTCHA/MFA precisam de intervenção. Reinício do serviço,
fechamento manual ou reboot podem fechar janelas. Preserve Chromium sandbox, sem `--no-sandbox`.
O teste opcional `tests/automatizacao-browser-persistencia.test.ts` usa
`MEURY_BROWSER_TEST_CLI` e `MEURY_BROWSER_TEST_CHROME` para validar com browser
real sem interface: duas sessões MCP consecutivas, desconexão do último cliente
e preservação dos mesmos IDs de abas. Foi validado no macOS com Chrome e perfil
temporário; o teste gráfico no XFCE da VM ainda precisa ser feito.
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

## Print opcional nas notificações

O worker aceita `evidencia: string | null` na saída do agente de navegador.
O agente solicita a captura sem `filename`: o MCP salva o arquivo automaticamente
no `output-dir`. Nomes explícitos relativos são resolvidos contra o workspace e
não devem ser usados para direcionar a imagem ao output-dir. Caminhos retornados
podem ser absolutos ou relativos ao output-dir/workspace; o worker só lê o destino
quando ele permanece dentro da pasta privada configurada, inclusive após symlinks.
O caminho deve apontar para uma captura criada nesta execução dentro da pasta
privada `artefatos`, ao lado do perfil. Para MCP persistente, configure no ambiente
do worker `AUTOMATIZACAO_BROWSER_ARTIFACTS_DIR` com o caminho absoluto da pasta
`--output-dir` do serviço browser (mesmo filesystem, acessível pelo usuário do worker).
Não use URLs nem diretórios compartilhados com usuários não confiáveis.
A captura deve conter apenas informação não sensível; em chats, não anexar conversas.

O worker valida JPEG/PNG de até 5 MiB e converte para JPEG de até 2 MiB para manter
o POST autenticado abaixo de 3 MB, inclusive base64. Falta de captura segura ou
falha de leitura preserva o resultado textual e informa a limitação. O fechamento
continua idempotente; a imagem acompanha o mesmo aviso, sem notificação adicional.
A imagem fica no envelope `whatsapp:image:v1` na fila notification, não no resultado
da tentativa. Trate essa fila como armazenamento privado de evidências.
O remetente usa `/send-image` da Z-API; mensagens comuns preservam `/send-text`.
Envelope inválido falha sem transmitir o base64 como texto.

Publicação: atualizar primeiro o ERP (API e remetente), depois o código do worker
na VM; configurar a pasta de artefatos e reiniciar somente o serviço worker quando
ocioso, preservando o serviço browser/perfil autenticado. Não é necessário pausar
ou recriar rotinas. A primeira validação real deve conferir captura segura, aviso
único na fila e recebimento da imagem no grupo; testes locais não comprovam entrega.


## Resumo do WhatsApp

O resultado completo permanece no histórico. O agente de navegador retorna também
`resumoWhatsapp` (até 360 caracteres e três linhas), com resultado por canal e ação
necessária. O worker envia esse campo no fechamento; a API aplica sanitização e o
mesmo texto compacto ao aviso textual e à legenda da imagem. Título sem a lista de
marketplaces, data curta em São Paulo e ausência de URLs reduzem a ocupação mobile.
Workers antigos continuam aceitos: resultados curtos são usados diretamente; os
longos recebem aviso de conclusão ou falha com orientação para consultar o histórico.
Não há inferência de contagens nem de fila vazia a partir de texto longo.
A mudança exige publicação do ERP e atualização/reinício do worker ocioso na VM.

## Falha por ocorrência

O limite de três tentativas pertence à execução de cada horário. `FALHA_FINAL`
não impede os próximos horários; o histórico e a unicidade por horário permanecem.
Execuções pendentes, em retry ou em andamento continuam impedindo sobreposição.
`BLOQUEADA` encerra apenas sua ocorrência e não impede o próximo horário. A causa
(por exemplo, login ou CAPTCHA) pode exigir intervenção para a próxima execução ter sucesso.
Uma retomada manual em conflito com outra execução em aberto retorna HTTP 409.
Aplique a migration de falha por ocorrência antes de publicar o agendador atualizado.
