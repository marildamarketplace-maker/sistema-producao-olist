// Classifica stderr sem encaminhar URLs, dados de páginas, paths ou secrets ao journal.
export function diagnosticoBrowser(saida: string, codigo?: string) {
  if (codigo === "EADDRINUSE" || /address already in use|EADDRINUSE/i.test(saida)) {
    return "PORTA_OCUPADA: confira processos nas portas locais 8931 e 9222; não inicie um segundo serviço.";
  }
  if (/no usable sandbox|failed to move to new namespace|sandbox.*(?:operation not permitted|permission denied)|apparmor.*(?:denied|restrict)/i.test(saida)) {
    return "SANDBOX_BLOQUEADA: o Ubuntu bloqueou o isolamento do Chromium. Confira AppArmor e user namespaces; não execute como root nem desative a sandbox.";
  }
  if (/missing x server|cannot open display|unable to open.*display|authorization required|no protocol specified|x11.*(?:failed|error)/i.test(saida)) {
    return "TELA_INACESSIVEL: confira DISPLAY, XAUTHORITY e se operador está conectado ao XFCE.";
  }
  if (/processsingleton|singletonlock|profile.*(?:in use|locked)|user data directory is already in use/i.test(saida)) {
    return "PERFIL_EM_USO: feche somente o navegador manual que usa esse perfil antes de iniciar o serviço. Não apague o perfil.";
  }
  if (/error while loading shared libraries|cannot open shared object file/i.test(saida)) {
    return "BIBLIOTECA_AUSENTE: um administrador deve instalar as dependências Linux do Chromium pelo Playwright.";
  }
  if (codigo === "ENOENT" || codigo === "MODULE_NOT_FOUND" || /executable.*doesn't exist|cannot find module/i.test(saida)) {
    return "INSTALACAO_INCOMPLETA: confira o caminho do MCP, a instalação do Playwright e seu Chromium.";
  }
  if (/permission denied|EACCES/i.test(saida) || codigo === "EACCES") {
    return "PERMISSAO_NEGADA: confira o proprietário do perfil e as permissões de instalação do usuário operador.";
  }
  if (/unknown option|unexpected argument|unrecognized option/i.test(saida)) {
    return "VERSAO_INCOMPATIVEL: confira a versão instalada do Playwright MCP e as opções suportadas.";
  }
  return "CAUSA_NAO_CLASSIFICADA: o processo encerrou sem diagnóstico reconhecido. É necessário conferir a inicialização do Chromium como operador.";
}
