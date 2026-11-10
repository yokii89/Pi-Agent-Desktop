/**
 * 把 DOM 元素后台渲染成 PNG（docs/design/135）：克隆 + 内联 computed style →
 * SVG `<foreignObject>` → `canvas`，全程不挂进文档、不截屏。
 *
 * 为什么不用主进程 `capturePage`：会话区的可见区只有一屏，长表格会被截断，
 * 浮动的输入栏 / 监控卡也会一起进图；离线渲染与视口、遮挡、滚动位置全都无关。
 *
 * 已知代价：SVG 图片是独立文档，应用私有的 OPPO Sans（13MB woff2）不参与渲染，
 * 中文回落到系统字体——排版由克隆体自己的宽度与内联度量决定，所以只影响字形观感。
 */

export interface ElementPng {
  /** PNG dataURL（写系统剪贴板 / 存盘都直接可用）。 */
  dataUrl: string;
  width: number;
  height: number;
}

export interface ElementPngOptions {
  /** 像素倍率，默认 2：粘进聊天或文档里不糊。超大表格会自动降档。 */
  scale?: number;
  /**
   * 成像宽度取「内容完整宽度」而不是元素可见宽度（docs/design/136）。
   * 代码围栏里的长行被横向滚动容器裁在卡片右缘，按可见宽成像等于复制出去少半截代码；
   * 开启后根元素与各滚动容器一起拉到 `scrollWidth`，长行完整进图。
   */
  expandWidth?: boolean;
}

const BASE_SCALE = 2;
/** 单边像素上限：再大有些聊天工具会拒收，也白耗内存。 */
const MAX_EDGE = 4096;
/** 总面积上限（像素）。 */
const MAX_AREA = 16_000_000;

/**
 * 不能照抄的 computed 属性：`content-visibility` / `contain` 会让 SVG 图片里的元素
 * 被判定为"不在视野内"而整块不绘制（会话流开着 content-visibility），
 * 动画与过渡留在定格的中间态没有意义，其余是纯交互态属性。
 */
const SKIP_PROPS = new Set([
  "content-visibility",
  "contain",
  "contain-intrinsic-size",
  "contain-intrinsic-width",
  "contain-intrinsic-height",
  "will-change",
  "cursor",
  "-webkit-app-region",
]);

const SKIP_PREFIXES = ["animation", "transition", "app-region"];

function shouldCopyProp(prop: string): boolean {
  if (SKIP_PROPS.has(prop)) return false;
  return !SKIP_PREFIXES.some((prefix) => prop.startsWith(prefix));
}

/**
 * 克隆体里带该属性的节点及其子树不入图（docs/design/136）：复制按钮这类纯交互节点
 * 不该出现在自己产出的图片里。只作用于克隆体，真实 DOM 不动，所以没有闪烁。
 */
const SKIP_ATTR = "data-capture-skip";

/** 逐属性抄 computed 值：颜色变量、color-mix、字体栈在克隆体里都已解析成具体值。 */
function inlineComputedStyle(live: Element, clone: HTMLElement): void {
  const computed = getComputedStyle(live);
  for (let index = 0; index < computed.length; index += 1) {
    const prop = computed.item(index);
    if (!shouldCopyProp(prop)) continue;
    const value = computed.getPropertyValue(prop);
    if (value === "") continue;
    clone.style.setProperty(prop, value);
  }
}

interface CloneTree {
  root: HTMLElement;
  /** 与 `clones` 同下标；被跳过的节点在 `clones` 里为 null（配对靠下标，不能过滤）。 */
  live: Element[];
  clones: (HTMLElement | null)[];
}

/** 深克隆并逐节点内联样式（两份树结构一致，按序配对）。 */
function cloneWithComputedStyles(root: Element): CloneTree {
  const clone = root.cloneNode(true) as HTMLElement;
  const liveAll = [root, ...root.querySelectorAll("*")];
  const cloneAll = [clone, ...clone.querySelectorAll("*")];
  const count = Math.min(liveAll.length, cloneAll.length);
  const live: Element[] = [];
  const clones: (HTMLElement | null)[] = [];
  for (let index = 0; index < count; index += 1) {
    const cloneNode = cloneAll[index] as HTMLElement;
    // 上层的跳过节点被摘掉后，其子孙也一并离场：contains 为假即可跳过（下标仍要对齐）
    if (!clone.contains(cloneNode) || cloneNode.hasAttribute(SKIP_ATTR)) {
      if (clone.contains(cloneNode)) cloneNode.remove();
      live.push(liveAll[index] as Element);
      clones.push(null);
      continue;
    }
    inlineComputedStyle(liveAll[index] as Element, cloneNode);
    // 滚动容器在图片里既不能滚也不需要滚动条：`overflow: auto` 会在 SVG 里画出一条真滚动条，
    // 还占掉内容宽高。只对真的溢出且声明了非 visible 溢出的节点动手，其余保持原样。
    const liveEl = liveAll[index] as HTMLElement;
    if (
      liveEl.scrollWidth > liveEl.clientWidth + 1 ||
      liveEl.scrollHeight > liveEl.clientHeight + 1
    ) {
      const computed = getComputedStyle(liveEl);
      if (computed.overflowX !== "visible" || computed.overflowY !== "visible") {
        cloneNode.style.overflow = "hidden";
      }
    }
    live.push(liveEl);
    clones.push(cloneNode);
  }
  return { root: clone, live, clones };
}

/**
 * 横向滚动容器的完整内容宽度（相对元素左缘）；没有溢出返回 0。
 * 只认滚动容器——长代码行就是被它的 `overflow-x` 裁在卡片右缘的。
 */
function overflowWidth(el: HTMLElement): number {
  const origin = el.getBoundingClientRect().left;
  let widest = 0;
  for (const node of el.querySelectorAll<HTMLElement>("*")) {
    const overflow = node.scrollWidth - node.clientWidth;
    if (overflow <= 1) continue;
    const offset = node.getBoundingClientRect().left - origin;
    widest = Math.max(widest, Math.ceil(offset + node.scrollWidth));
  }
  return widest;
}

/** 百分比 / 小数的 alpha 归一。 */
function parseAlpha(text: string): number {
  const value = text.trim();
  const alpha = value.endsWith("%") ? Number.parseFloat(value) / 100 : Number(value);
  return Number.isNaN(alpha) ? 1 : alpha;
}

/**
 * 颜色是否足够不透明（alpha ≥ 0.99）。半透明底不能当底：壁纸模式把会话流底色降到 55%
 * （docs/design/120），拿它当背景等于「半透明卡片叠在半透明画布上」，粘到白底聊天窗口
 * 整体发灰。`color-mix` 的计算值是 `color(srgb … / α)` 现代语法，也要认。
 */
function isOpaqueColor(color: string): boolean {
  if (!color || color === "transparent") return false;
  const rgba = /^rgba?\(([^)]+)\)$/i.exec(color);
  if (rgba) {
    const parts = rgba[1].split(/[,/]/).map((part) => part.trim());
    if (parts.length < 4) return true;
    return parseAlpha(parts[3]) >= 0.99;
  }
  const modern = /\/\s*([^)]+)\)$/.exec(color);
  if (modern) return parseAlpha(modern[1]) >= 0.99;
  return true;
}

/**
 * 表格自身多半是透明底，图片里必须有一层不透明底色，否则深色主题的浅色文字
 * 粘到白色聊天背景上等于消失。向上找第一个不透明祖先，兜底用主题 `--color-bg`。
 */
function resolveBackground(el: HTMLElement): string {
  let node: HTMLElement | null = el;
  while (node) {
    const background = getComputedStyle(node).backgroundColor;
    if (isOpaqueColor(background)) return background;
    node = node.parentElement;
  }
  const token = getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim();
  return token || "#ffffff";
}

function resolveScale(width: number, height: number, requested?: number): number {
  const limit = Math.min(
    MAX_EDGE / Math.max(width, height),
    Math.sqrt(MAX_AREA / (width * height)),
  );
  return Math.max(1, Math.min(requested ?? BASE_SCALE, limit));
}

/** UTF-8 → base64（SVG 里有中文，直接 btoa 会抛错）。 */
function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const chunk = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片渲染失败"));
    image.src = url;
  });
}

/**
 * 渲染元素为 PNG。元素自身尺寸就是图片尺寸：克隆体逐节点内联了度量值，
 * 改宽度会让换行与高度对不上；唯一例外是 `expandWidth`——那是按横向滚动容器的
 * 内容宽度整体拉宽，长行不换行（`white-space: pre`），高度不受影响。
 */
export async function elementToPng(
  el: HTMLElement,
  options: ElementPngOptions = {},
): Promise<ElementPng> {
  const rect = el.getBoundingClientRect();
  const measured = Math.ceil(rect.width);
  const height = Math.ceil(rect.height);
  const width = options.expandWidth ? Math.max(measured, overflowWidth(el)) : measured;
  if (width < 1 || height < 1) throw new Error("元素没有可见尺寸");

  const background = resolveBackground(el);
  const radius = getComputedStyle(el).borderTopLeftRadius;
  const tree = cloneWithComputedStyles(el);
  const clone = tree.root;
  // 根元素拉宽后滚动容器还停在自己的可视宽上，里面照样被裁：一起拉到内容宽度
  if (options.expandWidth) {
    for (let index = 0; index < tree.live.length; index += 1) {
      const target = tree.clones[index];
      if (!target) continue;
      const live = tree.live[index] as HTMLElement;
      if (live.scrollWidth - live.clientWidth <= 1) continue;
      target.style.width = `${live.scrollWidth}px`;
      target.style.maxWidth = "none";
    }
  }
  // 尺寸改由图片画布决定，边距与内部滚动条都不该出现在图里
  clone.style.margin = "0";
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  clone.style.overflow = "hidden";

  const body =
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;` +
    `background:${background};border-radius:${radius};overflow:hidden">${clone.outerHTML}</div>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}"><foreignObject x="0" y="0" width="${width}" ` +
    `height="${height}">${body}</foreignObject></svg>`;

  const image = await loadImage(`data:image/svg+xml;base64,${base64Utf8(svg)}`);
  const scale = resolveScale(width, height, options.scale);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建画布");
  // 先缩放再绘制：矢量重绘到目标分辨率，文字不会糊
  context.scale(scale, scale);
  context.drawImage(image, 0, 0, width, height);
  return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
}
