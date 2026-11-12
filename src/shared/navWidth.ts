/**
 * 左侧导航栏宽度的合法区间与归一（docs/design/137）。
 *
 * 宽度是**用户偏好**：持久化进 settings.json 并进入设置同步白名单（与主题、折叠态同层）。
 * 主进程写入校验与渲染层水合共用本文件，避免两边各写一套上下限。
 *
 * 为什么下限不是"再窄一点也行"：侧栏行是「图标 + 标题 + 状态槽 + ⋯」四段并排，
 * 窄于 180px 时标题只剩两三个字，历史条目就失去可读性；上限则交给运行时的
 * 「中央区最小宽」夹取（见 renderer/utils/navGeometry），这里只挡明显离谱的手改值。
 */

/** 侧栏展开态默认宽度（px），与 tokens.css 的 `--nav-width` 保持同值。 */
export const NAV_WIDTH_DEFAULT = 248;
/** 侧栏折叠态宽度（px），与 tokens.css 的 `--nav-width-collapsed` 保持同值；不参与拖拽。 */
export const NAV_WIDTH_COLLAPSED = 56;
/** 侧栏展开态最小宽度（px）：再窄标题就不可读，任何路径都不得低于它。 */
export const NAV_WIDTH_MIN = 180;
/** 侧栏展开态最大宽度（px）：运行时还会按「中央区最小宽」二次夹取。 */
export const NAV_WIDTH_MAX = 480;

/** 把任意值夹到合法区间；非法（非数字 / NaN）回退默认宽度。 */
export function clampNavWidth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return NAV_WIDTH_DEFAULT;
  return Math.min(NAV_WIDTH_MAX, Math.max(NAV_WIDTH_MIN, Math.round(value)));
}
