/**
 * 对话流问题导航分段栏的标记样式（设置 → 个性化）。
 * 持久化只存样式 id，渲染层据此选 QuestionRail.module.css 的形状变体类；
 * 「距焦点 4 档缩放山 + 激活高亮 + 悬停气泡」机制不变，只换标记几何形状，
 * 缩放轴（scaleX / scale / scaleY）由各变体类自决。
 */

export const RAIL_STYLES = ["line", "dot", "tick", "pill", "diamond", "bar", "ring"] as const;

export type RailStyle = (typeof RAIL_STYLES)[number];

/** 默认样式：现状短线，向后兼容旧设置文件。 */
export const DEFAULT_RAIL_STYLE: RailStyle = "line";

function isRailStyle(value: unknown): value is RailStyle {
  return typeof value === "string" && (RAIL_STYLES as readonly string[]).includes(value);
}

/** 非法值回退默认样式（手改设置文件 / 旧数据共用）。 */
function normalizeRailStyle(value: unknown): RailStyle {
  return isRailStyle(value) ? value : DEFAULT_RAIL_STYLE;
}

export { isRailStyle, normalizeRailStyle };
