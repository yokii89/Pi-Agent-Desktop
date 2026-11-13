/**
 * 桌面 toast 标题里的会话标识（`PiDesk · {session}` 的 `{session}`）。
 *
 * 与侧栏标题（`utils/sessionTitle`）的区别是取用户的**最新**一条消息而不是首条：
 * toast 只出现在窗口失焦、任务收口那一刻，用户想知道的是「刚才那一轮在干什么」；
 * pi 的显式会话名（session_info）通常是几天前改的旧名字，读不出当前任务。
 * 侧栏仍按首条/会话名展示——列表标题要稳定，不能随对话漂移。
 *
 * 三段消息/名字都压成单行（换行与连续空白折叠），字数截断交给 toast 协议层
 * （主进程 `TITLE_MAX`）与系统弹窗，这里不做。
 */
function oneLine(value: string | null | undefined): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim();
  return text || undefined;
}

export interface ToastSessionTitleInput {
  /** 该会话最新一条非空用户消息（桶内实时值）。 */
  lastUserText?: string | null;
  /** pi 的显式会话名（JSONL 最后一条 session_info）。 */
  sessionName?: string | null;
  /** 磁盘摘要里的首条用户消息，桶尚未装载时的兜底。 */
  firstUserMessage?: string | null;
}

/** 最新用户消息 > 会话名 > 首条用户消息；都没有时返回 undefined（只用应用名）。 */
export function toastSessionTitle(input: ToastSessionTitleInput): string | undefined {
  return (
    oneLine(input.lastUserText) ?? oneLine(input.sessionName) ?? oneLine(input.firstUserMessage)
  );
}
