import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import type {
  InspectorFloatHandoff,
  InspectorFloatNodePatch,
  StylePatchDeclaration,
} from "../../shared/ipc";
import { browserService } from "../services/browserService";
import { useBrowserStore } from "./browserStore";

/** CSS 自定义属性（`--*`）大小写敏感；普通属性名大小写不敏感。 */
function normalizeDeclName(name: string): string {
  const trimmed = name.trim();
  return trimmed.startsWith("--") ? trimmed : trimmed.toLowerCase();
}

/**
 * 样式热更改意图（docs/design/22 §5.3）。
 *
 * 职责边界：只负责「用户的临时调整」——草稿、已应用声明、按节点归拢、失效清空；
 * 页面真相的只读快照仍归 inspectorStore，导航/托盘归 browserStore。
 * 热应用经 browserService.stylePatch 写主进程 PiDesk 调整样式表。
 */

/** 连续输入（拖拽/滑条）的合并窗口；提交类操作走 flush 立刻发。 */
const LIVE_DEBOUNCE_MS = 50;

interface NodePatch {
  selector: string;
  declarations: StylePatchDeclaration[];
}

interface StyleEditState {
  byNode: Map<number, NodePatch>;
  currentNodeId: number | null;
  applying: boolean;
  error: string | null;
  /** 导航后提示「临时调整已清除」。 */
  navCleared: boolean;
}

type StyleEditAction =
  | { type: "focusNode"; nodeId: number | null }
  | {
      type: "local";
      nodeId: number;
      selector: string;
      declarations: StylePatchDeclaration[];
    }
  | { type: "applied"; nodeId: number; selector: string; declarations: StylePatchDeclaration[] }
  | { type: "removeNode"; nodeId: number }
  | { type: "clearAll" }
  | { type: "applying"; applying: boolean }
  | { type: "error"; message: string | null }
  | { type: "navCleared" }
  /** 停靠 ⇄ 浮窗移交（docs/design/38）：整表替换 UI 草稿。 */
  | {
      type: "hydrate";
      patches: InspectorFloatNodePatch[];
      currentNodeId: number | null;
      navCleared: boolean;
    };

const initialState: StyleEditState = {
  byNode: new Map(),
  currentNodeId: null,
  applying: false,
  error: null,
  navCleared: false,
};

function cloneDecls(decls: StylePatchDeclaration[]): StylePatchDeclaration[] {
  return decls.map((decl) => ({ ...decl }));
}

function reducer(state: StyleEditState, action: StyleEditAction): StyleEditState {
  switch (action.type) {
    case "focusNode":
      return { ...state, currentNodeId: action.nodeId, error: null };
    case "local": {
      const next = new Map(state.byNode);
      if (action.declarations.length === 0) {
        next.delete(action.nodeId);
      } else {
        next.set(action.nodeId, {
          selector: action.selector,
          declarations: cloneDecls(action.declarations),
        });
      }
      return { ...state, byNode: next, navCleared: false, error: null };
    }
    case "applied": {
      const next = new Map(state.byNode);
      if (action.declarations.length === 0) {
        next.delete(action.nodeId);
      } else {
        next.set(action.nodeId, {
          selector: action.selector,
          declarations: cloneDecls(action.declarations),
        });
      }
      return { ...state, byNode: next, applying: false, error: null };
    }
    case "removeNode": {
      const next = new Map(state.byNode);
      next.delete(action.nodeId);
      return { ...state, byNode: next };
    }
    case "clearAll":
      return { ...initialState, currentNodeId: state.currentNodeId };
    case "applying":
      return { ...state, applying: action.applying };
    case "error":
      return { ...state, error: action.message, applying: false };
    case "navCleared":
      return { ...initialState, navCleared: true };
    case "hydrate": {
      const next = new Map<number, NodePatch>();
      for (const patch of action.patches) {
        next.set(patch.nodeId, {
          selector: patch.selector,
          declarations: cloneDecls(patch.declarations),
        });
      }
      return {
        byNode: next,
        currentNodeId: action.currentNodeId,
        applying: false,
        error: null,
        navCleared: action.navCleared,
      };
    }
    default:
      return state;
  }
}

interface StyleEditStoreValue extends StyleEditState {
  /** 当前节点的调整（含未启用）。 */
  currentDeclarations: StylePatchDeclaration[];
  currentSelector: string;
  /** 全部节点已启用的调整条数（调整条角标）。 */
  totalEnabled: number;
  /** 其他节点上仍有调整的数量。 */
  otherNodeCount: number;
  setFocusNode: (nodeId: number | null) => void;
  upsertDeclaration: (name: string, value: string) => void;
  /** 一次写入多条（盒四边联动 / Flow 同时写 display+flex-direction）。 */
  upsertDeclarations: (entries: Array<{ name: string; value: string }>) => void;
  /** 移除多条（清除某组字段时用）。 */
  removeDeclarations: (names: string[]) => void;
  toggleEnabled: (name: string, enabled: boolean) => void;
  toggleImportant: (name: string, important: boolean) => void;
  setValue: (name: string, value: string, live?: boolean) => void;
  removeDeclaration: (name: string) => void;
  clearCurrent: () => void;
  clearAll: () => void;
  exportCss: (host: string) => Promise<string>;
  dismissNavCleared: () => void;
  /** 热更成功后通知（StylesTab 用来拉 computed 对账）。 */
  subscribeApplied: (listener: () => void) => () => void;
  /** 导出 UI 草稿（不含 tab；tab 归 uiStore）。 */
  serializeHandoffBody: () => Pick<
    InspectorFloatHandoff,
    "currentNodeId" | "navCleared" | "patches"
  >;
  /** 停靠 ⇄ 浮窗移交：恢复 UI 草稿。 */
  hydrateHandoffBody: (
    body: Pick<InspectorFloatHandoff, "currentNodeId" | "navCleared" | "patches">,
  ) => void;
}

const StyleEditStoreContext = createContext<StyleEditStoreValue | null>(null);

export function StyleEditProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const browser = useBrowserStore();
  const stateRef = useRef(state);
  stateRef.current = state;
  const browserRef = useRef(browser);
  browserRef.current = browser;
  const timerRef = useRef<number | null>(null);
  const seqRef = useRef(0);
  // 热更成功后由 StylesTab 拉一次 computed 对账（22 R3）
  const appliedListenersRef = useRef(new Set<() => void>());

  useEffect(
    () =>
      browserService.subscribe((message) => {
        if (message.type === "inspectInvalidated") {
          if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
          }
          seqRef.current += 1;
          dispatch({ type: "navCleared" });
          return;
        }
        if (message.type === "styleApplyFailed") {
          dispatch({ type: "error", message: message.payload.message });
        }
      }),
    [],
  );

  const currentPatch =
    state.currentNodeId !== null ? state.byNode.get(state.currentNodeId) : undefined;
  const currentDeclarations = currentPatch?.declarations ?? [];
  const currentSelector = currentPatch?.selector ?? "";

  const totalEnabled = useMemo(() => {
    let count = 0;
    for (const patch of state.byNode.values()) {
      count += patch.declarations.filter((decl) => decl.enabled).length;
    }
    return count;
  }, [state.byNode]);

  const otherNodeCount = useMemo(() => {
    let count = 0;
    for (const [nodeId] of state.byNode) {
      if (nodeId !== state.currentNodeId) count += 1;
    }
    return count;
  }, [state.byNode, state.currentNodeId]);

  const pushPatch = useCallback(
    (
      nodeId: number,
      selector: string,
      declarations: StylePatchDeclaration[],
      live: boolean,
    ): void => {
      dispatch({ type: "local", nodeId, selector, declarations });
      const run = (): void => {
        timerRef.current = null;
        seqRef.current += 1;
        const seq = seqRef.current;
        dispatch({ type: "applying", applying: true });
        void browserService.stylePatch(nodeId, selector, declarations).then((result) => {
          if (seq !== seqRef.current) return;
          if (!result) {
            dispatch({ type: "error", message: "热更改未生效，请重新拾取元素" });
            return;
          }
          dispatch({
            type: "applied",
            nodeId,
            selector: result.selector,
            declarations,
          });
          for (const listener of appliedListenersRef.current) listener();
        });
      };
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (live) {
        timerRef.current = window.setTimeout(run, LIVE_DEBOUNCE_MS);
      } else {
        run();
      }
    },
    [],
  );

  const ensureContext = useCallback((): {
    nodeId: number;
    selector: string;
    declarations: StylePatchDeclaration[];
  } | null => {
    const nodeId = stateRef.current.currentNodeId;
    if (nodeId === null) return null;
    const patch = stateRef.current.byNode.get(nodeId);
    const picked = browserRef.current.lastPicked;
    const fallbackSelector =
      picked && picked.kind === "element" && picked.selector ? picked.selector : "";
    return {
      nodeId,
      selector: patch?.selector || fallbackSelector,
      declarations: cloneDecls(patch?.declarations ?? []),
    };
  }, []);

  const setFocusNode = useCallback((nodeId: number | null): void => {
    if (stateRef.current.currentNodeId === nodeId) return;
    dispatch({ type: "focusNode", nodeId });
  }, []);

  const upsertDeclaration = useCallback(
    (name: string, value: string): void => {
      const ctx = ensureContext();
      if (!ctx) return;
      const key = normalizeDeclName(name);
      const declarations = ctx.declarations.filter((decl) => normalizeDeclName(decl.name) !== key);
      declarations.push({ name: key, value: value.trim(), important: false, enabled: true });
      pushPatch(ctx.nodeId, ctx.selector, declarations, false);
    },
    [ensureContext, pushPatch],
  );

  const upsertDeclarations = useCallback(
    (entries: Array<{ name: string; value: string }>): void => {
      const ctx = ensureContext();
      if (!ctx) return;
      const keys = new Set(entries.map((entry) => normalizeDeclName(entry.name)));
      const declarations = ctx.declarations.filter(
        (decl) => !keys.has(normalizeDeclName(decl.name)),
      );
      for (const entry of entries) {
        const value = entry.value.trim();
        if (!value) continue;
        declarations.push({
          name: normalizeDeclName(entry.name),
          value,
          important: false,
          enabled: true,
        });
      }
      pushPatch(ctx.nodeId, ctx.selector, declarations, false);
    },
    [ensureContext, pushPatch],
  );

  const removeDeclarations = useCallback(
    (names: string[]): void => {
      const ctx = ensureContext();
      if (!ctx) return;
      const keys = new Set(names.map((name) => normalizeDeclName(name)));
      const declarations = ctx.declarations.filter(
        (decl) => !keys.has(normalizeDeclName(decl.name)),
      );
      pushPatch(ctx.nodeId, ctx.selector, declarations, false);
    },
    [ensureContext, pushPatch],
  );

  const mutateDeclaration = useCallback(
    (name: string, patch: Partial<StylePatchDeclaration>, live: boolean): void => {
      const ctx = ensureContext();
      if (!ctx) return;
      const key = normalizeDeclName(name);
      const declarations = ctx.declarations.map((decl) =>
        normalizeDeclName(decl.name) === key ? { ...decl, ...patch, name: decl.name } : decl,
      );
      pushPatch(ctx.nodeId, ctx.selector, declarations, live);
    },
    [ensureContext, pushPatch],
  );

  const toggleEnabled = useCallback(
    (name: string, enabled: boolean): void => {
      mutateDeclaration(name, { enabled }, false);
    },
    [mutateDeclaration],
  );

  const toggleImportant = useCallback(
    (name: string, important: boolean): void => {
      mutateDeclaration(name, { important }, false);
    },
    [mutateDeclaration],
  );

  const setValue = useCallback(
    (name: string, value: string, live = false): void => {
      const trimmed = value.trim();
      // 空值不写入（清空输入时保留上一生效值，避免规则被掏空）
      if (!trimmed) return;
      mutateDeclaration(name, { value: trimmed }, live);
    },
    [mutateDeclaration],
  );

  const removeDeclaration = useCallback(
    (name: string): void => {
      const ctx = ensureContext();
      if (!ctx) return;
      const key = normalizeDeclName(name);
      const declarations = ctx.declarations.filter((decl) => normalizeDeclName(decl.name) !== key);
      pushPatch(ctx.nodeId, ctx.selector, declarations, false);
    },
    [ensureContext, pushPatch],
  );

  const clearCurrent = useCallback((): void => {
    const ctx = ensureContext();
    if (!ctx) return;
    pushPatch(ctx.nodeId, ctx.selector, [], false);
  }, [ensureContext, pushPatch]);

  const clearAll = useCallback((): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    seqRef.current += 1;
    dispatch({ type: "clearAll" });
    void browserService.stylePatchClear(null);
  }, []);

  const exportCss = useCallback(async (host: string): Promise<string> => {
    return browserService.stylePatchExport(host);
  }, []);

  const dismissNavCleared = useCallback((): void => {
    dispatch({ type: "clearAll" });
  }, []);

  const subscribeApplied = useCallback((listener: () => void): (() => void) => {
    appliedListenersRef.current.add(listener);
    return () => {
      appliedListenersRef.current.delete(listener);
    };
  }, []);

  const serializeHandoffBody = useCallback(() => {
    const current = stateRef.current;
    const patches: InspectorFloatNodePatch[] = [];
    for (const [nodeId, patch] of current.byNode) {
      patches.push({
        nodeId,
        selector: patch.selector,
        declarations: cloneDecls(patch.declarations),
      });
    }
    return {
      currentNodeId: current.currentNodeId,
      navCleared: current.navCleared,
      patches,
    };
  }, []);

  const hydrateHandoffBody = useCallback(
    (body: Pick<InspectorFloatHandoff, "currentNodeId" | "navCleared" | "patches">): void => {
      dispatch({
        type: "hydrate",
        patches: body.patches,
        currentNodeId: body.currentNodeId,
        navCleared: body.navCleared,
      });
    },
    [],
  );

  const value = useMemo<StyleEditStoreValue>(
    () => ({
      ...state,
      currentDeclarations,
      currentSelector,
      totalEnabled,
      otherNodeCount,
      setFocusNode,
      upsertDeclaration,
      upsertDeclarations,
      removeDeclarations,
      toggleEnabled,
      toggleImportant,
      setValue,
      removeDeclaration,
      clearCurrent,
      clearAll,
      exportCss,
      dismissNavCleared,
      subscribeApplied,
      serializeHandoffBody,
      hydrateHandoffBody,
    }),
    [
      state,
      currentDeclarations,
      currentSelector,
      totalEnabled,
      otherNodeCount,
      setFocusNode,
      upsertDeclaration,
      upsertDeclarations,
      removeDeclarations,
      toggleEnabled,
      toggleImportant,
      setValue,
      removeDeclaration,
      clearCurrent,
      clearAll,
      exportCss,
      dismissNavCleared,
      subscribeApplied,
      serializeHandoffBody,
      hydrateHandoffBody,
    ],
  );

  return <StyleEditStoreContext.Provider value={value}>{children}</StyleEditStoreContext.Provider>;
}

export function useStyleEditStore(): StyleEditStoreValue {
  const ctx = useContext(StyleEditStoreContext);
  if (!ctx) throw new Error("useStyleEditStore 必须在 StyleEditProvider 内使用");
  return ctx;
}
