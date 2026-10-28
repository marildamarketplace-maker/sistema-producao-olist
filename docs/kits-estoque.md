# Associação de kits para baixa Olist

Em Produtos → Associação de kits, informe o SKU exato vendido e os SKUs individuais ativos do mesmo aplicativo, com quantidade inteira positiva por kit. O SKU do kit pode ser informado antes de seu cadastro/importação. Componentes precisam estar cadastrados. Não são permitidos componentes duplicados, autorreferência ou kits aninhados.

Exemplo: 3 unidades do kit com A × 2 e B × 1 geram saídas de A × 6 e B × 3, sem saída do SKU do kit. Produtos individuais sem composição seguem o fluxo anterior. SKUs com prefixo KIT sem composição bloqueiam a confirmação inteira antes de qualquer movimentação, com orientação para cadastrar a associação. A regra vale na confirmação manual e no cron Olist. Alterações não recalculam baixas passadas.

Cada componente recebe seu registro de baixa e movimento na mesma transação, preservando pedido/item e SKU original vendido em sku_origem. A confirmação serializa operações concorrentes e verifica novamente se o item já foi baixado. Se a composição mudar durante a preparação, a confirmação é interrompida e deve ser refeita. Retornos de cancelados validam o SKU original com a Olist e devolvem os componentes registrados, sem consultar a composição atual.

Leitura exige visualizar ou editar estoque; gravação exige editar estoque. O servidor deriva o aplicativo da sessão autenticada. A tabela de composição tem RLS sem políticas públicas e acesso restrito ao servidor.

## Ativação

Aplicar a migration `20261028170000_kits_estoque` antes de disponibilizar o código. Ela adiciona a composição e sku_origem e altera a unicidade da baixa para pedido/item/SKU. Não executar versões antigas do confirmador simultaneamente após essa alteração: elas não utilizam o bloqueio transacional novo.

## Aceite da interface

Em 390px e 1440px, temas claro e escuro: localizar a tela no menu, informar SKU longo, adicionar/remover componentes, corrigir quantidade inválida, salvar, editar e desfazer associação. Sem overflow da página; ações acessíveis por teclado e áreas de toque de 44px. Carregamento, falha e salvamento devem preservar os dados e impedir reenvio enquanto salva.

Validação automatizada: expansão e limites de quantidade, composição inválida, baixa automática existente e retorno de cancelados com SKU original do kit. Verificações reais de banco, navegador e dispositivo permanecem necessárias antes de produção.

## Geração automática de produção

O botão “Gerar solicitação automaticamente” também consulta a mesma associação de kits, sempre no aplicativo da solicitação. A composição cadastrada tem precedência sobre a interpretação das estampas no SKU, inclusive para códigos sem prefixo KIT. Multiplica as quantidades por kit e soma a demanda às vendas individuais e a outros kits do mesmo componente, preservando os pedidos e SKUs de origem.

Sem associação, permanece o reconhecimento legado das variantes pelo SKU. Com associação, um componente inativo ou ausente no aplicativo bloqueia a geração; não há fallback silencioso para outro produto. Os cálculos existentes de estoque disponível, mínimo/meta e produção em andamento continuam sendo aplicados aos componentes resultantes.

Testes adicionais cobrem precedência da associação, kits sem padrão, componente indisponível, mistura com kits legados e vendas individuais. A integração real com Olist/banco não foi executada nesta alteração.

## Importação em lote

Na mesma tela, use “Importar associações em lote”: carregue um CSV/TXT (até 1 MB) ou cole dados de uma planilha. Formato, uma linha por componente:

```csv
sku_kit;sku_componente;quantidade
KIT-EXEMPLO;SKU-INDIVIDUAL-A;1
KIT-EXEMPLO;SKU-INDIVIDUAL-B;2
```

Aceita ponto e vírgula, vírgula ou tabulação, cabeçalho opcional, BOM UTF-8 e campos entre aspas (sem quebras de linha internas). Limites: 500 kits, 2000 componentes no lote, 100 componentes por kit. Quantidades inteiras positivas. Linhas repetidas do mesmo kit/componente são rejeitadas.

“Conferir importação” apresenta a composição agrupada, indicando criação ou substituição. “Confirmar importação do lote” revalida o payload, a permissão de editar estoque e os componentes ativos do aplicativo. Substitui integralmente apenas os kits informados. A validação do grafo final impede kits aninhados, inclusive entre registros novos e existentes. Todo o lote é salvo na mesma transação e sob o mesmo bloqueio da edição e baixa; falhas revertem a transação inteira. O formulário é preservado para correção. Não movimenta estoque nem altera solicitações anteriores.

Validação desta implementação: 25 testes de parsing, limites, composição, expansão, isolamento por aplicativo e atomicidade com dependência de banco simulada; TypeScript e ESLint. Componente React isolado no navegador: temas claro/escuro, 390px e 1440px com largura de conteúdo contida, SKU longo, prévia, confirmação e erro simulados e acesso à conferência por Tab/Enter. Não houve gravação em banco real, upload de arquivo pelo navegador ou teste em dispositivo físico; integração com sessão/API e persistência ainda requer validação no ambiente de uso.

## Seleção de kit na solicitação manual

O campo SKU da nova solicitação manual consulta `/api/produtos/opcoes?incluir_kits=1`. Esse modo acrescenta as composições do aplicativo e torna selecionáveis os kits associados mesmo sem um produto cadastrado com o SKU do kit. Consumidores sem esse parâmetro mantêm as opções anteriores.

Selecionar um kit associado substitui a linha por seus componentes ativos. A quantidade presente na linha antes da seleção representa kits e é multiplicada pela quantidade de cada componente. Depois da expansão, os campos representam quantidades individuais editáveis. Mantém acabamento e observação manual e recalcula as observações de tecido por componente. Falha de disponibilidade ou quantidade inválida impede a substituição inteira; nenhum SKU virtual é salvo. O formulário fica desabilitado durante o carregamento da seleção para impedir salvar itens incompletos.

Aceite: em desktop/mobile, localizar o kit pelo SKU, distinguir “kit associado”, informar a quantidade antes de selecionar e conferir componentes e quantidades resultantes; corrigir erro sem perder outros itens. Teclado: seta para baixo acessa as opções, Enter seleciona e Escape fecha a lista. Implementação validada por 25 testes de domínio/regressão, TypeScript e ESLint. O fluxo completo no navegador autenticado e em dispositivo real ainda não foi validado.
