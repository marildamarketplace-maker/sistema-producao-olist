# Manter a sessão XFCE da VM disponível

Após atualizar o repositório, execute **no terminal dentro do XFCE**, como
`operador`, sem sudo:

```bash
cd ~/sistema-producao-olist
git pull --ff-only
bash scripts/configurar-xfce-vm.sh
```

O script desativa o autostart do Light Locker apenas para o usuário atual,
encerra esse bloqueador e configura o XFCE para nunca suspender por inatividade,
apagar ou desligar a tela. Os ajustes de energia são persistidos no Xfconf.
Não instala pacotes, não remove senhas e não reinicia LightDM, browser ou worker.
O acesso ao VNC precisa continuar protegido: a sessão permanecerá desbloqueada.

Cada execução guarda os valores anteriores e o autostart em uma pasta privada
`~/meury-xfce-backup.*`. Para desfazer, execute o `restaurar.sh` dessa pasta,
conforme o caminho exibido pelo script, e entre novamente na sessão. As opções
anteriores do X11 estão registradas em `tela-antes.txt`; a nova sessão reaplica
as configurações restauradas do gerenciador de energia.

Isso não impede crashes do XFCE, logout manual ou reboot da VM. O script também
não configura o worker como serviço: essa operação tem ciclo de vida separado.

Referência das propriedades: [XFCE Power Manager 4.18](https://github.com/xfce-mirror/xfce4-power-manager/blob/xfce-4.18/common/xfpm-config.h).
