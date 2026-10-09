# Mapa de telas para revisão

Inventário do App Router em 09/10/2026. Abrange todos os arquivos `page.tsx` atuais; APIs não são telas, mas devem ser revisadas junto aos fluxos que as utilizam.

Total: **36 rotas**, sendo **35 páginas de interface e 1 redirecionamento**. O inventário não equivale a aprovação técnica ou visual.

## Ordem sugerida

1. Componentes globais: shell, navegação, autenticação, tema e controles compartilhados.
2. Alta: autenticação, permissões, configurações, estoque e operações que alteram pedidos/produção.
3. Normal: cadastros, consultas, mídia e dashboard.
4. Concluir a validação visual das duas telas já corrigidas e verificar o redirecionamento legado.

Prioridade indica a ordem recomendada por impacto potencial, não uma falha comprovada.

## Inventário

| Rota | Entrada | Componentes específicos importados | Prioridade | Status |
| --- | --- | --- | --- | --- |
| `/anotar-sku` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/anotar-sku/page.tsx) | Implementação na página | Normal | Pendente |
| `/baixa-estoque-olist` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/baixa-estoque-olist/page.tsx) | Implementação na página | Alta | Pendente |
| `/configuracoes` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/configuracoes/page.tsx) | Implementação na página | Alta | Pendente |
| `/confirmar-entrega-producao` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/confirmar-entrega-producao/page.tsx) | `confirmacao-entrega-producao-publica` | Alta | Pendente |
| `/confirmar-producao` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/confirmar-producao/page.tsx) | Implementação na página | Alta | Pendente |
| `/controle-midia/categorias` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/controle-midia/categorias/page.tsx) | Implementação na página | Normal | Pendente |
| `/controle-midia/estampas/jobs` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/controle-midia/estampas/jobs/page.tsx) | `estampas/estampa-jobs-client` | Normal | Revisão de código e ajustes realizados; validação visual pendente |
| `/controle-midia/estampas` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/controle-midia/estampas/page.tsx) | `estampas/pesquisa-estampas-client` | Normal | Revisão de código e ajustes realizados; validação visual pendente |
| `/controle-midia/produtos` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/controle-midia/produtos/page.tsx) | Implementação na página | Normal | Pendente |
| `/controle-midia/tarefas` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/controle-midia/tarefas/page.tsx) | Implementação na página | Normal | Pendente |
| `/dashboard` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/dashboard/page.tsx) | Implementação na página | Normal | Pendente |
| `/devolucoes` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/devolucoes/page.tsx) | Implementação na página | Alta | Pendente |
| `/estoque` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/estoque/page.tsx) | Implementação na página | Alta | Pendente |
| `/fornecedor/fornecedores` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/fornecedor/fornecedores/page.tsx) | Implementação na página | Normal | Pendente |
| `/fornecedor/produtos` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/fornecedor/produtos/page.tsx) | Implementação na página | Normal | Pendente |
| `/gerador-csv-olist` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/gerador-csv-olist/page.tsx) | `gerador-csv-olist/gerador-csv-olist-client` | Normal | Pendente |
| `/login` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/login/page.tsx) | Implementação na página | Alta | Pendente |
| `/olist/contatos` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/olist/contatos/page.tsx) | Implementação na página | Normal | Pendente |
| `/olist/formas-pagamento` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/olist/formas-pagamento/page.tsx) | `modal-associar-planos-pagamento` | Normal | Pendente |
| `/olist/formas-recebimento` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/olist/formas-recebimento/page.tsx) | `modal-associar-planos-pagamento` | Normal | Pendente |
| `/olist/pedidos/criar` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/olist/pedidos/criar/page.tsx) | `campo-tipo-produto`, `campo-tamanho`, `switch` | Alta | Pendente |
| `/olist/pedidos` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/olist/pedidos/page.tsx) | Implementação na página | Normal | Pendente |
| `/olist/produtos` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/olist/produtos/page.tsx) | Implementação na página | Normal | Pendente |
| `/olist/vendedores` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/olist/vendedores/page.tsx) | Implementação na página | Normal | Pendente |
| `/` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/page.tsx) | `acessos-rapidos` | Normal | Pendente |
| `/produtos/calculadora-precos` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/produtos/calculadora-precos/page.tsx) | `pricing-calculator/PricingCalculator` | Normal | Pendente |
| `/produtos/estampas/jobs` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/produtos/estampas/jobs/page.tsx) | Sem interface própria | Normal | Redirecionamento; verificar destino e acesso |
| `/produtos/estampas` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/produtos/estampas/page.tsx) | `estampas/estampas-client` | Normal | Pendente |
| `/produtos` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/produtos/page.tsx) | Implementação na página | Normal | Pendente |
| `/produtos/tamanhos` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/produtos/tamanhos/page.tsx) | `tamanhos/tamanhos-client` | Normal | Pendente |
| `/produtos/tipos` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/produtos/tipos/page.tsx) | `tipos-produto/tipos-produto-client` | Normal | Pendente |
| `/produtos/variantes` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/produtos/variantes/page.tsx) | `variantes/variantes-client` | Normal | Pendente |
| `/solicitacoes-producao` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/solicitacoes-producao/page.tsx) | `campo-tipo-produto`, `campo-tamanho`, `switch` | Alta | Pendente |
| `/turnos-producao` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/turnos-producao/page.tsx) | Implementação na página | Normal | Pendente |
| `/usuario` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/usuario/page.tsx) | Implementação na página | Alta | Pendente |
| `/usuarios` | [page.tsx](/Users/marcotulio/Documents/www/sistema-producao-olist/src/app/usuarios/page.tsx) | Implementação na página | Alta | Pendente |

## Dependências compartilhadas

| Responsabilidade | Arquivos |
| --- | --- |
| Layout e navegação | `src/app/layout.tsx`, `src/components/app-shell.tsx`, `src/components/sidebar.tsx`, `src/components/acessos-rapidos.tsx` |
| Autenticação e acesso | `src/components/auth-provider.tsx`, `src/components/access-guard.tsx`, APIs e permissões do fluxo |
| Tema e identidade | `src/app/globals.css`, `tailwind.config.ts`, `src/components/theme-provider.tsx`, `src/components/page-header.tsx` |
| Formulários e diálogos | `src/components/switch.tsx`, `src/components/campo-tamanho.tsx`, `src/components/campo-tipo-produto.tsx`, `src/components/modal-associar-planos-pagamento.tsx`, `src/hooks/use-modal-focus.ts` |

## Checklist por tela

- [ ] Mapear fluxo principal, regras de negócio, componentes e APIs envolvidas.
- [ ] Verificar autenticação e autorização no servidor, validação de entradas e exposição de informações sensíveis.
- [ ] Avaliar responsabilidades, acoplamento e aplicação proporcional de SOLID, sem abstrações especulativas.
- [ ] Desktop: mouse, teclado, foco visível, tabulação, leitura de tabelas, filtros e ações.
- [ ] Mobile: toque, áreas interativas, teclado virtual, menus, modais e acesso a todas as funções essenciais.
- [ ] Validar larguras representativas de 360–390px e 1280–1440px, além dos breakpoints relevantes.
- [ ] Validar temas claro e escuro, textos longos, contraste e overflow.
- [ ] Conferir labels, semântica, mensagens acessíveis e foco/Escape/restauração em diálogos.
- [ ] Conferir carregamento, vazio, erro, sucesso, recuperação e preservação de dados digitados.
- [ ] Conferir cancelamento de consultas, respostas obsoletas, envio duplicado e concorrência aplicáveis.
- [ ] Executar testes relevantes e adicionar regressões para os problemas corrigidos.
- [ ] Registrar achados com arquivo/linha, impacto e prioridade; separar hipóteses de problemas comprovados.
- [ ] Registrar evidências e limitações da validação, distinguindo viewport emulado de dispositivo real.

## Registro de conclusão

Para cada rota, atualizar o status e registrar: achados, correções, testes executados, validação desktop/mobile e pendências. Uma tela só deve ser marcada como concluída quando seus critérios de aceite forem atendidos ou as limitações restantes estiverem explicitamente registradas.

As correções anteriores nas telas de pesquisa e jobs não constituem uma auditoria completa de todos os seus comportamentos. A inspeção autenticada em navegador permanece pendente.
