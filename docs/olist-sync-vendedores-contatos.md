# Vendedor na sincronização de contatos

A atualização de contatos usa o nome normalizado do vendedor para localizar um único cadastro ativo na conta de destino. O PUT envia `vendedor: { id }` com o ID dessa conta. A criação de contatos com vendedor continua bloqueada; vendedores não são criados nem ativados pelo sincronizador.

## Regras

- A comparação ignora maiúsculas/minúsculas e espaços extras, preservando acentos. Não há busca aproximada.
- Ausência de correspondência, homônimos (inclusive um homônimo inativo), referência inválida ou candidato inativo deixam o contato pendente.
- Vendedores diferentes na primeira comparação exigem revisão. A resolução manual existente permite escolher uma empresa como fonte.
- Sem vendedor na fonte, cada destino conserva seu vínculo. Quando há PUT de outros campos, o ID atual do destino é reenviado explicitamente. As bases por réplica impedem que uma auditoria seguinte restaure o vendedor removido na fonte.
- Mudanças simultâneas incompatíveis continuam pendentes. O módulo não escolhe uma origem arbitrária.
- A próxima auditoria reavalia contatos com dependências de vendedor pendentes, mesmo sem alteração do contato remoto e mesmo com delta incremental vazio. As pendências são percorridas em páginas de 100 IDs, com checkpoint; somente esses contatos precisam de nova leitura completa. A pendência anterior é encerrada após a confirmação das operações da revisão.
- A conclusão compara os hashes esperados de cada réplica. Assim, preservar um vínculo diferente não mantém a origem falsamente divergente e não dispensa a igualdade dos demais campos.

## Execução e segurança

O worker coleta uma página por checkpoint, com até 100 itens por página e 1.000 vendedores por conta. A cobertura deve estar completa e sem IDs repetidos antes da resolução. Catálogos de aplicação expiram em 15 minutos; são isolados por aplicativo, identidade da conta e execução. Nomes e IDs ficam cifrados nos checkpoints e nos payloads de operação. Logs e motivos usam códigos sem dados pessoais.

As proteções existentes de conta, autorização, revisão, lease, quota, backoff e tentativas continuam ativas. Antes do envio, o vínculo local também é comparado para detectar troca de ID com o mesmo nome. O ID enviado é persistido atomicamente com o início da escrita, permitindo confirmar por GET após interrupção ou resposta perdida. Uma confirmação divergente não gera sucesso nem repetição cega do PUT.

A projeção de contatos passa à versão 3. A assinatura da coleta invalida a cobertura antiga e exige nova coleta completa; operações antigas não são enviadas sob a regra nova. Efeitos antigos já enviados permanecem pendentes de reconciliação/revisão, sem reenvio automático.

## Contrato e limites

O [Swagger oficial](https://erp.tiny.com.br/public-api/v3/swagger/index.html#/Contatos/AtualizarContatoAction), consultado em 25/11/2026, declara `VendedorRequestModel` com `id` inteiro. O GET retorna ID e nome; a listagem usa `contato.nome` e situação A/B para ativo. A documentação não foi tomada como garantia de preservação por campo omitido: um destino com vendedor recebe seu ID explicitamente.

Sem controle condicional de versão na API, uma mudança externa entre a última leitura e o PUT continua sendo um risco residual. A confirmação detecta divergências posteriores, mas não substitui uma operação atômica no provedor. Renomeações no catálogo sem atualização do contato remoto podem depender da auditoria completa periódica para reaparecer no delta de contatos.

## Egress e validação

Há uma coleta paginada de vendedores por conta na auditoria e outra na aplicação, reaproveitada entre operações da mesma etapa enquanto válida. Para V vendedores, cada coleta faz `max(1, ceil(V/100))` GETs de catálogo, além das verificações de identidade e eventuais tentativas. Não há uma listagem por contato. Reavaliar dependências acrescenta consultas limitadas a 100 IDs por página e GETs apenas dos contatos pendentes. Os checkpoints cifrados acrescentam leituras e escritas no banco proporcionais ao tamanho do catálogo; o limite de 1.000 controla esse volume, mas o reaproveitamento HTTP não elimina esse egress interno.

Os testes verificam duas páginas para 105 vendedores, retomada com novo consumidor, isolamento, ausência, homônimos, inatividade, preservação, concorrência, resposta incerta, confirmação por ID, revisão manual e múltiplos destinos. O provedor é simulado; não há validação com mutações reais no ERP.
