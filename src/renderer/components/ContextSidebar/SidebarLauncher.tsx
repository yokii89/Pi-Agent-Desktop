import { useT } from "../../hooks/useT";
import { sidebarBadgeLabel } from "./badgeSemantics";
import styles from "./ContextSidebar.module.css";
import { SidebarBadge } from "./SidebarBadge";
import type { SidebarFeature } from "./sidebarFeatures";

/**
 * 右侧栏一级界面：可打开功能的启动页。页签全部关闭时回到这里。
 * 功能卡不区分「是否打开」——启动页只在没有打开页签时出现；
 * 审查浮窗态例外，但它不是页签，卡片点击也不会产生新的页签。
 */
export function SidebarLauncher({
  features,
  onOpenFeature,
}: {
  features: readonly SidebarFeature[];
  onOpenFeature: (feature: SidebarFeature) => void;
}) {
  const t = useT();
  return (
    <div className={styles.launcher}>
      <ul
        className={styles.launcherList}
        aria-label={t("panels.context.launcherLabel")}
        data-sidebar-launcher=""
      >
        {features.map((feature) => {
          const IconComponent = feature.icon;
          const hint = feature.shortcut ?? feature.description;
          const badge = feature.badge;
          return (
            <li key={feature.id}>
              <button
                type="button"
                className={styles.launcherCard}
                data-sidebar-feature={feature.id}
                aria-busy={feature.catalog?.state === "activating" || undefined}
                aria-label={badge ? sidebarBadgeLabel(t, feature.title, badge) : undefined}
                onClick={() => onOpenFeature(feature)}
              >
                <span className={styles.launcherIcon}>
                  <IconComponent size={20} weight="regular" />
                </span>
                <span className={styles.launcherText}>
                  <span className={styles.launcherTitle}>{feature.title}</span>
                  {hint && <span className={styles.launcherHint}>{hint}</span>}
                </span>
                {badge ? <SidebarBadge badge={badge} className={styles.launcherBadge} /> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
