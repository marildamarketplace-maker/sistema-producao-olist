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

A gravação usa uma única requisição e uma única transação para todos os vínculos
válidos novos do arquivo (até 10.000 vínculos e 5.000 SKUs distintos, payload de
750 KB). Autenticação, permissão, atividade e aplicativo são verificados no
servidor. O cliente não escolhe aplicativo nem IDs de produto para a gravação.

Antes da inserção, adquire em ordem estável as mesmas advisory locks por evento
usadas pelo seletor manual. Bloqueia todos os produtos por ID em ordem estável e
confere que estejam presentes e ativos no aplicativo. Uma única inserção com
`ON CONFLICT DO NOTHING` preserva vínculos existentes. Qualquer indisponibilidade
ou falha provoca rollback de todo o arquivo, sem importação parcial.

Permanece síncrono por ser uma gravação limitada de metadados locais, sem
integrações externas: dois SETs, uma aquisição dos locks, uma consulta de produtos
e um INSERT. Os limites são lock_timeout de 5s, statement_timeout de 12s e
transação de 20s (maxWait de 5s). Não há trabalho disparado após a resposta. Os
lotes de leitura da prévia continuam limitados a 500; o limite manual de 100
alterações no seletor individual não foi alterado. A ação antiga de lotes também
foi preservada para compatibilidade com clientes anteriores, mas não é usada
pela nova interface de importação.

A tela só confirma sucesso depois da resposta da transação completa; não exibe
percentuais fictícios. Trocar identidade/aplicativo limpa o fluxo. Uma requisição
já aceita pode concluir mesmo ao sair da página; renovação do token preserva a
prévia e usa a credencial atual na confirmação. Se houver perda de conexão, não
presumir rollback: revalidar o mesmo CSV reconhece os vínculos já gravados. Repetir
a gravação também é idempotente. Não há job nem acompanhamento após reload.

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
projeção/batching e contratos de locks. A SQL de verificação dos vínculos existentes
foi executada em PostgreSQL WASM. A gravação integral também foi testada nesse
banco com mais de 100 vínculos em múltiplos eventos, isolamento de aplicativo,
produto inativo, falha de constraint e rollback completo, além de repetição
idempotente. O Chrome usa o componente real com ações
simuladas e CSS do projeto: valida arquivo, prévia, confirmação integral de 101 vínculos, falha sem gravação parcial e nova
validação para repetir a importação. Verifica overflow em 390/1440px e ambos
os temas; isso é emulação de viewport, sem dispositivo real nem mutação de produção.
