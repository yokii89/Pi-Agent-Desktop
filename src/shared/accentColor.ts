/** 主题色（accent）预设色板：设置 → 外观 → 主题色。值固定为小写 #RRGGBB。 */
export const ACCENT_PRESETS = [
  // 按色相从左到右排一行（设置页 swatch 按此顺序铺开），灰档收尾作为中性选项。
  // 预设值须与 --color-accent-text 反白档搭配可读，不收录纯黄等过亮色。
  { id: "red", value: "#e5484d" },
  { id: "orange", value: "#ea580c" },
  { id: "amber", value: "#d97706" },
  { id: "lime", value: "#65a30d" },
  { id: "green", value: "#16a34a" },
  { id: "teal", value: "#0d9488" },
  { id: "cyan", value: "#0891b2" },
  { id: "sky", value: "#0284c7" },
  { id: "blue", value: "#4a8cff" },
  { id: "indigo", value: "#6366f1" },
  { id: "purple", value: "#8b5cf6" },
  { id: "fuchsia", value: "#d946ef" },
  { id: "pink", value: "#ec4899" },
  { id: "rose", value: "#f43f5e" },
  { id: "slate", value: "#64748b" },
] as const;

export type AccentPresetId = (typeof ACCENT_PRESETS)[number]["id"];

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/;

/**
 * 归一主题色：合法的小写 #RRGGBB 原样返回；其余值（含 null / 缺省）回退 null，
 * null 表示跟随主题默认蓝（tokens.css 的 --color-accent）。
 * 读盘兜底与 IPC patch 校验共用同一份规则。
 */
export function normalizeAccentColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hex = value.trim().toLowerCase();
  return HEX_COLOR_RE.test(hex) ? hex : null;
}
