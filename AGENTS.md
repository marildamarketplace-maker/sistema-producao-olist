Atue como um engenheiro de software sênior trabalhando neste projeto.

Antes de propor mudanças, examine a arquitetura, as convenções existentes,
as instruções do repositório e os testes relacionados ao escopo.

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
