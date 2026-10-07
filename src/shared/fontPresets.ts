/**
 * 界面 / 等宽字体预设（设置 → 个性化）。
 * 只登记 Windows 自带或应用内置字体，避免预设落空；
 * 设置持久化存预设 id，渲染层再解析成 CSS font-family 栈写入根变量。
 */

export const FONT_UI_PRESETS = [
  "default",
  "segoe",
  "yahei",
  "dengxian",
  "simsun",
  "arial",
] as const;
export const FONT_MONO_PRESETS = ["default", "cascadia", "consolas", "courier", "lucida"] as const;

export type FontUiPreset = (typeof FONT_UI_PRESETS)[number];
export type FontMonoPreset = (typeof FONT_MONO_PRESETS)[number];

export const DEFAULT_FONT_UI_PRESET: FontUiPreset = "default";
export const DEFAULT_FONT_MONO_PRESET: FontMonoPreset = "default";

/** 预设 → CSS font-family 栈；与 tokens.css 默认值对齐（default 项）。 */
const FONT_UI_STACKS: Record<FontUiPreset, string> = {
  default: '"OPPO Sans", system-ui, "Segoe UI", "Microsoft YaHei", sans-serif',
  segoe: '"Segoe UI", system-ui, sans-serif',
  yahei: '"Microsoft YaHei", "微软雅黑", system-ui, sans-serif',
  dengxian: '"DengXian", "等线", system-ui, sans-serif',
  simsun: 'SimSun, "宋体", serif',
  arial: 'Arial, "Helvetica Neue", sans-serif',
};

const FONT_MONO_STACKS: Record<FontMonoPreset, string> = {
  default: '"Cascadia Code", Consolas, monospace',
  cascadia: '"Cascadia Code", "Cascadia Mono", monospace',
  consolas: 'Consolas, "Courier New", monospace',
  courier: '"Courier New", Courier, monospace',
  lucida: '"Lucida Console", "Lucida Sans Typewriter", monospace',
};

function isFontUiPreset(value: unknown): value is FontUiPreset {
  return typeof value === "string" && (FONT_UI_PRESETS as readonly string[]).includes(value);
}

function isFontMonoPreset(value: unknown): value is FontMonoPreset {
  return typeof value === "string" && (FONT_MONO_PRESETS as readonly string[]).includes(value);
}

export { isFontMonoPreset, isFontUiPreset };

/** 非法值回退默认预设（手改设置文件 / 旧数据共用）。 */
export function normalizeFontUiPreset(value: unknown): FontUiPreset {
  return isFontUiPreset(value) ? value : DEFAULT_FONT_UI_PRESET;
}

/** 非法值回退默认预设。 */
export function normalizeFontMonoPreset(value: unknown): FontMonoPreset {
  return isFontMonoPreset(value) ? value : DEFAULT_FONT_MONO_PRESET;
}

/** 解析界面字体 CSS 栈；未知 id 回退 default。 */
export function resolveFontUiStack(preset: unknown): string {
  return FONT_UI_STACKS[normalizeFontUiPreset(preset)];
}

/** 解析等宽字体 CSS 栈；未知 id 回退 default。 */
export function resolveFontMonoStack(preset: unknown): string {
  return FONT_MONO_STACKS[normalizeFontMonoPreset(preset)];
}
