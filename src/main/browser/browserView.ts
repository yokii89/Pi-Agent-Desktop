import { type Stats, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, shell, type WebContents, WebContentsView } from "electron";
import { t } from "../../shared/i18n";
import type {
  BrowserBoundsRequest,
  BrowserConsoleError,
  BrowserInstanceInfo,
  BrowserPickedElement,
  BrowserPickMode,
  BrowserPushBody,
  BrowserScreenshotResult,
  InspectorBoxModel,
  InspectorDomTree,
  InspectorStyleData,
  StylePatchClearRequest,
  StylePatchDeclaration,
  StylePatchExportRequest,
  StylePatchExportResult,
  StylePatchResult,
} from "../../shared/ipc";
import { getSettings, updateSettings } from "../settings/settings";
import { getMainWindow } from "../window/createMainWindow";
import { broadcastBrowserOutput } from "../window/inspectorWindow";
import {
  bindDebugger,
  captureViewport,
  detachDebugger,
  getPickMode,
  isPickActive,
  rearmPick,
  savePng,
  setPickCallbacks,
  setPickMode,
  startPick,
  stopPick,
} from "./browserPick";
import { getBrowserSession, setBrowserPopupBlockedListener } from "./browserPolicy";
import { BROWSER_PARTITION } from "./browserPolicyRules";
import {
  bindInspector,
  getBoxModel,
  getDomTree,
  getStyles,
  invalidateInspector,
  isInspectorSessionActive,
  setInspectorCallbacks,
  startInspectorSession,
  stopInspectorSession,
} from "./inspector";
import {
  applyStylePatch,
  clearStylePatch,
  exportOverrideCss,
  resetStylePatches,
} from "./inspectorEdit";

/**
 * 内嵌浏览器面板的页面实例管理（docs/design/05 §7.1）：
 * WebContentsView 主进程托管——生命周期、bounds 随侧栏同步、导航控制、
 * 控制台错误捕获、最近 URL 记录。渲染层只通过 IPC 与推送消息交互。
 *
 * 多页面：实例以 Map 管理，仅**活跃实例**挂到主窗口并接收 bounds；
 * 拾取/检查器是全局会话，只允许作用在活跃实例上。
 */

const MAX_CONSOLE_ERRORS = 50;
const MAX_RECENT_URLS = 20;
/** 浏览器页面实例上限，与终端对齐的产品直觉。 */
export const MAX_BROWSER_INSTANCES = 8;

interface BrowserInstance {
  id: string;
  view: WebContentsView | null;
  addedToWindow: boolean;
  lastBounds: BrowserBoundsRequest | null;
  errors: BrowserConsoleError[];
  errorSeq: number;
  zoomFactor: number;
}

const instances = new Map<string, BrowserInstance>();
let activeId = "";
let instanceSeq = 0;
let viewportWidth: number | null = getSettings().browserViewportWidth;
/**
 * 面板宿主区域最近一次 bounds（渲染层 RO / 显隐同步）。
 * 各页面实例共用同一宿主区，新建/切换实例时直接沿用，避免新实例
 * lastBounds 为 null 导致 applyBounds 隐藏视图、页面打不开。
 */
let panelBounds: BrowserBoundsRequest | null = null;
/**
 * 临时抑制页面视图显隐（区域截图 / 设置浮窗等）。
 * WebContentsView 盖在渲染层上方，fixed 弹层只要叠到宿主区就会被挡住，
 * 因此浮层打开时先藏视图，关闭后再由 applyBounds 按 lastBounds 恢复。
 * 多来源叠加：任一来源仍抑制则隐藏（例如设置与区域截图同时打开）。
 */
const overlaySuppressedReasons = new Set<string>();
const DEFAULT_SUPPRESS_REASON = "default";

function isOverlaySuppressed(): boolean {
  return overlaySuppressedReasons.size > 0;
}

function push(id: string, message: BrowserPushBody): void {
  // 浮窗打开时检查器在独立窗口，主窗仍要维护会话芯片——广播而非单播（docs/design/38）
  broadcastBrowserOutput({ ...message, id });
}

function getActive(): BrowserInstance | null {
  if (!activeId) return null;
  return instances.get(activeId) ?? null;
}

/** 取当前活跃页面实例；不存在时抛错（IPC 统一信封会转成 `{ ok: false }`）。 */
function requireActive(): BrowserInstance {
  const entry = getActive();
  if (!entry) throw new Error("请先打开一个页面");
  return entry;
}

function requireWebContents(): WebContents {
  const entry = requireActive();
  const wc = entry.view?.webContents;
  if (!wc) throw new Error("请先打开一个页面");
  return wc;
}

// ---------------------------------------------------------------------------
// 页面实例
// ---------------------------------------------------------------------------

/** 确保至少有一个实例（默认 id=1），供面板首挂与应用启动使用。 */
export function ensureDefaultInstance(): string {
  if (instances.size === 0) {
    createBrowserInstance();
  }
  if (!activeId) {
    const first = instances.keys().next().value;
    if (first) activeId = first;
  }
  return activeId;
}

/** 新建浏览器页面实例并设为活跃；返回实例 id。 */
export function createBrowserInstance(): string {
  if (instances.size >= MAX_BROWSER_INSTANCES) {
    throw new Error(`最多 ${MAX_BROWSER_INSTANCES} 个浏览器页面`);
  }
  instanceSeq += 1;
  const id = String(instanceSeq);
  const entry: BrowserInstance = {
    id,
    view: null,
    addedToWindow: false,
    // 新建实例继承面板宿主 bounds，导航后即可挂载显示
    lastBounds: panelBounds,
    errors: [],
    errorSeq: 0,
    zoomFactor: 1,
  };
  instances.set(id, entry);
  // 同步切换活跃 id：navigate 必须立刻作用在新实例上，
  // 不能落在 setActive 的异步窗口（拾取收尾 await）里打到旧页
  const prev = getActive();
  if (prev) hideInstanceView(prev);
  activeId = id;
  if (isPickActive()) {
    void stopPickMode().catch(() => {});
  }
  applyBoundsFor(entry);
  syncActiveInstanceState(entry);
  return id;
}

/**
 * 关闭指定实例。关闭的是活跃实例时切到「原位置后的下一个」，
 * 没有下一个则取前一个，与渲染层 closePage / pageClosed 对齐。
 */
export function closeBrowserInstance(id: string): void {
  const entry = instances.get(id);
  if (!entry) return;
  const idsBefore = [...instances.keys()];
  const closedIndex = idsBefore.indexOf(id);
  destroyInstanceView(entry);
  instances.delete(id);
  if (activeId !== id) return;
  const remaining = [...instances.keys()];
  const next = remaining[closedIndex] ?? remaining[closedIndex - 1] ?? remaining[0] ?? "";
  activeId = next;
  if (!next) return;
  const nextEntry = instances.get(next);
  if (!nextEntry) return;
  rebindPickToActive(nextEntry);
  applyBoundsFor(nextEntry);
  syncActiveInstanceState(nextEntry);
}

/** 切换活跃实例：停拾取、藏旧视图、显示新视图并同步地址栏状态。 */
export async function setActiveBrowserInstance(id: string): Promise<void> {
  const entry = instances.get(id);
  if (!entry) throw new Error("浏览器页面不存在");
  if (activeId === id) return;
  // 拾取/检查器是全局会话，换页前必须退出
  if (isPickActive()) {
    await stopPickMode().catch(() => {});
  }
  // 热更改与检查器按实例隔离（22 §六）：换页即失效，避免 A 页调整写进 B 页
  invalidateInspector("navigated");
  resetStylePatches();
  const prev = getActive();
  if (prev) hideInstanceView(prev);
  activeId = id;
  rebindPickToActive(entry);
  applyBoundsFor(entry);
  syncActiveInstanceState(entry);
}

/** 拾取/检查器 debugger 会话跟到当前活跃实例（多页面各自独立 WebContents）。 */
function rebindPickToActive(entry: BrowserInstance): void {
  const wc = entry.view?.webContents;
  if (!wc) return;
  bindDebugger(wc);
  bindInspector(wc);
}

export function listBrowserInstances(): BrowserInstanceInfo[] {
  return [...instances.values()].map((entry) => ({
    id: entry.id,
    url: entry.view?.webContents.getURL() ?? "",
    title: entry.view?.webContents.getTitle() ?? "",
    started: entry.view !== null,
  }));
}

function syncActiveInstanceState(entry: BrowserInstance): void {
  const wc = entry.view?.webContents;
  if (!wc) {
    push(entry.id, { type: "loading", payload: false });
    push(entry.id, {
      type: "navigated",
      payload: {
        url: "",
        title: "",
        canGoBack: false,
        canGoForward: false,
        kind: "commit",
      },
    });
    return;
  }
  const url = wc.getURL();
  push(entry.id, { type: "loading", payload: wc.isLoading() });
  push(entry.id, {
    type: "navigated",
    payload: {
      url,
      title: wc.getTitle(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      kind: "commit",
    },
  });
}

/** 惰性创建页面视图；首个 URL 导航时才真正落到窗口上。 */
function ensureView(entry: BrowserInstance): WebContentsView {
  if (entry.view) return entry.view;
  // session 级初始化必须在创建 WebContents **之前**：Electron 的 session.setUserAgent
  // 不影响「先于该调用创建」的 WebContents，顺序反了首个页面会带着 `Electron/33.4.11`
  // 出海（实测：js navigator 与请求头同时残留），Google 等站点据此走另一条流程
  const session = getBrowserSession();
  initializeBrowserSession(session);
  const created = new WebContentsView({
    webPreferences: {
      // 独立分区：与主窗口会话/存储隔离（docs/design/05 §7.3 安全边界）
      partition: BROWSER_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  const wc = created.webContents;

  // 本地开发预览不授予任何敏感权限，禁止下载
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));

  wc.on("did-start-loading", () => push(entry.id, { type: "loading", payload: true }));
  wc.on("did-stop-loading", () => push(entry.id, { type: "loading", payload: false }));
  wc.on("did-navigate", (_event, url) => {
    if (/^https?:\/\//i.test(url)) recordRecentUrl(url);
    // nodeId 与 backendNodeId 在导航后全部失效（06 §5.1）：清空检查器并提示重新拾取
    invalidateInspector("navigated");
    pushNavigated(entry, "commit");
  });
  // 页内导航（SPA 路由）只更新地址栏，不让托盘元素过期，也不动检查器（DOM 未重建）
  wc.on("did-navigate-in-page", (_event, _url, isMainFrame) => {
    if (isMainFrame) pushNavigated(entry, "inpage");
  });
  wc.on("page-title-updated", () => pushNavigated(entry, "inpage"));
  wc.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
    // -3 为 ERR_ABORTED（主动停止或被新导航取代），不作为错误提示
    if (isMainFrame && code !== -3) {
      push(entry.id, { type: "error", payload: `页面加载失败 (${code}) ${description}` });
    }
  });
  // 刷新/热重载后拾取模式若仍开启则重新武装 overlay
  wc.on("dom-ready", () => {
    if (isPickActive() && entry.id === activeId) void rearmPick(wc);
  });
  // ESC 分层兜底（06 §3.1）：圈选中先退到「浏览」（保留检查器数据），浏览中再按才退出拾取。
  // Enter（圈选中）：把最近拾取元素送入中央对话框（默认无截图）。
  // 页面持有焦点时键盘事件只到得了主进程这一层（before-input-event 先于页面）。
  wc.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !isPickActive() || entry.id !== activeId) return;
    if (input.key === "Escape") {
      event.preventDefault();
      if (getPickMode() === "select") {
        void setPickMode(wc, "browse").catch(() => {});
      } else {
        void stopPickMode();
      }
      return;
    }
    // 圈选模式下页面不可交互，Enter 可安全用于「加入对话」
    if (input.key === "Enter" && getPickMode() === "select") {
      event.preventDefault();
      push(entry.id, { type: "pickConfirm" });
    }
  });
  // 控制台错误捕获（P1-2）。
  // Electron 35 起 `console-message` 把入参收进事件对象，`level` 从数字 0–3 变成
  // 'verbose'|'info'|'warning'|'error'|'debug' 字符串（旧的位置参数仍在类型声明里但运行时已不再传入，
  // 照旧写法会静默漏掉所有控制台错误）。docs/design/05 的控制台面板因此同时接受两种写法。
  wc.on("console-message", (details) => {
    const level = resolveConsoleLevel(details);
    const message = (details as { message?: string }).message ?? "";
    if (level !== "error" || !message) return;
    const lineNumber = (details as { lineNumber?: number }).lineNumber;
    const sourceId = (details as { sourceId?: string }).sourceId;
    entry.errorSeq += 1;
    const error: BrowserConsoleError = {
      id: `console-error-${entry.id}-${entry.errorSeq}`,
      message,
      source: sourceId || null,
      line: typeof lineNumber === "number" && Number.isFinite(lineNumber) ? lineNumber : null,
      at: Date.now(),
    };
    entry.errors.push(error);
    if (entry.errors.length > MAX_CONSOLE_ERRORS) {
      entry.errors.splice(0, entry.errors.length - MAX_CONSOLE_ERRORS);
    }
    push(entry.id, { type: "console", payload: error });
  });

  setPickCallbacks({
    onPicked: (element: BrowserPickedElement) =>
      push(activeId, { type: "picked", payload: element }),
    onPickState: (active: boolean, mode: BrowserPickMode) =>
      push(activeId, { type: "pick", payload: { active, mode } }),
    onPickError: (message: string) => push(activeId, { type: "error", payload: message }),
    getRecentErrors: () => {
      const current = getActive();
      if (!current) return [];
      return current.errors
        .slice(-5)
        .map(
          (error) =>
            `${error.message}${error.source ? ` (${error.source}${error.line !== null ? `:${error.line}` : ""})` : ""}`,
        );
    },
  });
  // 检查器：数据失效统一走既有单推送通道（06 §4.4）
  setInspectorCallbacks({
    onInvalidated: (reason) => push(activeId, { type: "inspectInvalidated", payload: { reason } }),
  });
  bindDebugger(wc);
  bindInspector(wc);

  entry.view = created;
  return created;
}

/** persist:browser 为共享 session，will-download 只绑一次。 */
const sessionInitialized = new WeakSet<Electron.Session>();

/**
 * 面板 session 的一次性初始化。
 *
 * 这里**不再**做 UA / UA-CH 伪装（docs/design/42 §6.9）：伪装会让请求头自称 `Google Chrome`
 * 而页面 JS 里的 `navigator.userAgentData.brands` 没有 `Google Chrome`，Google 据此判定
 * 「内嵌应用冒充浏览器」并拒登；保留 Electron 自己诚实的身份（与 ZCode 同档）后正常。
 */
function initializeBrowserSession(session: Electron.Session): void {
  if (sessionInitialized.has(session)) return;
  sessionInitialized.add(session);
  session.on("will-download", (event) => event.preventDefault());
}

/**
 * `console-message` 的等级归一。
 *
 * Electron 35+ 传字符串（`info`/`warning`/`error`/`debug`），33 及更早传数字 0–3。
 * 两套都认，避免升级或降级时静默丢掉控制台错误。
 */
function resolveConsoleLevel(details: unknown): "error" | "warning" | "info" | "debug" | null {
  const level = (details as { level?: unknown }).level;
  if (level === "error" || level === "warning" || level === "info" || level === "debug") {
    return level;
  }
  // 旧形态：位置参数里的 level（事件对象本身不带）
  if (level === 3) return "error";
  if (level === 2) return "warning";
  if (level === 1) return "info";
  if (level === 0) return "debug";
  return null;
}

function pushNavigated(entry: BrowserInstance, kind: "commit" | "inpage"): void {
  const wc = entry.view?.webContents;
  push(entry.id, {
    type: "navigated",
    payload: {
      url: wc?.getURL() ?? "",
      title: wc?.getTitle() ?? "",
      canGoBack: wc?.navigationHistory.canGoBack() ?? false,
      canGoForward: wc?.navigationHistory.canGoForward() ?? false,
      kind,
    },
  });
}

function recordRecentUrl(url: string): void {
  const settings = getSettings();
  const next = [
    { url, at: Date.now() },
    ...settings.browserRecentUrls.filter((item) => item.url !== url),
  ].slice(0, MAX_RECENT_URLS);
  updateSettings({ browserRecentUrls: next });
}

// ---------------------------------------------------------------------------
// bounds 同步（docs/design/05 §11.2 风险点：侧栏拖拽/显隐需手动同步）
// ---------------------------------------------------------------------------

function hideInstanceView(entry: BrowserInstance): void {
  const win = getMainWindow();
  const view = entry.view;
  if (!view) return;
  if (entry.addedToWindow && win) {
    win.contentView.removeChildView(view);
    entry.addedToWindow = false;
  }
  view.setVisible(false);
}

function applyBoundsFor(entry: BrowserInstance): void {
  const win = getMainWindow();
  const view = entry.view;
  // 非活跃实例一律隐藏
  if (entry.id !== activeId || !view || !win) {
    hideInstanceView(entry);
    return;
  }
  // 宿主 bounds 以面板级事实为准：实例切换/新建时 lastBounds 可能尚未单独写入
  const bounds = panelBounds ?? entry.lastBounds;
  if (!bounds?.visible || bounds.width < 2 || bounds.height < 2 || isOverlaySuppressed()) {
    // 仅 setVisible 在部分平台上合成层让出不及时，设置等 Modal 仍会被盖住；
    // 抑制期间直接从窗口摘掉视图，恢复时再挂回。
    if (entry.addedToWindow) {
      win.contentView.removeChildView(view);
      entry.addedToWindow = false;
    }
    view.setVisible(false);
    return;
  }
  // 响应式视口（P1-4）：按预设宽度收缩视图，余下区域透出面板底色
  const width =
    viewportWidth !== null ? Math.min(Math.round(viewportWidth), bounds.width) : bounds.width;
  view.setBounds({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(1, width),
    height: Math.round(bounds.height),
  });
  // 先摆好 bounds 再挂回/显示，避免以错误坐标闪一帧
  if (!entry.addedToWindow) {
    win.contentView.addChildView(view);
    entry.addedToWindow = true;
  }
  view.setVisible(true);
}

function applyBoundsAll(): void {
  for (const entry of instances.values()) applyBoundsFor(entry);
}

export function setBrowserBounds(rect: BrowserBoundsRequest): void {
  ensureDefaultInstance();
  panelBounds = rect;
  const entry = getActive();
  if (!entry) return;
  entry.lastBounds = rect;
  applyBoundsFor(entry);
}

function destroyInstanceView(entry: BrowserInstance): void {
  if (entry.id === activeId && isPickActive()) {
    stopPickMode().catch(() => {});
  }
  if (entry.view) {
    // 销毁的可能是 debugger 当前绑定的实例，统一走 detach 清理
    detachDebugger(entry.view.webContents);
    hideInstanceView(entry);
    entry.view.webContents.close();
    entry.view = null;
  }
  entry.addedToWindow = false;
  entry.errors = [];
}

// ---------------------------------------------------------------------------
// 导航控制（作用在活跃实例）
// ---------------------------------------------------------------------------

/** 地址规范化：localhost / 内网 IP / 127.x 补 http，其余按域名补 https；非 http(s) 一律拒绝。 */
function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("地址不能为空");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^file:\/\//i.test(trimmed)) {
    // 用户刚从文件面板点进来时地址栏就是 file://，容易误以为这里能导航——
    // 文案把正确入口指出来，而不是一句「仅支持 http/https」让人困惑
    throw new Error("本地 HTML 请从文件面板打开（预览头部的地球按钮）");
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    throw new Error("仅支持 http/https 页面");
  }
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\]|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/|$)/i;
  return `${isLocal.test(trimmed) ? "http" : "https"}://${trimmed}`;
}

export async function navigateBrowser(input: string): Promise<void> {
  ensureDefaultInstance();
  const entry = requireActive();
  const url = normalizeUrl(input);
  const wc = ensureView(entry).webContents;
  applyBoundsFor(entry);
  // 加载失败经 did-fail-load 推送提示；loadURL 的 rejection（中断/失败）不外抛
  await wc.loadURL(url).catch(() => {});
}

/** file:// 通道仅服务文件面板的网页预览；其他后缀仍走「用系统应用打开」。 */
const LOCAL_HTML_EXTS = new Set(["html", "htm"]);

/**
 * 在侧栏浏览器中打开本地 HTML 文件（file:// 专用通道，docs/文件面板文件渲染方案.md）。
 * 只收本地路径并在此校验后缀与存在性，渲染层不传 URL，防止绕过地址栏的
 * http(s) 白名单；`pathToFileURL` 负责空格/`#`/中文的转义。
 */
export function openLocalFileInBrowser(filePath: string): void {
  const trimmed = filePath.trim();
  if (!trimmed) throw new Error("文件路径不能为空");
  if (!LOCAL_HTML_EXTS.has(path.extname(trimmed).slice(1).toLowerCase())) {
    throw new Error("仅支持在侧栏浏览器中打开 HTML 文件");
  }
  let stat: Stats;
  try {
    stat = statSync(trimmed);
  } catch {
    throw new Error("文件不存在或已被移动");
  }
  if (!stat.isFile()) throw new Error("不是常规文件");
  ensureDefaultInstance();
  const entry = requireActive();
  const wc = ensureView(entry).webContents;
  applyBoundsFor(entry);
  // 不等加载完成：渲染层随即切到浏览器 Tab，bounds 同步后视图才可见；
  // 加载失败经 did-fail-load 推送提示，rejection（中断/失败）不外抛
  void wc.loadURL(pathToFileURL(path.resolve(trimmed)).href).catch(() => {});
}

export function reloadBrowser(): void {
  getActive()?.view?.webContents.reload();
}

export function forceReloadBrowser(): void {
  getActive()?.view?.webContents.reloadIgnoringCache();
}

export function openBrowserDevTools(): void {
  getActive()?.view?.webContents.openDevTools({ mode: "detach" });
}

/** 缩放因子夹到 50%–300%，避免极端值把页面压成不可用。 */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;

export function setBrowserZoom(factor: number): void {
  const entry = getActive();
  if (!entry) return;
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, factor));
  entry.zoomFactor = clamped;
  entry.view?.webContents.setZoomFactor(clamped);
}

export async function clearBrowserCookies(): Promise<void> {
  const wc = requireWebContents();
  await wc.session.clearStorageData({ storages: ["cookies"] });
}

export async function clearBrowserCache(): Promise<void> {
  const wc = requireWebContents();
  await wc.session.clearCache();
}

/**
 * 截取当前页冻结帧（视图仍保持可见）。
 * 浮层应：先截帧 → 渲染层画上垫底 → 再 setOverlaySuppressed，
 * 避免「先藏视图、下一帧才显示冻结帧」造成的闪烁。
 */
export async function captureBrowserOverlayFreeze(): Promise<{ freeze: string | null }> {
  const view = getActive()?.view;
  if (!view) return { freeze: null };
  try {
    const image = await view.webContents.capturePage();
    return { freeze: image.toDataURL() };
  } catch {
    return { freeze: null };
  }
}

/**
 * 临时抑制页面视图显隐（区域截图 / 设置浮窗 / 更多菜单等）。
 * WebContentsView 盖在渲染层上方，fixed 弹层只要叠到宿主区就会被挡住，
 * 因此浮层打开时先藏视图，关闭后再由 applyBounds 按 lastBounds 恢复。
 * 多来源叠加：任一来源仍抑制则隐藏（例如设置与区域截图同时打开）。
 *
 * 本函数**不负责截帧**；需要冻结帧时先调 captureBrowserOverlayFreeze，
 * 待渲染层画上后再调本函数隐藏，避免闪烁。
 */
export function setBrowserOverlaySuppressed(
  suppressed: boolean,
  reason: string = DEFAULT_SUPPRESS_REASON,
): void {
  if (suppressed) overlaySuppressedReasons.add(reason);
  else overlaySuppressedReasons.delete(reason);
  applyBoundsAll();
}

/** 渲染层裁剪后的区域截图落盘（路径供托盘/上下文引用）。 */
export function saveBrowserScreenshot(base64: string): { path: string } {
  return { path: savePng(base64, "region") };
}

export function backBrowser(): void {
  getActive()?.view?.webContents.navigationHistory.goBack();
}

export function forwardBrowser(): void {
  getActive()?.view?.webContents.navigationHistory.goForward();
}

export function stopBrowser(): void {
  getActive()?.view?.webContents.stop();
}

export function getBrowserUrl(): string | null {
  ensureDefaultInstance();
  const url = getActive()?.view?.webContents.getURL();
  return url && /^https?:\/\//i.test(url) ? url : null;
}

export async function openBrowserExternal(): Promise<void> {
  const url = getBrowserUrl();
  if (!url) throw new Error("当前没有已打开的页面");
  await shell.openExternal(url);
}

// ---------------------------------------------------------------------------
// 拾取与截图
// ---------------------------------------------------------------------------

export async function startPickMode(): Promise<void> {
  ensureDefaultInstance();
  const wc = requireWebContents();
  await startPick(wc);
  await startInspectorSession(wc);
}

export async function stopPickMode(): Promise<void> {
  const view = getActive()?.view;
  const wc = view?.webContents;
  if (!wc) return;
  // 先收 CSS 域再退拾取（DOM 域由 pick 负责关闭）
  await stopInspectorSession(wc);
  await stopPick(wc);
}

/** 拾取会话内的子模式切换（圈选 / 浏览，06 §3.1）。 */
export async function setBrowserPickMode(mode: BrowserPickMode): Promise<void> {
  const wc = requireWebContents();
  await setPickMode(wc, mode);
}

/** 检查器只读查询：nodeId 来自拾取结果，越界/失效一律按错误上抛由渲染层清空面板。 */
function assertInspectorReady(nodeId: number): number {
  if (!isInspectorSessionActive()) throw new Error("检查器会话未开启，请重新拾取元素");
  if (!Number.isInteger(nodeId) || nodeId <= 0) throw new Error("节点已失效，请重新拾取");
  return nodeId;
}

export async function inspectStyles(nodeId: number): Promise<InspectorStyleData> {
  return getStyles(requireWebContents(), assertInspectorReady(nodeId));
}

export async function inspectBoxModel(nodeId: number): Promise<InspectorBoxModel> {
  return getBoxModel(requireWebContents(), assertInspectorReady(nodeId));
}

export async function inspectDomTree(nodeId: number): Promise<InspectorDomTree> {
  return getDomTree(requireWebContents(), assertInspectorReady(nodeId));
}

/** 热更改写路径：不绑死 pick 会话，只要求节点 id 有效（22 §4.4）。 */
function assertStylePatchNode(nodeId: number): number {
  if (!Number.isInteger(nodeId) || nodeId <= 0) throw new Error("节点已失效，请重新拾取");
  return nodeId;
}

/** 样式热更改：全量替换某 selector 的 PiDesk 调整声明（docs/design/22）。 */
export async function stylePatch(
  nodeId: number,
  selector: string,
  declarations: StylePatchDeclaration[],
): Promise<StylePatchResult> {
  const entry = requireActive();
  try {
    const result = await applyStylePatch(
      requireWebContents(),
      assertStylePatchNode(nodeId),
      selector,
      declarations,
    );
    push(entry.id, {
      type: "styleApplied",
      payload: { nodeId, selector: result.selector, applied: result.applied },
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    push(entry.id, { type: "styleApplyFailed", payload: { message } });
    throw err;
  }
}

export async function stylePatchClear(req: StylePatchClearRequest): Promise<void> {
  await clearStylePatch(requireWebContents(), req?.selector ?? null);
}

export function stylePatchExport(req: StylePatchExportRequest): StylePatchExportResult {
  return exportOverrideCss(req?.host ?? "");
}

export async function setBrowserViewport(width: number | null): Promise<void> {
  viewportWidth = width;
  applyBoundsAll();
}

/** 视口截图（P0-4）：PNG 落盘 + base64 返回。 */
export async function captureBrowserScreenshot(): Promise<BrowserScreenshotResult> {
  const wc = requireWebContents();
  const captured = await captureViewport(wc);
  return {
    base64: captured.base64,
    path: savePng(captured.base64, "viewport"),
    url: wc.getURL(),
    width: captured.width,
    height: captured.height,
  };
}

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------

export function destroyBrowser(): void {
  stopPickMode().catch(() => {});
  for (const entry of [...instances.values()]) {
    destroyInstanceView(entry);
  }
  instances.clear();
  activeId = "";
  panelBounds = null;
  overlaySuppressedReasons.clear();
}

export function registerBrowserLifecycle(): void {
  // 弹窗被上限拒绝时告知面板（策略层不碰页面实例与推送通道，见 browserPolicy）
  setBrowserPopupBlockedListener((limit) => {
    const entry = getActive();
    if (entry) push(entry.id, { type: "error", payload: t("browser.popup.blocked", { limit }) });
  });
  app.on("will-quit", () => {
    destroyBrowser();
  });
}
