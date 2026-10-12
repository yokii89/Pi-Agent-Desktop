import type { SessionSummary } from "../../shared/ipc";

/**
 * 会话列表展示用标题：用户重命名过的自定义名优先，否则把首条用户消息里的
 * 换行/连续空白压成单个空格（侧栏所有地方都是单行展示），尚无用户消息的会话给统一占位文案。
 *
 * 这里不做字数截断：侧栏标题一律单行，截断由 `.historyTitle` 的 CSS 省略号按行宽处理
 * （行宽由侧栏轨道 + 行内边距 + 右缘动作槽决定，见 SideNav.module.css），
 * 全文与元信息交给悬浮详情卡。
 */
export function sessionTitle(session: SessionSummary, customTitle?: string | null): string {
  const custom = customTitle?.trim();
  if (custom) return custom;
  return session.firstUserMessage?.replace(/\s+/g, " ").trim() || "(无消息会话)";
}
