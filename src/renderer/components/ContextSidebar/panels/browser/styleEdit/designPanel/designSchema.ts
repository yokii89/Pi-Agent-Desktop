/**
 * 设计面板字段映射（拾取后自动填入的 CSS 数值 ↔ Figma 式控件）。
 * 只做「展示值 / 写入值」换算与多属性字段的合并，不碰 IPC。
 */

export type DesignValueKind = "length" | "number" | "percent" | "color" | "text" | "enum";

export interface DesignFieldMeta {
  /** 写入 stylePatch 的 CSS 属性名（单属性字段）。 */
  prop: string;
  kind: DesignValueKind;
  /** kind=length 的单位后缀（展示用，写入时拼上）。 */
  unit?: string;
  /** kind=enum 的固定选项。 */
  options?: readonly string[];
  /** 空值时的占位（设计图里的 auto）。 */
  placeholder?: string;
}

/** 位置 */
export const FIELD_X: DesignFieldMeta = {
  prop: "left",
  kind: "length",
  unit: "px",
  placeholder: "auto",
};
export const FIELD_Y: DesignFieldMeta = {
  prop: "top",
  kind: "length",
  unit: "px",
  placeholder: "auto",
};
export const FIELD_Z: DesignFieldMeta = {
  prop: "z-index",
  kind: "number",
  placeholder: "auto",
};
export const FIELD_ROTATE: DesignFieldMeta = {
  prop: "rotate",
  kind: "number",
  unit: "deg",
  placeholder: "0",
};

/** 布局 */
export const FIELD_W: DesignFieldMeta = {
  prop: "width",
  kind: "length",
  unit: "px",
  placeholder: "auto",
};
export const FIELD_H: DesignFieldMeta = {
  prop: "height",
  kind: "length",
  unit: "px",
  placeholder: "auto",
};
export const FIELD_RADIUS: DesignFieldMeta = {
  prop: "border-radius",
  kind: "length",
  unit: "px",
  placeholder: "0",
};

/** 外观 */
export const FIELD_OPACITY: DesignFieldMeta = {
  prop: "opacity",
  kind: "percent",
  unit: "%",
  placeholder: "100",
};

/** 文本 */
export const FIELD_FONT: DesignFieldMeta = {
  prop: "font-family",
  kind: "enum",
  placeholder: "—",
};
export const FIELD_WEIGHT: DesignFieldMeta = {
  prop: "font-weight",
  kind: "enum",
  options: ["100", "200", "300", "400", "500", "600", "700", "800", "900", "normal", "bold"],
  placeholder: "400",
};
export const FIELD_SIZE: DesignFieldMeta = {
  prop: "font-size",
  kind: "length",
  unit: "px",
  placeholder: "16",
};
export const FIELD_COLOR: DesignFieldMeta = {
  prop: "color",
  kind: "color",
  placeholder: "rgb(0, 0, 0)",
};
export const FIELD_LINE_HEIGHT: DesignFieldMeta = {
  prop: "line-height",
  kind: "text",
  unit: "px",
  placeholder: "normal",
};
export const FIELD_LETTER_SPACING: DesignFieldMeta = {
  prop: "letter-spacing",
  kind: "text",
  unit: "px",
  placeholder: "normal",
};

/** 背景 */
export const FIELD_BG_COLOR: DesignFieldMeta = {
  prop: "background-color",
  kind: "color",
  placeholder: "rgba(0, 0, 0, 0)",
};

/** 边框（单层简写长手） */
export const FIELD_BORDER_WIDTH: DesignFieldMeta = {
  prop: "border-width",
  kind: "length",
  unit: "px",
  placeholder: "0",
};
export const FIELD_BORDER_STYLE: DesignFieldMeta = {
  prop: "border-style",
  kind: "enum",
  options: ["none", "solid", "dashed", "dotted", "double", "groove", "ridge", "inset", "outset"],
  placeholder: "none",
};
export const FIELD_BORDER_COLOR: DesignFieldMeta = {
  prop: "border-color",
  kind: "color",
  placeholder: "rgb(0, 0, 0)",
};

/** 阴影与模糊 */
export const FIELD_BOX_SHADOW: DesignFieldMeta = {
  prop: "box-shadow",
  kind: "text",
  placeholder: "none",
};
export const FIELD_FILTER: DesignFieldMeta = {
  prop: "filter",
  kind: "text",
  placeholder: "none",
};

/** 盒四边字段：水平 = left+right，垂直 = top+bottom。 */
export const PAIR_PROPS = {
  paddingH: ["padding-left", "padding-right"],
  paddingV: ["padding-top", "padding-bottom"],
  marginH: ["margin-left", "margin-right"],
  marginV: ["margin-top", "margin-bottom"],
} as const;

export const FONT_OPTIONS = [
  "Arial",
  "Helvetica",
  "Georgia",
  '"Times New Roman"',
  '"Courier New"',
  "Verdana",
  "Tahoma",
  "system-ui",
  "sans-serif",
  "serif",
  "monospace",
  '"Microsoft YaHei"',
  '"PingFang SC"',
] as const;

export type FlowMode = "block" | "row" | "column" | "grid";
export type AlignMode = "left" | "center" | "right" | "justify";

export function normalizeProp(name: string): string {
  const trimmed = name.trim();
  return trimmed.startsWith("--") ? trimmed : trimmed.toLowerCase();
}

/** 从 computed + 已启用调整中解析单属性展示值（调整优先）。 */
export function resolveDisplayValue(
  prop: string,
  computed: ReadonlyMap<string, string>,
  declarations: ReadonlyArray<{ name: string; value: string; enabled: boolean }>,
): string {
  const key = normalizeProp(prop);
  const hit = declarations.find((decl) => decl.enabled && normalizeProp(decl.name) === key);
  return hit ? hit.value : (computed.get(key) ?? computed.get(prop) ?? "");
}

/** 盒四边水平/垂直合并值：两侧相同取该值，否则取前侧（left/top）。 */
export function resolvePairValue(
  props: readonly [string, string],
  computed: ReadonlyMap<string, string>,
  declarations: ReadonlyArray<{ name: string; value: string; enabled: boolean }>,
): string {
  const [a, b] = props;
  const va = resolveDisplayValue(a, computed, declarations);
  const vb = resolveDisplayValue(b, computed, declarations);
  return va || vb;
}

/** 「160px」→ 数字串「160」；「auto」原样；非长度原样。 */
export function splitLength(raw: string): { num: string; unit: string } {
  const text = raw.trim();
  if (!text || text === "auto" || text === "inherit" || text === "unset" || text === "normal") {
    return { num: text, unit: "" };
  }
  const match = /^([+-]?\d*\.?\d+)([a-z%]*)$/i.exec(text);
  if (!match) return { num: text, unit: "" };
  return { num: match[1], unit: match[2] ?? "" };
}

/** 数字串 + 单位 → CSS 值；auto 等关键字原样；空 unit = 无单位（z-index）。 */
export function joinLength(num: string, unit: string): string {
  const n = num.trim();
  if (!n) return "";
  if (n === "auto" || n === "inherit" || n === "unset" || n === "normal") return n;
  return unit ? `${n}${unit}` : n;
}

/** opacity：computed「0.5」/「50%」→ 展示「50」；写入「0.5」。 */
export function opacityToDisplay(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  if (text.endsWith("%")) return text.slice(0, -1).trim();
  const num = Number(text);
  if (!Number.isFinite(num)) return text;
  return String(Math.round(num * 1000) / 10);
}

export function opacityToCss(display: string): string {
  const text = display.trim().replace(/%$/, "");
  if (!text) return "";
  if (text === "auto") return "";
  const num = Number(text);
  if (!Number.isFinite(num)) return text;
  const clamped = Math.min(100, Math.max(0, num));
  // 保留小数百分比（0.5% → 0.005），避免 round 掉
  return String(Math.round(clamped * 1000) / 1000 / 100);
}

/** 从 transform / rotate 解析角度数字（写入用独立 `rotate` 属性）。 */
export function rotateToDisplay(rotate: string, transform: string): string {
  const direct = /^([+-]?\d*\.?\d+)deg$/i.exec(rotate.trim());
  if (direct) return direct[1];
  const bare = Number(rotate.trim());
  if (rotate.trim() && Number.isFinite(bare)) return String(bare);
  const fromTransform = /rotate\(\s*([+-]?\d*\.?\d+)deg\s*\)/i.exec(transform);
  if (fromTransform) return fromTransform[1];
  return "0";
}

/** 「1」/「100%」→ 是否 box-sizing:border-box。 */
export function isBorderBox(boxSizing: string): boolean {
  return boxSizing.trim().toLowerCase() === "border-box";
}

/** 从 display / flex-direction 归纳 Flow 档位。 */
export function resolveFlowMode(display: string, flexDirection: string): FlowMode | null {
  const d = display.trim().toLowerCase();
  if (d === "grid" || d === "inline-grid") return "grid";
  if (d === "block" || d === "inline" || d === "inline-block") return "block";
  if (d.includes("flex")) {
    const dir = flexDirection.trim().toLowerCase();
    if (dir.startsWith("column")) return "column";
    return "row";
  }
  return null;
}

export function flowModeToDecls(mode: FlowMode): Array<{ name: string; value: string }> {
  switch (mode) {
    case "block":
      return [{ name: "display", value: "block" }];
    case "row":
      return [
        { name: "display", value: "flex" },
        { name: "flex-direction", value: "row" },
      ];
    case "column":
      return [
        { name: "display", value: "flex" },
        { name: "flex-direction", value: "column" },
      ];
    case "grid":
      return [{ name: "display", value: "grid" }];
  }
}

export function resolveAlignMode(textAlign: string): AlignMode | null {
  const t = textAlign.trim().toLowerCase();
  if (t === "left" || t === "start") return "left";
  if (t === "center") return "center";
  if (t === "right" || t === "end") return "right";
  if (t === "justify") return "justify";
  return null;
}

export function alignModeToValue(mode: AlignMode): string {
  return mode;
}

/** 背景色透明度（0–100）从颜色值粗提；无 alpha 返回 100。 */
export function colorAlphaToPercent(color: string): string {
  const text = color.trim();
  const rgba = /rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*([\d.]+)\s*)?\)/i.exec(text);
  if (rgba) {
    if (rgba[1] === undefined) return "100";
    return String(Math.round(Number(rgba[1]) * 1000) / 10);
  }
  const hex8 = /^#([0-9a-f]{8})$/i.exec(text);
  if (hex8) {
    const alpha = Number.parseInt(hex8[1].slice(6, 8), 16) / 255;
    return String(Math.round(alpha * 1000) / 10);
  }
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text)) return "100";
  return "100";
}

/** 颜色 + 透明度百分比 → 可写入的 CSS 颜色。 */
export function colorWithAlpha(color: string, alphaPercent: string): string {
  const alpha = Math.min(100, Math.max(0, Number(alphaPercent) || 0)) / 100;
  const text = color.trim();
  if (!text) return "";
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(text);
  if (rgb) {
    return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`;
  }
  const hex = toOpaqueHex(text);
  if (hex) {
    const a = Math.round(alpha * 255)
      .toString(16)
      .padStart(2, "0");
    return `${hex}${a}`;
  }
  return text;
}

function toOpaqueHex(raw: string): string | null {
  const text = raw.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text;
  if (/^#[0-9a-f]{3}$/i.test(text)) {
    const [, r, g, b] = text;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^#[0-9a-f]{8}$/i.test(text)) return text.slice(0, 7);
  return null;
}
