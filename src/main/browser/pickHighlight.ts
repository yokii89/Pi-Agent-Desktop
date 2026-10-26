import type { WebContents } from "electron";
import { sendCommand } from "./cdp";

/**
 * 拾取高亮（视觉层）：**选中（selection）与悬停（hover）双层**。
 *
 * 产品语义：
 * - 选中框：点击后常驻，仅描边、无 fill；换选替换；鼠标离开页面仍保留。
 * - 悬停：换目标时整框补间（见 `HIGHLIGHT_MOTION`，视觉方案见
 *   `docs/ui-design/pick-highlight-transition.html`），fill + 描边 + chip 一起走；
 *   命中选中元素时不叠 fill，只保留尺寸 chip；离页淡出。
 * - 浏览子模式：`selection-only`（无 hover/click 捕获，页面可交互，选中框仍在）。
 *
 * 为何不走 CDP `Overlay.setInspectMode`：角标形态锁死，画不出产品样式。
 *
 * 边界（对齐 06「无持久注入物」）：
 * - 高亮层与 `__pideskPickHit` binding 随拾取会话存活，stopPick / 导航即拆；
 * - 不创建 `__pideskPick__` / `__pidesk-pick-card`；
 * - 点击经 binding 回传视口坐标 + scroll，主进程优先 `targetAt` 解析节点。
 */

/** 页内 binding 名：仅拾取会话存活期存在，用于点击坐标回传。 */
export const PICK_HIT_BINDING = "__pideskPickHit";

/**
 * 高亮色板（粉色系）：描边 / chip 用实色，盒模型 fill 用同色不同透明度表达
 * margin / padding / content 色深。注入脚本运行在页面上下文，色板在此集中定义。
 */
const HIGHLIGHT_PALETTE = {
  /** 实线描边 + chip 底色（选中与悬停共用描边色） */
  solid: "#ec5a8d",
  /** content 区 fill（仅悬停） */
  content: "rgba(236, 90, 141, 0.24)",
  /** padding 区 fill（仅悬停） */
  padding: "rgba(236, 90, 141, 0.18)",
  /** margin 区 fill（仅悬停） */
  margin: "rgba(236, 90, 141, 0.10)",
} as const;

/**
 * 悬停层换目标的过渡参数（「整框补间」方案）。
 * 注入脚本运行在页面上下文，拿不到渲染层的 motionTokens，参数在这里单点定义；
 * 视觉基准见 `docs/ui-design/pick-highlight-transition.html`。
 */
const HIGHLIGHT_MOTION = {
  /** x/y/w/h（含盒模型内边距）一起补间的时长。 */
  morphMs: 170,
  /** 首次进入页面的淡入时长。 */
  fadeInMs: 90,
  /** 离开页面 / 失焦时的淡出时长。 */
  fadeOutMs: 120,
} as const;

/** 页内视觉模式：full=圈选（hover+选中）；selection-only=浏览（仅选中框）。 */
export type PickHighlightMode = "full" | "selection-only";

export interface HitPayload {
  /** 视口坐标（CSS px，`elementFromPoint` / 页内命中用）。 */
  x: number;
  y: number;
  /** 滚动偏移；换算 `DOM.getNodeForLocation` 的文档坐标用。 */
  scrollX: number;
  scrollY: number;
}

export interface LayerPlan {
  /** 画选中描边（无 fill）。 */
  drawSelection: boolean;
  /** 画悬停层（fill + 描边）。 */
  drawHover: boolean;
  /** chip 挂在哪一层；none=不画。 */
  drawChipOn: "none" | "hover" | "selection";
}

/**
 * 双层叠加规则（纯函数，供单测钉死产品语义）：
 * - hover ≠ 选中：选中描边 + 悬停全套（chip 在 hover）。
 * - hover = 选中：不叠 fill，只画选中描边 + chip。
 * - 无 hover：只画选中描边（鼠标不在页面上）。
 * - selection-only：只画选中描边，无 chip / hover。
 */
export function resolveLayerPlan(input: {
  hasSelection: boolean;
  hasHover: boolean;
  hoverIsSelection: boolean;
  mode: PickHighlightMode;
}): LayerPlan {
  const drawSelection = input.hasSelection;
  if (input.mode === "selection-only") {
    return { drawSelection, drawHover: false, drawChipOn: "none" };
  }
  if (input.hasHover && !input.hoverIsSelection) {
    return { drawSelection, drawHover: true, drawChipOn: "hover" };
  }
  if (input.hasHover && input.hoverIsSelection) {
    return { drawSelection, drawHover: false, drawChipOn: "selection" };
  }
  return { drawSelection, drawHover: false, drawChipOn: "none" };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * 视口坐标 + 滚动 → 文档坐标（整数）。
 * CDP `DOM.getNodeForLocation` 的 x/y 是 integer，且语义是文档坐标
 * （内部会再 `DocumentToFrame` 减一次 scroll）。
 */
export function toDocumentHitPoint(hit: {
  x: number;
  y: number;
  scrollX: number;
  scrollY: number;
}): { x: number; y: number } {
  return {
    x: Math.round(hit.x + hit.scrollX),
    y: Math.round(hit.y + hit.scrollY),
  };
}

/** 主进程侧解析 binding 回传的点击坐标（payload 为 JSON 字符串或已解析对象）。 */
export function parsePickHit(payload: unknown): HitPayload | null {
  let data: unknown = payload;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (Array.isArray(data) && data.length >= 2) {
    const x = finiteNumber(data[0]);
    const y = finiteNumber(data[1]);
    if (x === null || y === null) return null;
    return { x, y, scrollX: 0, scrollY: 0 };
  }
  if (!data || typeof data !== "object") return null;
  const record = data as { x?: unknown; y?: unknown; scrollX?: unknown; scrollY?: unknown };
  const x = finiteNumber(record.x);
  const y = finiteNumber(record.y);
  if (x === null || y === null) return null;
  const scrollX = finiteNumber(record.scrollX) ?? 0;
  const scrollY = finiteNumber(record.scrollY) ?? 0;
  return { x, y, scrollX, scrollY };
}

/**
 * 主进程解析「视口点 → 元素」的 Runtime.evaluate 表达式。
 * 与悬停/选中共用 `targetAt`（穿 shadow DOM，必要时临时藏高亮层）。
 */
export function buildTargetAtExpression(x: number, y: number): string {
  const px = Number.isFinite(x) ? x : 0;
  const py = Number.isFinite(y) ? y : 0;
  return `(window.__pideskPickHighlight__ && window.__pideskPickHighlight__.targetAt(${px}, ${py})) || null`;
}

export function buildSetHighlightModeExpression(mode: PickHighlightMode): string {
  return `(window.__pideskPickHighlight__ && window.__pideskPickHighlight__.setMode(${JSON.stringify(mode)})) || null`;
}

export function buildClearSelectionExpression(): string {
  return `(window.__pideskPickHighlight__ && window.__pideskPickHighlight__.clearSelection()) || null`;
}

function evaluate(wc: WebContents, expression: string): Promise<unknown> {
  return sendCommand(wc, "Runtime.evaluate", { expression, returnByValue: true });
}

/**
 * 安装高亮层（幂等：重复调用会先卸旧层并进入 full）。
 * 圈选模式下吞掉页面鼠标 / 滚轮；浏览请改 `setPickHighlightMode("selection-only")`。
 */
export async function installPickHighlight(wc: WebContents): Promise<void> {
  await evaluate(
    wc,
    `(${INSTALL_PICK_HIGHLIGHT_SRC})(${JSON.stringify(HIGHLIGHT_PALETTE)}, ${JSON.stringify(HIGHLIGHT_MOTION)})`,
  );
}

/** 卸载高亮层与页内监听；页面刷新后 DOM 自然消失，再调一次仍安全。 */
export async function removePickHighlight(wc: WebContents): Promise<void> {
  await evaluate(wc, `(${REMOVE_PICK_HIGHLIGHT_SRC})();`).catch(() => {
    // 页面已销毁 / 导航中：无需残留清理
  });
}

/** 切换视觉模式（full ↔ selection-only），**保留**已有选中框。 */
export async function setPickHighlightMode(
  wc: WebContents,
  mode: PickHighlightMode,
): Promise<void> {
  await evaluate(wc, buildSetHighlightModeExpression(mode));
}

/** 清除选中框（退出拾取 / 用户主动清除）。 */
export async function clearPickSelection(wc: WebContents): Promise<void> {
  await evaluate(wc, buildClearSelectionExpression()).catch(() => {});
}

/** 装 / 卸点击回传 binding（与圈选捕获同生命周期）。 */
export async function enablePickHitBinding(wc: WebContents): Promise<void> {
  await sendCommand(wc, "Runtime.addBinding", { name: PICK_HIT_BINDING });
}

export async function disablePickHitBinding(wc: WebContents): Promise<void> {
  await sendCommand(wc, "Runtime.removeBinding", { name: PICK_HIT_BINDING }).catch(() => {});
}

// ---------------------------------------------------------------------------
// 页内脚本源码（字符串注入，不参与主进程 DOM 类型检查）
// ---------------------------------------------------------------------------

/** 安装高亮层。palette / motion 由主进程传入，保持视觉参数单点定义。 */
const INSTALL_PICK_HIGHLIGHT_SRC = `function installPickHighlight(palette, motion) {
  var w = window;
  if (w.__pideskPickHighlight__) w.__pideskPickHighlight__.destroy();

  var host = document.createElement("div");
  host.setAttribute("data-pidesk-pick-highlight", "");
  host.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;margin:0;padding:0;border:0";

  var root = host.attachShadow({ mode: "open" });
  var style = document.createElement("style");
  style.textContent = [
    ":host { all: initial; }",
    "canvas { position:fixed; inset:0; width:100vw; height:100vh; pointer-events:none; }",
    ".chip {",
    "  position:fixed; box-sizing:border-box; max-width:min(360px, 90vw);",
    "  padding:3px 10px; border-radius:6px;",
    "  background:" + palette.solid + "; color:#fff;",
    "  font:600 12px/1.35 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif;",
    "  letter-spacing:0.01em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;",
    "  pointer-events:none; opacity:0;",
    "}",
    ".chip .size { margin-left:8px; font-weight:500; opacity:0.92; }"
  ].join("\\n");
  var canvas = document.createElement("canvas");
  var chip = document.createElement("div");
  chip.className = "chip";
  var chipName = document.createElement("span");
  var chipSize = document.createElement("span");
  chipSize.className = "size";
  chip.append(chipName, chipSize);
  root.append(style, canvas, chip);
  (document.documentElement || document.body).appendChild(host);

  var ctx = canvas.getContext("2d");
  var raf = 0;
  var alive = true;
  /** full | selection-only */
  var mode = "full";
  var hoverEl = null;
  var selectionEl = null;
  var fullListenersBound = false;
  /** 最近一次 mousemove 的视口坐标：高回报率鼠标一帧能发多条，命中测试合并到帧内做一次。 */
  var pendingPoint = null;
  /** 滚动 / 尺寸变化只置标记，画布尺寸与悬停矩形吸附同样合并到帧内。 */
  var layoutDirty = false;

  /**
   * 悬停层的视觉状态：hoverRect / hoverMetrics 是「这一帧画出来的」，
   * hoverAnim 负责把上一帧的视觉矩形补间到新目标；换目标时从当前视觉矩形接管，
   * 避免从上个元素的 rect 重算导致快速扫过时的跳变。
   */
  var hoverRect = null;
  var hoverMetrics = null;
  var hoverAnim = null;
  var hoverPresence = 0;
  var hoverPresenceFrom = 0;
  var hoverPresenceTarget = 0;
  var hoverPresenceT0 = 0;
  var hoverPresenceDur = 0;
  /** hoverMetrics 对应的目标元素：同一元素内移动时不再重读 computed style。 */
  var metricsEl = null;
  /** 画布上一帧画过的区域：每帧只清「它 ∪ 本帧要画的区域」，不做全屏 clear。 */
  var paintedBounds = null;
  /** chip 单行高度恒定（nowrap + 固定字号），量一次即可，避免每帧读 offsetHeight。 */
  var chipHeight = 0;
  var chipAlpha = -1;
  var chipLeft = -1;
  var chipTopPos = -1;

  var morphMs = motion.morphMs;
  var fadeInMs = motion.fadeInMs;
  var fadeOutMs = motion.fadeOutMs;

  function resizeCanvas() {
    var dpr = window.devicePixelRatio || 1;
    var nextWidth = Math.floor(window.innerWidth * dpr);
    var nextHeight = Math.floor(window.innerHeight * dpr);
    // 同尺寸的 scroll 不重设 canvas（赋值 width/height 会清空整张画布，动画会被闪一帧）
    if (canvas.width !== nextWidth) canvas.width = nextWidth;
    if (canvas.height !== nextHeight) canvas.height = nextHeight;
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resizeCanvas();

  function pierceFromPoint(x, y) {
    var el = document.elementFromPoint(x, y);
    var guard = 0;
    while (el && guard < 8) {
      guard += 1;
      if (el === host) return null;
      var sr = el.shadowRoot;
      if (sr) {
        var inner = sr.elementFromPoint(x, y);
        if (inner && inner !== el) {
          el = inner;
          continue;
        }
      }
      break;
    }
    return el;
  }

  function deepTarget(x, y) {
    // 视口外（含滚动条外沿）elementFromPoint 必然拿不到元素；提前返回，
    // 免得走下面切 display 的分支白白触发一次样式 / 布局计算
    if (!(x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight)) return null;
    var el = pierceFromPoint(x, y);
    if (el) return el;
    var prev = host.style.display;
    host.style.display = "none";
    try {
      el = pierceFromPoint(x, y);
    } finally {
      host.style.display = prev;
    }
    return el;
  }

  function parseSide(value) {
    var n = parseFloat(value);
    return isFinite(n) ? n : 0;
  }

  function live(el) {
    return el && el.isConnected && el.nodeType === 1 ? el : null;
  }

  function boxOf(el) {
    var rect = el.getBoundingClientRect();
    return { x: rect.left, y: rect.top, w: rect.width, h: rect.height, rect: rect };
  }

  function sameRect(a, b) {
    return Math.abs(a.x - b.x) <= 0.5 &&
      Math.abs(a.y - b.y) <= 0.5 &&
      Math.abs(a.w - b.w) <= 0.5 &&
      Math.abs(a.h - b.h) <= 0.5;
  }

  function unionBounds(a, b) {
    if (!a) return b;
    if (!b) return a;
    var x = Math.min(a.x, b.x);
    var y = Math.min(a.y, b.y);
    var right = Math.max(a.x + a.w, b.x + b.w);
    var bottom = Math.max(a.y + a.h, b.y + b.h);
    return { x: x, y: y, w: right - x, h: bottom - y };
  }

  function boxBounds(box, pad) {
    return {
      x: box.x - pad,
      y: box.y - pad,
      w: box.w + pad * 2,
      h: box.h + pad * 2
    };
  }

  /** 悬停层最外层是 margin box；负 margin 时它可能比 border box 小，描边仍画在 border box 上。 */
  function hoverBounds(box, metrics) {
    var m = metrics.m;
    var margin = {
      x: box.x - m[3],
      y: box.y - m[0],
      w: box.w + m[3] + m[1],
      h: box.h + m[0] + m[2]
    };
    return boxBounds(unionBounds(margin, box), 2);
  }

  function clearBounds(bounds) {
    if (!ctx || !bounds || bounds.w <= 0 || bounds.h <= 0) return;
    ctx.clearRect(bounds.x, bounds.y, bounds.w, bounds.h);
  }

  function clamp01(value) {
    return value < 0 ? 0 : value > 1 ? 1 : value;
  }

  function easeOut(t) {
    t = clamp01(t);
    return 1 - Math.pow(1 - t, 3);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /** 盒模型四边尺寸只在换目标时读一次，fill 随矩形一起补间。 */
  function metricsOf(el) {
    var cs = getComputedStyle(el);
    return {
      m: [parseSide(cs.marginTop), parseSide(cs.marginRight), parseSide(cs.marginBottom), parseSide(cs.marginLeft)],
      b: [parseSide(cs.borderTopWidth), parseSide(cs.borderRightWidth), parseSide(cs.borderBottomWidth), parseSide(cs.borderLeftWidth)],
      p: [parseSide(cs.paddingTop), parseSide(cs.paddingRight), parseSide(cs.paddingBottom), parseSide(cs.paddingLeft)]
    };
  }

  function lerpMetrics(from, to, t) {
    if (!from) return to;
    if (!to) return from;
    function mix(a, b) {
      return [
        lerp(a[0], b[0], t),
        lerp(a[1], b[1], t),
        lerp(a[2], b[2], t),
        lerp(a[3], b[3], t)
      ];
    }
    return { m: mix(from.m, to.m), b: mix(from.b, to.b), p: mix(from.p, to.p) };
  }

  function setPresence(value, now) {
    if (hoverPresenceTarget === value) return;
    hoverPresenceFrom = hoverPresence;
    hoverPresenceTarget = value;
    hoverPresenceT0 = now;
    hoverPresenceDur = value ? fadeInMs : fadeOutMs;
  }

  function resetHoverVisual() {
    hoverEl = null;
    hoverRect = null;
    hoverMetrics = null;
    hoverAnim = null;
    metricsEl = null;
    hoverPresence = 0;
    hoverPresenceFrom = 0;
    hoverPresenceTarget = 0;
    chip.style.opacity = "0";
    chipAlpha = 0;
  }

  /**
   * 离开页面：普通元素淡出；若悬停的正是选中元素，选中框已经提供常驻描边，
   * 立即收掉 hover 层，避免淡出时把 fill 叠在选中框上。
   */
  function clearHover(now) {
    if (!hoverEl && hoverPresenceTarget === 0) return;
    var wasSelection = !!hoverEl && !!selectionEl && hoverEl === live(selectionEl);
    hoverEl = null;
    if (wasSelection) {
      resetHoverVisual();
      return;
    }
    setPresence(0, now);
  }

  /** 换目标：从当前视觉矩形接管；首次进入 / 命中选中元素时直接落位。 */
  function setHoverTarget(el, now) {
    if (!el || !live(el)) {
      clearHover(now);
      return;
    }

    if (el === hoverEl) {
      var nextRect = boxOf(el);
      setChipContent(el, nextRect);
      if (!hoverAnim) {
        hoverRect = nextRect;
        if (metricsEl !== el) {
          hoverMetrics = metricsOf(el);
          metricsEl = el;
        }
      }
      setPresence(1, now);
      return;
    }

    var toRect = boxOf(el);
    var toMetrics = metricsOf(el);
    metricsEl = el;
    var previousEl = hoverEl;
    var fromRect = hoverRect ? {
      x: hoverRect.x,
      y: hoverRect.y,
      w: hoverRect.w,
      h: hoverRect.h
    } : toRect;
    var fromMetrics = hoverMetrics || toMetrics;

    hoverEl = el;
    setPresence(1, now);
    setChipContent(el, toRect);

    if (selectionEl && live(selectionEl) && el === live(selectionEl)) {
      hoverRect = toRect;
      hoverMetrics = toMetrics;
      hoverAnim = null;
      return;
    }

    if (!previousEl && !hoverPresence) {
      hoverRect = toRect;
      hoverMetrics = toMetrics;
      hoverAnim = null;
      return;
    }

    hoverAnim = {
      from: fromRect,
      fromMetrics: fromMetrics,
      to: toRect,
      toMetrics: toMetrics,
      t0: now,
      dur: morphMs
    };
  }

  /** 推进 presence / 整框补间；返回 true 表示下一帧还要继续。 */
  function stepHover(now) {
    var active = false;

    if (hoverPresence !== hoverPresenceTarget) {
      var pt = clamp01((now - hoverPresenceT0) / hoverPresenceDur);
      hoverPresence = hoverPresenceFrom + (hoverPresenceTarget - hoverPresenceFrom) * easeOut(pt);
      if (pt >= 1) hoverPresence = hoverPresenceTarget;
      active = true;
    }

    if (hoverAnim) {
      var at = clamp01((now - hoverAnim.t0) / hoverAnim.dur);
      var eased = easeOut(at);
      hoverRect = {
        x: lerp(hoverAnim.from.x, hoverAnim.to.x, eased),
        y: lerp(hoverAnim.from.y, hoverAnim.to.y, eased),
        w: lerp(hoverAnim.from.w, hoverAnim.to.w, eased),
        h: lerp(hoverAnim.from.h, hoverAnim.to.h, eased)
      };
      hoverMetrics = lerpMetrics(hoverAnim.fromMetrics, hoverAnim.toMetrics, eased);
      if (at >= 1) {
        hoverRect = hoverAnim.to;
        hoverMetrics = hoverAnim.toMetrics;
        hoverAnim = null;
      }
      active = true;
    }

    if (!hoverEl && hoverPresenceTarget === 0 && hoverPresence <= 0.001 && (hoverRect || hoverAnim)) {
      resetHoverVisual();
    }

    return active;
  }

  function setChipContent(el, box) {
    var tag = el.tagName.toLowerCase();
    var classValue = (el.getAttribute && el.getAttribute("class")) || "";
    classValue = String(classValue).trim();
    var classes = classValue ? "." + classValue.split(/\\s+/).slice(0, 3).join(".") : "";
    var name = tag + classes;
    var size = Math.round(box.w) + " × " + Math.round(box.h);
    if (chipName.textContent !== name) chipName.textContent = name;
    if (chipSize.textContent !== size) chipSize.textContent = size;
  }

  function placeChip(box, alpha) {
    if (!box || alpha <= 0.01) {
      if (chipAlpha !== 0) {
        chip.style.opacity = "0";
        chipAlpha = 0;
      }
      return;
    }
    // 每帧读 offsetHeight 会强制同步布局；chip 是 nowrap 单行、字号固定，量一次就够
    if (!chipHeight) chipHeight = chip.offsetHeight;
    var value = Math.round(alpha * 1000) / 1000;
    var left = Math.max(0, box.x);
    // 底边距元素上边框 10px：文字不压描边；贴视口顶时上移裁切改为贴顶
    var top = box.y - 10 - chipHeight;
    if (top < 0) top = 0;
    if (chipAlpha !== value) {
      chip.style.opacity = String(value);
      chipAlpha = value;
    }
    if (chipLeft !== left) {
      chip.style.left = left + "px";
      chipLeft = left;
    }
    if (chipTopPos !== top) {
      chip.style.top = top + "px";
      chipTopPos = top;
    }
  }

  /** 选中：仅描边，无 fill。 */
  function paintSelection(box) {
    if (!ctx || !box) return;
    ctx.strokeStyle = palette.solid;
    ctx.lineWidth = 2;
    ctx.strokeRect(box.x + 1, box.y + 1, box.w - 2, box.h - 2);
  }

  /** 悬停：用当前视觉矩形 + 补间后的盒模型尺寸画三级 fill + 描边。 */
  function paintHover(box, metrics, alpha) {
    if (!ctx || !box || !metrics || alpha <= 0.001) return;
    var m = metrics.m;
    var b = metrics.b;
    var p = metrics.p;

    var marginBox = {
      x: box.x - m[3],
      y: box.y - m[0],
      w: box.w + m[3] + m[1],
      h: box.h + m[0] + m[2]
    };
    var paddingBox = {
      x: box.x + b[3],
      y: box.y + b[0],
      w: box.w - b[3] - b[1],
      h: box.h - b[0] - b[2]
    };
    var contentBox = {
      x: paddingBox.x + p[3],
      y: paddingBox.y + p[0],
      w: paddingBox.w - p[3] - p[1],
      h: paddingBox.h - p[0] - p[2]
    };

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = palette.margin;
    if (marginBox.w > 0 && marginBox.h > 0) {
      ctx.fillRect(marginBox.x, marginBox.y, marginBox.w, marginBox.h);
    }
    ctx.fillStyle = palette.padding;
    if (paddingBox.w > 0 && paddingBox.h > 0) {
      ctx.fillRect(paddingBox.x, paddingBox.y, paddingBox.w, paddingBox.h);
    }
    ctx.fillStyle = palette.content;
    if (contentBox.w > 0 && contentBox.h > 0) {
      ctx.fillRect(contentBox.x, contentBox.y, contentBox.w, contentBox.h);
    }
    ctx.strokeStyle = palette.solid;
    ctx.lineWidth = 2;
    ctx.strokeRect(box.x + 1, box.y + 1, box.w - 2, box.h - 2);
    ctx.restore();
  }

  function planOf(sel, hov, m, hoverVisible) {
    var hasSelection = !!live(sel);
    var hover = live(hov);
    var hasHover = !!hoverVisible && m === "full";
    return {
      hasSelection: hasSelection,
      hasHover: hasHover,
      hoverIsSelection: hasHover && hasSelection && !!hover && hover === live(sel),
      mode: m
    };
  }

  function drawLayers() {
    if (!alive || !ctx) return;
    selectionEl = live(selectionEl);
    var previousHover = hoverEl;
    hoverEl = live(hoverEl);
    // 目标元素被页面移除：与旧实现一致，直接撤掉悬停层，不做淡出
    if (previousHover && !hoverEl) resetHoverVisual();

    var sel = selectionEl;
    var hov = hoverEl;
    var hoverVisible = !!hoverRect && hoverPresence > 0.001;
    var plan = planOf(sel, hov, mode, hoverVisible);
    // 与主进程 resolveLayerPlan 同一规则（页内不能 import，保持一字不差的分支）
    var drawSelection = plan.hasSelection;
    var drawHoverLayer = plan.hasHover && !plan.hoverIsSelection;
    var chipOn = "none";
    if (plan.mode !== "selection-only") {
      if (plan.hasHover && !plan.hoverIsSelection) chipOn = "hover";
      else if (plan.hasHover && plan.hoverIsSelection) chipOn = "selection";
    }

    var selBox = drawSelection && sel ? boxOf(sel) : null;
    // 只清「上一帧画过 ∪ 本帧要画」的区域：全屏 clear 在大窗口 DPR 2 下每帧都是实打实的像素代价
    var nextBounds = null;
    if (selBox) nextBounds = boxBounds(selBox, 2);
    if (drawHoverLayer && hoverRect && hoverMetrics) {
      nextBounds = unionBounds(nextBounds, hoverBounds(hoverRect, hoverMetrics));
    }
    clearBounds(unionBounds(paintedBounds, nextBounds));
    paintedBounds = nextBounds;

    if (selBox) paintSelection(selBox);
    if (drawHoverLayer && hoverRect && hoverMetrics) {
      paintHover(hoverRect, hoverMetrics, hoverPresence);
    }
    if (chipOn === "hover" && hoverRect) placeChip(hoverRect, hoverPresence);
    else if (chipOn === "selection" && selBox) placeChip(selBox, 1);
    else placeChip(null, 0);
  }

  /**
   * 滚动 / 尺寸变化：尺寸变化要重设画布（赋值 width/height 等于清空）；
   * 悬停矩形只在目标真的随布局动了时吸附，页面里别的滚动容器动一下
   * （轮播、日志面板）不应该打断正在播放的换框补间。
   */
  function refreshLayout() {
    resizeCanvas();
    if (!hoverEl) return;
    hoverEl = live(hoverEl);
    if (!hoverEl) {
      resetHoverVisual();
      return;
    }
    var rect = boxOf(hoverEl);
    var destination = hoverAnim ? hoverAnim.to : hoverRect;
    if (!destination || !sameRect(destination, rect)) {
      hoverRect = rect;
      hoverMetrics = metricsOf(hoverEl);
      metricsEl = hoverEl;
      hoverAnim = null;
      setChipContent(hoverEl, rect);
    }
  }

  function scheduleDraw() {
    if (raf) return;
    raf = requestAnimationFrame(function (now) {
      raf = 0;
      // 命中测试、矩形与 computed style 都放在帧内：一帧只做一次，滚动也不逐事件读布局
      if (layoutDirty) {
        layoutDirty = false;
        refreshLayout();
      }
      if (pendingPoint) {
        var point = pendingPoint;
        pendingPoint = null;
        setHoverTarget(deepTarget(point.x, point.y), now);
      }
      var active = stepHover(now);
      drawLayers();
      if (active) scheduleDraw();
    });
  }

  function onMove(event) {
    if (!alive || mode !== "full") return;
    event.preventDefault();
    event.stopPropagation();
    // 高回报率鼠标一帧能发多条：只留最新坐标，命中测试延到帧内做一次
    if (!pendingPoint) pendingPoint = { x: 0, y: 0 };
    pendingPoint.x = event.clientX;
    pendingPoint.y = event.clientY;
    scheduleDraw();
  }

  function onClick(event) {
    if (!alive || mode !== "full") return;
    event.preventDefault();
    event.stopPropagation();
    var now = performance.now();
    selectionEl = deepTarget(event.clientX, event.clientY);
    // 点击必须落到真实目标：清掉进行中的补间，选中框与 hover 框都按真实 rect 落位
    if (selectionEl && live(selectionEl)) {
      var rect = boxOf(selectionEl);
      hoverEl = selectionEl;
      hoverRect = rect;
      hoverMetrics = metricsOf(selectionEl);
      metricsEl = selectionEl;
      hoverAnim = null;
      setPresence(1, now);
      setChipContent(selectionEl, rect);
    } else {
      clearHover(now);
    }
    scheduleDraw();
    var hit = w.__pideskPickHit;
    if (typeof hit === "function") {
      try {
        hit(JSON.stringify({
          x: event.clientX,
          y: event.clientY,
          scrollX: window.scrollX || 0,
          scrollY: window.scrollY || 0
        }));
      } catch (err) {
        // binding 未就绪时不让错误冒泡成 Uncaught
      }
    }
  }

  function onWheel(event) {
    if (!alive || mode !== "full") return;
    event.preventDefault();
    event.stopPropagation();
  }

  function onLeave() {
    if (!alive) return;
    // 丢掉还没在帧内处理的移动坐标，否则鼠标已经离开页面还会再亮起一次
    pendingPoint = null;
    clearHover(performance.now());
    scheduleDraw();
  }

  function onScrollOrResize() {
    if (!alive) return;
    // 滚动事件的节奏可能高于帧：尺寸读取与矩形吸附都推迟到帧内，避免逐事件读布局
    layoutDirty = true;
    scheduleDraw();
  }

  function bindFull() {
    if (fullListenersBound) return;
    fullListenersBound = true;
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
  }

  function unbindFull() {
    if (!fullListenersBound) return;
    fullListenersBound = false;
    pendingPoint = null;
    window.removeEventListener("mousemove", onMove, true);
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("wheel", onWheel, true);
    resetHoverVisual();
  }

  function setMode(next) {
    mode = next === "selection-only" ? "selection-only" : "full";
    if (mode === "full") bindFull();
    else unbindFull();
    scheduleDraw();
  }

  function clearSelection() {
    selectionEl = null;
    scheduleDraw();
  }

  function destroy() {
    if (!alive) return;
    alive = false;
    pendingPoint = null;
    layoutDirty = false;
    if (raf) cancelAnimationFrame(raf);
    unbindFull();
    window.removeEventListener("mouseleave", onLeave, true);
    document.removeEventListener("mouseleave", onLeave, true);
    window.removeEventListener("blur", onLeave, true);
    window.removeEventListener("resize", onScrollOrResize, true);
    window.removeEventListener("scroll", onScrollOrResize, true);
    host.remove();
    delete w.__pideskPickHighlight__;
  }

  bindFull();
  window.addEventListener("mouseleave", onLeave, true);
  document.addEventListener("mouseleave", onLeave, true);
  window.addEventListener("blur", onLeave, true);
  // 滚动 / 尺寸回调只置标记，加 passive 避免它们跟页面滚动抢主线程
  window.addEventListener("resize", onScrollOrResize, { capture: true, passive: true });
  window.addEventListener("scroll", onScrollOrResize, { capture: true, passive: true });
  w.__pideskPickHighlight__ = {
    destroy: destroy,
    targetAt: deepTarget,
    setMode: setMode,
    clearSelection: clearSelection
  };
}`;

const REMOVE_PICK_HIGHLIGHT_SRC = `function removePickHighlight() {
  if (window.__pideskPickHighlight__) window.__pideskPickHighlight__.destroy();
}`;
