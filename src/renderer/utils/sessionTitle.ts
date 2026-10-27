import type { SessionSummary } from "../../shared/ipc";

/**
 * 会话列表展示用标题：pi 的显式名字优先（JSONL 最后一条 session_info，
 * 与 pi 自己的会话选择器一致），否则把首条用户消息里的换行/连续空白压成
 * 单个空格（侧栏所有地方都是单行展示），尚无用户消息的会话用调用方给的占位文案。
 *
 * 首条消息是实时计算的兜底，不落库；显式名字只存 pi，所以两边默认永远一致。
 * 这里不做字数截断：侧栏标题一律单行，截断由 `.historyTitle` 的 CSS 省略号按行宽处理
 * （行宽由侧栏轨道 + 行内边距 + 右缘动作槽决定，见 SideNav.module.css），
 * 全文与元信息交给悬浮详情卡。
 */
export function sessionTitle(session: SessionSummary, untitled: string): string {
  const name = session.sessionName?.trim();
  if (name) return name;
  return session.firstUserMessage?.replace(/\s+/g, " ").trim() || untitled;
}
