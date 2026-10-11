import {
  ArrowsClockwise,
  ArrowsIn,
  CaretDown,
  CaretUp,
  Crosshair,
  Cube,
  Palette,
  TreeStructure,
} from "@phosphor-icons/react";
import { useT } from "../../../../hooks/useT";
import type { BrowserPanelTab } from "../../../../stores/uiStore";
import { Segmented } from "../../../ui/Segmented";
import styles from "./BrowserInspector.module.css";

/**
 * 检查器区的二级 tab 条（docs/design/06 §3.2 ④）。
 * 纯展示组件：只有「哪一项可见」和回调，不碰任何业务状态。
 */

export const BROWSER_PANE_TABS: Array<{
  id: BrowserPanelTab;
  labelKey: string;
  icon: typeof Crosshair;
}> = [
  { id: "pick", labelKey: "browser.tab.pick", icon: Crosshair },
  { id: "styles", labelKey: "browser.tab.styles", icon: Palette },
  { id: "boxModel", labelKey: "browser.tab.boxModel", icon: Cube },
  { id: "dom", labelKey: "browser.tab.structure", icon: TreeStructure },
];

interface BrowserPaneTabsProps {
  active: BrowserPanelTab;
  onSelect: (tab: BrowserPanelTab) => void;
  /** 重新拉取当前节点的三件套。 */
  onRefresh: () => void;
  /** 尚无检查目标时禁用刷新。 */
  refreshDisabled: boolean;
  /** 检查器是否已收起。 */
  collapsed: boolean;
  /** 切换收起/展开。 */
  onToggleCollapsed: () => void;
  /** 是否渲染在系统级浮窗内（刷新/停靠在标题条，此处只留页签）。 */
  floatHost?: boolean;
  /** 打开浮窗（主窗）；浮窗打开后主窗检查器整段隐藏，故无需「聚焦」态。 */
  onFloat?: () => void;
}

export function BrowserPaneTabs({
  active,
  onSelect,
  onRefresh,
  refreshDisabled,
  collapsed,
  onToggleCollapsed,
  floatHost = false,
  onFloat,
}: BrowserPaneTabsProps) {
  const t = useT();
  return (
    <div className={styles.paneTabs}>
      <Segmented
        ariaLabel={t("browser.inspector.label")}
        className={styles.paneSeg}
        semantics="tab"
        equal={false}
        scrollable
        size="sm"
        value={active}
        items={BROWSER_PANE_TABS.map((tab) => {
          const Icon = tab.icon;
          return {
            value: tab.id,
            label: t(tab.labelKey),
            icon: <Icon size={14} weight={tab.id === active ? "fill" : "regular"} />,
          };
        })}
        onChange={onSelect}
      />
      {floatHost ? null : (
        <>
          <div className={styles.paneSpacer} />
          {!collapsed && (
            <button
              type="button"
              className={styles.refreshButton}
              title={t("browser.inspector.refreshNode")}
              disabled={refreshDisabled}
              onClick={onRefresh}
            >
              <ArrowsClockwise size={14} weight="regular" />
            </button>
          )}
          {onFloat && (
            <button
              type="button"
              className={styles.refreshButton}
              title={t("browser.inspector.float")}
              onClick={onFloat}
            >
              <ArrowsIn size={14} weight="regular" />
            </button>
          )}
          <button
            type="button"
            className={styles.refreshButton}
            title={collapsed ? t("browser.inspector.expand") : t("browser.inspector.collapse")}
            aria-expanded={!collapsed}
            onClick={onToggleCollapsed}
          >
            {collapsed ? (
              <CaretDown size={16} weight="regular" />
            ) : (
              <CaretUp size={16} weight="regular" />
            )}
          </button>
        </>
      )}
    </div>
  );
}
