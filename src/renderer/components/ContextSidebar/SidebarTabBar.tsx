import { PuzzlePiece, X } from "@phosphor-icons/react";
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef } from "react";
import { useT } from "../../hooks/useT";
import type { RightSidebarTab } from "../../stores/uiStore";
import { revealInNearestScroller } from "../../utils/revealInScroller";
import { sidebarBadgeLabel } from "./badgeSemantics";
import styles from "./ContextSidebar.module.css";
import { SidebarBadge } from "./SidebarBadge";
import type { SidebarFeature } from "./sidebarFeatures";

/** 页签条尺寸停稳多久后再定位激活页签（避开展开补间 / 拖宽途中的来回蹭）。 */
const TAB_REVEAL_SETTLE_MS = 150;

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
  const stripRef = useRef<HTMLDivElement>(null);

  // 从加号菜单打开的新页签追加在末尾，滚动容器要把它带进可视区。
  // 只滚页签条自己：挂载时侧栏还在展开补间里（宽度从 0 长起），scrollIntoView
  // 会把 #root 一起横滚，整页弹跳一下（见 utils/revealInScroller.ts 文件头）。
  // 页签条宽度还在变（展开补间、拖宽）时不逐帧定位——那会在窄条里来回蹭；
  // 等尺寸停稳再定位，打开补间结束后激活页签照样落在视野里。
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeTab 是触发定位的信号
  useEffect(() => {
    const strip = stripRef.current;
    const active = activeRef.current;
    if (!strip || !active) return;
    const reveal = (): void => revealInNearestScroller(active, "x");
    reveal();
    let timer = 0;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(reveal, TAB_REVEAL_SETTLE_MS);
    });
    observer.observe(strip);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
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
    <div
      ref={stripRef}
      className={styles.tabStrip}
      role="tablist"
      aria-label={t("panels.context.tabList")}
    >
      {tabs.map((tab) => {
        const feature = featureById.get(tab);
        const title = feature?.tabTitle ?? feature?.title ?? t("panels.context.extensionFallback");
        const IconComponent = feature?.icon ?? PuzzlePiece;
        const active = tab === activeTab;
        const closeLabel = t("ui.view.closeTitled", { title });
        // 徽章只在面板不在前台时提示（docs/06 R7）；前台时面板正文自己会说。
        const badge = active ? undefined : feature?.badge;
        // 徽章语义进页签的可访问名称：圆点/颜色不能是唯一信号（docs/06 R7）
        const accessibleName = badge ? sidebarBadgeLabel(t, title, badge) : undefined;
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
              aria-label={accessibleName}
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
              {badge ? <SidebarBadge badge={badge} /> : null}
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
