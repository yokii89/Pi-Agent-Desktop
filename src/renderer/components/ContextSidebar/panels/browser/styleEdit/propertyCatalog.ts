/**
 * 热更改属性目录（docs/design/22 §4.2）——PiDesk 前端包装的控件映射表。
 * 静态常量，不随页面 DOM 变化；未命中目录的属性走「文本」控件 + 添加属性。
 */

export type StyleValueKind = "length" | "color" | "enum" | "text";

export interface StylePropertyMeta {
  name: string;
  kind: StyleValueKind;
  /** kind=enum 的选项。 */
  options?: readonly string[];
  /** kind=length 的默认单位。 */
  defaultUnit?: string;
  /** 添加属性菜单里的分组标签。 */
  group: string;
}

const LENGTH = (name: string, group: string, defaultUnit = "px"): StylePropertyMeta => ({
  name,
  kind: "length",
  defaultUnit,
  group,
});

const COLOR = (name: string, group: string): StylePropertyMeta => ({
  name,
  kind: "color",
  group,
});

const ENUM = (name: string, group: string, options: readonly string[]): StylePropertyMeta => ({
  name,
  kind: "enum",
  options,
  group,
});

const TEXT = (name: string, group: string): StylePropertyMeta => ({
  name,
  kind: "text",
  group,
});

export const STYLE_PROPERTY_CATALOG: readonly StylePropertyMeta[] = [
  // 盒模型
  LENGTH("margin-top", "盒模型"),
  LENGTH("margin-right", "盒模型"),
  LENGTH("margin-bottom", "盒模型"),
  LENGTH("margin-left", "盒模型"),
  LENGTH("margin", "盒模型"),
  LENGTH("padding-top", "盒模型"),
  LENGTH("padding-right", "盒模型"),
  LENGTH("padding-bottom", "盒模型"),
  LENGTH("padding-left", "盒模型"),
  LENGTH("padding", "盒模型"),
  LENGTH("width", "盒模型"),
  LENGTH("height", "盒模型"),
  LENGTH("min-width", "盒模型"),
  LENGTH("max-width", "盒模型"),
  LENGTH("min-height", "盒模型"),
  LENGTH("max-height", "盒模型"),
  ENUM("box-sizing", "盒模型", ["border-box", "content-box"]),
  // 边框 / 圆角 / 阴影
  LENGTH("border-radius", "边框"),
  LENGTH("border-width", "边框"),
  ENUM("border-style", "边框", ["solid", "dashed", "dotted", "none", "double", "groove"]),
  COLOR("border-color", "边框"),
  TEXT("box-shadow", "边框"),
  TEXT("border", "边框"),
  // 布局
  ENUM("display", "布局", [
    "block",
    "inline",
    "inline-block",
    "flex",
    "inline-flex",
    "grid",
    "inline-grid",
    "none",
    "contents",
  ]),
  ENUM("position", "布局", ["static", "relative", "absolute", "fixed", "sticky"]),
  ENUM("float", "布局", ["none", "left", "right"]),
  ENUM("clear", "布局", ["none", "left", "right", "both"]),
  ENUM("overflow", "布局", ["visible", "hidden", "scroll", "auto", "clip"]),
  ENUM("overflow-x", "布局", ["visible", "hidden", "scroll", "auto", "clip"]),
  ENUM("overflow-y", "布局", ["visible", "hidden", "scroll", "auto", "clip"]),
  ENUM("visibility", "布局", ["visible", "hidden", "collapse"]),
  ENUM("box-orient", "布局", ["horizontal", "vertical"]),
  // Flex / Grid
  ENUM("flex-direction", "Flex", ["row", "row-reverse", "column", "column-reverse"]),
  ENUM("flex-wrap", "Flex", ["nowrap", "wrap", "wrap-reverse"]),
  ENUM("justify-content", "Flex", [
    "flex-start",
    "flex-end",
    "center",
    "space-between",
    "space-around",
    "space-evenly",
  ]),
  ENUM("align-items", "Flex", ["stretch", "flex-start", "flex-end", "center", "baseline"]),
  ENUM("align-self", "Flex", ["auto", "stretch", "flex-start", "flex-end", "center", "baseline"]),
  ENUM("align-content", "Flex", [
    "stretch",
    "flex-start",
    "flex-end",
    "center",
    "space-between",
    "space-around",
  ]),
  LENGTH("flex-grow", "Flex", ""),
  LENGTH("flex-shrink", "Flex", ""),
  LENGTH("flex-basis", "Flex", "px"),
  LENGTH("flex", "Flex", ""),
  LENGTH("order", "Flex", ""),
  LENGTH("gap", "Flex"),
  LENGTH("row-gap", "Flex"),
  LENGTH("column-gap", "Flex"),
  TEXT("grid-template-columns", "Flex"),
  TEXT("grid-template-rows", "Flex"),
  // 排版
  COLOR("color", "排版"),
  TEXT("font-family", "排版"),
  LENGTH("font-size", "排版"),
  ENUM("font-weight", "排版", [
    "100",
    "200",
    "300",
    "400",
    "500",
    "600",
    "700",
    "800",
    "900",
    "normal",
    "bold",
  ]),
  ENUM("font-style", "排版", ["normal", "italic", "oblique"]),
  LENGTH("line-height", "排版", ""),
  LENGTH("letter-spacing", "排版"),
  ENUM("text-align", "排版", ["left", "right", "center", "justify", "start", "end"]),
  ENUM("text-decoration-line", "排版", ["none", "underline", "overline", "line-through"]),
  ENUM("text-transform", "排版", ["none", "uppercase", "lowercase", "capitalize"]),
  ENUM("white-space", "排版", ["normal", "nowrap", "pre", "pre-wrap", "pre-line"]),
  ENUM("word-break", "排版", ["normal", "break-all", "keep-all", "break-word"]),
  ENUM("vertical-align", "排版", [
    "baseline",
    "top",
    "middle",
    "bottom",
    "text-top",
    "text-bottom",
  ]),
  // 视觉
  COLOR("background-color", "视觉"),
  TEXT("background-image", "视觉"),
  LENGTH("opacity", "视觉", ""),
  TEXT("transform", "视觉"),
  TEXT("filter", "视觉"),
  TEXT("backdrop-filter", "视觉"),
  ENUM("cursor", "视觉", [
    "auto",
    "default",
    "pointer",
    "wait",
    "text",
    "move",
    "not-allowed",
    "grab",
    "grabbing",
    "crosshair",
  ]),
  ENUM("pointer-events", "视觉", ["auto", "none"]),
  ENUM("object-fit", "视觉", ["fill", "contain", "cover", "none", "scale-down"]),
  ENUM("user-select", "视觉", ["auto", "none", "text", "all"]),
  // 定位
  LENGTH("top", "定位"),
  LENGTH("right", "定位"),
  LENGTH("bottom", "定位"),
  LENGTH("left", "定位"),
  ENUM("z-index", "定位", ["auto", "0", "1", "10", "100", "1000"]),
];

const BY_NAME = new Map(STYLE_PROPERTY_CATALOG.map((meta) => [meta.name, meta]));

const DEFAULT_META: StylePropertyMeta = { name: "", kind: "text", group: "其他" };

export function resolvePropertyMeta(name: string): StylePropertyMeta {
  return BY_NAME.get(name.trim().toLowerCase()) ?? { ...DEFAULT_META, name: name.trim() };
}

/** 添加属性时的可搜列表（按 group / name 过滤）。 */
export function searchCatalog(query: string, limit = 12): StylePropertyMeta[] {
  const q = query.trim().toLowerCase();
  const hits = STYLE_PROPERTY_CATALOG.filter(
    (meta) => !q || meta.name.includes(q) || meta.group.toLowerCase().includes(q),
  );
  return hits.slice(0, limit);
}

/** 当前节点上「被调整」的属性名集合（含简写覆盖长手的判定）。 */
export function adjustedNameSet(names: Iterable<string>): Set<string> {
  const set = new Set<string>();
  for (const name of names) set.add(name.trim().toLowerCase());
  return set;
}

const SHORTHAND_COVERS: Record<string, string[]> = {
  margin: ["margin-top", "margin-right", "margin-bottom", "margin-left"],
  padding: ["padding-top", "padding-right", "padding-bottom", "padding-left"],
  border: ["border-width", "border-style", "border-color"],
  "border-radius": [
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-right-radius",
    "border-bottom-left-radius",
  ],
  overflow: ["overflow-x", "overflow-y"],
  gap: ["row-gap", "column-gap"],
  background: ["background-color", "background-image"],
  flex: ["flex-grow", "flex-shrink", "flex-basis"],
};

/** computed 行是否被 PiDesk 调整覆盖（简写 ↔ 长手双向）。 */
export function isComputedAdjusted(computedName: string, adjusted: Set<string>): boolean {
  const name = computedName.trim().toLowerCase();
  if (adjusted.has(name)) return true;
  for (const [shorthand, longhands] of Object.entries(SHORTHAND_COVERS)) {
    if (name === shorthand && longhands.some((item) => adjusted.has(item))) return true;
    if (longhands.includes(name) && adjusted.has(shorthand)) return true;
  }
  return false;
}
