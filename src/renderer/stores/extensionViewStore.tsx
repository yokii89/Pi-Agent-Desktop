import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AccessModeSelectionState,
  ActivateContributionRequest,
  ContributionCatalogSnapshot,
  ExtensionContribution,
  SessionRuntimeSnapshot,
} from "../../shared/contribution";
import type {
  ExtensionViewPush,
  ExtensionViewState,
  ViewAction,
  ViewPlacementHint,
} from "../../shared/view";
import { ACCESS_MODE_ACTIONS } from "../../shared/view";
import { collectFormValues, type FormValues } from "../components/ExtensionView/formValues";
import {
  activateContribution as activateContributionIpc,
  catalogService,
  runtimeService,
} from "../services/contributionService";
import { extensionViewService } from "../services/extensionViewService";
import {
  type ActivationTxn,
  accessModeChipLabel,
  type LastKnownMode,
  type LiveAccessModeSnapshot,
  type MergedAccessModeRow,
  mergeAccessModeRows,
  resolveAccessModeSelection,
} from "./contributionProjection";
import { beginModeTransition, isModeTransitioning } from "./modeTransitionBarrier";
import { useProjectStore } from "./projectStore";
import { registerSessionContextBinder } from "./sessionContextBridge";
import { useUiStore } from "./uiStore";

export interface ExtensionViewEntry extends ExtensionViewState {
  values: FormValues;
  /** panel：Host 分配的面板格 id。 */
  panelId?: string;
  /** widget：true = 覆盖层浮在输入栏上方（不参与布局）。 */
  floating?: boolean;
  /**
   * open 到达时渲染层的 active SessionId。
   * Host 的 sessionId 与 UI active 错位时，用它做展示兜底（后台工具仍优先 Host id）。
   */
  boundSessionId?: string | null;
}

/** 视图是否应出现在当前 active 会话的 UI 上。 */
export function viewMatchesActive(
  entry: { sessionId?: string; boundSessionId?: string | null },
  activeSessionId: string | null,
): boolean {
  const hostId = entry.sessionId;
  const boundId = entry.boundSessionId ?? null;
  // 完全未绑定：全局可见（旧 SDK）
  if (!hostId && !boundId) return true;
  if (!activeSessionId) return false;
  if (hostId && hostId === activeSessionId) return true;
  // Host 未带 sessionId 时，用 open 时刻的 active 认领
  if (!hostId && boundId === activeSessionId) return true;
  return false;
}

/**
 * 视图是否应出现在当前 active 会话的 UI 上（多会话隔离）。
 */
export function viewBelongsToSession(
  entry: { sessionId?: string; boundSessionId?: string | null },
  activeSessionId: string | null,
  forceVisible = false,
): boolean {
  if (forceVisible) return true;
  return viewMatchesActive(entry, activeSessionId);
}

/**
 * 按 active 会话过滤扩展视图列表。
 *
 * - 有精确匹配 → 只显示该会话的视图（A 的问卷不进 B）
 * - 无匹配 → **不**把其它会话的绑定视图塞进当前会话（新对话本就应无表单）
 * - 无 sessionId 的全局视图始终可见
 */
export function filterViewsForSession<
  T extends { sessionId?: string; boundSessionId?: string | null },
>(views: T[], activeSessionId: string | null): T[] {
  if (views.length === 0) return views;
  const globalOnly = () => views.filter((v) => !v.sessionId && !v.boundSessionId);
  if (!activeSessionId) return globalOnly();
  const matched = views.filter((v) => viewMatchesActive(v, activeSessionId));
  if (matched.length > 0) return matched;
  return globalOnly();
}

/** sessionKey：entry.sessionId，无归属时用 ""（全局/旧 SDK）。 */
function sessionKeyOf(entry: { sessionId?: string }): string {
  return entry.sessionId ?? "";
}

/**
 * access-mode 单选互斥（docs/design/14 §5.2，**按会话隔离**）：
 * activatedEntry 上报 active=true 时，同一会话内需要向其停发的其它激活注册视图 id。
 * 不同会话的真值互相独立（多会话各显各的模式）；真值在扩展侧，
 * 宿主只负责收敛「每会话最多一个激活」。
 */
export function staleActiveAccessModeIds(
  entries: Array<{ id: string; sessionId?: string; placementHint?: ViewPlacementHint }>,
  activatedEntry: { id: string; sessionId?: string; placementHint?: ViewPlacementHint },
): string[] {
  if (activatedEntry.placementHint?.mode?.active !== true) return [];
  const sessionKey = activatedEntry.sessionId ?? "";
  return entries
    .filter(
      (other) =>
        other.id !== activatedEntry.id &&
        (other.sessionId ?? "") === sessionKey &&
        other.placementHint?.mode?.active === true,
    )
    .map((other) => other.id);
}

/**
 * access-mode 注册只跟随精确会话归属（docs/design/14）。
 * 与一次性表单的全局兜底不同：未绑定会话的进程外注册不进任何会话的面板，
 * 避免把激活指令路由到非当前会话的 pi 进程。
 */
export function accessModeMatchesSession(
  entry: { sessionId?: string; boundSessionId?: string | null },
  activeSessionId: string | null,
): boolean {
  if (!activeSessionId) return false;
  if (entry.sessionId) return entry.sessionId === activeSessionId;
  return entry.boundSessionId === activeSessionId;
}

type WidgetSlot = {
  side: "aboveEditor" | "belowEditor";
  floating: boolean;
  entry: ExtensionViewEntry;
};

/**
 * 槽位列表（widget/header）按 entry.sessionId 过滤；复用 filterViewsForSession 兜底策略。
 */
function filterSlotsForSession<T extends { entry: { sessionId?: string } }>(
  slots: T[],
  activeSessionId: string | null,
): T[] {
  const wrapped = slots.map((slot) => ({
    slot,
    sessionId: slot.entry.sessionId,
  }));
  return filterViewsForSession(wrapped, activeSessionId).map((w) => w.slot);
}

function fromOpen(message: Extract<ExtensionViewPush, { type: "open" }>): ExtensionViewEntry {
  return {
    id: message.id,
    sessionId: message.sessionId,
    // Host 未带 sessionId 时，稍后用 open 时刻的 active 认领（subscribe 内处理）
    boundSessionId: null,
    title: message.title,
    root: message.root,
    actions: message.actions ?? [],
    placement: message.placement,
    placementHint: message.placementHint,
    panelId: message.panelId,
    contributionKey: message.contributionKey,
    floating: message.placement === "widget" ? widgetFloating(message.placementHint) : undefined,
    values: collectFormValues(message.root),
  };
}

function applyUpdateEntry(
  entry: ExtensionViewEntry,
  message: Extract<ExtensionViewPush, { type: "update" }>,
): ExtensionViewEntry {
  const root = message.root ?? entry.root;
  const nextHint = message.placementHint ?? entry.placementHint;
  return {
    ...entry,
    root,
    title: message.title ?? entry.title,
    actions: message.actions ?? entry.actions,
    placementHint: nextHint,
    contributionKey: entry.contributionKey ?? message.contributionKey,
    floating: entry.placement === "widget" ? widgetFloating(nextHint) : entry.floating,
    // Preserve live user input across full-tree updates; tree-supplied
    // value/checked fields still win when the Client echoes them.
    values: collectFormValues(root, entry.values),
  };
}

function widgetSide(hint: ViewPlacementHint | undefined): "aboveEditor" | "belowEditor" {
  return hint?.side === "belowEditor" ? "belowEditor" : "aboveEditor";
}

function widgetFloating(hint: ViewPlacementHint | undefined): boolean {
  return hint?.floating === true;
}

/** header 三端：缺省 left，与主进程 resolveHeaderSide 对齐。 */
function headerSide(hint: ViewPlacementHint | undefined): "left" | "center" | "right" {
  if (hint?.headerSide === "center" || hint?.headerSide === "right") return hint.headerSide;
  return "left";
}

interface ExtensionViewStoreValue {
  /** 全量列表；渲染请优先用 visible* 过滤结果。 */
  modals: ExtensionViewEntry[];
  streams: ExtensionViewEntry[];
  panels: ExtensionViewEntry[];
  /** 左侧导航内嵌卡片（展开态）。 */
  sidebars: ExtensionViewEntry[];
  /** 设置「来自扩展」页纵向堆叠的卡片（跨会话）。 */
  settingsViews: ExtensionViewEntry[];
  /**
   * 当前 active 会话可见的 access-mode 注册（docs/design/14）。
   * 模式真值在扩展侧；本列表只是投影，激活经 sendAction(actionId) 路由。
   */
  visibleAccessModes: ExtensionViewEntry[];
  /** Catalog 合并投影（docs/design/16）：冷态 advertised / live / suspended 等。 */
  accessModeRows: MergedAccessModeRow[];
  /** 访问模式选择三态；unresolved 时不勾选「完全访问」。 */
  accessModeSelection: AccessModeSelectionState;
  accessModeChip: ReturnType<typeof accessModeChipLabel>;
  /** 该会话是否存在 mode transition（阻断发送）。 */
  modeTransitioning: boolean;
  runtimeSnapshots: SessionRuntimeSnapshot[];
  /** 激活失败信息（行内展示）。 */
  accessModeError: string | null;
  headerLeft: ExtensionViewEntry | null;
  headerCenter: ExtensionViewEntry | null;
  headerRight: ExtensionViewEntry | null;
  /** 当前 active 可见的全部 above/below widget（多表单并存时都挂上）。 */
  widgetAboveList: ExtensionViewEntry[];
  widgetBelowList: ExtensionViewEntry[];
  /** 仅 active 会话可见的 modal / panel / sidebar。 */
  visibleModals: ExtensionViewEntry[];
  visiblePanels: ExtensionViewEntry[];
  visibleSidebars: ExtensionViewEntry[];
  /**
   * 仅当 blocking 视图归属该 sessionId（或未绑定会话）时阻断发送。
   * 多会话：后台 B 的问卷不禁用 A 的发送。
   */
  hasBlockingViewFor: (sessionId: string | null) => boolean;
  /** SessionProvider 同步 active SessionId，供本 store 过滤视图。 */
  bindActiveViewSession: (sessionId: string | null) => void;
  /** 登记会话 cwd/sessionFile，供激活事务与 Catalog context 使用。 */
  bindSessionRuntimeContext: (
    sessionId: string,
    ctx: { cwd?: string | null; sessionFile?: string | null },
  ) => void;
  dismiss: (id: string) => void;
  changeValue: (id: string, nodeId: string, value: unknown) => void;
  sendAction: (id: string, actionId: string, values: FormValues, kind?: ViewAction["kind"]) => void;
  /** 冷态入口原子激活：ensure → ready → wait live → confirm。 */
  activateAccessMode: (opts: {
    contributionKey: string;
    actionId: "mode:activate" | "mode:deactivate" | "view:open";
    sessionFile?: string | null;
    cwd?: string | null;
    prepareSession: () => Promise<string | null>;
  }) => Promise<void>;
  /**
   * Catalog panel/settings 冷态入口（docs/design/19 §10.1/§10.2）：
   * `view:open` = ensureSession → 等 live 注册；成功后 Host 会推 open。
   */
  activateViewOpen: (opts: {
    contributionKey: string;
    sessionFile?: string | null;
    cwd?: string | null;
    prepareSession?: () => Promise<string | null>;
  }) => Promise<void>;
  /** 供 ContextSidebar 渲染的 Catalog-only panel 条目（无 live 时）。 */
  catalogPanelRows: Array<{
    key: string;
    contributionKey: string;
    id: string;
    title: string;
    description?: string;
    state: "advertised" | "activating" | "failed" | "suspended";
    error?: string;
  }>;
  /** live 为真时发送阻断（mode transition）。 */
  sendBlockedReason: string | null;
}

function upsertSlotted(
  prev: ExtensionViewEntry[],
  entry: ExtensionViewEntry,
): ExtensionViewEntry[] {
  const panelId = entry.panelId ?? `ext-${entry.id}`;
  const rest = prev.filter((p) => p.id !== entry.id && (p.panelId ?? `ext-${p.id}`) !== panelId);
  return [...rest, entry];
}

const ExtensionViewStoreContext = createContext<ExtensionViewStoreValue | null>(null);

/** change 防抖（50ms，docs/design/08 §12.2）。 */
const CHANGE_DEBOUNCE_MS = 50;

export function ExtensionViewProvider({ children }: { children: ReactNode }) {
  const { currentProject } = useProjectStore();
  const [modals, setModals] = useState<ExtensionViewEntry[]>([]);
  const [streams, setStreams] = useState<ExtensionViewEntry[]>([]);
  const [panels, setPanels] = useState<ExtensionViewEntry[]>([]);
  const [sidebars, setSidebars] = useState<ExtensionViewEntry[]>([]);
  const [settingsViews, setSettingsViews] = useState<ExtensionViewEntry[]>([]);
  /** access-mode 注册表：按视图 id 去重，随会话回收（docs/design/14）。 */
  const [accessModes, setAccessModes] = useState<ExtensionViewEntry[]>([]);
  /** Contribution Catalog 快照（按 context；P0 渲染层缓存 user + 当前项目）。 */
  const [catalogByContext, setCatalogByContext] = useState<
    Record<string, ContributionCatalogSnapshot>
  >({});
  const [sessionCatalogContexts, setSessionCatalogContexts] = useState<Record<string, string>>({});
  /** runtime 快照（主进程权威，reload 对账）。 */
  const [runtimeSnapshots, setRuntimeSnapshots] = useState<SessionRuntimeSnapshot[]>([]);
  /** 激活事务（渲染层投影用；主进程另有互斥锁）。 */
  const [activationTxns, setActivationTxns] = useState<ActivationTxn[]>([]);
  /** last-known access-mode（仅内存，不作为权限依据）。 */
  const [lastKnownModes, setLastKnownModes] = useState<LastKnownMode[]>([]);
  /** 激活时使用的会话上下文（由 activate 传入或 active 桶推导）。 */
  const [sessionCwdBySessionId, setSessionCwdBySessionId] = useState<Record<string, string | null>>(
    {},
  );
  const [sessionFileBySessionId, setSessionFileBySessionId] = useState<
    Record<string, string | null>
  >({});
  /** header 槽列表：按会话并存，切换 active 只过滤展示。 */
  const [headerSlots, setHeaderSlots] = useState<
    Array<{ side: "left" | "center" | "right"; entry: ExtensionViewEntry }>
  >([]);
  /** widget 槽列表：按会话并存，切换 active 只过滤展示，不互相覆盖。 */
  const [widgetSlots, setWidgetSlots] = useState<WidgetSlot[]>([]);
  /** SessionProvider 同步的 active 运行时 SessionId。 */
  const [activeViewSessionId, setActiveViewSessionId] = useState<string | null>(null);
  const { openSidebarTab } = useUiStore();
  const knownPanelIdsRef = useRef(new Set<string>());
  const activeViewSessionIdRef = useRef(activeViewSessionId);
  activeViewSessionIdRef.current = activeViewSessionId;

  const bindActiveViewSession = useCallback((sessionId: string | null) => {
    activeViewSessionIdRef.current = sessionId;
    setActiveViewSessionId(sessionId);
  }, []);

  /** 供 sessionStore 在启动/打开会话时登记 cwd/sessionFile/processAlive。 */
  const bindSessionRuntimeContext = useCallback(
    (
      sessionId: string,
      ctx: { cwd?: string | null; sessionFile?: string | null; processAlive?: boolean },
    ) => {
      if (ctx.cwd !== undefined) {
        setSessionCwdBySessionId((prev) => ({ ...prev, [sessionId]: ctx.cwd ?? null }));
      }
      if (ctx.sessionFile !== undefined) {
        setSessionFileBySessionId((prev) => ({
          ...prev,
          [sessionId]: ctx.sessionFile ?? null,
        }));
      }
      // 按需拉取该会话 cwd 对应 Catalog
      const cwd = ctx.cwd ?? null;
      catalogService
        .list(cwd)
        .then((snap) => {
          setCatalogByContext((prev) => ({ ...prev, [snap.contextId]: snap }));
          setSessionCatalogContexts((prev) => ({ ...prev, [sessionId]: snap.contextId }));
        })
        .catch(() => {});
    },
    [],
  );

  // SessionProvider 在外层：通过 bridge 登记 binder
  useEffect(() => {
    return registerSessionContextBinder(bindSessionRuntimeContext);
  }, [bindSessionRuntimeContext]);

  // Catalog 变化推送 + 启动时拉 user catalog
  useEffect(() => {
    catalogService
      .list(null)
      .then((snap) => {
        setCatalogByContext((prev) => ({ ...prev, [snap.contextId]: snap }));
      })
      .catch(() => {});
    return catalogService.onChanged((snapshot) => {
      setCatalogByContext((prev) => ({ ...prev, [snapshot.contextId]: snapshot }));
    });
  }, []);

  useEffect(() => {
    void catalogService
      .list(currentProject?.dir ?? null)
      .then((snap) => {
        setCatalogByContext((prev) => ({ ...prev, [snap.contextId]: snap }));
      })
      .catch(() => {});
  }, [currentProject?.dir]);

  // Runtime 快照对账
  useEffect(() => {
    let cancelled = false;
    const pushed = new Set<string>();
    runtimeService
      .snapshot()
      .then((snapshots) => {
        if (!cancelled)
          setRuntimeSnapshots((previous) => [
            ...previous,
            ...snapshots.filter((runtime) => !pushed.has(runtime.sessionId)),
          ]);
      })
      .catch(() => {});
    const unsubscribe = runtimeService.onChanged((snap) => {
      pushed.add(snap.sessionId);
      setRuntimeSnapshots((prev) => {
        const rest = prev.filter((r) => r.sessionId !== snap.sessionId);
        return [...rest, snap];
      });
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // live access-mode 关闭时：保留 last-known，条目回到 suspended 而不是删除
  useEffect(() => {
    const next: LastKnownMode[] = [];
    for (const entry of accessModes) {
      const mode = entry.placementHint?.mode;
      if (!mode || !entry.contributionKey) continue;
      next.push({
        contributionKey: entry.contributionKey,
        sessionId: entry.sessionId ?? entry.boundSessionId ?? null,
        title: mode.title,
        active: mode.active === true,
        detail: mode.detail,
        icon: mode.icon,
      });
    }
    if (next.length > 0)
      setLastKnownModes((prev) => [
        ...prev.filter(
          (old) =>
            !next.some(
              (item) =>
                item.sessionId === old.sessionId && item.contributionKey === old.contributionKey,
            ),
        ),
        ...next,
      ]);
  }, [accessModes]);

  const activateAccessMode = useCallback(
    async (opts: {
      contributionKey: string;
      actionId: "mode:activate" | "mode:deactivate" | "view:open";
      sessionFile?: string | null;
      cwd?: string | null;
      prepareSession: () => Promise<string | null>;
    }) => {
      let sessionId = activeViewSessionIdRef.current;
      if (isModeTransitioning(sessionId)) return;
      const releaseOrigin = beginModeTransition(sessionId);
      let releaseSession: (() => void) | undefined;
      const cwd =
        opts.cwd ??
        (sessionId ? (sessionCwdBySessionId[sessionId] ?? null) : (currentProject?.dir ?? null));
      const sessionFile =
        opts.sessionFile ?? (sessionId ? (sessionFileBySessionId[sessionId] ?? null) : null);

      const txn: ActivationTxn = {
        contributionKey: opts.contributionKey,
        sessionId,
        actionId: opts.actionId,
        startedAt: Date.now(),
      };
      setActivationTxns((prev) => [
        ...prev.filter(
          (t) => t.contributionKey !== opts.contributionKey || t.sessionId !== sessionId,
        ),
        txn,
      ]);

      const req: ActivateContributionRequest = {
        contributionKey: opts.contributionKey,
        sessionId: sessionId ?? undefined,
        sessionFile: sessionFile ?? undefined,
        cwd: cwd ?? undefined,
        actionId: opts.actionId,
      };

      try {
        const prepared = await opts.prepareSession();
        if (!prepared) throw new Error("会话启动失败，请重试");
        sessionId = prepared;
        releaseSession = beginModeTransition(sessionId);
        releaseOrigin();
        req.sessionId = sessionId;
        setActivationTxns((prev) => prev.map((t) => (t === txn ? { ...t, sessionId } : t)));
        const result = await activateContributionIpc(req);
        setActivationTxns((prev) =>
          prev.filter(
            (t) => t.contributionKey !== opts.contributionKey || t.sessionId !== sessionId,
          ),
        );
        // 主进程返回权威 sessionId；若与渲染层不同，交给 sessionStore remap 由调用方处理
        if (
          result.sessionId &&
          result.sessionId !== sessionId &&
          activeViewSessionIdRef.current === sessionId
        ) {
          bindActiveViewSession(result.sessionId);
        }
        // live View 的 update 会带新 active；此处只清理事务
      } catch (err) {
        const message = err instanceof Error ? err.message : "激活失败";
        setActivationTxns((prev) =>
          prev.map((t) =>
            t.contributionKey === opts.contributionKey && t.sessionId === sessionId
              ? { ...t, error: message }
              : t,
          ),
        );
      } finally {
        releaseSession?.();
        releaseOrigin();
      }
    },
    [bindActiveViewSession, sessionCwdBySessionId, sessionFileBySessionId, currentProject?.dir],
  );

  /**
   * panel / settings 的 `view:open` 激活（docs/design/19 §10.1/§10.2）。
   * 不进入 mode transition（不阻断发送）——只 ensureSession + 等 live 注册。
   */
  const activateViewOpen = useCallback(
    async (opts: {
      contributionKey: string;
      sessionFile?: string | null;
      cwd?: string | null;
      prepareSession?: () => Promise<string | null>;
    }) => {
      let sessionId = activeViewSessionIdRef.current;
      const cwd =
        opts.cwd ??
        (sessionId ? (sessionCwdBySessionId[sessionId] ?? null) : (currentProject?.dir ?? null));
      const sessionFile =
        opts.sessionFile ?? (sessionId ? (sessionFileBySessionId[sessionId] ?? null) : null);

      const txn: ActivationTxn = {
        contributionKey: opts.contributionKey,
        sessionId,
        actionId: "view:open",
        startedAt: Date.now(),
      };
      setActivationTxns((prev) => [
        ...prev.filter(
          (t) => t.contributionKey !== opts.contributionKey || t.sessionId !== sessionId,
        ),
        txn,
      ]);

      const req: ActivateContributionRequest = {
        contributionKey: opts.contributionKey,
        sessionId: sessionId ?? undefined,
        sessionFile: sessionFile ?? undefined,
        cwd: cwd ?? undefined,
        actionId: "view:open",
      };

      try {
        if (opts.prepareSession) {
          const prepared = await opts.prepareSession();
          if (!prepared) throw new Error("会话启动失败，请重试");
          sessionId = prepared;
          req.sessionId = sessionId;
          setActivationTxns((prev) => prev.map((t) => (t === txn ? { ...t, sessionId } : t)));
        }
        const result = await activateContributionIpc(req);
        setActivationTxns((prev) =>
          prev.filter(
            (t) => t.contributionKey !== opts.contributionKey || t.sessionId !== sessionId,
          ),
        );
        if (
          result.sessionId &&
          result.sessionId !== sessionId &&
          activeViewSessionIdRef.current === sessionId
        ) {
          bindActiveViewSession(result.sessionId);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "激活失败";
        setActivationTxns((prev) =>
          prev.map((t) =>
            t.contributionKey === opts.contributionKey && t.sessionId === sessionId
              ? { ...t, error: message }
              : t,
          ),
        );
      }
    },
    [bindActiveViewSession, sessionCwdBySessionId, sessionFileBySessionId, currentProject?.dir],
  );

  /**
   * 最近一次上报 active=true 的 access-mode 视图 id（互斥收敛的「保留者」）。
   * 事件时写入；收敛在提交后的 effect 里执行，避免读未提交状态。
   */
  const lastActivatedAccessModeIdRef = useRef<string | null>(null);

  // 新 panel 打开时展开右栏并聚焦该 Tab——仅当该 panel 属于当前 active 会话（B6）。
  // active 从 ref 读取：只在「新 panel 出现」时判定，切换 active 不回头抢焦点。
  useEffect(() => {
    const active = activeViewSessionIdRef.current;
    for (const panel of panels) {
      if (knownPanelIdsRef.current.has(panel.id)) continue;
      knownPanelIdsRef.current.add(panel.id);
      if (!viewBelongsToSession(panel, active)) continue;
      const panelId = panel.panelId ?? `ext-${panel.id}`;
      openSidebarTab(extensionPanelTabId(panelId));
    }
    const alive = new Set(panels.map((p) => p.id));
    for (const id of knownPanelIdsRef.current) {
      if (!alive.has(id)) knownPanelIdsRef.current.delete(id);
    }
  }, [panels, openSidebarTab]);

  useEffect(() => {
    return extensionViewService.subscribe((message) => {
      if (message.type === "open") {
        let entry = fromOpen(message);
        // Host 未注入 sessionId 时，认领「open 到达时」的 active，避免表单无归属
        if (!entry.sessionId && activeViewSessionIdRef.current) {
          entry = { ...entry, boundSessionId: activeViewSessionIdRef.current };
        }
        switch (message.placement) {
          case "modal":
            setModals((prev) => [...prev.filter((m) => m.id !== entry.id), entry]);
            return;
          case "stream":
            setStreams((prev) => [...prev.filter((s) => s.id !== entry.id), entry]);
            return;
          case "panel":
            setPanels((prev) => upsertSlotted(prev, entry));
            return;
          case "sidebar":
            setSidebars((prev) => upsertSlotted(prev, entry));
            return;
          case "settings":
            setSettingsViews((prev) => upsertSlotted(prev, entry));
            return;
          case "access-mode":
            if (entry.placementHint?.mode?.active === true) {
              lastActivatedAccessModeIdRef.current = entry.id;
            }
            setAccessModes((prev) => [...prev.filter((m) => m.id !== entry.id), entry]);
            return;
          case "header": {
            const side = headerSide(entry.placementHint);
            const key = sessionKeyOf(entry);
            setHeaderSlots((prev) => [
              ...prev.filter(
                (h) =>
                  h.entry.id !== entry.id && !(sessionKeyOf(h.entry) === key && h.side === side),
              ),
              { side, entry },
            ]);
            return;
          }
          case "widget": {
            const key = sessionKeyOf(entry);
            const side = widgetSide(entry.placementHint);
            const floating = widgetFloating(entry.placementHint);
            setWidgetSlots((prev) => [
              ...prev.filter(
                (w) =>
                  w.entry.id !== entry.id && !(sessionKeyOf(w.entry) === key && w.side === side),
              ),
              { side, floating, entry },
            ]);
            return;
          }
          default:
            return;
        }
      }
      if (message.type === "update") {
        const mapList = (prev: ExtensionViewEntry[]): ExtensionViewEntry[] =>
          prev.map((entry) => (entry.id === message.id ? applyUpdateEntry(entry, message) : entry));
        setModals(mapList);
        setStreams(mapList);
        setPanels(mapList);
        setSidebars(mapList);
        setSettingsViews(mapList);
        setHeaderSlots((prev) =>
          prev.map((h) =>
            h.entry.id === message.id ? { ...h, entry: applyUpdateEntry(h.entry, message) } : h,
          ),
        );
        setWidgetSlots((prev) =>
          prev.map((w) => {
            if (w.entry.id !== message.id) return w;
            const entry = applyUpdateEntry(w.entry, message);
            return {
              side: widgetSide(entry.placementHint),
              floating: widgetFloating(entry.placementHint),
              entry,
            };
          }),
        );
        // access-mode：update 可能带来 active 翻转（扩展自报或 TUI 反向同步）。
        // 在函数式更新内取已提交前值合并——open 与 update 同批到达时不会丢更新；
        // 「保留者」记下最新激活者，收敛统一交给提交后的 effect。
        setAccessModes((prev) => {
          const existing = prev.find((m) => m.id === message.id);
          if (!existing) return prev;
          const merged = applyUpdateEntry(existing, message);
          if (merged.placementHint?.mode?.active === true) {
            lastActivatedAccessModeIdRef.current = merged.id;
          }
          return prev.map((entry) => (entry.id === message.id ? merged : entry));
        });
        return;
      }
      if (message.type === "closed") {
        const drop = (prev: ExtensionViewEntry[]): ExtensionViewEntry[] =>
          prev.filter((entry) => entry.id !== message.id);
        setModals(drop);
        setStreams(drop);
        setPanels(drop);
        setSidebars(drop);
        setSettingsViews(drop);
        setAccessModes(drop);
        setHeaderSlots((prev) => prev.filter((h) => h.entry.id !== message.id));
        setWidgetSlots((prev) => prev.filter((w) => w.entry.id !== message.id));
      }
    });
  }, []);

  /**
   * access-mode 单选互斥收敛（docs/design/14 §5.2，按会话隔离）：
   * 「保留者」（最近激活者）保持 active，向同会话内其它激活注册发 deactivate。
   * 放在提交后执行：open/update 与渲染提交之间的竞态不会丢事件；
   * deactivate 幂等，Strict Mode 双执行无害。
   */
  useEffect(() => {
    const keeperId = lastActivatedAccessModeIdRef.current;
    if (!keeperId) return;
    const keeper = accessModes.find((m) => m.id === keeperId);
    if (!keeper?.placementHint?.mode?.active) return;
    for (const id of staleActiveAccessModeIds(accessModes, keeper)) {
      extensionViewService
        .sendEvent(id, { type: "action", actionId: ACCESS_MODE_ACTIONS.deactivate, values: {} })
        .catch(() => {});
    }
  }, [accessModes]);

  const changeTimers = useRef(new Map<string, number>());
  /** 防抖窗口内的最新 change（key = `${viewId}::${nodeId}`），action 前冲刷用。 */
  const pendingChangesRef = useRef(
    new Map<string, { id: string; nodeId: string; value: unknown }>(),
  );

  const dismiss = useCallback((id: string) => {
    extensionViewService.sendEvent(id, { type: "dismiss" }).catch(() => {});
  }, []);

  const changeValue = useCallback((id: string, nodeId: string, value: unknown) => {
    const patch = (entry: ExtensionViewEntry): ExtensionViewEntry =>
      entry.id === id ? { ...entry, values: { ...entry.values, [nodeId]: value } } : entry;
    setModals((prev) => prev.map(patch));
    setStreams((prev) => prev.map(patch));
    setPanels((prev) => prev.map(patch));
    setSidebars((prev) => prev.map(patch));
    setSettingsViews((prev) => prev.map(patch));
    setHeaderSlots((prev) =>
      prev.map((h) => (h.entry.id === id ? { ...h, entry: patch(h.entry) } : h)),
    );
    setWidgetSlots((prev) =>
      prev.map((w) => (w.entry.id === id ? { ...w, entry: patch(w.entry) } : w)),
    );

    const key = `${id}::${nodeId}`;
    const timers = changeTimers.current;
    const existing = timers.get(key);
    if (existing) window.clearTimeout(existing);
    pendingChangesRef.current.set(key, { id, nodeId, value });
    timers.set(
      key,
      window.setTimeout(() => {
        timers.delete(key);
        pendingChangesRef.current.delete(key);
        extensionViewService.sendEvent(id, { type: "change", nodeId, value }).catch(() => {});
      }, CHANGE_DEBOUNCE_MS),
    );
  }, []);

  const sendAction = useCallback(
    (id: string, actionId: string, values: FormValues, _kind?: ViewAction["kind"]) => {
      // action 前冲刷该视图未发出的 change，避免 Host 表单 store 落后于渲染层
      const pending = pendingChangesRef.current;
      for (const [key, item] of [...pending]) {
        if (item.id !== id) continue;
        const handle = changeTimers.current.get(key);
        if (handle !== undefined) window.clearTimeout(handle);
        changeTimers.current.delete(key);
        pending.delete(key);
        extensionViewService
          .sendEvent(id, { type: "change", nodeId: item.nodeId, value: item.value })
          .catch(() => {});
      }
      extensionViewService.sendEvent(id, { type: "action", actionId, values }).catch(() => {});
    },
    [],
  );

  const value = useMemo<ExtensionViewStoreValue>(() => {
    const active = activeViewSessionId;
    const visibleModals = filterViewsForSession(modals, active);
    const visiblePanels = filterViewsForSession(panels, active);
    const visibleSidebars = filterViewsForSession(sidebars, active);
    const visibleWidgets = filterSlotsForSession(widgetSlots, active);
    const widgetAboveList = visibleWidgets
      .filter((w) => w.side === "aboveEditor")
      .map((w) => w.entry);
    const widgetBelowList = visibleWidgets
      .filter((w) => w.side === "belowEditor")
      .map((w) => w.entry);
    const visibleHeaders = filterSlotsForSession(headerSlots, active);
    const headerLeft = visibleHeaders.find((h) => h.side === "left")?.entry ?? null;
    const headerCenter = visibleHeaders.find((h) => h.side === "center")?.entry ?? null;
    const headerRight = visibleHeaders.find((h) => h.side === "right")?.entry ?? null;
    // 注册只跟随精确会话归属：未绑定的进程外注册不进任何会话面板（docs/design/14）
    const visibleAccessModes = accessModes.filter((m) => accessModeMatchesSession(m, active));

    // Catalog + live 合并投影（docs/design/16 §10.1）
    const cwd = active ? (sessionCwdBySessionId[active] ?? null) : (currentProject?.dir ?? null);
    const catalogEntries: ExtensionContribution[] = [];
    for (const snap of Object.values(catalogByContext)) {
      if (active && sessionCatalogContexts[active]) {
        if (snap.contextId === sessionCatalogContexts[active]) catalogEntries.push(...snap.entries);
      } else if (cwd == null) {
        if (snap.contextId === "user" || !snap.projectDir) {
          catalogEntries.push(...snap.entries);
        }
      } else if (
        snap.projectDir?.replace(/\\/g, "/").toLowerCase().replace(/\/+$/, "") ===
        cwd.replace(/\\/g, "/").toLowerCase().replace(/\/+$/, "")
      ) {
        catalogEntries.push(...snap.entries);
      }
    }
    const liveSnapshots: LiveAccessModeSnapshot[] = accessModes.map((m) => ({
      id: m.id,
      sessionId: m.sessionId,
      boundSessionId: m.boundSessionId,
      contributionKey: m.contributionKey,
      mode: m.placementHint?.mode,
      placementHint: m.placementHint,
    }));
    const runtime = active ? (runtimeSnapshots.find((r) => r.sessionId === active) ?? null) : null;
    const runtimeStateReady =
      runtime != null &&
      (runtime.state === "ready" || runtime.state === "idle" || runtime.state === "busy");
    const runtimeReady = runtimeStateReady;

    const accessModeRows = mergeAccessModeRows({
      catalogEntries,
      liveEntries: liveSnapshots,
      activationTxns,
      lastKnown: lastKnownModes,
      activeSessionId: active,
      runtimeReady,
    });

    const catalogHasAccessModes = catalogEntries.some((e) => e.placement === "access-mode");
    // 只有 mode 激活阻断发送；view:open（panel/settings）不进 mode transition
    const modeTxnsActive = activationTxns.some(
      (t) =>
        !t.error && t.actionId !== "view:open" && (t.sessionId === active || t.sessionId === null),
    );

    // Catalog-only panel 条目（无 live 时仍可在右栏看到并点击激活）
    const livePanelKeys = new Set(
      panels
        .filter((p) => filterViewsForSession([p], active).length > 0)
        .map((p) => p.contributionKey)
        .filter((k): k is string => typeof k === "string"),
    );
    const livePanelIds = new Set(
      panels.filter((p) => filterViewsForSession([p], active).length > 0).map((p) => p.panelId),
    );
    const catalogPanelRows = catalogEntries
      .filter((e) => e.placement === "panel")
      .filter((e) => !livePanelKeys.has(e.key) && !livePanelIds.has(e.id))
      .map((e) => {
        const txn = activationTxns.find(
          (t) =>
            t.contributionKey === e.key &&
            (t.sessionId === active || (t.sessionId === null && !active)),
        );
        let state: "advertised" | "activating" | "failed" | "suspended" = "advertised";
        if (txn && !txn.error) state = "activating";
        else if (txn?.error) state = "failed";
        else if (lastKnownModes.some((m) => m.contributionKey === e.key)) state = "suspended";
        return {
          key: e.key,
          contributionKey: e.key,
          id: e.id,
          title: e.title,
          description: e.description,
          state,
          error: txn?.error,
        };
      });
    const accessModeSelection = resolveAccessModeSelection({
      rows: accessModeRows,
      runtimeReady,
      catalogHasAccessModes,
      anyActivating: modeTxnsActive,
    });
    const accessModeChip = accessModeChipLabel({
      selection: accessModeSelection,
      rows: accessModeRows,
    });

    const modeTransitioning = modeTxnsActive;
    const sendBlockedReason = modeTransitioning ? "正在切换访问模式" : null;
    const liveError = accessModeRows.find((r) => r.state === "failed")?.error;
    const combinedError =
      activationTxns.find((txn) => txn.sessionId === active && txn.error)?.error ??
      liveError ??
      null;

    return {
      modals,
      streams,
      panels,
      sidebars,
      settingsViews,
      visibleAccessModes,
      accessModeRows,
      accessModeSelection,
      accessModeChip,
      modeTransitioning,
      runtimeSnapshots,
      accessModeError: combinedError,
      headerLeft,
      headerCenter,
      headerRight,
      widgetAboveList,
      widgetBelowList,
      visibleModals,
      visiblePanels,
      visibleSidebars,
      catalogPanelRows,
      sendBlockedReason,
      /**
       * 仅阻断「属于该会话」的 floating 表单。
       * - sessionId == null（新建空态）：不因 A/B 会话的问卷禁用输入
       * - 未绑定 sessionId 的视图视为全局（旧 SDK 兼容）
       */
      hasBlockingViewFor: (sessionId: string | null) => {
        const blocks = (entry: ExtensionViewEntry): boolean => {
          if (sessionId == null) return !entry.sessionId;
          if (!entry.sessionId) return true;
          return entry.sessionId === sessionId;
        };
        return (
          modals.some((m) => blocks(m)) || widgetSlots.some((w) => w.floating && blocks(w.entry))
        );
      },
      bindActiveViewSession,
      bindSessionRuntimeContext,
      dismiss,
      changeValue,
      sendAction,
      activateAccessMode,
      activateViewOpen,
    };
  }, [
    modals,
    streams,
    panels,
    sidebars,
    settingsViews,
    accessModes,
    headerSlots,
    widgetSlots,
    activeViewSessionId,
    catalogByContext,
    sessionCatalogContexts,
    runtimeSnapshots,
    currentProject?.dir,
    activationTxns,
    lastKnownModes,
    sessionCwdBySessionId,
    bindActiveViewSession,
    bindSessionRuntimeContext,
    dismiss,
    changeValue,
    sendAction,
    activateAccessMode,
    activateViewOpen,
  ]);

  return (
    <ExtensionViewStoreContext.Provider value={value}>
      {children}
    </ExtensionViewStoreContext.Provider>
  );
}

export function useExtensionViewStore(): ExtensionViewStoreValue {
  const ctx = useContext(ExtensionViewStoreContext);
  if (!ctx) throw new Error("useExtensionViewStore 必须在 ExtensionViewProvider 内使用");
  return ctx;
}

/** 右栏扩展面板 tab id：`ext:<panelId>`。 */
export function extensionPanelTabId(panelId: string): `ext:${string}` {
  return `ext:${panelId}`;
}
