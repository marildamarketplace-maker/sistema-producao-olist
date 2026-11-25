# Pedidos manuais multiempresa

Em `/olist/pedidos/criar`, selecionar vendedor e cliente no primeiro aplicativo
autorizado (ordem por nome e ID). Havendo filhos, a referência é o primeiro filho;
sem filhos, é a própria conta. Usuário vendedor exige vínculo na referência e no
destino, e seus clientes são filtrados pela carteira.

## Configuração

O pai administra **Configurações → Direcionamento de pedidos**, com as permissões
existentes de visualizar/editar configurações. Definir um filho direto como padrão
e cadastrar até 50 regras, com até 10 condições por regra. A primeira regra ativa
satisfeita vence. A ordem pode ser alterada pelos botões Subir/Descer, inclusive
por teclado e em telas pequenas.

Condições: UF dentro/fora de uma lista, nome contém texto e documento CPF/CNPJ.
Combinar por todas (E) ou qualquer (OU). A UF é a do endereço principal do cliente
na referência. Dados ausentes não satisfazem a condição; nenhuma regra satisfeita
usa o padrão. Falhas de rede, OAuth ou contrato interrompem a consulta com aviso,
sem encaminhar ao padrão. Conta única não exige configuração.

## Identidade e fila

Nas novas criações, o cliente precisa ter CPF/CNPJ cadastrado na referência e o
mesmo documento na conta destinatária. Cliente sem documento bloqueia a resolução
e a inclusão com aviso para corrigir o cadastro; não há correspondência por nome
para novos clientes. O servidor usa o documento normalizado, sem acrescentar uma
nova validação fiscal à identidade.

Vendedores ainda podem ser identificados por nome exato e único quando os dois
cadastros estão realmente sem documento. Um homônimo documentado também impede
essa correspondência por nome. A mesma proteção se aplica a clientes de snapshots
históricos sem documento. Os contratos anteriores e a recuperação idempotente dos
pedidos já aceitos permanecem compatíveis.

IDs Olist são resolvidos na conta destinatária. Ausência, ambiguidade, carteira
inválida ou falta de vínculo bloqueiam. A classificação fiscal das regras é
independente dessa identidade e não altera o cadastro da Olist.

Novas inclusões usam o contrato versão 2, com origem e decisão verificadas no
servidor. Não é permitido escolher outro aplicativo na criação. Regras/cliente
alterados entre prévia e inclusão exigem nova revisão. Configuração e permissões
são revalidadas sob locks antes da gravação.
Na criação, a releitura feita durante a correspondência também confere nome e UF
usados na regra. Essa conferência reaproveita a consulta existente e não reaplica
regras aos pedidos históricos da fila.

Na fila, quem possui permissão de gestão pode trocar o destino antes da confirmação
do envio, sujeito aos guardas de tentativas existentes. A troca remapeia as pessoas,
invalida associações comerciais e prévias, registra histórico e exige nova prévia.
O envio usa o destino atual e não reaplica regras. Envios reservados, incertos ou
concluídos bloqueiam alterações. Pedidos antigos mantêm o fluxo anterior; o contrato
antigo apenas recupera inclusões já aceitas, sem criar pedidos novos. Repetições
idempotentes devolvem o estado e destino atuais do mesmo pedido.
A recuperação da chave ocorre também após falhas de validação, quando outra
requisição pode ter aceitado a confirmação nesse intervalo. A tela conserva a
mesma chave ao corrigir dados e após recarregar; um conflito de conteúdo apresenta
o comprovante existente e informa que as novas alterações não foram aplicadas.
Somente criar outro pedido explicitamente inicia uma nova intenção. A recuperação
em erro pode repetir autorização e lookup no banco, mas não consulta novamente a Olist.

O editor das regras preserva rascunhos ao renovar o token no mesmo usuário e
aplicativo. Troca de contexto reinicia o editor; recarga explícita lê o que foi salvo.
Respostas antigas de leitura ou gravação não substituem um rascunho ou contexto mais novo.

## Banco e validação

A migration `20261125130000_direcionamento_pedidos` cria configuração por pai,
com versão, padrão, regras e último editor. Inclui FKs, limites, RLS e revogação de
acesso público. Sua criação não significa aplicação no banco nem implantação.

Não há sincronização, polling ou varredura de clientes. A correspondência limita
cada operação a 12 consultas lógicas/12 segundos; a descoberta inicial por ID
consulta até 4 páginas de 100 vendedores. Cada consulta pode renovar OAuth uma
vez após 401. Buscas incompletas bloqueiam. A resolução e a revalidação acrescentam
leituras obrigatórias; os testes verificam que 100 itens não consultam os cadastros
opcionais durante o aceite. Esses limites não representam medição de egress faturado.

Os testes usam fixtures e integrações simuladas, incluindo carteiras, documentos,
regras, concorrência, idempotência, redirecionamento e recuperação. Os testes de
Chrome usam viewports emulados; não substituem testes em dispositivo físico.
