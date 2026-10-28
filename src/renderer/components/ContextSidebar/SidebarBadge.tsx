import type { ViewPanelBadge } from "../../../shared/view";
import { sidebarBadgeText } from "./badgeSemantics";
import styles from "./ContextSidebar.module.css";

/** 纯视觉徽章；语义由父级 aria-label 承担（这里 aria-hidden）。 */
export function SidebarBadge({ badge, className }: { badge: ViewPanelBadge; className?: string }) {
  const text = sidebarBadgeText(badge);
  return (
    <span
      className={[styles.badge, className].filter(Boolean).join(" ")}
      data-tone={badge.tone}
      data-dot={text === null ? "true" : undefined}
      aria-hidden="true"
    >
      {text ?? ""}
    </span>
  );
}
