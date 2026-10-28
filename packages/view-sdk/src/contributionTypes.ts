/**
 * Public contribution manifest types.
 *
 * GENERATED FILE — do not edit by hand.
 * Source of truth: PiDesk `src/shared/contribution.ts` (// #begin view-sdk-contribution … // #end view-sdk-contribution).
 * Regenerate: `node scripts/sync-view-sdk-types.mjs`
 * Verify:      `node scripts/sync-view-sdk-types.mjs --check`
 *
 * Only the manifest subset is mirrored; Catalog entries, activation
 * transactions and runtime/worker state stay Host-internal (准则 §7.1).
 */

/** Catalog 条目的挂载位置。仅这些 placement 进入静态目录。 */
export type ContributionPlacement =
  | "access-mode"
  | "settings"
  | "widget"
  | "header"
  | "sidebar"
  | "panel";

/** 扩展声明的激活条件。 */
export type ContributionActivation = "onAccessMode" | "onSettingsView" | "onSessionView";

export type ContributionAccent = "default" | "warning" | "success" | "danger";

/**
 * 宿主允许的图标映射名（manifest.icon / mode.icon 只能取自这里）。
 * 未知名字回落到通用 puzzle-piece；access-mode 芯片只渲染
 * `ACCESS_MODE_ICON_NAMES` 子集。
 */
export const CONTRIBUTION_ICON_NAMES = [
  "shield",
  "shield-check",
  "clipboard",
  "gear",
  "gear-six",
  "sliders",
  "puzzle-piece",
  "sparkle",
  "warning",
  "check-circle",
  "info",
  "folder",
  "globe",
  "git-pull-request",
  "terminal-window",
  "chat-circle",
  "robot",
  "database",
  "code",
  "list-checks",
  "calendar",
  "envelope",
  "chart-line",
] as const;

export type ContributionIconName = (typeof CONTRIBUTION_ICON_NAMES)[number];

/** access-mode 芯片实际渲染的图标子集（其余合法名字回落到默认图标）。 */
export const ACCESS_MODE_ICON_NAMES = ["shield", "shield-check", "clipboard"] as const;

export type AccessModeIconName = (typeof ACCESS_MODE_ICON_NAMES)[number];

export const CONTRIBUTION_ICONS: ReadonlySet<string> = new Set(CONTRIBUTION_ICON_NAMES);

/** 单包贡献数量上限；超出项跳过并记诊断。 */
export const CONTRIBUTION_LIMITS = {
  maxPerPackage: 32,
  maxTitleLength: 80,
  maxDescriptionLength: 400,
  maxIdLength: 64,
  maxIconLength: 40,
} as const;

/**
 * `package.json` → `pidesk.contributes.*[]` 的条目形状（docs/design/16 §5）。
 * 只放静态可发现信息；`active` / `detail` 等运行时真值由 live 注册提供。
 */
export interface ManifestContributionItem {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  accent?: ContributionAccent;
  activation?: ContributionActivation;
}
