import type { SessionEntry } from "../stores/sessionTranscript";
import { PAGE_CONTEXT_PREFIX, PAGE_CONTEXT_USER_HEADING } from "./pageContext";
import { parseUserMessageSegments, readableUserMessage } from "./userMessageSegments";

/**
 * 输入栏 ↑ / ↓ 历史召回的读数（docs/design/127）。
 * 数据源就是当前会话文档流里的用户消息，不另建存储：恢复会话后 pi JSONL 读回的历史同样可召回。
 */

/**
 * 带浏览器元素的历史消息，落盘文本是 buildPageContext 的整块 payload。
 * 召回只要「## 用户说明」那一段——把 DOM 描述灌进输入栏不是用户打过的一句话。
 * 按首处标题切（与 parseUserMessageSegments 同口径）：用户原话里也可能出现这个小节名。
 */
function userInstructionOf(raw: string): string {
  if (!raw.startsWith(PAGE_CONTEXT_PREFIX)) return raw;
  const heading = `\n${PAGE_CONTEXT_USER_HEADING}\n`;
  const at = raw.indexOf(heading);
  return at < 0 ? "" : raw.slice(at + heading.length);
}

/**
 * 会话用户输入 → 召回列表：**最新在前**，重复内容只保留最近一次。
 * 取可读文案（与气泡「复制」同一份）：机器用的引用路径附注与芯片元数据被剥掉，
 * @ 文件引用落回纯文本、不重建芯片。
 */
export function buildUserHistory(entries: readonly SessionEntry[]): string[] {
  const history: string[] = [];
  const seen = new Set<string>();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.kind !== "user") continue;
    const body = userInstructionOf(entry.text);
    const text = readableUserMessage(parseUserMessageSegments(body)).trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    history.push(text);
  }
  return history;
}
