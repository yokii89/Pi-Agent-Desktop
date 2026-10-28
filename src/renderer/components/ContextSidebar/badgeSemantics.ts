import type { TranslateFn } from "../../../shared/i18n";
import type { ViewPanelBadge } from "../../../shared/view";

/** 计数上限：超过显示 99+（docs/06 R7）。 */
export const MAX_BADGE_COUNT = 99;

/** 徽章的可见内容；null 表示只画圆点。 */
export function sidebarBadgeText(badge: ViewPanelBadge): string | null {
  if (badge.count !== undefined) {
    return badge.count > MAX_BADGE_COUNT ? "99+" : String(badge.count);
  }
  return badge.label ?? null;
}

/**
 * 徽章的语义文案：颜色与圆点不可读，页签/启动页/菜单的可访问名称必须带上它。
 * 有计数时读具体数字，没有时按 tone 读「有需要处理的事项」这类结论。
 */
export function sidebarBadgeLabel(t: TranslateFn, title: string, badge: ViewPanelBadge): string {
  const count = badge.count;
  const hasCount = count !== undefined && count > 0;
  if (badge.tone === "attention") {
    return hasCount
      ? t("panels.context.badgeAttention", { title, count })
      : t("panels.context.badgeAttentionHint", { title });
  }
  if (badge.tone === "success") {
    return hasCount
      ? t("panels.context.badgeSuccess", { title, count })
      : t("panels.context.badgeSuccessHint", { title });
  }
  return hasCount
    ? t("panels.context.badgeMuted", { title, count })
    : t("panels.context.badgeMutedHint", { title });
}
