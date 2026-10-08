import type { SessionSummary } from "../../shared/ipc";

/** 项目子列表的标题字数上限：超出部分用 "..." 收尾（窄栏，8 字足够辨认）。 */
export const TITLE_MAX_CHARS = 8;

/**
 * 会话列表展示用标题：用户重命名过的自定义名优先，否则把首条用户消息里的
 * 换行/连续空白压成单个空格（侧栏所有地方都是单行展示），尚无用户消息的会话给统一占位文案。
 */
export function sessionTitle(session: SessionSummary, customTitle?: string | null): string {
  const custom = customTitle?.trim();
  if (custom) return custom;
  return session.firstUserMessage?.replace(/\s+/g, " ").trim() || "(无消息会话)";
}

/**
 * 按"字数"截断标题（中文按字符计，不能用 CSS 宽度代替——宽度随字号/字体浮动，
 * 拿不到确切的"8 个字"）。仅用于项目内的历史条目；悬浮卡的全文展示不受此限。
 */
export function truncateTitle(title: string, max = TITLE_MAX_CHARS): string {
  return title.length > max ? `${title.slice(0, max)}...` : title;
}
