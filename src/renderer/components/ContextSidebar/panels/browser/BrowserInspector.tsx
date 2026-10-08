import {
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import type { InspectorFloatHandoff } from "../../../../../shared/ipc";
import { useT } from "../../../../hooks/useT";
import { inspectorFloatService } from "../../../../services/inspectorFloatService";
import { useBrowserStore } from "../../../../stores/browserStore";
import { inspectorStaleMessage, useInspectorStore } from "../../../../stores/inspectorStore";
import { useStyleEditStore } from "../../../../stores/styleEditStore";
import {
  INSPECTOR_COMPACT_WIDTH,
  INSPECTOR_WIDEN_HINT_WIDTH,
  INSPECTOR_WIDEN_TARGET_WIDTH,
  useUiStore,
} from "../../../../stores/uiStore";
import { BoxModelTab } from "./BoxModelTab";
import styles from "./BrowserInspector.module.css";
import { BrowserPaneTabs } from "./BrowserPaneTabs";
import { DomTreeTab } from "./DomTreeTab";
import { PickTab } from "./PickTab";
import { StylesTab } from "./StylesTab";

/**
 * 检查器区容器（docs/design/06 §3.2 ④）：拖拽分隔 + 二级 tab + 内容分发 + 两类提示。
 *
 * 为什么放在侧栏而不是页面内注入卡：检查器需要在用户滚动、悬停、切换元素时**持续存在**，
 * 而注入卡的生命周期绑死在一次选中上，且页面侧拿不到 tokens/Phosphor。
 */

/** 检查器区高度边界：下限固定像素，上限为面板高度的占比（保证页面区仍可用）。 */
const MIN_HEIGHT = 120;
const MAX_HEIGHT_RATIO = 0.6;

interface ResizeSession {
  startY: number;
  startHeight: number;
  maxHeight: number;
}

function clampHeight(value: number, maxHeight: number): number {
  return Math.min(maxHeight, Math.max(MIN_HEIGHT, Math.round(value)));
}

export function BrowserInspector({ floatHost = false }: { floatHost?: boolean }) {
  const t = useT();
  const {
    browserPanelTab,
    inspectorPaneHeight,
    inspectorPaneCollapsed,
    inspectorFloatOpen,
    rightSidebarWidth,
    dispatch,
  } = useUiStore();
  const browser = useBrowserStore();
  const inspector = useInspectorStore();
  const edit = useStyleEditStore();
  const rootRef = useRef<HTMLElement>(null);
  const resizeRef = useRef<ResizeSession | null>(null);
  // 拖拽中的高度走局部 state，pointerup 时一次性提交 store，避免拖拽帧重渲染全局
  const [dragHeight, setDragHeight] = useState<number | null>(null);

  const onResizeStart = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const root = rootRef.current;
    const panel = root?.parentElement;
    if (event.button !== 0 || !root || !panel) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = {
      startY: event.clientY,
      startHeight: root.getBoundingClientRect().height,
      maxHeight: Math.max(MIN_HEIGHT, Math.floor(panel.clientHeight * MAX_HEIGHT_RATIO)),
    };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  };

  const onResizeMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const session = resizeRef.current;
    if (!session) return;
    setDragHeight(
      clampHeight(session.startHeight + (session.startY - event.clientY), session.maxHeight),
    );
  };

  const onResizeEnd = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const session = resizeRef.current;
    if (!session) return;
    resizeRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    const next = clampHeight(
      session.startHeight + (session.startY - event.clientY),
      session.maxHeight,
    );
    setDragHeight(null);
    dispatch({ type: "setInspectorPaneHeight", height: next });
  };

  // 「拾取」tab 的 Enter：把最近拾取元素直接加入中央对话框（默认无截图）。
  // 只在焦点位于检查器内部、且不是按在按钮上时生效，避免与按钮自身 Enter 重复。
  const onBodyKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (browserPanelTab !== "pick" || event.key !== "Enter") return;
    if ((event.target as HTMLElement).closest("button")) return;
    if (!browser.lastPicked) return;
    if (browser.chatElements.some((entry) => entry.id === browser.lastPicked?.id)) return;
    event.preventDefault();
    browser.addLastPickedToChat();
  };

  const compact = rightSidebarWidth < INSPECTOR_COMPACT_WIDTH;
  const showWidenHint =
    rightSidebarWidth < INSPECTOR_WIDEN_HINT_WIDTH && browserPanelTab !== "pick";
  const staleMessage = inspector.stale ? inspectorStaleMessage(inspector.stale) : null;
  // 浮窗打开时主窗整段不渲染：预览页占满侧栏高度（docs/design/38 验收 2）；
  // 停靠 / 关闭只在浮窗标题条操作，不在主窗留占位条。
  const dockedHidden = !floatHost && inspectorFloatOpen;

  const buildHandoff = (): InspectorFloatHandoff => ({
    tab: browserPanelTab,
    ...edit.serializeHandoffBody(),
  });

  const openFloat = (): void => {
    void inspectorFloatService.open(buildHandoff());
    dispatch({ type: "setInspectorFloatOpen", open: true });
  };

  // 主窗：跟随浮窗开/关，并在关闭时吃回 handoff（docs/design/38）
  useEffect(() => {
    if (floatHost) return;
    return inspectorFloatService.onState((message) => {
      dispatch({ type: "setInspectorFloatOpen", open: message.open });
      if (!message.open && message.handoff) {
        dispatch({ type: "setBrowserPanelTab", tab: message.handoff.tab });
        edit.hydrateHandoffBody(message.handoff);
      }
    });
  }, [dispatch, edit, floatHost]);

  if (dockedHidden) return null;

  return (
    <section
      ref={rootRef}
      className={[styles.inspector, inspectorPaneCollapsed ? styles.inspectorCollapsed : ""].join(
        " ",
      )}
      style={
        floatHost || inspectorPaneCollapsed
          ? undefined
          : { height: dragHeight ?? inspectorPaneHeight }
      }
      aria-label={t("browser.inspector.label")}
    >
      {!inspectorPaneCollapsed && !floatHost && (
        <div
          className={[
            styles.resizeHandle,
            dragHeight !== null ? styles.resizeHandleDragging : "",
          ].join(" ")}
          title={t("browser.inspector.resize")}
          onPointerDown={onResizeStart}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onPointerCancel={onResizeEnd}
        />
      )}
      <BrowserPaneTabs
        active={browserPanelTab}
        onSelect={(tab) => dispatch({ type: "setBrowserPanelTab", tab })}
        onRefresh={inspector.refresh}
        refreshDisabled={inspector.nodeId === null}
        collapsed={inspectorPaneCollapsed && !floatHost}
        onToggleCollapsed={() => dispatch({ type: "toggleInspectorPaneCollapsed" })}
        floatHost={floatHost}
        onFloat={openFloat}
      />
      {!inspectorPaneCollapsed && (
        /* 内容区即当前二级 tab 的面板（一次只渲染一个），因此直接标成 tabpanel */
        <div
          className={styles.body}
          role="tabpanel"
          aria-label={t("browser.inspector.content")}
          onKeyDown={onBodyKeyDown}
        >
          {staleMessage && (
            <div className={styles.notice}>
              <span className={styles.noticeText}>{staleMessage}</span>
              <button
                type="button"
                className={styles.noticeButton}
                onClick={() => {
                  dispatch({ type: "setBrowserPanelTab", tab: "pick" });
                  if (!browser.pickActive) browser.togglePick();
                }}
              >
                {t("browser.inspector.repick")}
              </button>
            </div>
          )}

          {showWidenHint && (
            <div className={styles.hint}>
              <span className={styles.hintText}>{t("browser.inspector.narrowHint")}</span>
              <button
                type="button"
                className={styles.widenButton}
                onClick={() =>
                  dispatch({ type: "setRightSidebarWidth", width: INSPECTOR_WIDEN_TARGET_WIDTH })
                }
              >
                {t("panels.context.widen")}
              </button>
            </div>
          )}

          {browserPanelTab === "pick" && <PickTab />}
          {browserPanelTab === "styles" && <StylesTab compact={compact} />}
          {browserPanelTab === "boxModel" && <BoxModelTab compact={compact} />}
          {browserPanelTab === "dom" && <DomTreeTab compact={compact} />}
        </div>
      )}
    </section>
  );
}
