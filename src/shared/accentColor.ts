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

/** null 使用应用默认色，system 跟随本机强调色，hex 使用固定颜色。 */
export type AccentColorPreference = "system" | `#${string}` | null;

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/;

/**
 * 归一主题色偏好：保留 system，hex 统一为小写，其余值回退应用默认色。
 * 读盘兜底与 IPC patch 校验共用同一份规则。
 */
export function normalizeAccentColor(value: unknown): AccentColorPreference {
  if (value === "system") return value;
  if (typeof value !== "string") return null;
  const hex = value.trim().toLowerCase();
  return HEX_COLOR_RE.test(hex) ? (hex as `#${string}`) : null;
}

/** Electron 返回不带 # 的 RRGGBBAA；应用强调色始终不透明，不能按 Windows 的 ARGB 解读。 */
export function normalizeSystemAccentColor(value: unknown): `#${string}` | null {
  if (typeof value !== "string" || !/^[0-9a-f]{8}$/i.test(value)) return null;
  return `#${value.slice(0, 6).toLowerCase()}`;
}

/** 系统色无法读取时回退应用默认色，保留 system 偏好供后续变化恢复。 */
export function resolveAccentColor(
  preference: AccentColorPreference,
  systemColor: string | null,
): `#${string}` | null {
  const color = normalizeAccentColor(preference === "system" ? systemColor : preference);
  return color === "system" ? null : color;
}

/** 任意系统色都可能很亮或很暗；选用对比更高的黑/白前景。 */
export function accentTextTone(color: string): "dark" | "light" {
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? "dark" : "light";
}
