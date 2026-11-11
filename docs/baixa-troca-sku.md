# Troca de SKU na baixa Olist

Antes da confirmação, o campo SKU/referência dos itens importados é editável. O formulário mostra SKU original e troca pendente. Selecionar outro pedido preserva alterações dos itens que continuam selecionados; sincronizar novamente o pedido restaura os dados da Olist. A troca não modifica o pedido no ERP.

O servidor exige SKU substituto ativo no aplicativo autenticado, preserva pedido/item e SKU vendido em `sku_origem` e acrescenta a troca à observação. A composição cadastrada do SKU escolhido é aplicada normalmente; sem composição, baixa o próprio SKU. A prevenção de duplicidade continua usando pedido/item, independentemente do SKU escolhido.

Depois da confirmação, expanda os detalhes do histórico e use “Trocar SKU” na linha desejada. Confira a quantidade que será reposta e baixada e confirme. Na mesma transação: cria entrada compensatória do SKU anterior, saída do substituto e atualiza a linha da baixa para apontar à nova saída. Os movimentos anteriores permanecem para auditoria, com responsável e par de SKUs nas novas movimentações. Pedido/item, quantidade e SKU vendido são preservados. A geração automática de produção não é recalculada retroativamente.

Trocas no histórico atuam por linha individual, inclusive quando a linha era componente de kit. Destino precisa estar ativo e sem composição cadastrada. Baixas com qualquer retorno, inclusive perda na entrega, não permitem troca. Retornos posteriores validam o SKU vendido e repõem o SKU efetivamente baixado após a troca.

Concorrência: bloqueio compartilhado com confirmação/composição e bloqueio da linha compatível com retorno. O cliente envia a saída esperada, e reenvios ou edições concorrentes são rejeitados sem compensação duplicada. Falhas revertem os movimentos e a alteração da baixa. Autorização exige `podeSolicitarBaixa` e o aplicativo vem da sessão; o payload não aceita aplicativo escolhido pelo cliente.

Validação: testes de domínio e serviço com banco simulado cobrem os dois exemplos de pedido, expansão do destino, isolamento por aplicativo, destino indisponível, duplicidade, conflito de versão, rollback, retorno existente e retorno após troca. Prévia isolada com sessão/API simuladas: edição e erro antes da confirmação; erro e sucesso no histórico; larguras efetivas de 389px e 1440px, temas claro/escuro e navegação por Tab. Não houve gravação no banco real, teste em dispositivo físico ou execução integrada autenticada em produção. Não requer migration.
