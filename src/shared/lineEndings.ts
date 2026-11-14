/**
 * 换行的「探测 → 还原」（docs/design/141）。
 *
 * 编辑器内核（CodeMirror）按 `\n` 切行，CRLF 文件的 `\r` 会被丢掉；直接用编辑器内容
 * 覆盖写盘，等于把整个文件的行尾改写成 LF——在 git 里显示成「每一行都改了」。
 * 所以读入时记住原文件的换行风格，保存时再还原回去。
 *
 * 仓库自身约定 LF（`.gitattributes` / `.editorconfig`），但侧栏会打开项目外的任意文件，
 * 不能假设对方的行尾是 LF。
 */

export type LineEnding = "lf" | "crlf";

/**
 * 探测换行风格：出现任意一处 `\r\n` 即判为 CRLF。
 *
 * 混合行尾（同一文件里 CRLF 与 LF 并存）按 CRLF 处理——这种文件通常是某次编辑
 * 漏转的产物，保持原样比"顺手归一"更不容易制造意外 diff；真要归一应该显式做。
 */
export function detectLineEnding(text: string): LineEnding {
  return text.includes("\r\n") ? "crlf" : "lf";
}

/** 把「统一以 \n 分行」的文本按目标风格还原（先归一再拼，避免出现 `\r\r\n`）。 */
export function applyLineEnding(text: string, eol: LineEnding): string {
  const normalized = text.replace(/\r\n?/g, "\n");
  return eol === "crlf" ? normalized.replace(/\n/g, "\r\n") : normalized;
}

/**
 * 保存前的最终内容：换行还原 + 末尾换行沿用原文件。
 *
 * 末尾那个换行不还原会被 git 读成「文件末尾新增/删除换行」，而编辑器不显示它，
 * 用户根本没有察觉的余地——所以以原文件为准。
 */
export function toSavedContent(edited: string, original: string): string {
  // 空文件没有「原有风格」可言：编辑器给什么就存什么（CRLF 也还原不出来）
  if (original.length === 0) return edited;
  const eol = detectLineEnding(original);
  const newline = eol === "crlf" ? "\r\n" : "\n";
  let body = applyLineEnding(edited, eol);
  const originalEndsWithNewline = /\r?\n$/.test(original);
  const bodyEndsWithNewline = /\r?\n$/.test(body);
  if (originalEndsWithNewline && !bodyEndsWithNewline) body += newline;
  else if (!originalEndsWithNewline && bodyEndsWithNewline) body = body.slice(0, -newline.length);
  return body;
}
