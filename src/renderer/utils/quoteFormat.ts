/**
 * 会话流引用块格式化（docs/design/12 §4.4）：
 * 选中文本以 `> ` 逐行前缀组成引用块追加进输入栏，与用户自己的话在结构上区分，
 * pi 按引文前缀理解上下文归属。只产出逻辑文本（\n 分行），DOM 落地由 Composer 负责。
 */

/** 选中文本 → 引用行：整体去首尾空白后逐行加 `> ` 前缀，内部空行输出 `>`。 */
export function toQuoteLines(text: string): string[] {
  const trimmed = text.replace(/^\s+|\s+$/g, "");
  if (!trimmed) return [];
  return trimmed.split(/\r?\n/).map((line) => (line.trim().length === 0 ? ">" : `> ${line}`));
}

/**
 * 组装要追加进输入栏的文本：
 * - 草稿非空先补一个空行（草稿已带尾部换行则不重复补），避免与已写内容粘连；
 * - 末尾留一个空行，光标落此承接追问。
 */
export function formatQuoteBlock(draft: string, text: string): string {
  const lines = toQuoteLines(text);
  if (lines.length === 0) return "";
  if (draft.trim().length === 0) return `${lines.join("\n")}\n`;
  const lead = draft.endsWith("\n") ? "\n" : "\n\n";
  return `${lead}${lines.join("\n")}\n`;
}
