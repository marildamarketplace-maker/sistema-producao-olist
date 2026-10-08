# Piloto Claude para catalogação de estampas

O piloto compara `claude-haiku-5-5` e `claude-sonnet-5-5` usando os mesmos bytes, prompt, schema local e regras de qualidade dos demais providers. Sonnet roda como configuração independente na amostra, sem fallback automático. O fluxo de produção não foi alterado.

## Chave e ambiente

1. Entre no [Claude Console](https://platform.claude.com/).
2. Selecione a organização/workspace desejado e abra **Settings → API keys → Create key**. Guarde a chave no ambiente local, nunca em arquivos versionados ou no navegador.
3. Confirme saldo de API em **Billing**. Adicione créditos à organização, ou resgate créditos de assinatura caso sua conta seja elegível. Configure um limite de gasto na conta.
4. No `.env` usado pelo script, acrescente:

```dotenv
# Obrigatória
ANTHROPIC_API_KEY=
# Opcionais, valores padrão
ANTHROPIC_IMAGE_ANALYSIS_TIMEOUT_MS=90000
ANTHROPIC_MAX_OUTPUT_TOKENS=4096
```

Não use `NEXT_PUBLIC_`. O provider usa header `x-api-key`, endpoint fixo e recusa redirects. Chave, URLs da amostra, conteúdo de pensamento e corpos de erros HTTP não são registrados. O limite de saída é próprio do Claude e também cobre tokens de pensamento; a API mantém o comportamento padrão dos modelos para pensamento/esforço. Valores de timeout aceitos: 1000–300000 ms; tokens: 300–16384.

## Execução

```sh
# Valida a amostra localmente, sem chamadas pagas nem necessidade de chave.
DOTENV_CONFIG_PATH=.env npm run piloto:estampas:claude -- amostra.json

# Executa somente os dois modelos Claude.
DOTENV_CONFIG_PATH=.env npm run piloto:estampas:claude -- amostra.json --executar

# Completa todas as sete configurações: OpenAI + Gemini + Claude.
DOTENV_CONFIG_PATH=.env npm run piloto:estampas -- amostra.json --executar
```

O comando Claude precisa apenas de `ANTHROPIC_API_KEY`; não depende da ativação do Gemini. O comando conjunto exige também `OPENAI_API_KEY` e `GEMINI_API_KEY`. Para 561 imagens: 1.122 combinações Claude; 3.927 no conjunto completo. Cada combinação ausente ou com falha faz uma única chamada por execução, sem retries implícitos. Imagens acima de 10 MB codificadas em base64 são rejeitadas antes da chamada; o carregador existente valida URLs e bytes do preview.

## Resultados e retomada

Todos os comandos atualizam `outputs/arquivo-pilotos/piloto-estampas/`, inclusive os modos isolados Claude, Gemini e OpenAI. Não criam um diretório por execução.

- `resultados.jsonl`: histórico permanente: cada nova tentativa é acrescentada, sem apagar ou substituir linhas anteriores. Sucessos não são reexecutados nem duplicados; falhas anteriores permanecem no histórico após uma nova tentativa.
- `resumo.json`: estado atual por modelo e custo acumulado das tentativas conhecidas.
- `amostra.json`: manifesto com IDs, sem URLs.

Na retomada, `ok: true` não gera chamada nem outra linha. `ok: false` é retentado, e combinações ausentes são executadas. Provider, modelo, detalhe, pensamento e hash da imagem distinguem configurações. Ajustar prompt, schema ou limite de saída não reexecuta sucessos existentes. Qualidade `precisaRevisao` não muda essa regra: o critério solicitado é `ok`.

O arquivo nesse caminho é a fonte de retomada, inclusive após parar e recomeçar. Arquivos legados são importados sem excluir ou mover os originais e sem duplicar tentativas. As gravações preservam todo o conteúdo anterior e acrescentam novas linhas por troca atômica, antes de iniciar outra chamada. O resumo considera o sucesso preferencialmente ou a última falha de cada combinação, e acumula os custos das tentativas conhecidas. Não apague checkpoints ou locks de processos ativos. Falhas de autenticação suspendem apenas o provider nessa execução, mantendo suas combinações pendentes e continuando os demais. Falhas globais de contrato da Anthropic encerram o lote após salvar o diagnóstico.

Claude recebe o JSON Schema completo no prompt e retorna JSON, sem `output_config.format`. A gramática do catálogo foi rejeitada por tamanho tanto com enums quanto com a versão simplificada. A integração dispensa a compilação remota e aplica o Zod original a cada resposta: campos obrigatórios, enums, tipos, limites e coerência continuam exigidos antes de salvar `ok: true`. JSON inválido ou dados fora do contrato ficam como falha. Um bloco Markdown JSON completo é tolerado; JSON cercado de prosa não é extraído.

Os hashes de auditoria incluem o prompt e contrato efetivamente enviados. O schema no prompt aumenta tokens de entrada, registrados no uso real. Não há retry ou fallback oculto. A precisão visual continua exigindo revisão humana.

Custos estimados seguem tarifa Standard da API, sem Batch: Haiku 5.5 até 100k tokens de entrada custa US$ 0,10/0,50 por milhão de entrada/saída; acima disso US$ 0,50/2,50. Sonnet 5.5 custa US$ 2/10. Cache de leitura é separado. Cache de escrita não é solicitado; se aparecer, o custo fica desconhecido para evitar subestimar. Compare qualidade, custo e latência antes de decidir usar Sonnet como fallback em produção.

Referências: [modelos](https://platform.claude.com/docs/en/models/overview), [autenticação](https://platform.claude.com/docs/en/manage-claude/authentication), [créditos](https://support.claude.com/en/articles/8114531-i-created-a-claude-console-organization-how-do-i-start-using-the-claude-api), [Structured Outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [preços](https://platform.claude.com/docs/en/about-claude/pricing).
