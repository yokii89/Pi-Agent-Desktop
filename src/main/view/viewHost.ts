/**
 * 扩展 View 协议 Host（docs/design/08）。
 *
 * 多连接模型（P1 定稿）：
 * - 本进程共享一条 pipe/socket；多扩展可共用一条连接并按视图 id 多路复用。
 * - 扩展 SDK 也可每扩展开一条连接；Host 一视同仁，widget/panel 槽按 connection 隔离。
 * - 认证：首行 `{ token }`；通过后 Host 推送 `hello`（已实现 placements）。
 * - 主进程只做传输与会话表，不执行扩展代码。
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import {
  isNotificationScenarioId,
  isNotificationSoundId,
  NOTIFICATION_IPC,
  type NotificationPushMessage,
  type NotificationScenarioId,
  type NotificationSoundId,
  SDK_NOTIFICATION_SCENARIOS,
} from "../../shared/notification";
import type {
  ExtensionViewPush,
  HeaderSide,
  ViewAction,
  ViewClosedReason,
  ViewClosePayload,
  ViewEnvelope,
  ViewErrorCode,
  ViewEvent,
  ViewHelloPayload,
  ViewModeDescriptor,
  ViewNode,
  ViewNotifiedPayload,
  ViewNotifyPayload,
  ViewOpenPayload,
  ViewPatchPayload,
  ViewPlacement,
  ViewPlacementHint,
  ViewUpdatePayload,
} from "../../shared/view";
import {
  IMPLEMENTED_VIEW_PLACEMENTS,
  SLOTTED_VIEW_PLACEMENTS,
  VIEW_HOST_CAPABILITIES,
  VIEW_IPC,
  VIEW_LIMITS,
  VIEW_PROTOCOL_VERSION,
} from "../../shared/view";
import { showSystemToast } from "../notification/toastService";
import { getSettings } from "../settings/settings";
import { getMainWindow } from "../window/createMainWindow";
import {
  applyPatch,
  buildOpenedPayload,
  resolveHeaderSide,
  resolvePanelId,
  resolvePlacement,
  sanitizeActions,
  sanitizeTree,
  slotKey,
  truncateString,
} from "./viewHostProtocol";

/** 注入给 pi 扩展的握手环境变量。 */
export interface ViewHostEnv {
  endpoint: string;
  token: string;
  protocol: string;
  /**
   * 稳定 rendezvous 文件路径（docs/design/15 P0-1）。
   * Host 重启后 pipe 名随 Electron pid 变化，pi 子进程 env 里的旧 endpoint 会失效；
   * SDK 重连时优先读该文件拿到当前 endpoint/token。
   */
  rendezvousPath?: string;
}

interface OpenView {
  id: string;
  connectionId: string;
  /** 归属的 pi 会话运行时实例 id（多会话并行时按此回收视图）。 */
  sessionId?: string;
  placement: ViewPlacement;
  title?: string;
  root: ViewNode;
  actions: ViewAction[];
  placementHint?: ViewPlacementHint;
  /** panel/sidebar/settings：Host 分配的稳定槽位 id。 */
  panelId?: string;
  /** Catalog 稳定 key（docs/design/16）；legacy 为 undefined。 */
  contributionKey?: string;
  timeoutHandle?: NodeJS.Timeout;
}

interface ViewConnection {
  id: string;
  socket: net.Socket;
  authenticated: boolean;
  /** auth/open 透传的会话归属；缺省为 undefined（进程外连接）。 */
  sessionId?: string;
  /** 连接角色：Extension Worker 不得绑定 access-mode / session widget（docs/design/16 §9）。 */
  role?: "session" | "worker";
  /** 每连接同时最多一个 widget 槽；新 open 顶替旧的。 */
  widgetViewId: string | null;
  /** access-mode：每连接最多一个模式注册；新 open 顶替旧的（docs/design/14）。 */
  accessModeViewId: string | null;
  /** panel/sidebar/settings：slotId → viewId（同槽位顶替）。 */
  slotViews: Map<string, string>;
  /** header：每侧最多一个（与顶栏左/中/右三端对齐）。 */
  headerLeftViewId: string | null;
  headerCenterViewId: string | null;
  headerRightViewId: string | null;
}

function headerSideViewKey(
  side: HeaderSide,
): "headerLeftViewId" | "headerCenterViewId" | "headerRightViewId" {
  if (side === "center") return "headerCenterViewId";
  if (side === "right") return "headerRightViewId";
  return "headerLeftViewId";
}

let server: net.Server | null = null;
let hostEnv: ViewHostEnv | null = null;
let starting: Promise<ViewHostEnv> | null = null;
let nextConnectionId = 0;

const connections = new Map<string, ViewConnection>();
const views = new Map<string, OpenView>();
/** sessionId + contributionKey → live viewId（docs/design/16 §7.1）。 */
const contributionIndex = new Map<string, string>();
/** waitForContribution 等待队列。 */
const contributionWaiters = new Map<
  string,
  Array<{
    resolve: (viewId: string) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }>
>();

function contributionIndexKey(sessionId: string | undefined, contributionKey: string): string {
  return `${sessionId ?? ""}::${contributionKey}`;
}

function sanitizeContributionKey(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 512) return undefined;
  return trimmed;
}

function registerContribution(view: OpenView): void {
  if (!view.contributionKey) return;
  const key = contributionIndexKey(view.sessionId, view.contributionKey);
  contributionIndex.set(key, view.id);
  const waiters = contributionWaiters.get(key);
  if (waiters && waiters.length > 0) {
    contributionWaiters.delete(key);
    for (const w of waiters) {
      clearTimeout(w.timer);
      w.resolve(view.id);
    }
  }
}

function clearContribution(view: OpenView): void {
  if (!view.contributionKey) return;
  const key = contributionIndexKey(view.sessionId, view.contributionKey);
  if (contributionIndex.get(key) === view.id) {
    contributionIndex.delete(key);
  }
}

/**
 * 等待 sessionId + contributionKey 的 live View 注册。
 * 覆盖「先注册后等待」与「先等待后注册」两种时序。
 */
export function waitForContribution(opts: {
  sessionId: string;
  contributionKey: string;
  timeoutMs: number;
}): Promise<string> {
  const key = contributionIndexKey(opts.sessionId, opts.contributionKey);
  const existing = contributionIndex.get(key);
  if (existing && views.has(existing)) {
    return Promise.resolve(existing);
  }
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      const list = contributionWaiters.get(key) ?? [];
      contributionWaiters.set(
        key,
        list.filter((w) => w.timer !== timer),
      );
      reject(new Error("contribution-not-registered"));
    }, opts.timeoutMs);
    const list = contributionWaiters.get(key) ?? [];
    list.push({ resolve, reject, timer });
    contributionWaiters.set(key, list);
  });
}

/** 当前 live viewId（若存在）。 */
export function getContributionViewId(sessionId: string, contributionKey: string): string | null {
  const id = contributionIndex.get(contributionIndexKey(sessionId, contributionKey));
  return id && views.has(id) ? id : null;
}

/** 读取 live 视图的 access-mode 状态（激活确认用）。 */
export function getViewModeState(viewId: string): {
  active: boolean;
  detail?: string;
  modeId?: string;
} | null {
  const view = views.get(viewId);
  if (!view) return null;
  const mode = view.placementHint?.mode;
  if (!mode) return { active: false };
  return {
    active: mode.active === true,
    detail: mode.detail,
    modeId: mode.id,
  };
}

function push(message: ExtensionViewPush): void {
  getMainWindow()?.webContents.send(VIEW_IPC.output, message);
}

function sendEnvelope(conn: ViewConnection, envelope: Omit<ViewEnvelope, "v">): void {
  if (conn.socket.destroyed) return;
  try {
    conn.socket.write(`${JSON.stringify({ v: VIEW_PROTOCOL_VERSION, ...envelope })}\n`);
  } catch {
    // 对端已断开；close 会走清理
  }
}

function sendError(conn: ViewConnection, id: string, message: string, code: ViewErrorCode): void {
  sendEnvelope(conn, { id, type: "error", payload: { message, code } });
}

function sendNotified(conn: ViewConnection, id: string, payload: ViewNotifiedPayload): void {
  sendEnvelope(conn, { id, type: "notified", payload });
}

/**
 * 扩展 SDK 系统提示音 + 可选桌面 toast（docs/design/18、24）。
 * Host 做 scenario/sound/toast 白名单与设置门禁；声音推送渲染层，toast 主进程直弹。
 */
function handleNotify(conn: ViewConnection, id: string, raw: unknown): void {
  const payload = (raw && typeof raw === "object" ? raw : {}) as ViewNotifyPayload;
  const settings = getSettings().notification;

  let scenario: NotificationScenarioId = "custom";
  if (payload.scenario !== undefined) {
    if (
      !isNotificationScenarioId(payload.scenario) ||
      !(SDK_NOTIFICATION_SCENARIOS as readonly string[]).includes(payload.scenario)
    ) {
      sendNotified(conn, id, { ok: false, reason: "rejected" });
      return;
    }
    scenario = payload.scenario;
  }

  let sound: NotificationSoundId | undefined;
  if (payload.sound !== undefined) {
    if (!isNotificationSoundId(payload.sound)) {
      sendNotified(conn, id, { ok: false, reason: "rejected" });
      return;
    }
    sound = payload.sound;
  }

  let toastTitle: string | undefined;
  let toastBody: string | undefined;
  if (payload.toast !== undefined) {
    const toast = payload.toast;
    if (
      !toast ||
      typeof toast !== "object" ||
      typeof toast.title !== "string" ||
      toast.title.trim().length === 0 ||
      toast.title.length > 500 ||
      (toast.body !== undefined && (typeof toast.body !== "string" || toast.body.length > 2000))
    ) {
      sendNotified(conn, id, { ok: false, reason: "rejected" });
      return;
    }
    toastTitle = toast.title;
    toastBody = toast.body;
  }

  if (!settings.scenarios[scenario]?.enabled) {
    sendNotified(conn, id, { ok: false, reason: "disabled" });
    return;
  }
  const wantSound = settings.enabled;
  const wantToast = toastTitle !== undefined && settings.systemToast;
  if (!wantSound && !(toastTitle !== undefined)) {
    // 场景开着但声音总开关关且本次没请求 toast → 无事可做
    sendNotified(conn, id, { ok: false, reason: "disabled" });
    return;
  }
  if (!wantSound && toastTitle !== undefined && !settings.systemToast) {
    // 请求了 toast 但桌面通知关、声音也关
    sendNotified(conn, id, { ok: false, reason: "disabled" });
    return;
  }

  const mainWindow = getMainWindow();
  if (!mainWindow) {
    // 无窗口可送达时不能伪成功（SDK 准则：运行时确认）
    sendNotified(conn, id, { ok: false, reason: "rejected" });
    return;
  }

  const sessionId =
    typeof payload.sessionId === "string" && payload.sessionId.length > 0
      ? payload.sessionId
      : conn.sessionId;

  if (wantToast && toastTitle !== undefined) {
    // 聚焦 / 门禁失败时静默抑制，不改 ack（见 docs/design/24 §5）
    showSystemToast({ title: toastTitle, body: toastBody, sessionId });
  }

  if (wantSound) {
    const message: NotificationPushMessage = {
      scenario,
      sound,
      sessionId,
      reason: typeof payload.reason === "string" ? payload.reason.slice(0, 200) : undefined,
      source: "sdk",
      gated: true,
    };
    mainWindow.webContents.send(NOTIFICATION_IPC.output, message);
  }

  sendNotified(conn, id, { ok: true });
}

function clearViewTimeout(view: OpenView): void {
  if (view.timeoutHandle) {
    clearTimeout(view.timeoutHandle);
    view.timeoutHandle = undefined;
  }
}

function destroyView(
  view: OpenView,
  reason?: ViewClosedReason | string,
  notifyClient = true,
): void {
  clearViewTimeout(view);
  views.delete(view.id);
  clearContribution(view);
  const conn = connections.get(view.connectionId);
  if (conn) {
    if (conn.widgetViewId === view.id) conn.widgetViewId = null;
    if (conn.accessModeViewId === view.id) conn.accessModeViewId = null;
    if (conn.headerLeftViewId === view.id) conn.headerLeftViewId = null;
    if (conn.headerCenterViewId === view.id) conn.headerCenterViewId = null;
    if (conn.headerRightViewId === view.id) conn.headerRightViewId = null;
    if (view.panelId) {
      const key = slotKey(view.placement, view.panelId);
      const mapped = conn.slotViews.get(key);
      if (mapped === view.id) conn.slotViews.delete(key);
    }
    if (notifyClient) {
      sendEnvelope(conn, { id: view.id, type: "closed", payload: { reason } });
    }
  }
  push({ type: "closed", id: view.id, reason, contributionKey: view.contributionKey });
}

function sanitizePlacementHint(raw: unknown): ViewPlacementHint | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as {
    afterEntryId?: unknown;
    side?: unknown;
    floating?: unknown;
    panelId?: unknown;
    headerSide?: unknown;
    mode?: unknown;
  };
  const hint: ViewPlacementHint = {};
  if (typeof record.afterEntryId === "string") {
    hint.afterEntryId = truncateString(record.afterEntryId);
  }
  if (record.side === "aboveEditor" || record.side === "belowEditor") hint.side = record.side;
  if (record.floating === true) hint.floating = true;
  if (typeof record.panelId === "string") hint.panelId = truncateString(record.panelId);
  if (
    record.headerSide === "left" ||
    record.headerSide === "center" ||
    record.headerSide === "right"
  ) {
    hint.headerSide = record.headerSide;
  }
  if (record.mode && typeof record.mode === "object") {
    const mode = sanitizeModeDescriptor(record.mode);
    if (mode) hint.mode = mode;
  }
  return Object.keys(hint).length > 0 ? hint : undefined;
}

/** access-mode 模式描述符清洗（docs/design/14）：id/title 必填，其余逐项校验。 */
function sanitizeModeDescriptor(raw: unknown): ViewModeDescriptor | undefined {
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? truncateString(record.id) : "";
  const title = typeof record.title === "string" ? truncateString(record.title) : "";
  if (!id || !title) return undefined;
  const mode: ViewModeDescriptor = { id, title };
  if (typeof record.description === "string") {
    mode.description = truncateString(record.description);
  }
  if (typeof record.icon === "string") mode.icon = truncateString(record.icon);
  if (
    record.accent === "default" ||
    record.accent === "warning" ||
    record.accent === "success" ||
    record.accent === "danger"
  ) {
    mode.accent = record.accent;
  }
  if (typeof record.active === "boolean") mode.active = record.active;
  if (typeof record.detail === "string") mode.detail = truncateString(record.detail);
  return mode;
}

async function handleOpen(conn: ViewConnection, id: string, payload: unknown): Promise<void> {
  if (!payload || typeof payload !== "object") {
    sendError(conn, id, "open payload 无效", "protocol");
    return;
  }
  const open = payload as ViewOpenPayload & Record<string, unknown>;
  const resolved = resolvePlacement(open.placement, open.placementRequired);
  if (!resolved.ok) {
    sendError(conn, id, resolved.message, "placement");
    sendEnvelope(conn, { id, type: "closed", payload: { reason: "placement" } });
    return;
  }

  // Extension Worker 只允许全局、安全声明能力（settings 等）；
  // access-mode / widget 属于会话真值，拒绝绑定（docs/design/16 §9.1）。
  if (conn.role === "worker") {
    if (resolved.placement !== "settings") {
      sendError(conn, id, "Extension Worker 不允许注册会话级 View", "placement");
      sendEnvelope(conn, { id, type: "closed", payload: { reason: "placement" } });
      return;
    }
  }

  // access-mode：每 connection 最多一个注册；先顶替旧的再计入打开数上限，
  // 否则满额连接重注册会撞 limit 而不是顶替（docs/design/14）。
  if (resolved.placement === "access-mode" && conn.accessModeViewId) {
    const old = views.get(conn.accessModeViewId);
    if (old) destroyView(old, "replaced", true);
  }

  // Per-connection open-view cap (docs/design/08 §8).
  let openOnConnection = 0;
  for (const v of views.values()) {
    if (v.connectionId === conn.id) openOnConnection += 1;
  }
  if (openOnConnection >= VIEW_LIMITS.maxOpenViewsPerConnection) {
    sendError(conn, id, `打开中视图数超过上限 ${VIEW_LIMITS.maxOpenViewsPerConnection}`, "limit");
    sendEnvelope(conn, { id, type: "closed", payload: { reason: "limit" } });
    return;
  }

  if (views.has(id)) {
    const existing = views.get(id);
    // 跨连接 id 冲突：不得静默销毁另一会话的视图（多 pi 并行时客户端 id 可能撞车）
    if (existing && existing.connectionId !== conn.id) {
      sendError(conn, id, "视图 id 与其它会话冲突，请重试", "protocol");
      sendEnvelope(conn, { id, type: "closed", payload: { reason: "protocol" } });
      return;
    }
    if (existing) destroyView(existing, "dispose", false);
  }

  const tree = sanitizeTree(open.root);
  if ("error" in tree) {
    sendError(conn, id, tree.error, "limit");
    sendEnvelope(conn, { id, type: "closed", payload: { reason: "limit" } });
    return;
  }

  const placement = resolved.placement;
  const placementHint = sanitizePlacementHint(open.placementHint);
  const actions = sanitizeActions(open.actions);

  if (placement === "widget" && conn.widgetViewId) {
    const old = views.get(conn.widgetViewId);
    if (old) destroyView(old, "replaced", true);
  }

  // header：每 connection 每侧最多一个；新 open 顶替
  if (placement === "header") {
    const sideKey = headerSideViewKey(resolveHeaderSide(placementHint?.headerSide));
    const prevId = conn[sideKey];
    if (prevId) {
      const old = views.get(prevId);
      if (old) destroyView(old, "replaced", true);
    }
  }

  // panel/sidebar/settings：稳定 slotId 复用同一格；缺省 ext-<viewId>；同格顶替。
  // 槽位按 placement 命名空间隔离：panel「cfg」与 settings「cfg」互不顶替。
  let panelId: string | undefined;
  let slot: string | undefined;
  if (SLOTTED_VIEW_PLACEMENTS.has(placement)) {
    panelId = resolvePanelId(id, placementHint?.panelId);
    slot = slotKey(placement, panelId);
    const oldViewId = conn.slotViews.get(slot);
    if (oldViewId) {
      const old = views.get(oldViewId);
      if (old) destroyView(old, "replaced", true);
    }
  }

  // 归属优先连接 auth 的 sessionId（spawn 时注入，与 start 返回值一致）；
  // open payload 仅在连接未绑定时兜底，避免 payload 与进程 env 不一致导致串会话。
  const openSessionId =
    conn.sessionId ??
    (typeof open.sessionId === "string" && open.sessionId.length > 0 ? open.sessionId : undefined);

  const rawContributionKey = sanitizeContributionKey(open.contributionKey);
  let contributionKey: string | undefined;
  try {
    const { getCatalogSnapshot } = await import("../extension/contributionCatalog");
    const { getSessionCwd } = await import("../session/sessionCwdRegistry");
    const { resolveContributionBinding } = await import("./contributionBinding");
    const { listRuntimeSnapshots } = await import("../session/runtimeCoordinator");
    const stale = listRuntimeSnapshots().some(
      (runtime) => runtime.sessionId === openSessionId && runtime.staleExtension,
    );
    if (stale && rawContributionKey) throw new Error("扩展配置待重载，当前进程无法绑定新目录");
    if (open.contributionKey !== undefined && !rawContributionKey)
      throw new Error("无效的 contributionKey");
    contributionKey = resolveContributionBinding({
      entries: stale ? [] : getCatalogSnapshot(getSessionCwd(openSessionId)).entries,
      contributionKey: rawContributionKey,
      placement,
      hint: placementHint,
      worker: conn.role === "worker",
    });
    // await 期间连接可能已经断开，禁止复活已关闭连接上的 View。
    if (!connections.has(conn.id)) return;
  } catch (error) {
    sendError(conn, id, error instanceof Error ? error.message : "扩展能力绑定失败", "protocol");
    sendEnvelope(conn, { id, type: "closed", payload: { reason: "protocol" } });
    return;
  }

  const view: OpenView = {
    id,
    connectionId: conn.id,
    sessionId: openSessionId,
    placement,
    title: typeof open.title === "string" ? truncateString(open.title) : undefined,
    root: tree.root,
    actions,
    placementHint,
    panelId,
    contributionKey,
  };

  const timeoutMs = typeof open.timeoutMs === "number" ? open.timeoutMs : undefined;
  if (timeoutMs && timeoutMs > 0) {
    view.timeoutHandle = setTimeout(
      () => {
        destroyView(view, "timeout", true);
      },
      Math.min(timeoutMs, 24 * 60 * 60 * 1000),
    );
  }

  views.set(id, view);
  if (placement === "widget") conn.widgetViewId = id;
  if (placement === "access-mode") conn.accessModeViewId = id;
  if (placement === "header") {
    conn[headerSideViewKey(resolveHeaderSide(placementHint?.headerSide))] = id;
  }
  if (slot) conn.slotViews.set(slot, id);
  registerContribution(view);

  push({
    type: "open",
    id,
    sessionId: view.sessionId,
    title: view.title,
    root: view.root,
    actions: view.actions,
    placement,
    placementHint: view.placementHint,
    panelId,
    timeoutMs,
    contributionKey: view.contributionKey,
  });

  // Open ack：Client 可读最终 placement（降级后的真实槽位）。
  // 老 SDK 忽略此消息；协议向后兼容。header 槽附带最终 side。
  sendEnvelope(conn, {
    id,
    type: "opened",
    payload: buildOpenedPayload(
      placement,
      panelId,
      placement === "header" ? resolveHeaderSide(placementHint?.headerSide) : undefined,
    ),
  });
}

function handleUpdate(conn: ViewConnection, id: string, payload: unknown): void {
  const view = views.get(id);
  if (!view || view.connectionId !== conn.id) {
    sendError(conn, id, "视图不存在或已关闭", "protocol");
    return;
  }
  if (!payload || typeof payload !== "object") {
    sendError(conn, id, "update payload 无效", "protocol");
    return;
  }
  const update = payload as ViewUpdatePayload;
  const message: Extract<ExtensionViewPush, { type: "update" }> = { type: "update", id };

  if (update.root !== undefined) {
    const tree = sanitizeTree(update.root);
    if ("error" in tree) {
      sendError(conn, id, tree.error, "limit");
      return;
    }
    view.root = tree.root;
    message.root = tree.root;
  }
  if (typeof update.title === "string") {
    view.title = truncateString(update.title);
    message.title = view.title;
  }
  if (update.actions !== undefined) {
    view.actions = sanitizeActions(update.actions);
    message.actions = view.actions;
  }
  if (update.placementHint !== undefined) {
    view.placementHint = sanitizePlacementHint(update.placementHint);
    message.placementHint = view.placementHint;
  }
  if (view.contributionKey) {
    message.contributionKey = view.contributionKey;
  }

  push(message);
}

/**
 * patch（docs/design/19 §10.3）：在当前树上按 path 替换子树，整树 sanitize
 * 通过后向渲染层推**合并结果**的全量 update。失败整次拒绝、树不变。
 */
function handlePatch(conn: ViewConnection, id: string, payload: unknown): void {
  const view = views.get(id);
  if (!view || view.connectionId !== conn.id) {
    sendError(conn, id, "视图不存在或已关闭", "protocol");
    return;
  }
  if (!payload || typeof payload !== "object") {
    sendError(conn, id, "patch payload 无效", "protocol");
    return;
  }
  const patch = payload as ViewPatchPayload;
  if (!Array.isArray(patch.ops) || patch.ops.length === 0) {
    sendError(conn, id, "patch.ops 必须是非空数组", "protocol");
    return;
  }
  if (patch.ops.length > VIEW_LIMITS.maxPatchOps) {
    sendError(conn, id, `patch.ops 超过上限 ${VIEW_LIMITS.maxPatchOps}`, "limit");
    return;
  }

  const applied = applyPatch(view.root, patch.ops);
  if ("error" in applied) {
    sendError(conn, id, applied.error, "protocol");
    return;
  }
  const tree = sanitizeTree(applied.root);
  if ("error" in tree) {
    sendError(conn, id, tree.error, "limit");
    return;
  }

  view.root = tree.root;
  const message: Extract<ExtensionViewPush, { type: "update" }> = {
    type: "update",
    id,
    root: tree.root,
  };
  if (typeof patch.title === "string") {
    view.title = truncateString(patch.title);
    message.title = view.title;
  }
  if (patch.actions !== undefined) {
    view.actions = sanitizeActions(patch.actions);
    message.actions = view.actions;
  }
  if (patch.placementHint !== undefined) {
    view.placementHint = sanitizePlacementHint(patch.placementHint);
    message.placementHint = view.placementHint;
  }
  if (view.contributionKey) {
    message.contributionKey = view.contributionKey;
  }
  push(message);
}

function handleClose(conn: ViewConnection, id: string, _payload: unknown): void {
  const view = views.get(id);
  if (!view || view.connectionId !== conn.id) return;
  destroyView(view, undefined, false);
}

function handleEnvelope(conn: ViewConnection, line: string): void {
  if (!line) return;
  if (Buffer.byteLength(line, "utf8") > VIEW_LIMITS.maxMessageBytes) {
    sendError(conn, "", "消息超过大小上限", "limit");
    conn.socket.destroy();
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    sendError(conn, "", "JSON 解析失败", "protocol");
    return;
  }
  if (!parsed || typeof parsed !== "object") {
    sendError(conn, "", "消息必须是 JSON 对象", "protocol");
    return;
  }

  if (!conn.authenticated) {
    const token = (parsed as { token?: unknown }).token;
    if (typeof token !== "string" || token !== hostEnv?.token) {
      conn.socket.destroy();
      return;
    }
    conn.authenticated = true;
    // 多会话：子进程 env PIDESK_VIEW_SESSION 经 SDK 在 auth 行透传；缺失时不绑定（兼容旧 SDK）
    const authSessionId = (parsed as { sessionId?: unknown }).sessionId;
    if (typeof authSessionId === "string" && authSessionId.length > 0) {
      conn.sessionId = authSessionId;
    }
    const authRole = (parsed as { role?: unknown }).role;
    if (authRole === "worker") conn.role = "worker";
    else if (authRole === "session") conn.role = "session";
    // capability 广告：便于扩展决定是否 placementRequired / contribution binding
    const hello: ViewHelloPayload = {
      protocol: VIEW_PROTOCOL_VERSION,
      placements: [...IMPLEMENTED_VIEW_PLACEMENTS],
      capabilities: [...VIEW_HOST_CAPABILITIES],
      // 真实运行时预算随 hello 下发，扩展不再抄一份 README 里的数字（docs/design/20 O3）
      limits: VIEW_LIMITS,
    };
    sendEnvelope(conn, { id: "", type: "hello", payload: hello });
    return;
  }

  const envelope = parsed as Partial<ViewEnvelope>;
  if (envelope.v !== VIEW_PROTOCOL_VERSION) {
    sendError(
      conn,
      typeof envelope.id === "string" ? envelope.id : "",
      "协议版本不匹配",
      "protocol",
    );
    return;
  }
  const id = typeof envelope.id === "string" ? envelope.id : "";
  const type = envelope.type;
  if (!id || !type) {
    sendError(conn, id, "envelope 缺少 id/type", "protocol");
    return;
  }

  switch (type) {
    case "open":
      void handleOpen(conn, id, envelope.payload).catch(() => {
        sendError(conn, id, "open 处理失败", "internal");
      });
      return;
    case "update":
      handleUpdate(conn, id, envelope.payload);
      return;
    case "patch":
      handlePatch(conn, id, envelope.payload);
      return;
    case "close":
      handleClose(conn, id, envelope.payload as ViewClosePayload | undefined);
      return;
    case "notify":
      handleNotify(conn, id, envelope.payload);
      return;
    default:
      // event/hello/opened/notified 为 Host→Client；其余未知类型不断开整条 pipe
      if (type !== "event" && type !== "hello" && type !== "opened" && type !== "notified") {
        sendError(conn, id, `未知消息类型 ${String(type)}`, "protocol");
      }
  }
}

function onConnection(socket: net.Socket): void {
  const conn: ViewConnection = {
    id: `vc-${++nextConnectionId}`,
    socket,
    authenticated: false,
    widgetViewId: null,
    accessModeViewId: null,
    slotViews: new Map(),
    headerLeftViewId: null,
    headerCenterViewId: null,
    headerRightViewId: null,
  };
  connections.set(conn.id, conn);

  const decoder = new StringDecoder("utf8");
  let lineBuffer = "";
  socket.on("data", (chunk: Buffer) => {
    lineBuffer += decoder.write(chunk);
    let newlineAt = lineBuffer.indexOf("\n");
    while (newlineAt !== -1) {
      const line = lineBuffer.slice(0, newlineAt).replace(/\r$/, "");
      lineBuffer = lineBuffer.slice(newlineAt + 1);
      handleEnvelope(conn, line);
      newlineAt = lineBuffer.indexOf("\n");
    }
    if (!conn.authenticated && lineBuffer.length > VIEW_LIMITS.maxMessageBytes) {
      socket.destroy();
    }
  });

  const cleanup = (): void => {
    if (!connections.has(conn.id)) return;
    connections.delete(conn.id);
    for (const view of [...views.values()]) {
      if (view.connectionId === conn.id) destroyView(view, "session", false);
    }
  };
  socket.on("error", cleanup);
  socket.on("close", cleanup);
}

function listenAsync(srv: net.Server, pathOrPort: string | number, host?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error): void => {
      srv.removeListener("listening", onListening);
      reject(err);
    };
    const onListening = (): void => {
      srv.removeListener("error", onError);
      resolve();
    };
    srv.once("error", onError);
    srv.once("listening", onListening);
    if (typeof pathOrPort === "number") srv.listen(pathOrPort, host ?? "127.0.0.1");
    else srv.listen(pathOrPort);
  });
}

/**
 * 稳定 rendezvous 路径：不绑 Electron pid，Host 重启后仍有效。
 * 单机单 PiDesk 实例的产品形态下用 tmpdir 固定名足够；同名文件由后启动的 Host 覆盖。
 */
export function getViewHostRendezvousPath(): string {
  return path.join(os.tmpdir(), "pidesk-view-host.json");
}

function writeViewHostRendezvous(env: {
  endpoint: string;
  token: string;
  protocol: string;
}): string {
  const file = getViewHostRendezvousPath();
  const payload = JSON.stringify({
    endpoint: env.endpoint,
    token: env.token,
    protocol: env.protocol,
    pid: process.pid,
    updatedAt: Date.now(),
  });
  // 原子写：避免 SDK 在 Host 重启窗口读到半截 JSON
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, payload, "utf8");
  fs.renameSync(tmp, file);
  return file;
}

function clearViewHostRendezvous(): void {
  try {
    fs.unlinkSync(getViewHostRendezvousPath());
  } catch {
    // 已删除或从未写入
  }
}

function sealHostEnv(endpoint: string, token: string, protocol: string): ViewHostEnv {
  const rendezvousPath = writeViewHostRendezvous({ endpoint, token, protocol });
  return { endpoint, token, protocol, rendezvousPath };
}

async function startServer(): Promise<ViewHostEnv> {
  const token = randomBytes(24).toString("hex");
  const protocol = VIEW_PROTOCOL_VERSION;

  if (process.platform === "win32") {
    const pipePath = `\\\\.\\pipe\\pidesk-view-${process.pid}`;
    const pipeServer = net.createServer(onConnection);
    try {
      await listenAsync(pipeServer, pipePath);
      server = pipeServer;
      hostEnv = sealHostEnv(pipePath, token, protocol);
      pipeServer.on("error", () => {
        if (server === pipeServer) {
          server = null;
          hostEnv = null;
        }
      });
      return hostEnv;
    } catch {
      // named pipe 不可用时回退 TCP
    }
  } else {
    const sockPath = `${os.tmpdir()}/pidesk-view-${process.pid}.sock`;
    try {
      const sockServer = net.createServer(onConnection);
      await listenAsync(sockServer, sockPath);
      server = sockServer;
      hostEnv = sealHostEnv(sockPath, token, protocol);
      return hostEnv;
    } catch {
      // 回退 TCP
    }
  }

  const tcpServer = net.createServer(onConnection);
  await listenAsync(tcpServer, 0, "127.0.0.1");
  const address = tcpServer.address();
  const port = typeof address === "object" && address ? address.port : 0;
  server = tcpServer;
  hostEnv = sealHostEnv(`http://127.0.0.1:${port}`, token, protocol);
  tcpServer.on("error", () => {
    if (server === tcpServer) {
      server = null;
      hostEnv = null;
    }
  });
  return hostEnv;
}

/** 确保旁路 Host 已监听；返回注入 pi 的环境变量。幂等。 */
export function ensureViewHost(): Promise<ViewHostEnv> {
  if (hostEnv) return Promise.resolve(hostEnv);
  if (starting) return starting;
  starting = startServer()
    .then((env) => {
      starting = null;
      return env;
    })
    .catch((err: unknown) => {
      starting = null;
      throw err instanceof Error ? err : new Error("View Host 启动失败");
    });
  return starting;
}

/** 渲染层用户事件 → 对应连接上的 Client；dismiss 会同步销毁视图。 */
export function sendViewEvent(viewId: string, event: ViewEvent): void {
  const view = views.get(viewId);
  if (!view) return;
  const conn = connections.get(view.connectionId);
  if (!conn?.authenticated) return;

  if (event.type === "dismiss") {
    // 用户显式关闭：先 dismiss 事件，再 closed（reason: user）并销毁
    sendEnvelope(conn, { id: viewId, type: "event", payload: event });
    destroyView(view, "user", true);
    return;
  }
  sendEnvelope(conn, { id: viewId, type: "event", payload: event });
}

/**
 * 会话结束：按 sessionId 回收该会话打开中的会话型视图；
 * `"all"` 用于退出清理。settings 偏设置态，跨会话保留（docs/design/08 §5.3.4）。
 * dispose A 不会关闭 B 的 stream/widget/panel。
 */
export function closeSessionViews(
  sessionId: string | "all",
  reason: ViewClosedReason = "session",
  includeSettings = false,
): void {
  for (const view of [...views.values()]) {
    if (view.placement === "settings" && !includeSettings) continue;
    if (sessionId === "all" || view.sessionId === sessionId) {
      destroyView(view, reason, true);
    }
  }
}

/**
 * 仅保留 liveIds 中的会话视图（settings / 无 sessionId 的全局视图不动）。
 * 用于清理「主进程已不认识、但 Host 上仍挂着」的孤儿扩展视图，
 * 避免表单 sessionId 与当前 active 永远对不上。
 */
export function retainSessionViews(
  liveIds: ReadonlySet<string>,
  reason: ViewClosedReason = "session",
): void {
  for (const view of [...views.values()]) {
    if (view.placement === "settings") continue;
    if (!view.sessionId) continue;
    if (!liveIds.has(view.sessionId)) {
      destroyView(view, reason, true);
    }
  }
}

/** 应用退出：发 closed 并断开全部连接。 */
export function disposeViewHost(): void {
  for (const view of [...views.values()]) {
    destroyView(view, "dispose", true);
  }
  for (const conn of [...connections.values()]) {
    try {
      conn.socket.destroy();
    } catch {
      // 已断开
    }
  }
  connections.clear();
  const srv = server;
  server = null;
  hostEnv = null;
  starting = null;
  srv?.close();
  clearViewHostRendezvous();
}
