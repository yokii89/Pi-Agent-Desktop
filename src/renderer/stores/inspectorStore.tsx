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
  InspectorBoxModel,
  InspectorDomTree,
  InspectorInvalidationReason,
  InspectorStyleData,
} from "../../shared/ipc";
import { browserService } from "../services/browserService";
import { useUiStore } from "./uiStore";

/**
 * 元素检查器状态（docs/design/06 §4.5）。
 *
 * 职责边界：只负责「当前节点的只读快照 + 加载 / 失效态」；
 * 导航与上下文托盘仍归 browserStore，二级 tab 归 uiStore（布局态）。
 * 数据源是主进程推送（`picked` / `inspectInvalidated`）+ 按 nodeId 的请求-响应。
 */

import { t } from "../../shared/i18n";

/** 检查器数据为何不可用：主进程的失效原因，加上渲染层自己的「节点已陈旧」判定。 */
export type InspectorStaleReason = InspectorInvalidationReason | "stale";

const INSPECTOR_STALE_MESSAGE_KEYS: Record<InspectorStaleReason, string> = {
  navigated: "browser.inspector.stale.navigated",
  detached: "browser.inspector.stale.detached",
  stale: "browser.inspector.stale.stale",
};

export function inspectorStaleMessage(reason: InspectorStaleReason): string {
  return t(INSPECTOR_STALE_MESSAGE_KEYS[reason]);
}

/** 「拾取」tab 展示与操作的对象：最近一次拾取的元素（对应 browserStore.lastPicked）。 */
export interface PickedRef {
  /** 对应 browserStore.lastPicked / chatElements 的条目 id。 */
  itemId: string;
  /** 采集时的 nodeId；导航后失效为 null。 */
  nodeId: number | null;
  label: string;
}

interface InspectorState {
  /** 检查器当前查看的节点（可被「结构」tab 的祖先链切换）。 */
  nodeId: number | null;
  label: string;
  picked: PickedRef | null;
  styles: InspectorStyleData | null;
  boxModel: InspectorBoxModel | null;
  domTree: InspectorDomTree | null;
  loading: boolean;
  stale: InspectorStaleReason | null;
}

type InspectorAction =
  | { type: "begin"; nodeId: number; label: string }
  | {
      type: "loaded";
      styles: InspectorStyleData;
      boxModel: InspectorBoxModel;
      domTree: InspectorDomTree;
    }
  | { type: "picked"; picked: PickedRef }
  | { type: "stale"; reason: InspectorStaleReason }
  | { type: "cleared" };

const initialState: InspectorState = {
  nodeId: null,
  label: "",
  picked: null,
  styles: null,
  boxModel: null,
  domTree: null,
  loading: false,
  stale: null,
};

function inspectorReducer(state: InspectorState, action: InspectorAction): InspectorState {
  switch (action.type) {
    case "begin":
      return {
        ...state,
        nodeId: action.nodeId,
        label: action.label,
        loading: true,
        stale: null,
      };
    case "loaded":
      return {
        ...state,
        styles: action.styles,
        boxModel: action.boxModel,
        domTree: action.domTree,
        // 主进程给的 label 是权威值（含真实 class 列表）
        label: action.styles.label || state.label,
        loading: false,
        stale: null,
      };
    case "picked":
      return { ...state, picked: action.picked, stale: null };
    case "stale":
      // 节点失效：数据一律清空，只保留「最近拾取条目」的引用供动作按钮继续可用
      return {
        ...initialState,
        stale: action.reason,
        picked: state.picked ? { ...state.picked, nodeId: null } : null,
      };
    case "cleared":
      return initialState;
    default:
      return state;
  }
}

interface InspectorStoreValue extends InspectorState {
  /** 检查目标已从「拾取元素」切到某个祖先（06 §3.2「结构」tab）。 */
  isAncestorTarget: boolean;
  /** 重新拉取当前节点三件套。 */
  refresh: () => void;
  /** 切换检查目标（祖先链点击）。 */
  selectNode: (nodeId: number | null, label: string) => void;
  /** 把检查目标切回最近拾取的元素。 */
  resetTarget: () => void;
}

const InspectorStoreContext = createContext<InspectorStoreValue | null>(null);

/** 元素 label：`tag.class`（与托盘条目同格式）。 */
function labelOf(tag: string, classAttr: string | null | undefined): string {
  const classes = classAttr?.trim();
  return classes ? `${tag}.${classes.split(/\s+/).join(".")}` : tag;
}

export function InspectorProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(inspectorReducer, initialState);
  const { dispatch: uiDispatch } = useUiStore();
  // 连点元素时后发的请求可能先回来，用序号丢弃过期结果
  const requestSeqRef = useRef(0);

  const load = useCallback((nodeId: number, label: string): void => {
    requestSeqRef.current += 1;
    const seq = requestSeqRef.current;
    dispatch({ type: "begin", nodeId, label });
    void Promise.all([
      browserService.inspectStyles(nodeId),
      browserService.inspectBoxModel(nodeId),
      browserService.inspectDomTree(nodeId),
    ]).then(([styles, boxModel, domTree]) => {
      if (seq !== requestSeqRef.current) return;
      // 任一查询失败（节点已脱离文档 / 会话已关）→ 整体按失效处理，
      // 不把 CDP 的协议错误冒泡到 UI（06 §5.1）
      if (!styles || !boxModel || !domTree) {
        dispatch({ type: "stale", reason: "stale" });
        return;
      }
      dispatch({ type: "loaded", styles, boxModel, domTree });
    });
  }, []);

  useEffect(
    () =>
      browserService.subscribe((message) => {
        if (message.type === "picked") {
          const element = message.payload;
          const label = labelOf(element.tag, element.class_attr);
          dispatch({
            type: "picked",
            picked: { itemId: element.id, nodeId: element.nodeId, label },
          });
          if (element.nodeId === null) {
            requestSeqRef.current += 1;
            dispatch({ type: "stale", reason: "stale" });
            return;
          }
          load(element.nodeId, label);
          // 06 §3.3 场景 A：点击即出样式，不需要任何额外操作
          uiDispatch({ type: "setBrowserPanelTab", tab: "styles" });
          return;
        }
        if (message.type === "inspectInvalidated") {
          requestSeqRef.current += 1;
          dispatch({ type: "stale", reason: message.payload.reason });
        }
      }),
    [load, uiDispatch],
  );

  const refresh = useCallback((): void => {
    if (state.nodeId === null) return;
    load(state.nodeId, state.label);
  }, [load, state.nodeId, state.label]);

  const selectNode = useCallback(
    (nodeId: number | null, label: string): void => {
      if (nodeId === null) return;
      load(nodeId, label);
    },
    [load],
  );

  const resetTarget = useCallback((): void => {
    if (state.picked?.nodeId == null) return;
    load(state.picked.nodeId, state.picked.label);
  }, [load, state.picked]);

  const isAncestorTarget =
    state.picked?.nodeId != null && state.nodeId !== null && state.nodeId !== state.picked.nodeId;

  const value = useMemo<InspectorStoreValue>(
    () => ({ ...state, isAncestorTarget, refresh, selectNode, resetTarget }),
    [state, isAncestorTarget, refresh, selectNode, resetTarget],
  );

  return <InspectorStoreContext.Provider value={value}>{children}</InspectorStoreContext.Provider>;
}

export function useInspectorStore(): InspectorStoreValue {
  const ctx = useContext(InspectorStoreContext);
  if (!ctx) throw new Error("useInspectorStore 必须在 InspectorProvider 内使用");
  return ctx;
}
