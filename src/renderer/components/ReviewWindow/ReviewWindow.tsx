import { GitBranch, X } from "@phosphor-icons/react";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useT } from "../../hooks/useT";
import { gitService } from "../../services/gitService";
import { useReviewStore } from "../../stores/reviewStore";
import { useUiStore } from "../../stores/uiStore";
import { GitGraphPanel } from "../ContextSidebar/panels/GitGraphPanel";
import { IconButton } from "../ui/IconButton";
import { ChangesPane } from "./ChangesPane";
import { ReviewHeaderActions } from "./ReviewHeaderActions";
import styles from "./ReviewWindow.module.css";

/** 浮窗尺寸下限与默认值（px）。 */
const MIN_WIDTH = 560;
const MIN_HEIGHT = 400;
const DEFAULT_WIDTH = 720;
const DEFAULT_HEIGHT = 560;
/** 与视口边缘保持的最小间距（px）。 */
const VIEWPORT_MARGIN = 12;

interface WindowRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 拖拽/缩放会话：起点指针坐标 + 起始矩形。 */
interface PointerSession {
  pointerId: number;
  startX: number;
  startY: number;
  origin: WindowRect;
}

/**
 * 位置/尺寸的会话内记忆：浮窗关闭重开保持原位，不跨重启持久化
 * （与 uiStore 其他布局态同一策略）。模块级单例，条件挂载下存活于组件外。
 */
let persistedRect: WindowRect | null = null;

/** 把矩形钳回视口：尺寸夹到 [min, 视口-边距]，位置保证整窗可见（拖不丢）。 */
function fitViewport(rect: WindowRect): WindowRect {
  const maxW = Math.max(MIN_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
  const maxH = Math.max(MIN_HEIGHT, window.innerHeight - VIEWPORT_MARGIN * 2);
  const width = Math.min(Math.max(rect.width, MIN_WIDTH), maxW);
  const height = Math.min(Math.max(rect.height, MIN_HEIGHT), maxH);
  const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
  const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
  return {
    left: Math.min(Math.max(rect.left, VIEWPORT_MARGIN), maxLeft),
    top: Math.min(Math.max(rect.top, VIEWPORT_MARGIN), maxTop),
    width,
    height,
  };
}

function initialRect(): WindowRect {
  if (persistedRect) return fitViewport(persistedRect);
  const width = Math.min(DEFAULT_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
  const height = Math.min(DEFAULT_HEIGHT, window.innerHeight - VIEWPORT_MARGIN * 2);
  return fitViewport({
    left: (window.innerWidth - width) / 2,
    top: Math.max(VIEWPORT_MARGIN, (window.innerHeight - height) / 2 - 40),
    width,
    height,
  });
}

/**
 * 代码审查浮窗（原侧栏审查面板的浮窗化重构）。
 * 壳只管定位/拖拽/缩放/开关；数据与操作全部下沉到 ChangesPane（reviewStore）。
 * 挂载方式：App 里 `{reviewWindowOpen && <ReviewWindow />}`，开屏动效与刷新 effect 都依赖条件挂载。
 */
export function ReviewWindow() {
  const t = useT();
  const { cwd, reviewView, graphRefreshSeq, refreshIfStale } = useReviewStore();
  const { closeReviewWindow } = useUiStore();
  const [rect, setRect] = useState<WindowRect>(initialRect);
  const [branch, setBranch] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<PointerSession | null>(null);
  const resizeRef = useRef<PointerSession | null>(null);

  // 挂载即聚焦浮窗：Esc 关闭只认浮窗内焦点（对话框打开时焦点在弹窗里，Esc 归弹窗）
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // 打开/切视图时数据过期才后台刷新；不重复执行 git（docs/design/04 §19/§28）
  useEffect(() => {
    if (reviewView === "changes") refreshIfStale();
  }, [refreshIfStale, reviewView]);

  // 分支 chip：随会话目录与手动刷新更新；非 git 仓库时静默隐藏
  // biome-ignore lint/correctness/useExhaustiveDependencies: graphRefreshSeq 是「手动刷新」的触发信号，effect 内不读它
  useEffect(() => {
    if (!cwd) {
      setBranch(null);
      return;
    }
    let cancelled = false;
    gitService
      .branches(cwd)
      .then((result) => {
        if (!cancelled) setBranch(result.current);
      })
      .catch(() => {
        if (!cancelled) setBranch(null);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, graphRefreshSeq]);

  // 会话内位置/尺寸记忆
  useEffect(() => {
    persistedRect = rect;
  }, [rect]);

  // 视口变小（窗口缩放/侧栏拖宽）时把浮窗钳回可见范围
  useEffect(() => {
    const onResize = (): void => setRect((current) => fitViewport(current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Esc：仅当焦点在浮窗内时关闭，避免抢走 ConfirmDialog / Modal 的 Esc
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      // 焦点不在浮窗内（如 ConfirmDialog 打开时）就不响应，把 Esc 让给上层弹窗
      if (!panelRef.current?.contains(document.activeElement)) return;
      event.stopPropagation();
      closeReviewWindow();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeReviewWindow]);

  const startPointerSession = (
    event: ReactPointerEvent<HTMLElement>,
    origin: WindowRect,
  ): PointerSession | null => {
    if (event.button !== 0) return null;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    return {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin,
    };
  };

  const onHeaderPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    // 头部按钮/输入不参与拖拽
    if ((event.target as HTMLElement).closest("button, input, textarea")) return;
    dragRef.current = startPointerSession(event, rect);
  };

  const onHeaderPointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
    const session = dragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    setRect(
      fitViewport({
        left: session.origin.left + event.clientX - session.startX,
        top: session.origin.top + event.clientY - session.startY,
        width: session.origin.width,
        height: session.origin.height,
      }),
    );
  };

  const endDrag = (): void => {
    dragRef.current = null;
  };

  const onResizePointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    resizeRef.current = startPointerSession(event, rect);
  };

  const onResizePointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
    const session = resizeRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    setRect(
      fitViewport({
        left: session.origin.left,
        top: session.origin.top,
        width: session.origin.width + event.clientX - session.startX,
        height: session.origin.height + event.clientY - session.startY,
      }),
    );
  };

  const endResize = (): void => {
    resizeRef.current = null;
  };

  // 图谱面板元素按输入记忆化：拖拽/缩放触发的壳重渲染不牵动 SVG 图谱
  const graphPanel = useMemo(
    () => <GitGraphPanel cwd={cwd} refreshSeq={graphRefreshSeq} />,
    [cwd, graphRefreshSeq],
  );

  return createPortal(
    <div
      ref={panelRef}
      className={styles.window}
      role="dialog"
      aria-label={t("panels.review.windowTitle")}
      tabIndex={-1}
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      <header
        className={styles.header}
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span className={styles.title}>{t("panels.review.windowTitle")}</span>
        {branch && (
          <span className={styles.branchChip} title={branch}>
            <GitBranch size={12} weight="regular" />
            {branch}
          </span>
        )}
        <ReviewHeaderActions />
        <IconButton title={t("panels.review.closeWindow")} onClick={closeReviewWindow}>
          <X size={16} weight="regular" />
        </IconButton>
      </header>
      <div className={styles.body}>{reviewView === "graph" ? graphPanel : <ChangesPane />}</div>
      <div
        className={styles.resizeHandle}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={endResize}
        onPointerCancel={endResize}
      />
    </div>,
    document.body,
  );
}
