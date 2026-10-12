import fs from "node:fs";
import path from "node:path";
import type { TerminalTabCompletion } from "../../shared/ipc";

/** PowerShell 侧的 UTF-8 前缀（中文 Windows 默认 GBK，xterm 按 UTF-8 渲染会乱码）。 */
const PS_UTF8_PREFIX = "chcp 65001 >$null";

/**
 * 「列出全部」档才改绑：PowerShell 出厂的 Tab 绑定 `TabCompleteNext` 本身就是循环切换，
 * 所以 cycle 档不注入任何东西，回到 shell 原生手感（也免掉菜单态的双回车代价）。
 *
 * 守卫不可省：实测用户 profile 先于 `-Command` 执行，直接绑等于踩掉用户自己的绑定。
 * `-eq 'Complete'` 那种写法在这里是错的——PSReadLine 2.0.0 的 Completion 组只有
 * MenuComplete / TabCompleteNext / TabCompletePrevious，实测 `-Function Complete`
 * 既不列候选也不执行。
 */
const PS_LIST_BIND =
  "if (Get-Module -ListAvailable PSReadLine) { Import-Module PSReadLine; " +
  "$tab = (Get-PSReadLineKeyHandler -Bound | Where-Object { $_.Key -eq 'Tab' } | Select-Object -First 1).Function; " +
  "if (-not $tab -or $tab -eq 'TabCompleteNext' -or $tab -eq 'MenuComplete') { " +
  "Set-PSReadLineKeyHandler -Key Tab -Function MenuComplete } }";

/**
 * bash 两档都要注入：readline 没有「只改一个变量」的入口，而 `INPUTRC` 会顶掉
 * `~/.inputrc`，所以首行 `$include` 把用户自己的设置接回来。
 *
 * 两档的差别只在要不要一上来铺一屏清单：`show-all-if-ambiguous` 才是「列出全部」的
 * 来源（实测同一种子 `ls /` 首次 Tab：带它 7 个候选同屏、不带它 0 个），
 * `menu-complete` 自身是「逐个替换当前词」。
 */
function bashInputrc(mode: TerminalTabCompletion): string {
  return [
    "$include ~/.inputrc",
    "set bell-style none",
    ...(mode === "list" ? ["set show-all-if-ambiguous on"] : []),
    // readline 的 Tab 序列必须写成转义形式，字面制表符不被识别
    `"\\t": ${mode === "list" ? "complete" : "menu-complete"}`,
  ].join("\n");
}

/** 拼 PowerShell 的 `-Command` 串。 */
export function buildPowerShellCommand(mode: TerminalTabCompletion): string {
  return mode === "list" ? `${PS_UTF8_PREFIX}; ${PS_LIST_BIND}` : PS_UTF8_PREFIX;
}

/**
 * 生成（内容未变则复用）bash 的 readline 键表，返回可写进 `INPUTRC` 的路径。
 * 走环境变量而不是 `--rcfile`：后者会顶掉 `~/.bashrc`，把用户自定义一并丢了。
 */
export function ensureBashInputrc(dir: string, mode: TerminalTabCompletion): string {
  const file = path.join(dir, "pidesk.inputrc");
  const content = `${bashInputrc(mode)}\n`;
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === content) return file;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}
