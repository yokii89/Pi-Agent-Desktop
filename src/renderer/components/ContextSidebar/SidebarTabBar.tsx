import { PuzzlePiece, X } from "@phosphor-icons/react";
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef } from "react";
import { useT } from "../../hooks/useT";
import type { RightSidebarTab } from "../../stores/uiStore";
import styles from "./ContextSidebar.module.css";
import type { SidebarFeature } from "./sidebarFeatures";

/**
 * 可关闭的右侧栏页签条。
 *
 * 没有复用 `ui/Segmented`：页签项内带关闭按钮，属于 AGENTS「可关闭的文档页签」
 * 明确排除在分段控件之外的形态；滑块/橡皮筋也不适合表达「一排放得下就排、
 * 放不下横向滚动」的页签条。
 */
export function SidebarTabBar({
  tabs,
  activeTab,
  features,
  onSelect,
  onClose,
}: {
  tabs: readonly RightSidebarTab[];
  activeTab: RightSidebarTab;
  features: readonly SidebarFeature[];
  onSelect: (tab: RightSidebarTab) => void;
  onClose: (tab: RightSidebarTab) => void;
}) {
  const t = useT();
  const featureById = new Map(features.map((feature) => [feature.id, feature]));
  const tabRefs = useRef(new Map<RightSidebarTab, HTMLButtonElement>());
  const activeRef = useRef<HTMLButtonElement>(null);

  // 从加号菜单打开的新页签追加在末尾，滚动容器要把它带进可视区
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeTab 是触发滚动的信号
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTab]);

  const handleKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    tab: RightSidebarTab,
  ): void => {
    const index = tabs.indexOf(tab);
    if (index < 0) return;
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = tabs[nextIndex];
    if (!next) return;
    onSelect(next);
    tabRefs.current.get(next)?.focus();
  };

  return (
    <div className={styles.tabStrip} role="tablist" aria-label={t("panels.context.tabList")}>
      {tabs.map((tab) => {
        const feature = featureById.get(tab);
        const title = feature?.tabTitle ?? feature?.title ?? t("panels.context.extensionFallback");
        const IconComponent = feature?.icon ?? PuzzlePiece;
        const active = tab === activeTab;
        const closeLabel = t("ui.view.closeTitled", { title });
        return (
          <div
            key={tab}
            role="presentation"
            className={[styles.tabItem, active ? styles.tabItemActive : ""]
              .filter(Boolean)
              .join(" ")}
            data-sidebar-tab={tab}
            data-active={active ? "true" : undefined}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              title={title}
              className={styles.tabButton}
              ref={(node) => {
                if (!node) {
                  tabRefs.current.delete(tab);
                  if (active) activeRef.current = null;
                  return;
                }
                tabRefs.current.set(tab, node);
                if (active) activeRef.current = node;
              }}
              onClick={() => onSelect(tab)}
              onKeyDown={(event) => handleKeyDown(event, tab)}
            >
              <span className={styles.tabIcon}>
                <IconComponent size={16} weight="regular" />
              </span>
              <span className={styles.tabLabel}>{title}</span>
            </button>
            <button
              type="button"
              className={styles.tabClose}
              data-sidebar-tab-close=""
              title={closeLabel}
              aria-label={closeLabel}
              onClick={(event) => {
                event.stopPropagation();
                const index = tabs.indexOf(tab);
                const next = tabs[index + 1] ?? tabs[index - 1] ?? null;
                onClose(tab);
                const focusTarget = active ? next : activeTab;
                if (focusTarget) {
                  requestAnimationFrame(() => tabRefs.current.get(focusTarget)?.focus());
                }
              }}
            >
              <X size={12} weight="regular" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
