# Importação de associações do calendário

Acesso: **Calendário Comercial → Importar associações CSV**
(`/controle-midia/calendario/importar`). Requer a mesma permissão de associar
produtos ao calendário, validada novamente no servidor em cada ação.

1. Baixar o modelo ou selecionar o CSV do mapeamento da Nuvemshop.
2. Escolher se entram sugestões comerciais e eventos adicionais (ambos desligados
   inicialmente). Alterar as opções invalida a prévia anterior.
3. Validar o arquivo e revisar novos vínculos, existentes, duplicados e problemas.
4. Confirmar a inclusão dos vínculos válidos. SKUs precisam existir e estar ativos
   no estoque local do aplicativo atual. Não há criação de produtos nem remoção
   de associações anteriores; títulos/imagens do CSV não alteram o cadastro.

## Contrato CSV

Obrigatórios: `SKU`, `Evento principal ID`.
Opcionais: `Eventos adicionais IDs` (IDs separados por `|`), `Tipo associacao`
(`Direta`, `Sugestão comercial`). Cabeçalhos aceitam acentos, caixa e underscores.
Sem tipo informado, o modelo simples assume `Direta`. Registros sem principal
são ignorados. Tipo desconhecido ou evento principal inválido sinaliza problema;
no caso de evento adicional inválido, somente esse vínculo é descartado.
Os IDs devem existir no catálogo, disponível para consulta na própria tela.

Aceita BOM UTF-8, UTF-8 e Windows-1252, delimitadores `;`/`,`, aspas escapadas e
campos com quebras de linha. Limites: arquivo de 5 MB, 5.000 registros, 64 colunas,
8.192 caracteres por campo e até 10 adicionais por registro. A fronteira do servidor
revalida campos, opções e tamanho compacto (750 KB), permitindo até 10.000 vínculos
candidatos. A prévia mostra até 100 problemas e conserva o total encontrado.

## Consistência, execução e interrupção

A gravação usa requisições sequenciais de até 100 SKUs por evento, com autenticação
por requisição e nova verificação de atividade/aplicativo. Reutiliza a transação,
locks e inserção idempotente do seletor manual. Os produtos são bloqueados para
verificação de atividade; a chave composta protege o isolamento também no banco.
O cliente não escolhe aplicativo nem IDs de produto para a gravação.

Cada lote é curto e limitado (statement de 8s, transação de 10s já existentes).
Não é um job em segundo plano: não há execução após responder a requisição nem
promise abandonada. A importação para na primeira falha, preservando os commits
anteriores; **Retomar** repete o lote inconclusivo com proteção contra duplicidade.
Trocar identidade/aplicativo desmonta o fluxo e impede iniciar os próximos lotes;
renovar o token mantém a prévia e utiliza a credencial nova nas próximas chamadas.
Uma chamada já aceita pelo servidor pode concluir mesmo ao sair da página.

O progresso informa vínculos confirmados, sem afirmar quantos foram fisicamente
inseridos em caso de concorrência. Se fechar/recarregar, reenvie o CSV e valide:
a prévia consulta vínculos duráveis para reconhecer os já salvos. Não há rollback
integral entre lotes. O acompanhamento em memória não sobrevive ao reload.

## Egress e validação

O arquivo é lido no browser: só SKU, IDs de eventos, tipo e número do registro vão
ao servidor. Fotos, descrições e demais colunas não são transmitidas. Consultas de
SKUs em lotes de 500 projetam somente id/SKU/ativo; vínculos existentes são buscados
somente pelos pares solicitados e aplicativo, em lotes de 500, sem catálogo inteiro
ou histórico de estoque. A prévia é limitada e exibida em páginas locais de 20.
Não há polling, cache compartilhado, API Nuvemshop ou nova migration.

O CSV real de 1.597 SKUs foi lido localmente: payload compacto de 196.648 bytes e
1.283 candidatos diretos, sem adicionais; 314 registros ficaram excluídos pelas
regras. Isso usa produtos simulados, não comprova existência dos SKUs no estoque
real nem grava associações. O volume das respostas depende dos vínculos locais;
não houve medição de cobrança do provedor.

Testes cobrem parser, limites, prévia, autorização, isolamento, atividade,
projeção/batching e contratos de locks. O Chrome usa o componente real com ações
simuladas e CSS do projeto: valida arquivo, prévia, confirmação, lotes, confirmação
perdida após commit e retomada idempotente. Verifica overflow em 390/1440px e ambos
os temas; isso é emulação de viewport, sem dispositivo real nem mutação de produção.
