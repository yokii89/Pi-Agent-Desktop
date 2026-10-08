import fs from "node:fs";
import path from "node:path";
import { app, type WebContents } from "electron";
import type { BrowserPickedElement, BrowserPickMode, BrowserStyleKey } from "../../shared/ipc";
import { sendCommand } from "./cdp";
import { resolveNodeId } from "./inspectorCdp";
import {
  buildTargetAtExpression,
  disablePickHitBinding,
  enablePickHitBinding,
  type HitPayload,
  installPickHighlight,
  PICK_HIT_BINDING,
  parsePickHit,
  removePickHighlight,
  setPickHighlightMode,
  toDocumentHitPoint,
} from "./pickHighlight";

/**
 * CDP 拾取与截图（docs/design/05 §1.3、docs/design/06 §6.2）。
 *
 * 悬停视觉：圈选期页内装**临时**高亮层（粉色实线描边 + 左上角 chip + 盒模型色深
 * fill，见 `pickHighlight.ts`）——CDP `Overlay` 的 showInfo 角标形态锁死在 DevTools
 * 白底卡，画不出产品要的样式，故视觉自绘；命中点击仍回主进程走 CDP 采集。
 *
 * 06 的「无持久注入物」边界仍成立：高亮层与 `__pideskPickHit` binding 只在圈选
 * 子模式存活，退出拾取 / 切浏览 / 页面导航即拆除，不恢复 `__pideskPick__` 悬浮卡。
 * 拾取会话分两个子模式（§3.1）：圈选（高亮 on）与浏览（高亮 off）。
 */

const STYLE_KEYS: BrowserStyleKey[] = [
  "display",
  "position",
  "zIndex",
  "margin",
  "padding",
  "color",
  "backgroundColor",
  "fontSize",
  "fontWeight",
  "fontFamily",
  "lineHeight",
  "borderRadius",
  "border",
  "boxShadow",
  "overflow",
  "gap",
  "width",
  "height",
];

/** 元素截图在 bbox 外保留的余量（CSS px），对齐 docs/design/05 §6"含少量余量"。 */
const SHOT_MARGIN = 8;

interface CollectedInfo {
  tag: string;
  id: string | null;
  classes: string | null;
  selector: string;
  outerHTML: string;
  text: string;
  rect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number; dpr: number };
  styles: Record<string, string>;
  role: string | null;
  name: string | null;
}

interface ResolveNodeResult {
  object: { objectId: string };
}

interface CallFunctionOnResult {
  result: { type: string; value?: unknown };
}

interface CaptureScreenshotResult {
  data: string;
}

interface LayoutMetricsResult {
  cssVisualViewport: { clientWidth: number; clientHeight: number };
}

/** CDP `DOM.getNodeForLocation` 返回体（协议字段是 backendNodeId，不是 backendDOMNodeId）。 */
interface NodeForLocationResult {
  backendNodeId: number;
}

interface EvaluateRemoteResult {
  result?: {
    type?: string;
    subtype?: string;
    objectId?: string;
    value?: unknown;
  };
}

interface DescribeNodeResult {
  node?: { backendNodeId?: number };
}

interface PickCallbacks {
  /** 元素采集完成（payload 含 nodeId / 截图 / 最近控制台错误）。 */
  onPicked: (element: BrowserPickedElement) => void;
  /** 拾取会话状态变化（进入 / 退出 / 子模式切换，含主进程侧 ESC 触发的场景）。 */
  onPickState: (active: boolean, mode: BrowserPickMode) => void;
  /** 最近控制台错误（格式化后的单行摘要）。 */
  getRecentErrors: () => string[];
  /** 点选采集失败（用户可见提示；细节只进终端）。 */
  onPickError: (message: string) => void;
}

let callbacks: PickCallbacks | null = null;
/** 当前 debugger 事件绑定的 WebContents；多页面实例切换时需要换绑。 */
let boundWc: WebContents | null = null;
let pickActive = false;
let pickMode: BrowserPickMode = "select";
let pickSeq = 0;
let shotSeq = 0;

export function setPickCallbacks(next: PickCallbacks): void {
  callbacks = next;
}

export function isPickActive(): boolean {
  return pickActive;
}

export function getPickMode(): BrowserPickMode {
  return pickMode;
}

function send<T>(wc: WebContents, method: string, params?: Record<string, unknown>): Promise<T> {
  return sendCommand<T>(wc, method, params);
}

function emitState(): void {
  callbacks?.onPickState(pickActive, pickMode);
}

/** 挂 debugger；以目标 wc 自身的 isAttached 为准，支持多实例切换。 */
async function ensureAttached(wc: WebContents): Promise<void> {
  if (boundWc !== wc) bindDebugger(wc);
  if (!wc.debugger.isAttached()) {
    wc.debugger.attach();
  }
  await send(wc, "Page.enable");
}

function onDebuggerMessage(_event: Electron.Event, method: string, params: unknown): void {
  const wc = boundWc;
  if (!wc) return;
  if (method === "Runtime.bindingCalled") {
    const body = params as { name?: unknown; payload?: unknown };
    if (body.name !== PICK_HIT_BINDING) return;
    let parsed: unknown = body.payload;
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        return;
      }
    }
    const hit = parsePickHit(parsed);
    if (!hit) return;
    void handleHitRequested(wc, hit);
    return;
  }
}

function onDebuggerDetach(): void {
  // DevTools 抢占等场景的被动 detach：先尽量卸掉页内高亮，再对齐拾取状态
  const wc = boundWc;
  boundWc = null;
  if (pickActive) {
    pickActive = false;
    pickMode = "select";
    if (wc) {
      void removePickHighlight(wc).catch(() => {});
      void disablePickHitBinding(wc).catch(() => {});
    }
    emitState();
  }
}

function unbindDebugger(wc: WebContents | null): void {
  if (!wc) return;
  try {
    wc.debugger.removeListener("message", onDebuggerMessage);
    wc.debugger.removeListener("detach", onDebuggerDetach);
    if (wc.debugger.isAttached()) wc.debugger.detach();
  } catch {
    // webContents 已销毁时忽略
  }
}

/** 创建 WebContentsView / 切换活跃实例时调用：把 CDP 事件流绑到当前实例。 */
export function bindDebugger(wc: WebContents): void {
  if (boundWc === wc) return;
  unbindDebugger(boundWc);
  boundWc = wc;
  wc.debugger.on("message", onDebuggerMessage);
  wc.debugger.on("detach", onDebuggerDetach);
}

/**
 * 视口点 → backendNodeId。
 * 主路径与悬停高亮同一套 `targetAt`（穿 shadow DOM，必要时藏高亮层）；
 * 兜底走 CDP `DOM.getNodeForLocation`（文档坐标，协议 integer）。
 */
async function resolveBackendNodeIdAt(wc: WebContents, hit: HitPayload): Promise<number> {
  await send(wc, "DOM.enable");
  await send(wc, "Runtime.enable");

  const fromPage = await resolveViaTargetAt(wc, hit.x, hit.y).catch(() => null);
  if (fromPage !== null) return fromPage;

  // getNodeForLocation 要的是文档坐标：内部 DocumentToFrame 会再减一次 scroll
  const doc = toDocumentHitPoint(hit);
  const located = await send<NodeForLocationResult>(wc, "DOM.getNodeForLocation", {
    x: doc.x,
    y: doc.y,
    includeUserAgentShadowDOM: true,
  }).catch(() => null);
  if (typeof located?.backendNodeId === "number" && located.backendNodeId > 0) {
    return located.backendNodeId;
  }

  throw new Error("未命中页面元素");
}

/** 页内 `targetAt`（与悬停 deepTarget 同源）→ objectId → backendNodeId。 */
async function resolveViaTargetAt(
  wc: WebContents,
  viewportX: number,
  viewportY: number,
): Promise<number | null> {
  const evaluated = await send<EvaluateRemoteResult>(wc, "Runtime.evaluate", {
    expression: buildTargetAtExpression(viewportX, viewportY),
    returnByValue: false,
  });
  const objectId = evaluated.result?.objectId;
  if (!objectId || evaluated.result?.subtype === "null" || evaluated.result?.type === "undefined") {
    return null;
  }
  const described = await send<DescribeNodeResult>(wc, "DOM.describeNode", {
    objectId,
    depth: 0,
  });
  const backendNodeId = described.node?.backendNodeId;
  return typeof backendNodeId === "number" && backendNodeId > 0 ? backendNodeId : null;
}

async function handleHitRequested(wc: WebContents, hit: HitPayload): Promise<void> {
  if (!pickActive || pickMode !== "select") return;
  try {
    const backendNodeId = await resolveBackendNodeIdAt(wc, hit);
    const element = await collectElement(wc, backendNodeId);
    callbacks?.onPicked(element);
    // 06 §3.1：选中后**不暂停**圈选，高亮层保持武装以支持连续点选；
    // 需要滚页面时由用户切到「浏览」子模式。
  } catch (err) {
    console.warn("[browser] 元素采集失败", err);
    callbacks?.onPickError("元素采集失败，请重新点选");
    // 选中框保留（所见即所点，D6）；只确保 full 捕获仍在，不重装层
    if (pickActive && pickMode === "select") {
      await enablePickHitBinding(wc).catch(() => {});
    }
  }
}

/**
 * 武装圈选：装高亮层（full：hover + 选中）+ 点击回传 binding。
 * 会重建层并清空选中——只用于 startPick / 导航 rearm，不用于 select↔browse 切换。
 */
async function armInspectMode(wc: WebContents): Promise<void> {
  await send(wc, "DOM.enable");
  await send(wc, "Runtime.enable");
  await enablePickHitBinding(wc);
  await installPickHighlight(wc);
}

/** 浏览子模式：只留选中框，拆掉点击捕获，页面可交互。 */
async function enterBrowseVisual(wc: WebContents): Promise<void> {
  await setPickHighlightMode(wc, "selection-only");
  await disablePickHitBinding(wc);
}

/** 退出拾取：整层拆除（选中框一并消失）。 */
async function teardownPickVisual(wc: WebContents): Promise<void> {
  await removePickHighlight(wc);
  await disablePickHitBinding(wc);
}

/** 进入拾取会话（默认「圈选」子模式）。 */
export async function startPick(wc: WebContents): Promise<void> {
  await ensureAttached(wc);
  await send(wc, "DOM.enable");
  await send(wc, "Runtime.enable"); // Runtime.callFunctionOn 采集元素信息需要
  pickActive = true;
  pickMode = "select";
  await armInspectMode(wc);
  emitState();
}

/** 退出拾取会话（保留 debugger 与 Page 域供截图复用）。 */
export async function stopPick(wc: WebContents): Promise<void> {
  if (!pickActive) return;
  pickActive = false;
  pickMode = "select";
  // 清理各自兜底：任一步失败（页面已销毁/导航中）都不能中断后续步骤——否则高亮层
  // 会留在页内，退出拾取后页面仍吞掉所有点击，且悬浮高亮跟着鼠标走。
  await teardownPickVisual(wc).catch((err) => {
    console.warn("[browser] 退出拾取时卸载高亮失败", err);
  });
  await send(wc, "DOM.disable").catch(() => {});
  emitState();
}

/**
 * 切换拾取子模式（docs/design/06 §3.1）。
 * 会话未开启时是空操作——模式开关只在面板的「拾取」tab 内出现。
 */
export async function setPickMode(wc: WebContents, mode: BrowserPickMode): Promise<void> {
  if (!pickActive || mode === pickMode) return;
  pickMode = mode;
  if (mode === "select") {
    // 只切视觉模式，不 install——保留已有选中框（产品动线 D4）
    await setPickHighlightMode(wc, "full").catch((err) => {
      console.warn("[browser] 恢复圈选失败", err);
    });
    await enablePickHitBinding(wc).catch((err) => {
      console.warn("[browser] 恢复点击捕获失败", err);
    });
  } else {
    await enterBrowseVisual(wc).catch((err) => {
      console.warn("[browser] 切到浏览模式失败", err);
    });
  }
  emitState();
}

/** 导航完成后拾取会话仍开启时重新武装（热重载/刷新后页内高亮层会消失）。 */
export async function rearmPick(wc: WebContents): Promise<void> {
  if (!pickActive || pickMode !== "select") return;
  try {
    await send(wc, "DOM.enable");
    await armInspectMode(wc);
  } catch {
    // 页面尚不可注入时忽略，dom-ready 会再次触发
  }
}

export function detachDebugger(wc: WebContents): void {
  unbindDebugger(wc);
  if (boundWc === wc) boundWc = null;
  pickActive = false;
  pickMode = "select";
}

// ---------------------------------------------------------------------------
// 元素信息采集
// ---------------------------------------------------------------------------

/** 在页面内执行的采集函数（CDP functionDeclaration，this 绑定为目标元素）。 */
const COLLECT_FN = `function collect() {
  const el = this;
  if (!el || el.nodeType !== 1) return null;
  function uniqueSelector(node) {
    const parts = [];
    let current = node;
    let depth = 0;
    while (current && current.nodeType === 1 && depth < 8) {
      const tag = current.nodeName.toLowerCase();
      if (tag === "html") break;
      if (current.id) { parts.unshift("#" + CSS.escape(current.id)); break; }
      let selector = tag;
      const classValue = typeof current.className === "string" ? current.className.trim() : "";
      if (classValue) {
        const classSelector = tag + "." + classValue.split(/\\s+/).map(function (c) { return CSS.escape(c); }).join(".");
        // 类选择器全文档唯一时直接命中（对齐 DevTools copySelector 心智）
        try {
          if (document.querySelectorAll(classSelector).length === 1) {
            parts.unshift(classSelector);
            break;
          }
        } catch (e) { /* 非法类名字符时回退 tag 链 */ }
        selector += "." + classValue.split(/\\s+/).map(function (c) { return CSS.escape(c); }).join(".");
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.prototype.filter.call(parent.children, function (c) {
          return c.nodeName === current.nodeName;
        });
        if (siblings.length > 1) {
          selector += ":nth-of-type(" + (Array.prototype.indexOf.call(siblings, current) + 1) + ")";
        }
      }
      parts.unshift(selector);
      current = parent;
      depth += 1;
    }
    return parts.join(" > ");
  }
  const rect = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const keys = ${JSON.stringify(STYLE_KEYS)};
  const styles = {};
  for (const key of keys) { styles[key] = cs[key]; }
  let role = null;
  let name = null;
  try { role = el.computedRole || null; name = el.computedName || null; } catch (e) { /* 旧内核无此属性 */ }
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    classes: typeof el.className === "string" ? el.className : null,
    selector: uniqueSelector(el),
    outerHTML: el.outerHTML,
    text: (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 300),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
    styles: styles,
    role: role,
    name: name
  };
}`;

async function collectElement(
  wc: WebContents,
  backendNodeId: number,
): Promise<BrowserPickedElement> {
  await send(wc, "DOM.enable");
  await send(wc, "Runtime.enable"); // DOM.resolveNode 产出的 RemoteObject 需 Runtime 域
  const resolved = await send<ResolveNodeResult>(wc, "DOM.resolveNode", { backendNodeId });
  const objectId = resolved.object.objectId;
  const evaluated = await send<CallFunctionOnResult>(wc, "Runtime.callFunctionOn", {
    objectId,
    functionDeclaration: COLLECT_FN,
    returnByValue: true,
  });
  const info = evaluated.result.value as CollectedInfo | null;
  if (!info) throw new Error("元素信息采集失败");
  // nodeId 是检查器（CSS.*）的唯一入口：转换失败不阻断托盘链路，只是检查器对该元素不可用
  const nodeId = await resolveNodeId(wc, backendNodeId);
  const screenshot = await captureElementScreenshot(wc, info);
  pickSeq += 1;
  return {
    id: `pick-${Date.now()}-${pickSeq}`,
    nodeId,
    url: wc.getURL(),
    at: Date.now(),
    tag: info.tag,
    id_attr: info.id,
    class_attr: info.classes,
    a11yRole: info.role,
    a11yName: info.name,
    selector: info.selector,
    outerHTML: info.outerHTML.slice(0, 4000),
    textSummary: info.text,
    rect: info.rect,
    viewport: { width: info.viewport.width, height: info.viewport.height },
    styles: info.styles,
    screenshot,
    consoleErrors: callbacks?.getRecentErrors() ?? [],
  };
}

/** 元素截图：bbox + 少量余量裁剪，超出视口部分收拢。 */
async function captureElementScreenshot(
  wc: WebContents,
  info: CollectedInfo,
): Promise<BrowserPickedElement["screenshot"]> {
  const { rect, viewport } = info;
  const x = Math.max(0, rect.x - SHOT_MARGIN);
  const y = Math.max(0, rect.y - SHOT_MARGIN);
  const width = Math.min(viewport.width - x, rect.width + SHOT_MARGIN * 2 + (rect.x - x));
  const height = Math.min(viewport.height - y, rect.height + SHOT_MARGIN * 2 + (rect.y - y));
  if (width < 1 || height < 1) return null;
  const scale = Math.min(viewport.dpr || 1, 2);
  try {
    const shot = await send<CaptureScreenshotResult>(wc, "Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      clip: { x, y, width, height, scale },
    });
    return { base64: shot.data, path: savePng(shot.data, "element") };
  } catch (err) {
    console.warn("[browser] 元素截图失败", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 截图落盘
// ---------------------------------------------------------------------------

/** PNG base64 落盘到 userData/browser-context；路径随上下文 payload 交给 pi 读取。 */
export function savePng(base64: string, kind: string): string {
  const dir = path.join(app.getPath("userData"), "browser-context");
  fs.mkdirSync(dir, { recursive: true });
  shotSeq += 1;
  const file = path.join(dir, `${kind}-${Date.now()}-${shotSeq}.png`);
  fs.writeFileSync(file, Buffer.from(base64, "base64"));
  return file;
}

/** 视口截图（P0-4 / P1-3）：不依赖拾取，仅确保 debugger 挂载后整屏捕获并附带视口尺寸。 */
export async function captureViewport(
  wc: WebContents,
): Promise<{ base64: string; width: number; height: number }> {
  await ensureAttached(wc);
  const shot = await send<CaptureScreenshotResult>(wc, "Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  let width = 0;
  let height = 0;
  try {
    const metrics = await send<LayoutMetricsResult>(wc, "Page.getLayoutMetrics");
    width = Math.round(metrics.cssVisualViewport.clientWidth);
    height = Math.round(metrics.cssVisualViewport.clientHeight);
  } catch {
    // 尺寸信息缺失不阻断截图本身
  }
  return { base64: shot.data, width, height };
}
