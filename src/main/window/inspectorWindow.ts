import path from "node:path";
import { app, BrowserWindow, type WebContents } from "electron";
import {
  BROWSER_IPC,
  type BrowserPushMessage,
  INSPECTOR_FLOAT_IPC,
  type InspectorFloatHandoff,
  type InspectorFloatStateMessage,
} from "../../shared/ipc";
import { getMainWindow } from "./createMainWindow";

/**
 * 检查器系统级浮窗（docs/design/38）。
 *
 * 为什么是独立 BrowserWindow 而不是 ReviewWindow 式应用内浮层：
 * 预览页是 `WebContentsView` 原生合成层，会盖住渲染层 DOM（06 D5）——
 * 浮窗必须是 OS 窗才能与页面并排、互不遮挡。
 *
 * 同一时刻只有一个交互宿主（停靠 XOR 浮窗）；`handoff` 暂存 UI 草稿快照，
 * 已写入 CSSOM 的热更仍由 `inspectorEdit` 持有，切换时不必回滚。
 */

function distPath(...segments: string[]): string {
  return path.join(app.getAppPath(), "dist", ...segments);
}

const DEFAULT_WIDTH = 420;
const DEFAULT_HEIGHT = 560;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 360;

let inspectorWindow: BrowserWindow | null = null;
let pendingHandoff: InspectorFloatHandoff | null = null;
/** 已通过 dock/returnHandoff 收过草稿，允许直接销毁。 */
let forceClosed = false;
/** 会话内位置/尺寸记忆（不落盘，与 ReviewWindow 同策略）。 */
let persistedBounds: { x: number; y: number; width: number; height: number } | null = null;

function isAlive(win: BrowserWindow | null): win is BrowserWindow {
  return win !== null && !win.isDestroyed();
}

/** 向所有应用窗口广播（主窗 + 浮窗）。对齐 deviceFlow.broadcast。 */
export function broadcastToAppWindows(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send(channel, payload);
  }
}

/**
 * 浏览器推送广播：浮窗打开时检查器 UI 在浮窗里，主窗仍要收 `picked` / `pickConfirm`
 * 以维护会话芯片；因此不单播主窗，而是广播给全部应用窗口。
 */
export function broadcastBrowserOutput(message: BrowserPushMessage): void {
  broadcastToAppWindows(BROWSER_IPC.output, message);
}

function pushFloatState(open: boolean, handoff?: InspectorFloatHandoff | null): void {
  const payload: InspectorFloatStateMessage = { open, handoff: handoff ?? null };
  getMainWindow()?.webContents.send(INSPECTOR_FLOAT_IPC.state, payload);
}

function resolveInitialBounds(): { x: number; y: number; width: number; height: number } {
  if (persistedBounds) {
    return {
      x: Math.round(persistedBounds.x),
      y: Math.round(persistedBounds.y),
      width: Math.round(persistedBounds.width),
      height: Math.round(persistedBounds.height),
    };
  }
  const main = getMainWindow();
  const display = main ? main.getBounds() : null;
  const width = DEFAULT_WIDTH;
  const height = DEFAULT_HEIGHT;
  if (!display) {
    return { x: 120, y: 120, width, height };
  }
  // 默认停在主窗右下角内侧，避免压住左侧会话区与预览页中心
  return {
    x: Math.round(display.x + display.width - width - 24),
    y: Math.round(display.y + display.height - height - 48),
    width,
    height,
  };
}

function loadInspector(win: BrowserWindow): void {
  const devServerUrl = process.env.PIDESK_DEV_SERVER_URL;
  if (devServerUrl) {
    const base = devServerUrl.endsWith("/") ? devServerUrl.slice(0, -1) : devServerUrl;
    void win.loadURL(`${base}/inspector.html`);
  } else {
    win.loadFile(distPath("renderer", "inspector.html"));
  }
}

/** 打开（或聚焦）检查器浮窗；可选携带 handoff。 */
export function openInspectorWindow(handoff?: InspectorFloatHandoff | null): void {
  if (handoff) pendingHandoff = handoff;

  if (isAlive(inspectorWindow)) {
    if (inspectorWindow.isMinimized()) inspectorWindow.restore();
    inspectorWindow.focus();
    pushFloatState(true);
    return;
  }

  const bounds = resolveInitialBounds();
  const win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    frame: false,
    show: false,
    backgroundColor: "#111113",
    title: "PiDesk Inspector",
    webPreferences: {
      preload: distPath("preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) win.show();
  });
  win.on("resize", () => {
    if (!win.isDestroyed()) persistedBounds = win.getBounds();
  });
  win.on("move", () => {
    if (!win.isDestroyed()) persistedBounds = win.getBounds();
  });
  win.on("close", (event) => {
    // 点 X：先要 handoff，浮窗 returnHandoff 后再真正关（避免草稿丢失）
    if (!pendingHandoff && !forceClosed) {
      event.preventDefault();
      if (!win.isDestroyed()) {
        win.webContents.send(INSPECTOR_FLOAT_IPC.requestReturn);
      }
      return;
    }
  });
  win.on("closed", () => {
    inspectorWindow = null;
    forceClosed = false;
    const handoff = pendingHandoff;
    pendingHandoff = null;
    pushFloatState(false, handoff);
  });

  loadInspector(win);
  inspectorWindow = win;
  pushFloatState(true);
}

export function getInspectorWindow(): BrowserWindow | null {
  return isAlive(inspectorWindow) ? inspectorWindow : null;
}

export function isInspectorWindowOpen(): boolean {
  return isAlive(inspectorWindow);
}

export function focusInspectorWindow(): boolean {
  if (!isAlive(inspectorWindow)) return false;
  if (inspectorWindow.isMinimized()) inspectorWindow.restore();
  inspectorWindow.focus();
  return true;
}

/** 停靠回主窗 / 关闭浮窗；可选交回 handoff。 */
export function closeInspectorWindow(handoff?: InspectorFloatHandoff | null): void {
  if (handoff) pendingHandoff = handoff;
  forceClosed = true;
  if (isAlive(inspectorWindow)) {
    inspectorWindow.close();
  } else {
    const snapshot = pendingHandoff;
    pendingHandoff = null;
    pushFloatState(false, snapshot);
  }
}

export function takePendingHandoff(): InspectorFloatHandoff | null {
  const snapshot = pendingHandoff;
  pendingHandoff = null;
  return snapshot;
}

export function setPendingHandoff(handoff: InspectorFloatHandoff | null): void {
  pendingHandoff = handoff;
  if (handoff) {
    forceClosed = true;
    // X 关闭路径：渲染层交回草稿后在此真正销毁
    if (isAlive(inspectorWindow)) inspectorWindow.close();
  }
}

/** 主窗占位条「停靠回来」：通知浮窗自己交草稿并关，避免主窗草稿为空。 */
export function requestDockFromHost(): boolean {
  if (!isAlive(inspectorWindow)) return false;
  inspectorWindow.webContents.send(INSPECTOR_FLOAT_IPC.requestDock);
  return true;
}

/** 应用退出前强制销毁浮窗（不要求 handoff）。 */
export function disposeInspectorWindow(): void {
  forceClosed = true;
  pendingHandoff = null;
  if (isAlive(inspectorWindow)) {
    inspectorWindow.removeAllListeners("close");
    inspectorWindow.destroy();
    inspectorWindow = null;
  }
}

/** 主窗「加入对话」：仅向主窗转发 pickConfirm，复用既有会话芯片路径。 */
export function relayChatAddToMainWindow(): void {
  const main = getMainWindow();
  if (!main) return;
  // id 在单实例拾取场景下由渲染层忽略，仅作消息形状兼容
  const message: BrowserPushMessage = { id: "float", type: "pickConfirm" };
  main.webContents.send(BROWSER_IPC.output, message);
}

/** 主窗 webContents（测试/扩展用）。 */
export function inspectorHostWebContents(): WebContents | null {
  return getMainWindow()?.webContents ?? null;
}
