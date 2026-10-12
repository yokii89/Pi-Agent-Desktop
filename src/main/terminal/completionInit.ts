import fs from "node:fs";
import path from "node:path";

/** PowerShell 侧的 UTF-8 前缀（中文 Windows 默认 GBK，xterm 按 UTF-8 渲染会乱码）。 */
const PS_UTF8_PREFIX = "chcp 65001 >$null";

/**
 * 把 Tab 从「逐个循环」改绑成「一次列出候选」。
 *
 * 守卫条件不可省：实测用户 profile 先于 `-Command` 执行，直接绑等于踩掉用户自己的绑定。
 * `-eq 'Complete'` 那种写法在这里是错的——PSReadLine 2.0.0 的 Completion 组只有
 * MenuComplete / TabCompleteNext / TabCompletePrevious，实测 `-Function Complete`
 * 既不列候选也不执行。
 */
const PS_MENU_BIND =
  "if (Get-Module -ListAvailable PSReadLine) { Import-Module PSReadLine; " +
  "$tab = (Get-PSReadLineKeyHandler -Bound | Where-Object { $_.Key -eq 'Tab' } | Select-Object -First 1).Function; " +
  "if (-not $tab -or $tab -eq 'TabCompleteNext' -or $tab -eq 'MenuComplete') { " +
  "Set-PSReadLineKeyHandler -Key Tab -Function MenuComplete } }";

/** bash 侧键表：先 $include 用户自己的，再覆盖 Tab。首行缺失文件时静默。 */
const BASH_INPUTRC = [
  "$include ~/.inputrc",
  "set bell-style none",
  "set show-all-if-ambiguous on",
  // readline 的 Tab 序列必须写成转义形式，字面制表符不被识别
  '"\\t": menu-complete',
].join("\n");

/** 拼 PowerShell 的 `-Command` 串。 */
export function buildPowerShellCommand(menuCompletion: boolean): string {
  return menuCompletion ? `${PS_UTF8_PREFIX}; ${PS_MENU_BIND}` : PS_UTF8_PREFIX;
}

/**
 * 生成（内容未变则复用）bash 的 readline 键表，返回可写进 `INPUTRC` 的路径。
 * 走环境变量而不是 `--rcfile`：后者会顶掉 `~/.bashrc`，把用户自定义一并丢了。
 */
export function ensureBashInputrc(dir: string): string {
  const file = path.join(dir, "pidesk.inputrc");
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === `${BASH_INPUTRC}\n`) return file;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, `${BASH_INPUTRC}\n`);
  return file;
}
