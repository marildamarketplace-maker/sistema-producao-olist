# Piloto Gemini para catalogação de estampas

Usa o mesmo `amostra.json`, prompt de catalogação, parser Zod e avaliação de qualidade do piloto OpenAI. Não altera o catálogo nem o provider de produção.

O comando principal agora completa **as sete configurações** (três OpenAI, duas Gemini e duas Claude):

```sh
DOTENV_CONFIG_PATH=.env npm run piloto:estampas -- amostra.json --executar
```

Ele exige `OPENAI_API_KEY`, `GEMINI_API_KEY` e `ANTHROPIC_API_KEY`, lê os históricos de `outputs/`, `outputs/gemini/` e `outputs/anthropic/`, preserva sucessos e retenta falhas ou combinações sem registro. O relatório único fica em `outputs/arquivo-pilotos/piloto-estampas/`. Para 561 imagens, o conjunto completo tem 3.927 combinações; apenas as pendentes geram chamadas novas. Para restringir ao OpenAI, acrescente `--provider=openai`; o comando `piloto:estampas:gemini` continua restringindo ao Gemini.

## Ambiente

Cadastre no arquivo escolhido com `DOTENV_CONFIG_PATH`:

```dotenv
# Obrigatória; chave da Gemini Developer API, criada no Google AI Studio.
GEMINI_API_KEY=

# Opcionais; estes são os valores padrão.
GEMINI_IMAGE_ANALYSIS_TIMEOUT_MS=90000
GEMINI_MAX_OUTPUT_TOKENS=4096
GEMINI_THINKING_LEVEL=low
GEMINI_IMAGE_ANALYSIS_DETAIL=high
```

Não use prefixo `NEXT_PUBLIC_` para a chave. A chamada é feita pelo script Node, usando header `x-goog-api-key`, sem incluir a chave na URL. Não é necessário cadastrar `OPENAI_API_KEY` para este piloto.

Os modelos são fixos: `gemini-3.5-flash-lite` e `gemini-3.8-flash`. `GEMINI_THINKING_LEVEL` aceita `low`, `medium` ou `high`; `minimal` não é usado porque o 3.8 não o aceita. `GEMINI_IMAGE_ANALYSIS_DETAIL` aceita `low`, `high` ou `auto` (padrão do modelo). O detalhe é convertido para `mediaResolution` da API Gemini; não implica equivalência com o detalhe OpenAI.

O limite de saída é independente de `AI_MAX_OUTPUT_TOKENS`: o Gemini também usa tokens de pensamento. O custo inclui `candidatesTokenCount + thoughtsTokenCount`. Restrições locais não suportadas pelo JSON Schema remoto, como comprimentos de strings e coerência entre propriedades, continuam sendo verificadas pelo Zod.

## Execução

```sh
# Validação local, sem chamadas pagas.
DOTENV_CONFIG_PATH=.env npm run piloto:estampas:gemini -- amostra.json

# Duas chamadas por imagem ainda pendente.
DOTENV_CONFIG_PATH=.env npm run piloto:estampas:gemini -- amostra.json --executar
```

Com 561 imagens são 1.122 combinações. Cada imagem é carregada uma vez por execução, e os dois modelos recebem os mesmos bytes. A ordem dos modelos alterna entre imagens. Não há retries ou fallback implícitos.

## Resultados e retomada

Todos os comandos atualizam `outputs/arquivo-pilotos/piloto-estampas/`, inclusive os modos isolados Claude, Gemini e OpenAI. Não criam um diretório por execução.

- `resultados.jsonl`: histórico permanente: cada nova tentativa é acrescentada, sem apagar ou substituir linhas anteriores. Sucessos não são reexecutados nem duplicados; falhas anteriores permanecem no histórico após uma nova tentativa.
- `resumo.json`: estado atual por modelo e custo acumulado das tentativas conhecidas.
- `amostra.json`: manifesto com IDs, sem URLs.

Na retomada, `ok: true` não gera chamada nem outra linha. `ok: false` é retentado, e combinações ausentes são executadas. Provider, modelo, detalhe, pensamento e hash da imagem distinguem configurações. Ajustar prompt, schema ou limite de saída não reexecuta sucessos existentes. Qualidade `precisaRevisao` não muda essa regra: o critério solicitado é `ok`.

O arquivo nesse caminho é a fonte de retomada, inclusive após parar e recomeçar. Arquivos legados são importados sem excluir ou mover os originais e sem duplicar tentativas. As gravações preservam todo o conteúdo anterior e acrescentam novas linhas por troca atômica, antes de iniciar outra chamada. O resumo considera o sucesso preferencialmente ou a última falha de cada combinação, e acumula os custos das tentativas conhecidas. Não apague checkpoints ou locks de processos ativos. Falhas de autenticação suspendem apenas o provider nessa execução, mantendo suas combinações pendentes e continuando os demais. Falhas globais de contrato da Anthropic encerram o lote após salvar o diagnóstico.

Custos seguem a tabela Standard, sem Batch. Os preços promocionais do Gemini 3.8 Flash são aplicados até 31/12/2026; a estimativa usa a data da tentativa. A revisão humana da precisão visual permanece necessária.

Referências: [API REST](https://ai.google.dev/api/generate-content), [JSON Schema](https://ai.google.dev/gemini-api/docs/structured-output), [preços](https://ai.google.dev/gemini-api/docs/pricing), [chave de API](https://aistudio.google.com/apikey).
