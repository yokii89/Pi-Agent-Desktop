import type { ExtensionContribution } from "../../shared/contribution";
import type { ActivationTxn, LastKnownMode } from "./contributionProjection";

export type PanelCatalogState = "advertised" | "activating" | "failed" | "suspended" | "live";

/** 右侧栏启动页 / 加号菜单 / 冷态占位使用的 Catalog panel 投影。 */
export interface PanelCatalogRow {
  key: string;
  contributionKey: string;
  /** 稳定页签 id（= live 的 placementHint.panelId）。 */
  id: string;
  title: string;
  description?: string;
  icon?: string;
  state: PanelCatalogState;
  error?: string;
}

export interface PanelCatalogInput {
  /** 当前 active 上下文（用户/项目）的完整 Catalog 条目。 */
  catalogEntries: readonly ExtensionContribution[];
  /** 当前 active 会话可见的 live 面板。 */
  visiblePanels: ReadonlyArray<{
    id: string;
    panelId?: string;
    contributionKey?: string;
  }>;
  activationTxns: readonly ActivationTxn[];
  lastKnownModes: readonly LastKnownMode[];
  activeSessionId: string | null;
}

function livePanelId(panel: PanelCatalogInput["visiblePanels"][number]): string {
  return panel.panelId ?? `ext-${panel.id}`;
}

/**
 * Catalog panel 条目投影（docs/design/19 §10.1 / docs/design/66）。
 *
 * 与旧版「只投影没有 live 的条目」不同：live 与否都保留，启动页与加号菜单
 * 需要所有可打开的功能；页签身份统一为 `ext:<Catalog id>`，live 面板按
 * contributionKey 或 panelId 与 Catalog 对账。
 *
 * 状态优先级：live > 激活事务（failed/activating）> last-known(suspended) > advertised。
 */
export function projectPanelCatalogRows(input: PanelCatalogInput): PanelCatalogRow[] {
  const { catalogEntries, visiblePanels, activationTxns, lastKnownModes, activeSessionId } = input;
  return catalogEntries
    .filter((entry) => entry.placement === "panel")
    .map((entry) => {
      const live = visiblePanels.find(
        (panel) => panel.contributionKey === entry.key || livePanelId(panel) === entry.id,
      );
      const txn = activationTxns.find(
        (candidate) =>
          candidate.contributionKey === entry.key &&
          (candidate.sessionId === activeSessionId ||
            (candidate.sessionId === null && !activeSessionId)),
      );
      let state: PanelCatalogState = "advertised";
      if (live) state = "live";
      else if (txn && !txn.error) state = "activating";
      else if (txn?.error) state = "failed";
      else if (lastKnownModes.some((mode) => mode.contributionKey === entry.key)) {
        state = "suspended";
      }
      return {
        key: entry.key,
        contributionKey: entry.key,
        id: entry.id,
        title: entry.title,
        description: entry.description,
        icon: entry.icon,
        state,
        error: txn?.error,
      };
    });
}
