import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useT } from "../../../hooks/useT";
import {
  clampFilePanelRatio,
  FILE_PANEL_DEFAULT_RATIO,
  filePanelRatioBounds,
} from "../../../utils/filePanelSplit";
import styles from "./FilePanelLayout.module.css";

const DRAG_THRESHOLD = 4;
const KEYBOARD_STEP = 0.05;

interface ResizeSession {
  pointerId: number;
  target: HTMLDivElement;
  startX: number;
  startRatio: number;
  span: number;
  moved: boolean;
  cursor: string;
  userSelect: string;
}

interface FilePanelLayoutProps {
  split: boolean;
  showPreview: boolean;
  active: boolean;
  navigation: ReactNode;
  children: ReactNode;
}

/** 保留目录与预览的挂载位置，切换双栏时不重建编辑器或丢失目录展开状态。 */
export function FilePanelLayout({
  split,
  showPreview,
  active,
  navigation,
  children,
}: FilePanelLayoutProps) {
  const t = useT();
  const navigationId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const ratioRef = useRef(FILE_PANEL_DEFAULT_RATIO);
  const sessionRef = useRef<ResizeSession | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const [ratio, setRatio] = useState(FILE_PANEL_DEFAULT_RATIO);
  const [bounds, setBounds] = useState(() => filePanelRatioBounds(0));
  const [dragging, setDragging] = useState(false);

  const availableWidth = useCallback((): number => {
    return Math.max(
      0,
      (rootRef.current?.clientWidth ?? 0) - (dividerRef.current?.offsetWidth ?? 0),
    );
  }, []);

  const applyRatio = useCallback(
    (value: number): number => {
      const next = clampFilePanelRatio(value, availableWidth());
      ratioRef.current = next;
      if (rootRef.current) {
        rootRef.current.style.gridTemplateColumns = `${next}fr var(--file-panel-divider-width) ${1 - next}fr`;
      }
      // 拖拽帧只改几何与读屏数值，松手时才提交 React 状态。
      dividerRef.current?.setAttribute("aria-valuenow", String(Math.round(next * 100)));
      return next;
    },
    [availableWidth],
  );

  const finishResize = useCallback(
    (clientX: number | null, commit = true): void => {
      const session = sessionRef.current;
      sessionRef.current = null;
      detachRef.current?.();
      detachRef.current = null;
      if (!session) return;
      if (session.target.hasPointerCapture(session.pointerId)) {
        session.target.releasePointerCapture(session.pointerId);
      }
      if (!session.moved) return;
      document.body.style.cursor = session.cursor;
      document.body.style.userSelect = session.userSelect;
      if (!commit) return;
      const next =
        clientX === null
          ? ratioRef.current
          : applyRatio(session.startRatio + (clientX - session.startX) / session.span);
      setRatio(next);
      setDragging(false);
    },
    [applyRatio],
  );

  useLayoutEffect(() => {
    if (!split || !active) {
      finishResize(null);
      return;
    }
    const root = rootRef.current;
    if (!root) return;
    const resize = (): void => {
      if (availableWidth() <= 0) return;
      setBounds(filePanelRatioBounds(availableWidth()));
      setRatio(applyRatio(ratioRef.current));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(root);
    return () => observer.disconnect();
  }, [split, active, availableWidth, applyRatio, finishResize]);

  useEffect(() => () => finishResize(null, false), [finishResize]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    const span = availableWidth();
    if (event.button !== 0 || !split || !active || span <= 0) return;
    finishResize(null);
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    sessionRef.current = {
      pointerId: event.pointerId,
      target: event.currentTarget,
      startX: event.clientX,
      startRatio: ratioRef.current,
      span,
      moved: false,
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect,
    };
    const onUp = (upEvent: PointerEvent): void => {
      if (upEvent.pointerId === sessionRef.current?.pointerId) finishResize(upEvent.clientX);
    };
    const onCancel = (cancelEvent: PointerEvent): void => {
      if (cancelEvent.pointerId === sessionRef.current?.pointerId) finishResize(null);
    };
    const onBlur = (): void => finishResize(null);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onCancel, true);
    window.addEventListener("blur", onBlur);
    detachRef.current = () => {
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onCancel, true);
      window.removeEventListener("blur", onBlur);
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const session = sessionRef.current;
    if (!session || event.pointerId !== session.pointerId) return;
    const delta = event.clientX - session.startX;
    if (!session.moved) {
      if (Math.abs(delta) < DRAG_THRESHOLD) return;
      session.moved = true;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      setDragging(true);
    }
    applyRatio(session.startRatio + delta / session.span);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    let next: number;
    if (event.key === "ArrowLeft") next = ratioRef.current - KEYBOARD_STEP;
    else if (event.key === "ArrowRight") next = ratioRef.current + KEYBOARD_STEP;
    else if (event.key === "Home") next = bounds.min;
    else if (event.key === "End") next = bounds.max;
    else return;
    event.preventDefault();
    setRatio(applyRatio(next));
  };

  return (
    <div ref={rootRef} className={styles.layout} data-split={split}>
      <div id={navigationId} className={styles.pane} hidden={!split && showPreview}>
        {navigation}
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: 可调宽窗格分隔条是带数值的键盘交互控件，不是静态分隔线。 */}
      <div
        ref={dividerRef}
        className={styles.divider}
        hidden={!split}
        role="separator"
        tabIndex={0}
        aria-label={t("panels.files.resizePanes")}
        aria-orientation="vertical"
        aria-controls={navigationId}
        aria-valuemin={Math.round(bounds.min * 100)}
        aria-valuemax={Math.round(bounds.max * 100)}
        aria-valuenow={Math.round(ratio * 100)}
        title={t("panels.files.resizePanesHint")}
        data-dragging={dragging}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onLostPointerCapture={() => finishResize(null)}
        onKeyDown={onKeyDown}
        onDoubleClick={() => setRatio(applyRatio(FILE_PANEL_DEFAULT_RATIO))}
      />
      <div className={styles.pane} hidden={!split && !showPreview}>
        {children}
      </div>
    </div>
  );
}
