; PiDesk 安装/卸载向导文案覆盖（双语，随安装器语言切换）。
;
; 生效原理：electron-builder 把本文件 !include 在 installer.nsi 模板之前
; （NsisTarget.computeFinalScript 将生成段拼在模板脚本前面），此时 MUI 页面宏
; 尚未展开，所以下面的编译期 define 能被 MUI_PAGE_WELCOME / MUI_UNPAGE_WELCOME 读取；
; LangString（en-US=1033 / zh-CN=2052）在运行时按当前安装器语言取值。
; 本文件会同时拼进安装与卸载两份脚本，安装侧 define 在卸载脚本里不会被读取，反之亦然。
;
; 前置条件：electron-builder.yml 里 nsis.installerLanguages 必须是 [en-US, zh-CN]——
; 不设时 NSIS 会内置全量 ~60 种语言，LangString 未覆盖的语种会触发 6040 警告，
; 而 makensis 以 -WX 把警告当错误直接终止打包。
; makensis 以 -INPUTCHARSET UTF8 解析输入，本文件保持 UTF-8（无 BOM）即可。

LangString PIDESK_WELCOME_TITLE 1033 "Welcome to the PiDesk Setup Wizard"
LangString PIDESK_WELCOME_TITLE 2052 "欢迎使用 PiDesk 安装向导"
LangString PIDESK_WELCOME_TEXT 1033 "This wizard will install PiDesk on your computer.$\r$\n$\r$\nIt is recommended that you close all other applications before continuing.$\r$\n$\r$\nClick Next to continue, or Cancel to exit the Setup Wizard."
LangString PIDESK_WELCOME_TEXT 2052 "本向导将帮助你在计算机上安装 PiDesk。$\r$\n$\r$\n建议在继续之前关闭其他所有应用程序。$\r$\n$\r$\n单击「下一步」(N) 继续，或单击「取消」退出安装向导。"
!define MUI_WELCOMEPAGE_TITLE "$(PIDESK_WELCOME_TITLE)"
!define MUI_WELCOMEPAGE_TEXT "$(PIDESK_WELCOME_TEXT)"

LangString PIDESK_UNWELCOME_TITLE 1033 "Uninstall PiDesk"
LangString PIDESK_UNWELCOME_TITLE 2052 "欢迎使用 PiDesk 卸载向导"
LangString PIDESK_UNWELCOME_TEXT 1033 "This wizard will uninstall PiDesk from your computer. It is recommended that you close PiDesk before continuing.$\r$\n$\r$\nClick Uninstall to start the uninstallation, or Cancel to exit the wizard."
LangString PIDESK_UNWELCOME_TEXT 2052 "此向导将从计算机中卸载 PiDesk。建议在继续之前关闭正在运行的 PiDesk。$\r$\n$\r$\n单击「卸载(U)」开始卸载，或单击「取消」退出卸载向导。"
!define MUI_UNWELCOMEPAGE_TITLE "$(PIDESK_UNWELCOME_TITLE)"
!define MUI_UNWELCOMEPAGE_TEXT "$(PIDESK_UNWELCOME_TEXT)"
