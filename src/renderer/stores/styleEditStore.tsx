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
import { t } from "../../shared/i18n";
import type {
  InspectorFloatHandoff,
  InspectorFloatNodePatch,
  StylePatchDeclaration,
} from "../../shared/ipc";
import { formatStylePatchCss } from "../../shared/stylePatchCss";
import { browserService } from "../services/browserService";
import { useBrowserStore } from "./browserStore";

/** CSS 自定义属性（`--*`）大小写敏感；普通属性名大小写不敏感。 */
function normalizeDeclName(name: string): string {
  const trimmed = name.trim();
  return trimmed.startsWith("--") ? trimmed : trimmed.toLowerCase();
}

/**
 * 样式编辑意图（docs/design/22 §5.3）。
 *
 * 只读页面快照归 inspectorStore，浏览器上下文归 browserStore；本 store 分开持有待保存草稿
 * 与已应用声明。默认实时预览；关闭后保留草稿，供手动应用或复制。
 */

interface NodePatch {
  selector: string;
  declarations: StylePatchDeclaration[];
}

interface StyleEditState {
  /** Working values, stored only for nodes that differ from the applied map. */
  byNode: Map<number, NodePatch>;
  /** Rules currently installed in the browser page. */
  appliedByNode: Map<number, NodePatch>;
  currentNodeId: number | null;
  applying: boolean;
  previewEnabled: boolean;
  error: string | null;
  /** 导航后提示「临时调整已清除」。 */
  navCleared: boolean;
}

type StyleEditAction =
  | { type: "focusNode"; nodeId: number | null }
  | {
      type: "draft";
      nodeId: number;
      selector: string;
      declarations: StylePatchDeclaration[];
    }
  | { type: "applied"; nodeId: number; selector: string; patch: NodePatch }
  | { type: "previewEnabled"; enabled: boolean }
  | { type: "removeNode"; nodeId: number }
  | { type: "clearAll" }
  | { type: "discardDrafts" }
  | { type: "applying"; applying: boolean }
  | { type: "error"; message: string | null }
  | { type: "navCleared" }
  /** 停靠 ⇄ 浮窗移交（docs/design/38）：整表替换 UI 草稿。 */
  | {
      type: "hydrate";
      patches: InspectorFloatNodePatch[];
      drafts: InspectorFloatNodePatch[];
      currentNodeId: number | null;
      navCleared: boolean;
      previewEnabled: boolean;
    };

const initialState: StyleEditState = {
  byNode: new Map(),
  appliedByNode: new Map(),
  currentNodeId: null,
  applying: false,
  previewEnabled: true,
  error: null,
  navCleared: false,
};

function cloneDecls(decls: StylePatchDeclaration[]): StylePatchDeclaration[] {
  return decls.map((decl) => ({ ...decl }));
}

function samePatch(
  patch: NodePatch | undefined,
  selector: string,
  declarations: StylePatchDeclaration[],
): boolean {
  if (!patch) return declarations.length === 0;
  if (patch.selector !== selector || patch.declarations.length !== declarations.length)
    return false;
  return patch.declarations.every((decl, index) => {
    const candidate = declarations[index];
    return (
      decl.name === candidate?.name &&
      decl.value === candidate.value &&
      decl.important === candidate.important &&
      decl.enabled === candidate.enabled
    );
  });
}

function removedDeclarations(
  applied: NodePatch | undefined,
  draft: NodePatch,
): StylePatchDeclaration[] {
  return (applied?.declarations ?? [])
    .filter((previous) => previous.enabled)
    .filter((previous) => {
      const current = draft.declarations.find(
        (declaration) => normalizeDeclName(declaration.name) === normalizeDeclName(previous.name),
      );
      return !current?.enabled;
    });
}

function reducer(state: StyleEditState, action: StyleEditAction): StyleEditState {
  switch (action.type) {
    case "focusNode":
      return { ...state, currentNodeId: action.nodeId, error: null };
    case "draft": {
      const next = new Map(state.byNode);
      const baseline = state.appliedByNode.get(action.nodeId);
      if (!state.applying && samePatch(baseline, action.selector, action.declarations)) {
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
      const applied = new Map(state.appliedByNode);
      if (action.patch.declarations.length === 0) {
        applied.delete(action.nodeId);
      } else {
        applied.set(action.nodeId, {
          selector: action.selector,
          declarations: cloneDecls(action.patch.declarations),
        });
      }
      const drafts = new Map(state.byNode);
      const draft = drafts.get(action.nodeId);
      // 写入期间仍可编辑；只结算已发送的版本，后续输入留给下一次应用。
      if (draft === action.patch) {
        drafts.delete(action.nodeId);
      } else if (draft) {
        drafts.set(action.nodeId, { ...draft, selector: action.selector });
      }
      return { ...state, appliedByNode: applied, byNode: drafts, error: null };
    }
    case "previewEnabled":
      return { ...state, previewEnabled: action.enabled, error: null };
    case "removeNode": {
      const next = new Map(state.byNode);
      next.delete(action.nodeId);
      return { ...state, byNode: next };
    }
    case "clearAll":
      return {
        ...initialState,
        currentNodeId: state.currentNodeId,
        previewEnabled: state.previewEnabled,
      };
    case "discardDrafts":
      return { ...state, byNode: new Map(), error: null };
    case "applying":
      return { ...state, applying: action.applying };
    case "error":
      return { ...state, error: action.message, applying: false };
    case "navCleared":
      return { ...initialState, navCleared: true, previewEnabled: state.previewEnabled };
    case "hydrate": {
      const applied = new Map<number, NodePatch>();
      for (const patch of action.patches) {
        applied.set(patch.nodeId, {
          selector: patch.selector,
          declarations: cloneDecls(patch.declarations),
        });
      }
      const drafts = new Map<number, NodePatch>();
      for (const patch of action.drafts) {
        drafts.set(patch.nodeId, {
          selector: patch.selector,
          declarations: cloneDecls(patch.declarations),
        });
      }
      return {
        byNode: drafts,
        appliedByNode: applied,
        currentNodeId: action.currentNodeId,
        applying: false,
        previewEnabled: action.previewEnabled,
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
  hasDrafts: boolean;
  exportDeclarationCount: number;
  setPreviewEnabled: (enabled: boolean) => void;
  setFocusNode: (nodeId: number | null) => void;
  upsertDeclaration: (name: string, value: string) => void;
  /** 一次写入多条（盒四边联动 / Flow 同时写 display+flex-direction）。 */
  upsertDeclarations: (entries: Array<{ name: string; value: string }>) => void;
  /** 移除多条（清除某组字段时用）。 */
  removeDeclarations: (names: string[]) => void;
  toggleEnabled: (name: string, enabled: boolean) => void;
  toggleImportant: (name: string, important: boolean) => void;
  setValue: (name: string, value: string) => void;
  removeDeclaration: (name: string) => void;
  clearCurrent: () => void;
  clearAll: () => void;
  discardDrafts: () => void;
  applyDrafts: () => Promise<boolean>;
  exportCss: (host: string) => string;
  dismissNavCleared: () => void;
  /** 热更成功后通知（StylesTab 用来拉 computed 对账）。 */
  subscribeApplied: (listener: () => void) => () => void;
  /** 导出 UI 草稿（不含 tab；tab 归 uiStore）。 */
  serializeHandoffBody: () => Pick<
    InspectorFloatHandoff,
    "currentNodeId" | "navCleared" | "patches" | "drafts" | "previewEnabled"
  >;
  /** 停靠 ⇄ 浮窗移交：恢复 UI 草稿。 */
  hydrateHandoffBody: (
    body: Pick<
      InspectorFloatHandoff,
      "currentNodeId" | "navCleared" | "patches" | "drafts" | "previewEnabled"
    >,
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
  const seqRef = useRef(0);
  const applyingRef = useRef(false);
  // 热更成功后由 StylesTab 拉一次 computed 对账（22 R3）
  const appliedListenersRef = useRef(new Set<() => void>());

  useEffect(
    () =>
      browserService.subscribe((message) => {
        if (message.type === "inspectInvalidated") {
          seqRef.current += 1;
          applyingRef.current = false;
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
    state.currentNodeId !== null
      ? (state.byNode.get(state.currentNodeId) ?? state.appliedByNode.get(state.currentNodeId))
      : undefined;
  const currentDeclarations = currentPatch?.declarations ?? [];
  const currentSelector = currentPatch?.selector ?? "";

  const exportDeclarationCount = useMemo(() => {
    let count = 0;
    for (const [nodeId, draft] of new Map([...state.appliedByNode, ...state.byNode])) {
      count += draft.declarations.filter((decl) => decl.enabled).length;
      count += removedDeclarations(state.appliedByNode.get(nodeId), draft).length;
    }
    return count;
  }, [state.appliedByNode, state.byNode]);

  const stagePatch = useCallback(
    (nodeId: number, selector: string, declarations: StylePatchDeclaration[]): void => {
      dispatch({ type: "draft", nodeId, selector, declarations });
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
    const patch = stateRef.current.byNode.get(nodeId) ?? stateRef.current.appliedByNode.get(nodeId);
    const picked = browserRef.current.lastPicked;
    const fallbackSelector =
      picked && picked.kind === "element" && picked.nodeId === nodeId ? picked.selector : "";
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
      stagePatch(ctx.nodeId, ctx.selector, declarations);
    },
    [ensureContext, stagePatch],
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
      stagePatch(ctx.nodeId, ctx.selector, declarations);
    },
    [ensureContext, stagePatch],
  );

  const removeDeclarations = useCallback(
    (names: string[]): void => {
      const ctx = ensureContext();
      if (!ctx) return;
      const keys = new Set(names.map((name) => normalizeDeclName(name)));
      const declarations = ctx.declarations.filter(
        (decl) => !keys.has(normalizeDeclName(decl.name)),
      );
      stagePatch(ctx.nodeId, ctx.selector, declarations);
    },
    [ensureContext, stagePatch],
  );

  const mutateDeclaration = useCallback(
    (name: string, patch: Partial<StylePatchDeclaration>): void => {
      const ctx = ensureContext();
      if (!ctx) return;
      const key = normalizeDeclName(name);
      const declarations = ctx.declarations.map((decl) =>
        normalizeDeclName(decl.name) === key ? { ...decl, ...patch, name: decl.name } : decl,
      );
      stagePatch(ctx.nodeId, ctx.selector, declarations);
    },
    [ensureContext, stagePatch],
  );

  const toggleEnabled = useCallback(
    (name: string, enabled: boolean): void => {
      mutateDeclaration(name, { enabled });
    },
    [mutateDeclaration],
  );

  const toggleImportant = useCallback(
    (name: string, important: boolean): void => {
      mutateDeclaration(name, { important });
    },
    [mutateDeclaration],
  );

  const setValue = useCallback(
    (name: string, value: string): void => {
      const trimmed = value.trim();
      // 空值不写入（清空输入时保留上一生效值，避免规则被掏空）
      if (!trimmed) return;
      mutateDeclaration(name, { value: trimmed });
    },
    [mutateDeclaration],
  );

  const removeDeclaration = useCallback(
    (name: string): void => {
      const ctx = ensureContext();
      if (!ctx) return;
      const key = normalizeDeclName(name);
      const declarations = ctx.declarations.filter((decl) => normalizeDeclName(decl.name) !== key);
      stagePatch(ctx.nodeId, ctx.selector, declarations);
    },
    [ensureContext, stagePatch],
  );

  const clearCurrent = useCallback((): void => {
    const ctx = ensureContext();
    if (!ctx) return;
    stagePatch(ctx.nodeId, ctx.selector, []);
  }, [ensureContext, stagePatch]);

  const clearAll = useCallback((): void => {
    seqRef.current += 1;
    applyingRef.current = false;
    dispatch({ type: "clearAll" });
    void browserService.stylePatchClear(null);
  }, []);

  const discardDrafts = useCallback((): void => {
    if (stateRef.current.applying || applyingRef.current) return;
    seqRef.current += 1;
    dispatch({ type: "discardDrafts" });
  }, []);

  const setPreviewEnabled = useCallback((enabled: boolean): void => {
    dispatch({ type: "previewEnabled", enabled });
  }, []);

  const applyDrafts = useCallback(async (): Promise<boolean> => {
    const pending = [...stateRef.current.byNode.entries()];
    if (pending.length === 0 || stateRef.current.applying || applyingRef.current) return false;
    applyingRef.current = true;
    seqRef.current += 1;
    const seq = seqRef.current;
    dispatch({ type: "applying", applying: true });
    for (const [nodeId, patch] of pending) {
      if (seq !== seqRef.current) {
        return false;
      }
      const result = await browserService.stylePatch(nodeId, patch.selector, patch.declarations);
      if (seq !== seqRef.current) {
        return false;
      }
      if (!result) {
        applyingRef.current = false;
        dispatch({ type: "error", message: t("browser.styles.applyFailed") });
        return false;
      }
      dispatch({
        type: "applied",
        nodeId,
        selector: result.selector,
        patch,
      });
    }
    if (seq !== seqRef.current) {
      return false;
    }
    applyingRef.current = false;
    dispatch({ type: "applying", applying: false });
    for (const listener of appliedListenersRef.current) listener();
    return true;
  }, []);

  const exportCss = useCallback((host: string): string => {
    const current = stateRef.current;
    const removals: string[] = [];
    for (const [nodeId, draft] of current.byNode) {
      const removed = removedDeclarations(current.appliedByNode.get(nodeId), draft);
      if (removed.length > 0) {
        removals.push(
          "/* Remove from " +
            draft.selector +
            ": " +
            removed.map((decl) => decl.name).join(", ") +
            " */",
        );
      }
    }
    const css = formatStylePatchCss(
      [...new Map([...current.appliedByNode, ...current.byNode]).values()].map(
        ({ selector, declarations }) => ({
          selector,
          declarations,
        }),
      ),
      host,
    );
    return [css, ...removals].filter(Boolean).join("\n\n");
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
    // 新宿主接管未完成的草稿，旧宿主不得继续发送后续节点。
    seqRef.current += 1;
    applyingRef.current = false;
    const current = stateRef.current;
    const serialize = (source: Map<number, NodePatch>): InspectorFloatNodePatch[] =>
      [...source].map(([nodeId, patch]) => ({
        nodeId,
        selector: patch.selector,
        declarations: cloneDecls(patch.declarations),
      }));
    return {
      currentNodeId: current.currentNodeId,
      navCleared: current.navCleared,
      previewEnabled: current.previewEnabled,
      patches: serialize(current.appliedByNode),
      drafts: serialize(current.byNode),
    };
  }, []);

  const hydrateHandoffBody = useCallback(
    (
      body: Pick<
        InspectorFloatHandoff,
        "currentNodeId" | "navCleared" | "patches" | "drafts" | "previewEnabled"
      >,
    ): void => {
      seqRef.current += 1;
      applyingRef.current = false;
      dispatch({
        type: "hydrate",
        patches: body.patches,
        drafts: body.drafts,
        currentNodeId: body.currentNodeId,
        navCleared: body.navCleared,
        previewEnabled: body.previewEnabled ?? true,
      });
    },
    [],
  );

  const value = useMemo<StyleEditStoreValue>(
    () => ({
      ...state,
      currentDeclarations,
      currentSelector,
      hasDrafts: state.byNode.size > 0,
      exportDeclarationCount,
      setPreviewEnabled,
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
      discardDrafts,
      applyDrafts,
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
      exportDeclarationCount,
      setPreviewEnabled,
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
      discardDrafts,
      applyDrafts,
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
