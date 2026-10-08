import type { WebContents } from "electron";
import { sendCommand } from "./cdp";

/**
 * 拾取高亮（视觉层）：**选中（selection）与悬停（hover）双层**。
 *
 * 产品语义：
 * - 选中框：点击后常驻，仅描边、无 fill；换选替换；鼠标离开页面仍保留。
 * - 悬停：跟手瞬时（fill + 描边 + chip）；命中选中元素时不叠 fill，只保留尺寸 chip。
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
  await evaluate(wc, `(${INSTALL_PICK_HIGHLIGHT_SRC})(${JSON.stringify(HIGHLIGHT_PALETTE)})`);
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

/** 安装高亮层。palette 由主进程传入，保持色板单点定义。 */
const INSTALL_PICK_HIGHLIGHT_SRC = `function installPickHighlight(palette) {
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
    "  pointer-events:none; display:none;",
    "}",
    ".chip .size { margin-left:8px; font-weight:500; opacity:0.92; }"
  ].join("\\n");
  var canvas = document.createElement("canvas");
  var chip = document.createElement("div");
  chip.className = "chip";
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

  function resizeCanvas() {
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
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

  function clearSurface() {
    if (!ctx) return;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    chip.style.display = "none";
    chip.textContent = "";
  }

  function boxOf(el) {
    var rect = el.getBoundingClientRect();
    return { x: rect.left, y: rect.top, w: rect.width, h: rect.height, rect: rect };
  }

  function drawChip(el, borderBox) {
    var tag = el.tagName.toLowerCase();
    var classValue = (el.getAttribute && el.getAttribute("class")) || "";
    classValue = String(classValue).trim();
    var classes = classValue ? "." + classValue.split(/\\s+/).slice(0, 3).join(".") : "";
    var size = Math.round(borderBox.w) + " × " + Math.round(borderBox.h);
    chip.textContent = "";
    var nameSpan = document.createElement("span");
    nameSpan.textContent = tag + classes;
    var sizeSpan = document.createElement("span");
    sizeSpan.className = "size";
    sizeSpan.textContent = size;
    chip.append(nameSpan, sizeSpan);
    chip.style.display = "block";
    chip.style.left = Math.max(0, borderBox.x) + "px";
    chip.style.transform = "none";
    // 底边距元素上边框 10px：文字不压描边；贴视口顶时上移裁切改为贴顶
    var chipTop = borderBox.y - 10 - chip.offsetHeight;
    chip.style.top = (chipTop < 0 ? 0 : chipTop) + "px";
  }

  /** 选中：仅描边，无 fill。 */
  function paintSelection(el) {
    if (!ctx) return;
    var box = boxOf(el);
    if (box.w < 0 || box.h < 0) return;
    ctx.strokeStyle = palette.solid;
    ctx.lineWidth = 2;
    ctx.strokeRect(box.x + 1, box.y + 1, box.w - 2, box.h - 2);
    return box;
  }

  /** 悬停：盒模型三级 fill + 描边。 */
  function paintHover(el) {
    if (!ctx) return null;
    var cs = getComputedStyle(el);
    var box = boxOf(el);
    if (box.w < 0 || box.h < 0) return null;

    var mTop = parseSide(cs.marginTop);
    var mRight = parseSide(cs.marginRight);
    var mBottom = parseSide(cs.marginBottom);
    var mLeft = parseSide(cs.marginLeft);
    var bTop = parseSide(cs.borderTopWidth);
    var bRight = parseSide(cs.borderRightWidth);
    var bBottom = parseSide(cs.borderBottomWidth);
    var bLeft = parseSide(cs.borderLeftWidth);
    var pTop = parseSide(cs.paddingTop);
    var pRight = parseSide(cs.paddingRight);
    var pBottom = parseSide(cs.paddingBottom);
    var pLeft = parseSide(cs.paddingLeft);

    var borderBox = box;
    var marginBox = {
      x: borderBox.x - mLeft,
      y: borderBox.y - mTop,
      w: borderBox.w + mLeft + mRight,
      h: borderBox.h + mTop + mBottom
    };
    var paddingBox = {
      x: borderBox.x + bLeft,
      y: borderBox.y + bTop,
      w: borderBox.w - bLeft - bRight,
      h: borderBox.h - bTop - bBottom
    };
    var contentBox = {
      x: paddingBox.x + pLeft,
      y: paddingBox.y + pTop,
      w: paddingBox.w - pLeft - pRight,
      h: paddingBox.h - pTop - pBottom
    };

    ctx.fillStyle = palette.margin;
    ctx.fillRect(marginBox.x, marginBox.y, marginBox.w, marginBox.h);
    ctx.fillStyle = palette.padding;
    ctx.fillRect(paddingBox.x, paddingBox.y, paddingBox.w, paddingBox.h);
    ctx.fillStyle = palette.content;
    ctx.fillRect(contentBox.x, contentBox.y, contentBox.w, contentBox.h);
    ctx.strokeStyle = palette.solid;
    ctx.lineWidth = 2;
    ctx.strokeRect(borderBox.x + 1, borderBox.y + 1, borderBox.w - 2, borderBox.h - 2);
    return borderBox;
  }

  function planOf(sel, hov, m) {
    var hasSelection = !!live(sel);
    var hover = live(hov);
    var hasHover = !!hover && m === "full";
    return {
      hasSelection: hasSelection,
      hasHover: hasHover,
      hoverIsSelection: hasHover && hasSelection && hover === live(sel),
      mode: m
    };
  }

  function drawLayers() {
    if (!alive || !ctx) return;
    selectionEl = live(selectionEl);
    hoverEl = live(hoverEl);
    clearSurface();

    var sel = selectionEl;
    var hov = hoverEl;
    var plan = planOf(sel, hov, mode);
    // 与主进程 resolveLayerPlan 同一规则（页内不能 import，保持一字不差的分支）
    var drawSelection = plan.hasSelection;
    var drawHoverLayer = plan.hasHover && !plan.hoverIsSelection;
    var chipOn = "none";
    if (plan.mode !== "selection-only") {
      if (plan.hasHover && !plan.hoverIsSelection) chipOn = "hover";
      else if (plan.hasHover && plan.hoverIsSelection) chipOn = "selection";
    }

    var selBox = null;
    if (drawSelection && sel) selBox = paintSelection(sel);
    var hoverBox = null;
    if (drawHoverLayer && hov) hoverBox = paintHover(hov);
    if (chipOn === "hover" && hov) drawChip(hov, hoverBox || boxOf(hov));
    else if (chipOn === "selection" && sel) drawChip(sel, selBox || boxOf(sel));
  }

  function scheduleDraw() {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(function () {
      raf = 0;
      drawLayers();
    });
  }

  function onMove(event) {
    if (!alive || mode !== "full") return;
    event.preventDefault();
    event.stopPropagation();
    hoverEl = deepTarget(event.clientX, event.clientY);
    scheduleDraw();
  }

  function onClick(event) {
    if (!alive || mode !== "full") return;
    event.preventDefault();
    event.stopPropagation();
    selectionEl = deepTarget(event.clientX, event.clientY);
    hoverEl = selectionEl;
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
    hoverEl = null;
    scheduleDraw();
  }

  function onScrollOrResize() {
    if (!alive) return;
    resizeCanvas();
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
    window.removeEventListener("mousemove", onMove, true);
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("wheel", onWheel, true);
    hoverEl = null;
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
  window.addEventListener("resize", onScrollOrResize, true);
  window.addEventListener("scroll", onScrollOrResize, true);
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
