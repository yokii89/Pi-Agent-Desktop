import { type PointerEvent as ReactPointerEvent, useCallback, useRef, useState } from "react";
import { useT } from "../../../../hooks/useT";
import type { RegionCaptureSession } from "../../../../stores/browserStore";
import { useBrowserStore } from "../../../../stores/browserStore";
import styles from "./RegionCaptureOverlay.module.css";

interface Point {
  x: number;
  y: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/**
 * 区域截图选区层：宿主区内覆盖冻结帧，拖拽框选后裁剪入托盘。
 * 页面原生视图此时已被抑制，这里才能接收到鼠标事件。
 */
export function RegionCaptureOverlay({ session }: { session: RegionCaptureSession }) {
  const t = useT();
  const store = useBrowserStore();
  const rootRef = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState<Point | null>(null);
  const [current, setCurrent] = useState<Point | null>(null);
  const dragging = start !== null && current !== null;
  const rect = dragging ? normalizeRect(start, current) : null;

  const toLocal = useCallback((event: ReactPointerEvent): Point | null => {
    const root = rootRef.current;
    if (!root) return null;
    const box = root.getBoundingClientRect();
    return {
      x: Math.min(Math.max(event.clientX - box.left, 0), box.width),
      y: Math.min(Math.max(event.clientY - box.top, 0), box.height),
    };
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toLocal(event);
    if (!point) return;
    setStart(point);
    setCurrent(point);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!start) return;
    const point = toLocal(event);
    if (point) setCurrent(point);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!start) return;
    const point = toLocal(event) ?? current;
    setStart(null);
    setCurrent(null);
    if (!point) return;
    const next = normalizeRect(start, point);
    if (next.width < 2 || next.height < 2) return;
    void store.confirmRegionCapture(next);
  };

  return (
    <div
      ref={rootRef}
      className={styles.overlay}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        setStart(null);
        setCurrent(null);
      }}
    >
      <img
        className={styles.frame}
        src={`data:image/png;base64,${session.base64}`}
        alt=""
        draggable={false}
      />
      <div className={styles.hint}>{t("browser.region.hint")}</div>
      {rect && rect.width > 0 && rect.height > 0 && (
        <div
          className={styles.selection}
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
          }}
        >
          <span className={styles.selectionSize}>
            {Math.round(rect.width)}×{Math.round(rect.height)}
          </span>
        </div>
      )}
    </div>
  );
}
