/**
 * 启动动画（开屏）的可配置项与纯逻辑：字体预设、标识 data URL 校验、
 * 文案/大小/速度的默认值与归一化。主进程设置校验与渲染层共用同一份规则。
 */

/** 设置页「立即预览」广播的事件名；SplashGate 监听后强制播一次。 */
export const SPLASH_PREVIEW_EVENT = "pidesk:splash:preview";

/** 开屏字体预设；只登记 Windows 自带字体，避免预设落空。 */
export const SPLASH_FONT_PRESETS = [
  "segoe",
  "yahei",
  "dengxian",
  "simsun",
  "arial",
  "cascadia",
] as const;

export type SplashFontPreset = (typeof SPLASH_FONT_PRESETS)[number];

export const DEFAULT_SPLASH_FONT_PRESET: SplashFontPreset = "cascadia";

/** 预设 → CSS font-family 栈。 */
const SPLASH_FONT_STACKS: Record<SplashFontPreset, string> = {
  segoe: '"Segoe UI", system-ui, "Microsoft YaHei", sans-serif',
  yahei: '"Microsoft YaHei", "微软雅黑", system-ui, sans-serif',
  dengxian: '"DengXian", "等线", system-ui, sans-serif',
  simsun: 'SimSun, "宋体", serif',
  arial: 'Arial, "Helvetica Neue", "Microsoft YaHei", sans-serif',
  cascadia: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
};

/** 小字行固定等宽字体（不跟随开屏字体预设，保持技术注脚的观感）。 */
export const SPLASH_MONO_STACK =
  '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace';

export function isSplashFontPreset(value: unknown): value is SplashFontPreset {
  return typeof value === "string" && (SPLASH_FONT_PRESETS as readonly string[]).includes(value);
}

export function normalizeSplashFontPreset(value: unknown): SplashFontPreset {
  return isSplashFontPreset(value) ? value : DEFAULT_SPLASH_FONT_PRESET;
}

/** 解析 font-family；未知预设回退 Cascadia Mono。 */
export function resolveSplashFontStack(preset: unknown): string {
  return SPLASH_FONT_STACKS[normalizeSplashFontPreset(preset)];
}

export const DEFAULT_SPLASH_TEXT_ZH = "求知 · 探索";
export const DEFAULT_SPLASH_TEXT_EN = "Slow down and enjoy life.";
export const DEFAULT_SPLASH_TEXT_SUB = "Pi HARNESS";

export const DEFAULT_SPLASH_LOGO_SIZE = 122;
export const SPLASH_LOGO_SIZE_MIN = 64;
export const SPLASH_LOGO_SIZE_MAX = 240;

export const DEFAULT_SPLASH_SPEED = 1;
export const SPLASH_SPEED_MIN = 0.35;
export const SPLASH_SPEED_MAX = 3;

/** 自定义标识存 data URL，随 settings.json 落盘；128 KB 原图约 175k 字符。 */
export const SPLASH_LOGO_MAX_CHARS = 200000;
export const SPLASH_LOGO_MAX_BYTES = 128 * 1024;
export const SPLASH_LOGO_DATA_URL_RE =
  /^data:image\/(?:png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;

export function isSplashLogoDataUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= SPLASH_LOGO_MAX_CHARS &&
    SPLASH_LOGO_DATA_URL_RE.test(value)
  );
}

/** 非法值回退内置 pi 标识（空字符串）。 */
export function normalizeSplashLogoImage(value: unknown): string {
  return isSplashLogoDataUrl(value) ? value : "";
}

export function clampSplashLogoSize(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SPLASH_LOGO_SIZE;
  return Math.min(SPLASH_LOGO_SIZE_MAX, Math.max(SPLASH_LOGO_SIZE_MIN, Math.round(n)));
}

export function clampSplashSpeed(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SPLASH_SPEED;
  return Math.round(Math.min(SPLASH_SPEED_MAX, Math.max(SPLASH_SPEED_MIN, n)) * 100) / 100;
}

/** 文案：非字符串回退默认，空字符串保留（用户主动清空 = 不显示该行）。 */
export function normalizeSplashText(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.slice(0, 64) : fallback;
}

/** SplashScreen 需要的完整快照（字体已解析成 CSS 栈）。 */
export interface SplashConfig {
  logoImage: string;
  logoSize: number;
  fontStack: string;
  textZh: string;
  textEn: string;
  textSub: string;
  speed: number;
}
