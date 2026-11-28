import { FolderOpen, GitPullRequest, Globe, type Icon, PuzzlePiece } from "@phosphor-icons/react";
import type { TranslateFn } from "../../../shared/i18n";
import type { ShortcutsMap } from "../../../shared/shortcuts";
import type { ViewPanelBadge, ViewPlacementHint } from "../../../shared/view";
import type { PanelCatalogRow } from "../../stores/panelCatalog";
import { extensionPanelIdOf, type RightSidebarTab } from "../../stores/sidebarTabs";
import { contributionIconComponent } from "../ExtensionView/contributionIcons";

export { extensionPanelIdOf };

/** 启动页 / 加号菜单里的扩展面板元数据（Catalog 投影的最小形状）。 */
export type SidebarCatalogPanel = PanelCatalogRow;

export interface SidebarLivePanel {
  id: string;
  panelId?: string;
  title?: string;
  contributionKey?: string;
  /** 面板徽章来自 placementHint（docs/06 R7）；旧 Host 不保留该字段。 */
  placementHint?: ViewPlacementHint;
}

export interface SidebarFeature {
  id: RightSidebarTab;
  /** 启动页卡片与加号菜单的动作标题（如「打开工作区文件」）。 */
  title: string;
  /** 页签条上的短标题（如「工作区文件」）；缺省用 title。 */
  tabTitle?: string;
  description?: string;
  /** 键位提示；没有可绑定动作的功能不显示（菜单只展示这一行）。 */
  shortcut?: string;
  icon: Icon;
  source: "builtin" | "extension";
  /** 页签已打开（审查浮窗态也算打开，用于加号菜单排除）。 */
  open: boolean;
  /** 当前会话已有 live 面板；Catalog 冷态为 false。 */
  live: boolean;
  catalog?: SidebarCatalogPanel;
  /** 面板页签/启动页/加号菜单徽章（docs/06 R7）；不参与开合判定。 */
  badge?: ViewPanelBadge;
}

export interface SidebarFeatureInput {
  tabs: readonly RightSidebarTab[];
  browserEnabled: boolean;
  /** 审查浮窗是否打开（停靠态由 tabs 判断）。 */
  reviewWindowOpen: boolean;
  shortcuts: Pick<ShortcutsMap, "openFiles" | "openReview">;
  catalogRows: readonly SidebarCatalogPanel[];
  /** 当前 active 会话可见的 live 面板。 */
  visiblePanels: readonly SidebarLivePanel[];
  /** 全部 live 面板（含其它会话），用于给已打开页签兜底标题。 */
  allPanels: readonly SidebarLivePanel[];
  t: TranslateFn;
}

export function livePanelIdOf(panel: SidebarLivePanel): string {
  return panel.panelId ?? `ext-${panel.id}`;
}

/**
 * 右侧栏功能清单：内置功能在前，Catalog 扩展面板按 Catalog 顺序随后，
 * 最后补上「有 live 但未进 Catalog」以及「页签仍开着、当前却找不到 live/Catalog」
 * 的兜底条目。页签身份统一为 `ext:<panelId>`。
 */
export function buildSidebarFeatures(input: SidebarFeatureInput): SidebarFeature[] {
  const { tabs, t, visiblePanels, allPanels, catalogRows } = input;
  const isOpen = (id: RightSidebarTab): boolean => tabs.includes(id);

  const features: SidebarFeature[] = [
    {
      id: "files",
      title: t("panels.context.openFiles"),
      tabTitle: t("panels.context.files"),
      description: t("panels.context.openFilesHint"),
      shortcut: input.shortcuts.openFiles,
      icon: FolderOpen,
      source: "builtin",
      open: isOpen("files"),
      live: true,
    },
  ];

  if (input.browserEnabled) {
    features.push({
      id: "browser",
      title: t("panels.context.openBrowser"),
      tabTitle: t("panels.context.browser"),
      description: t("panels.context.openBrowserHint"),
      icon: Globe,
      source: "builtin",
      open: isOpen("browser"),
      live: true,
    });
  }

  features.push({
    id: "review",
    title: t("panels.context.openReview"),
    tabTitle: t("panels.context.review"),
    description: t("panels.context.openReviewHint"),
    shortcut: input.shortcuts.openReview,
    icon: GitPullRequest,
    source: "builtin",
    open: isOpen("review") || input.reviewWindowOpen,
    live: true,
  });

  const seen = new Set<string>();
  const seenContributionKeys = new Set<string>();

  for (const row of catalogRows) {
    const id = `ext:${row.id}` as const;
    seen.add(id);
    if (row.contributionKey) seenContributionKeys.add(row.contributionKey);
    const livePanel = visiblePanels.find(
      (panel) => panel.contributionKey === row.contributionKey || livePanelIdOf(panel) === row.id,
    );
    features.push({
      id,
      title: row.title || t("panels.context.extensionFallback"),
      description: row.description ?? t("panels.context.extensionHint"),
      icon: contributionIconComponent(row.icon),
      source: "extension",
      open: isOpen(id),
      live: row.state === "live" || livePanel !== undefined,
      catalog: row,
      badge: livePanel?.placementHint?.panelBadge,
    });
  }

  for (const panel of visiblePanels) {
    const panelId = livePanelIdOf(panel);
    const id = `ext:${panelId}` as const;
    if (seen.has(id)) continue;
    if (panel.contributionKey && seenContributionKeys.has(panel.contributionKey)) continue;
    seen.add(id);
    features.push({
      id,
      title: panel.title || t("panels.context.extensionFallback"),
      description: t("panels.context.extensionHint"),
      icon: PuzzlePiece,
      source: "extension",
      open: isOpen(id),
      live: true,
      badge: panel.placementHint?.panelBadge,
    });
  }

  // 页签仍开着，但当前 active 会话看不到它的 live（属于其它会话）且不在 Catalog：
  // 仍然给它一个标题/图标，页签条不至于出现空白项。
  for (const tab of tabs) {
    const panelId = extensionPanelIdOf(tab);
    if (panelId === null || seen.has(tab)) continue;
    const panel = allPanels.find((item) => livePanelIdOf(item) === panelId);
    features.push({
      id: tab,
      title: panel?.title || t("panels.context.extensionFallback"),
      description: t("panels.context.otherSession"),
      icon: PuzzlePiece,
      source: "extension",
      open: true,
      live: false,
      badge: panel?.placementHint?.panelBadge,
    });
  }

  return features;
}

/** 加号菜单：排除已经打开的页签/浮窗；左侧顺序与启动页一致。 */
export function addableFeatures(features: readonly SidebarFeature[]): SidebarFeature[] {
  return features.filter((feature) => !feature.open);
}
