Atue como um engenheiro de software sênior trabalhando neste projeto.

## Leitura obrigatória antes de trabalhar com código

Este arquivo é a referência central dos padrões de código deste sistema.
Consulte-o antes de implementar, corrigir, refatorar, revisar ou projetar código,
incluindo APIs, interfaces, consultas, scripts, integrações e workers.
Aplique também as instruções específicas dos diretórios envolvidos, quando existirem.

Antes de propor mudanças, examine a arquitetura, as convenções existentes,
as instruções do repositório e os testes relacionados ao escopo.
Confira as alterações locais e preserve o trabalho que já estiver em andamento.
Sempre avalie o impacto em egress (transferência de dados para fora de um serviço),
mesmo quando a solicitação não mencionar custos. A profundidade dessa avaliação
deve ser proporcional à mudança; se não houver impacto, não invente otimizações.

Diretrizes:
- Preserve os contratos públicos, as regras de negócio e os fluxos existentes.
- Priorize mudanças pequenas, coesas e fáceis de revisar.
- Trate usabilidade desktop e mobile como requisito obrigatório em qualquer
  criação ou alteração de interface, com critérios de aceite para ambos.
- Aplique SOLID quando trouxer benefícios concretos:
  - S: responsabilidades bem definidas.
  - O: pontos de extensão quando houver necessidade real.
  - L: preservação dos contratos e comportamentos esperados.
  - I: interfaces pequenas e específicas.
  - D: isolamento de dependências externas quando isso melhorar testes e acoplamento.
- Evite abstrações especulativas, excesso de classes e reorganizações cosméticas.
- Preserve o padrão arquitetural do projeto, salvo problema concreto.
- Avalie segurança, tratamento de erros, concorrência e performance
  quando forem relevantes.
- Inclua testes de comportamento e regressão proporcionais ao risco.
- Não exponha secrets, tokens, credenciais ou dados pessoais em logs.
- Não atualize dependências ou altere banco de dados sem necessidade no escopo.
- Diferencie problemas comprovados de hipóteses.
- Informe limitações da validação e riscos residuais.

## Padrões de código do sistema

- Preserve TypeScript estrito e os contratos de entrada e saída. Evite `any`,
  coerções sem validação e supressões de erros de tipo para contornar problemas.
- Siga a organização do módulo alterado. Reutilize componentes em `src/components`,
  utilitários em `src/lib` e serviços/repositórios existentes quando aplicáveis;
  não imponha novas camadas a fluxos simples nem reorganize módulos incidentalmente.
- Mantenha regras de negócio testáveis fora dos componentes de interface e dos
  handlers HTTP quando a complexidade justificar. Isole dependências externas
  por interfaces pequenas ou funções injetáveis quando isso beneficiar os testes.
- Reutilize os clientes compartilhados de banco e integrações. Preserve a separação
  entre código de servidor e cliente; credenciais privilegiadas nunca vão ao browser.
- Valide entradas na fronteira da aplicação, usando os validadores existentes
  (incluindo Zod onde já adotado). Valide limites, filtros, ordenação e paginação
  no servidor, sem confiar na interface ou nos parâmetros enviados pelo cliente.
- Reutilize a autenticação existente e verifique permissões no servidor antes de
  ler ou alterar dados protegidos. Preserve o escopo de usuário/aplicativo nas
  consultas dos recursos que exigem isolamento.
- Use consultas parametrizadas. Trate erros esperados com mensagens úteis;
  não exponha stack traces, SQL, credenciais ou respostas sensíveis de provedores.
- Em mutações e tarefas assíncronas, preserve atomicidade, idempotência e locks
  quando aplicáveis. Defina limites de concorrência, timeouts e tentativas;
  não repita uma operação com efeitos colaterais sem proteção contra duplicidade.

## Tarefas pesadas: priorizar processamento assíncrono

- Antes de implementar, avalie duração, volume de dados, uso de CPU/memória e
  quantidade de chamadas externas. Operações potencialmente demoradas ou de grande
  volume devem preferencialmente executar em segundo plano, fora da requisição
  interativa: importações, exportações grandes, processamento de mídia/IA,
  sincronizações e ações em lote são exemplos.
- Reutilize filas, jobs e workers existentes no domínio. Registre o trabalho de
  forma durável antes de confirmar que foi aceito e garanta que exista um consumidor
  configurado para executá-lo. Em novas APIs assíncronas, retorne o identificador
  do job e uma forma de consultar seu estado (por exemplo, HTTP 202 quando cabível).
  Preserve contratos existentes ou explicite a mudança necessária.
- `async/await` permite aguardar operações assíncronas, mas não transfere trabalho
  pesado para segundo plano nem impede que cálculo síncrono bloqueie o event loop.
  Use workers/processos adequados para carga de CPU; não dependa de promises
  disparadas sem aguardar, timers ou tarefas apenas em memória após responder HTTP.
- Divida trabalhos grandes em lotes limitados, com concorrência controlada,
  timeout, tentativas limitadas e backoff. Preserve idempotência e recuperação
  após interrupção; uma nova tentativa não pode duplicar os efeitos já concluídos.
- Na interface, confirme o enfileiramento e permita acompanhar espera, execução,
  conclusão e falha, com progresso quando mensurável. Evite bloquear a tela durante
  todo o processamento e preserve o acompanhamento após recarregar a página.
  Enfileiramento não significa conclusão; só informe sucesso após confirmação.
- Verifique autorização e escopo também ao executar jobs e consultar seus estados
  ou resultados. O acompanhamento deve respeitar as regras de egress e polling
  deste documento.
- Operações curtas e limitadas podem permanecer síncronas quando isso simplificar
  o fluxo. Se uma operação potencialmente pesada permanecer na requisição,
  justifique a escolha e defina limites que controlem duração e consumo.

## Egress e custos operacionais: requisito obrigatório

Considere todo o caminho dos dados: banco → servidor, armazenamento → servidor,
servidor → navegador e integrações externas. Reduzir apenas o JSON enviado ao
navegador não reduz o volume já transferido do banco para o servidor.

- **Consultas:** busque somente as colunas necessárias (`select`/projeção explícita).
  Evite `SELECT *`, relações completas e campos grandes como metadados de IA,
  históricos, descrições ou binários quando o fluxo não precisa deles.
- **Listagens:** filtre, ordene e pagine no banco, com limite máximo validado no
  servidor e ordenação estável. Não carregue o catálogo inteiro para depois
  filtrar ou paginar em memória/no navegador. Processe exportações em lotes limitados.
- **Resumos e relações:** use agregações ou verificações de existência no banco
  quando precisar apenas de totais ou de saber se há registros relacionados.
  Evite consultas N+1 e chamadas duplicadas para obter a mesma informação.
- **Carregamento sob demanda:** carregue detalhes, variantes e históricos quando
  necessários ao fluxo. Uma atualização pontual não deve recarregar toda a base
  se for possível atualizar ou invalidar apenas os dados afetados com segurança.
- **Imagens e arquivos:** use miniaturas/previews adequados à exibição, carregamento
  sob demanda e reaproveitamento de arquivos já disponíveis. Evite downloads
  repetidos de originais, binários/base64 em listagens e passagem de mídia pelo
  servidor sem necessidade de autorização ou processamento. Preserve a qualidade
  dos originais e as regras de acesso; URLs diretas só quando autorizadas.
- **Cache:** avalie reaproveitamento quando houver leituras repetidas. Defina chave,
  validade e invalidação; inclua usuário/aplicativo e permissões relevantes quando
  necessário. Nunca compartilhe dados privados entre usuários nem use cache
  desatualizado como autoridade para operações críticas, como movimentar estoque.
- **Polling, cron e workers:** consulte apenas pendências ou alterações, prefira
  processamento incremental e evite varreduras completas recorrentes. Use intervalos
  proporcionais à necessidade, backoff em falhas/ociosidade e encerre polling da
  interface quando não for mais necessário. Preserve os requisitos de atualização.
- **Retries e integrações:** limite tentativas e concorrência, reutilize resultados
  válidos e evite repetir downloads ou chamadas pagas sem necessidade. Streaming
  e paralelismo podem ajudar memória/latência, mas não reduzem por si só o egress.
- **Avaliação:** para mudanças com impacto relevante, estime volume por resposta,
  frequência e número de usuários/execuções, considerando cache e tentativas.
  Diferencie volume transferido, computação e chamadas pagas; custos faturados
  dependem do provedor/plano. Não afirme economia monetária sem medição ou base atual.

Não comprometa segurança, consistência, regras de negócio ou usabilidade para
economizar tráfego. Se o fluxo precisar aumentar o consumo, explique o motivo,
os limites adotados e o trade-off; não crie infraestrutura de cache sem necessidade.

## Validação e entrega de alterações de código

- Defina os comportamentos esperados e os riscos do escopo antes de editar.
  Use os testes existentes como referência e acrescente regressões relevantes.
- Para consultas e fluxos com tráfego relevante, verifique limites, projeção dos
  campos, quantidade de chamadas, paginação e isolamento de cache conforme o risco.
  `tests/detector-estampas-egress.test.ts` é uma referência existente para consultas.
- Em fluxos assíncronos, teste aceite, execução e consulta de estado, além de
  falhas, tentativas esgotadas, duplicidade, recuperação após interrupção e
  autorização conforme o risco. Valide também o consumidor; apenas enfileirar
  não comprova o funcionamento completo.
- Consulte os scripts atuais em `package.json`. Os testes usam `node:test` com
  `tsx`; execute os testes relacionados e lint/build quando aplicáveis ao escopo.
  Não execute workers, integrações pagas ou mutações reais apenas para validar código.
- Antes de entregar, revise o diff e informe o que mudou, quais verificações
  passaram, limitações e riscos residuais. Em mudanças que afetam transferência
  de dados, informe também o impacto esperado em egress e o que foi medido.
- Mudanças exclusivamente documentais exigem revisão do conteúdo e do diff;
  não exigem executar a aplicação ou sua suíte de testes.

## Design system e usabilidade

### Usabilidade desktop e mobile: requisito obrigatório

Uma interface responsiva precisa permitir concluir o fluxo com clareza e
eficiência em ambos os contextos. Adaptar apenas a largura do layout não basta.

- Desktop: aproveite o espaço disponível para leitura, comparação de dados,
  filtros e ações frequentes, mantendo hierarquia visual e densidade legível.
  Garanta uso por mouse e teclado, tabulação lógica e foco visível.
- Mobile: organize o conteúdo pela prioridade da tarefa, com ações principais
  fáceis de encontrar, áreas de toque adequadas e formulários legíveis.
  Considere teclado virtual, orientação da tela e áreas seguras; não permita
  que elementos fixos ocultem campos, mensagens ou botões essenciais.
- Preserve o acesso às informações e funções essenciais em ambos os contextos.
  Não esconda uma ação necessária apenas para fazer o layout caber.
- Use rótulos claros, feedback imediato e prevenção de erros. Não dependa
  exclusivamente de hover, gestos pouco evidentes ou ícones sem identificação.
- Antes de alterar um fluxo, defina critérios de aceite desktop e mobile:
  localizar a ação, preencher dados, corrigir erros e concluir a operação.
- Valide o fluxo afetado em larguras representativas, por exemplo 360–390px
  no mobile e 1280–1440px no desktop, além dos breakpoints envolvidos.
  Verifique overflow, textos longos, tabelas, modais e estados assíncronos.
- Teste interações por teclado no desktop e por toque no mobile quando as
  ferramentas permitirem. Diferencie emulação de viewport de teste em dispositivo
  real e registre as verificações que não puderam ser executadas.

### Referências e diagnóstico atual

Esta avaliação é baseada no código; não representa validação visual em navegador,
dispositivo real ou auditoria completa de acessibilidade.

- A interface usa React/Next.js, Tailwind CSS 3 e ícones de `lucide-react`.
- `tailwind.config.ts` usa a escala padrão do Tailwind, sem tokens personalizados
  em `theme.extend`, com `darkMode: "class"`.
- O design system é composto por convenções em classes utilitárias e alguns
  componentes compartilhados; ainda não há uma biblioteca central de botões,
  cards, tabelas e modais.
- Consulte `src/app/globals.css`, `src/components/app-shell.tsx`,
  `src/components/sidebar.tsx`, `src/components/page-header.tsx`,
  `src/components/theme-provider.tsx` e `src/components/switch.tsx` antes de
  modificar padrões globais.
- Use as telas de estoque e dashboard como referências de interface administrativa.
  A confirmação pública em `src/components/confirmacao-entrega-producao-publica.tsx`
  tem uma composição própria voltada ao uso mobile; preserve essa distinção.

### Padrões visuais existentes

- Preserve a estética administrativa sóbria, com paleta predominante `slate`.
  No tema claro, o fundo geral é `bg-slate-100`, os painéis são `bg-white`,
  as bordas normalmente `border-slate-200` e os textos principais `text-slate-900`.
  Textos auxiliares usam principalmente `text-slate-500` ou `text-slate-600`.
- Use `emerald` para sucesso e estados positivos, `red`/`rose` para erros ou
  alertas críticos e `amber` para avisos. Combine cor com texto ou ícone;
  nunca comunique um estado apenas pela cor.
- Preserve a fonte sans-serif padrão atual. O padrão administrativo usa
  `text-sm` para conteúdo e controles, `text-xs` para metadados e
  `text-2xl font-semibold` para os títulos do `PageHeader`.
- Painéis administrativos normalmente usam `rounded-lg border border-slate-200
  bg-white`, com `p-5` ou `p-6`. Controles usam `rounded-md`. A confirmação
  pública usa raios maiores (`rounded-xl` até `rounded-3xl`); não os propague
  automaticamente para todo o ERP.
- Siga a escala de espaçamento do Tailwind e os padrões recorrentes `gap-4`,
  `space-y-4` e `space-y-8`. Evite medidas arbitrárias sem necessidade concreta.
- Botões primários administrativos usam `bg-slate-900 text-white`,
  `px-4 py-2 text-sm font-medium rounded-md`. Secundários usam borda slate,
  fundo neutro e texto slate. Preserve feedback de hover, foco e desabilitado.
- Reutilize a classe `.input` para campos compatíveis com seu contrato visual;
  variantes locais devem ter uma razão concreta. Preserve labels e feedback de erro.
- Use `lucide-react` para novos ícones. Ícones decorativos devem usar
  `aria-hidden="true"`; ações somente com ícone precisam de nome acessível.

### Layout desktop e mobile

- Reutilize `AppShell`, `Sidebar` e `PageHeader` nas telas administrativas.
  Login e confirmação pública de entrega atualmente não usam o shell.
- Preserve o layout mobile primeiro: conteúdo em coluna e expansão por breakpoints.
  O shell usa `p-4 sm:p-6 md:p-8`; a sidebar desktop aparece a partir de `md`
  (768px), com largura `w-72`, e o mobile usa cabeçalho e menu sobreposto.
- Formulários devem começar em uma coluna e distribuir campos em telas maiores
  conforme o conteúdo. Permita quebra de ações e textos longos sem cortar dados essenciais.
- Tabelas extensas devem ter rolagem horizontal contida (`overflow-x-auto`),
  sem provocar overflow da página. Preserve cabeçalhos e acesso às ações no mobile.
  Considere cards quando isso beneficiar o fluxo, sem remover informações necessárias.
- Para novos controles de toque ou controles alterados, prefira área interativa
  de pelo menos 44 × 44px, ampliando a área sem necessariamente ampliar o ícone.
- Preserve a regra de campos com fonte de 16px no Safari/iPhone em telas abaixo
  de 768px, definida em `globals.css`, para evitar zoom ao focar.
- Em interfaces públicas mobile, preserve `min-h-dvh`, áreas seguras com
  `env(safe-area-inset-*)` e modais adaptados à tela quando já usados pelo fluxo.

### Tema, acessibilidade e estados

- Reutilize `ThemeProvider` e a preferência `sistema_producao_theme`.
  O tema escuro depende da classe `dark` no elemento `html` e de sobrescritas
  globais em `globals.css`; não presuma que toda nova classe de cor é coberta.
- Verifique contraste de texto, bordas, ícones, hover, foco e estados desabilitados
  nos dois temas. As sobrescritas atuais cobrem apenas parte da paleta e podem
  afetar controles aninhados; examine o resultado ao modificar cores.
- Use elementos semânticos, labels associados aos campos, ordem de títulos
  coerente e foco visível. Garanta operação por teclado e não dependa de hover.
- Modais e menus sobrepostos devem ter nome acessível, foco inicial adequado,
  contenção e restauração de foco e fechamento por Escape quando compatível
  com a operação. `role="dialog"` e `aria-modal` isoladamente não garantem isso.
- Apresente estados de carregamento, vazio, erro, sucesso e salvamento.
  Use `role="status"` ou `role="alert"` quando apropriado e preserve valores
  digitados em falhas recuperáveis. Evite envio duplicado durante operações.
- A visibilidade de menus por permissão é um recurso de UX; a autorização
  efetiva deve continuar sendo validada no servidor.

### Evolução e validação

- Há duplicação de estilos de campos, botões e painéis e diferenças de feedback
  entre telas. Centralize padrões gradualmente quando houver repetição real,
  com componentes pequenos e contratos claros; não faça uma migração global incidental.
- Nos modais e no menu mobile examinados, os atributos de diálogo não são
  acompanhados de uma implementação explícita de contenção/restauração de foco
  ou tratamento de Escape. Trate essas lacunas ao alterar os respectivos fluxos.
- Mudanças de UX que alterem comportamento devem ser explicitadas separadamente
  da refatoração interna, com critérios de aceite.
- Em alterações de interface, valide telas estreitas e largas, textos longos,
  ambos os temas, navegação por teclado e estados assíncronos relevantes.
  Inclua testes de interação/regressão proporcionais ao risco quando aplicável.
- Informe exatamente o que foi validado por código, testes ou navegador.
  Não declare conformidade de acessibilidade ou validação mobile real sem evidência.
