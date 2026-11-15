import type { ITheme } from "@xterm/xterm";
import { accentTextTone } from "../../shared/accentColor";

let colorContext: CanvasRenderingContext2D | null | undefined;

function resolveColor(value: string): string {
  if (/^#[\da-f]{3,8}$/i.test(value) || /^rgba?\(/.test(value)) return value;
  // CSS 自定义属性的计算值仍可能是 color-mix/color(srgb)，xterm 只识别传统色值。
  // 用浏览器解色后转成 rgba，保留选区透明度，而不是把现代语法直接交给 xterm。
  if (colorContext === undefined) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    colorContext = canvas.getContext("2d", { willReadFrequently: true });
  }
  if (!colorContext || !CSS.supports("color", value)) return value;
  colorContext.clearRect(0, 0, 1, 1);
  colorContext.fillStyle = value;
  colorContext.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = colorContext.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}

/** 按当前令牌生成 xterm 可识别的配色，ANSI 内容色保持终端自己的语义。 */
export function readTerminalTheme(): ITheme {
  const computed = getComputedStyle(document.documentElement);
  const token = (name: string) => computed.getPropertyValue(name).trim();
  const color = (name: string) => resolveColor(token(name));
  const cursor = token("--color-accent-border");
  return {
    background: color("--terminal-bg"),
    foreground: color("--terminal-fg"),
    cursor: resolveColor(cursor),
    cursorAccent: color(`--color-accent-ink-${accentTextTone(cursor)}`),
    selectionBackground: color("--color-selection"),
    selectionInactiveBackground: color("--color-selection"),
    scrollbarSliderBackground: color("--color-text-muted"),
    scrollbarSliderHoverBackground: color("--color-text"),
    scrollbarSliderActiveBackground: color("--color-text-strong"),
  };
}

/** 跟随深浅主题与强调色变化原地刷新终端；无关根样式变化不重复设置配色。 */
export function subscribeTerminalTheme(onChange: (theme: ITheme) => void): () => void {
  let previous = "";
  const refresh = () => {
    const theme = readTerminalTheme();
    const signature = JSON.stringify(theme);
    if (signature === previous) return;
    previous = signature;
    onChange(theme);
  };
  const observer = new MutationObserver(refresh);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "style"],
  });
  refresh();
  return () => observer.disconnect();
}
