# Atualizar e executar o worker

Antes de atualizar a VM, envie as alterações ao repositório remoto e publique o
ERP com a API e o remetente que suportam imagens. Atualizar somente o worker não
habilita o envio de prints.

## 1. Encerrar o worker atual

Espere aparecer `AGUARDANDO_TAREFA` no terminal e pressione **Ctrl+C**.
Mantenha o navegador e o serviço `meury-browser` abertos para preservar as sessões.
Não inicie dois workers ao mesmo tempo.

## 2. Atualizar o código e as dependências

Execute como o usuário habitual do worker:

```bash
cd ~/sistema-producao-olist
git pull --ff-only
npm ci
```

Continue somente se os dois comandos terminarem sem erro. Se houver alterações
locais ou divergência no Git, resolva antes de iniciar; não descarte arquivos ou
configurações para forçar a atualização.

## 3. Configurar os prints de evidência

Edite o arquivo privado de configuração:

```bash
nano ~/.config/meury-worker/worker.env
```

Adicione ou atualize esta variável, preservando as demais configurações:

```dotenv
AUTOMATIZACAO_BROWSER_ARTIFACTS_DIR=/home/operador/.local/share/meury-browser/artefatos
```

Esse é o caminho padrão para o usuário `operador`. Se a instalação usar outro
usuário ou diretório, ajuste para a pasta `artefatos` configurada como
`--output-dir` do serviço browser. A pasta precisa estar acessível ao worker no
mesmo filesystem. Não use a pasta do perfil nem um diretório público.

Proteja o arquivo de ambiente:

```bash
chmod 600 ~/.config/meury-worker/worker.env
```

## 4. Iniciar o worker

```bash
cd ~/sistema-producao-olist
node --env-file="$HOME/.config/meury-worker/worker.env" --import tsx scripts/automatizacao-worker.ts
```

Mantenha esse terminal aberto. Não é necessário recriar ou pausar as rotinas,
nem reiniciar o navegador para esta atualização do worker.

## 5. Conferir a próxima execução

Confira o resultado no histórico do ERP e a notificação no WhatsApp. Quando houver
uma captura segura disponível, ela deve acompanhar o aviso da execução. Prints
não podem expor conversas, dados pessoais ou credenciais.

Se o print estiver indisponível, o resumo textual deve informar o motivo. Não
repita uma operação já concluída apenas para obter a imagem. Uma notificação
`PENDENTE` indica somente enfileiramento; confirme o recebimento no WhatsApp.
