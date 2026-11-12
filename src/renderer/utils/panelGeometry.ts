/**
 * 三栏网格几何（左栏宽 / 右侧上下文侧栏宽 / 会话监控卡停靠宽）的唯一写入口。
 *
 * 为什么不再往 `.app` 上写 `--nav-width` / `--context-sidebar-width` /
 * `--session-monitor-width` 这些变量来做补间：自定义属性是继承的，在祖先上改值会让
 * Chromium 把**整棵子树**判为样式失效，哪怕根本没有元素使用它。80 条消息的会话实测
 * ~5ms/次，切换补间 60fps 每帧都要付这笔钱（一次切换的样式重算从 ~10ms 涨到 ~84ms），
 * 120/144Hz 屏上直接掉帧。改成直接写各消费元素的普通属性后，失效范围缩到各自子树
 * （合计 <1ms/帧）。
 *
 * 契约：
 * - **只有本模块写网格轨道**：左右两条把手、两条收展补间都调 `writePanelGeometry`，
 *   三列总是整体重写。`grid-template-columns` 是整体替换的普通属性，只写一列就会把
 *   其余列打回 CSS 兜底值（拖左栏撞上右栏收展、或反之，都会跳一帧）。
 * - `current` 是当前**视觉**宽度，补间被打断时从这里接管起点。
 * - 折叠态是普通数值（左栏 56px / 右栏 0），由调用方换算后传进来；`.navCollapsed` 与
 *   `.sidebarClosed` 类的同名声明只作「内联尚未写入」的首帧兜底，两者必须同值。
 * - 消费元素用 `data-panel-geo` 标记（见各站点 CSS），查询结果按连接状态缓存。
 */

export interface PanelGeometry {
  /** 左侧导航栏视觉宽度（px）：展开态为用户宽度，折叠态为折叠宽度。 */
  nav: number;
  /** 右侧上下文侧栏的视觉宽度（px，0 = 收起）。 */
  sidebar: number;
  /** 会话监控卡停靠层的视觉宽度（px，0 = 不在）。 */
  monitor: number;
}

const TARGETS = {
  sidebar: '[data-panel-geo="sidebar"]',
  dock: '[data-panel-geo="monitor-dock"]',
  scroll: '[data-panel-geo="monitor-scroll"]',
  input: '[data-panel-geo="monitor-input"]',
  jump: '[data-panel-geo="monitor-jump"]',
} as const;

type TargetName = keyof typeof TARGETS;

/** 元素可能随页签/会话挂载卸载，缓存按 isConnected 失效。 */
const cache = new Map<TargetName, HTMLElement>();

function target(name: TargetName): HTMLElement | null {
  const cached = cache.get(name);
  if (cached?.isConnected) return cached;
  const el = document.querySelector<HTMLElement>(TARGETS[name]);
  if (el) cache.set(name, el);
  else cache.delete(name);
  return el;
}

const current: PanelGeometry = { nav: 0, sidebar: 0, monitor: 0 };

/** 当前视觉几何：补间起点取它，不要再去读 CSS 变量。 */
export function panelGeometry(): PanelGeometry {
  return current;
}

const px = (value: number): string => `${value}px`;

/** 右缘让位：基准偏移由站点 CSS 的 `--panel-base-right` 提供，这里只追加停靠宽。 */
function writeMonitorOffset(el: HTMLElement, monitor: number, property: "right" | "paddingRight") {
  el.style[property] = `calc(var(--panel-base-right) + ${px(monitor)})`;
}

/**
 * 写一组几何值（只写传入的键）。
 *
 * `root` 是三栏网格根元素：只改它的 `grid-template-columns`（普通属性，
 * 不失效子树样式，只是网格重排）。会话监控卡的写入不碰网格——停靠层是中央区里的
 * 绝对覆盖层，只改自己的宽度与正文让位量。
 */
export function writePanelGeometry(root: HTMLElement | null, next: Partial<PanelGeometry>): void {
  if (next.monitor !== undefined) {
    current.monitor = next.monitor;
    const dock = target("dock");
    if (dock) dock.style.width = px(current.monitor);
    const scroll = target("scroll");
    if (scroll) writeMonitorOffset(scroll, current.monitor, "paddingRight");
    for (const name of ["input", "jump"] as const) {
      const el = target(name);
      if (el) writeMonitorOffset(el, current.monitor, "right");
    }
  }

  if (next.nav !== undefined) current.nav = next.nav;
  if (next.sidebar !== undefined) current.sidebar = next.sidebar;

  if (next.nav !== undefined || next.sidebar !== undefined) {
    if (root) {
      root.style.gridTemplateColumns = `${px(current.nav)} 1fr ${px(current.sidebar)}`;
    }
    const aside = target("sidebar");
    if (aside) aside.style.width = px(current.sidebar);
  }
}
