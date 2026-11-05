/**
 * 应用界面缩放（整个主窗口页面的 zoomFactor）的参数与按键归一。
 *
 * 为什么要自己接管：Electron 只在**默认应用菜单**里给了 View → Zoom In/Out/Reset，
 * 其中 Zoom In 的加速键是 `CommandOrControl+Plus`。Windows 上这条只认字面「+」键
 * （= Ctrl+Shift+=），用户按惯用的 Ctrl+= 时没有任何反应，而 Ctrl+- 走 `Minus`
 * 一次就中——表现为「能缩小、不能放大」。主进程改为在 `before-input-event` 里自己
 * 认键（见 `src/main/window/windowZoom.ts`），不再依赖默认菜单的加速键。
 *
 * 本文件保持纯函数（不 import electron），供主进程与测试共用。
 */

/** 界面缩放下限（50%）；再小正文与图标都不可读。 */
export const UI_ZOOM_MIN = 0.5;
/** 界面缩放上限（200%）；应用布局按窗口最小宽度 1200 排布，再放大只剩滚动条。 */
export const UI_ZOOM_MAX = 2;
/** 单次按键的缩放步进，与浏览器面板（browserStore 的 ZOOM_STEP）同档。 */
export const UI_ZOOM_STEP = 0.1;
/** 默认缩放（100%），也是 Ctrl+0 的落点。 */
export const UI_ZOOM_DEFAULT = 1;

/** 缩放动作：放大 / 缩小 / 复原。 */
export type UiZoomAction = "in" | "out" | "reset";

/** Electron `before-input-event` 的 Input 子集（只取认键需要的字段）。 */
export interface UiZoomKeyInput {
  type: string;
  key: string;
  code?: string;
  control: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

/** 把任意来源的缩放值夹到合法范围并对齐到步进网格；非法值回退默认。 */
export function normalizeUiZoom(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return UI_ZOOM_DEFAULT;
  const clamped = Math.min(UI_ZOOM_MAX, Math.max(UI_ZOOM_MIN, value));
  // 对齐 0.1 网格：手动改过设置文件或浮点累加都不会留下 1.0000000000000002；
  // 必须先乘再除（而不是乘回 0.1），否则 0.8 - 0.1 又会漂回 0.7000000000000001
  return Math.round(clamped * 10) / 10;
}

/**
 * 从键盘事件判定缩放动作；不认识的组合一律返回 null。
 * 主键优先认物理键位（`code`），避免布局差异（德语键盘的 += 键要 Shift 才出 +）。
 */
export function resolveUiZoomAction(input: UiZoomKeyInput): UiZoomAction | null {
  if (input.type !== "keyDown") return null;
  // Alt 组合在 AltGr 布局上等于打字符，Win/Meta 是系统保留位，都不接管
  if (!input.control || input.alt || input.meta) return null;

  const code = input.code ?? "";
  if (!input.shift && (code === "Digit0" || code === "Numpad0" || input.key === "0")) {
    return "reset";
  }
  if (
    code === "Equal" ||
    code === "NumpadAdd" ||
    input.key === "+" ||
    input.key === "=" ||
    input.key === "Add"
  ) {
    return "in";
  }
  if (
    code === "Minus" ||
    code === "NumpadSubtract" ||
    input.key === "-" ||
    input.key === "_" ||
    input.key === "Subtract"
  ) {
    return "out";
  }
  return null;
}

/** 由当前缩放与动作算出目标缩放（已夹紧、已对齐步进）。 */
export function stepUiZoom(current: number, action: UiZoomAction): number {
  if (action === "reset") return UI_ZOOM_DEFAULT;
  const base = normalizeUiZoom(current);
  return normalizeUiZoom(action === "in" ? base + UI_ZOOM_STEP : base - UI_ZOOM_STEP);
}
