import { type ReactNode, useId, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../../hooks/useT";
import styles from "./AgentWorkspaceSplit.module.css";
import {
  type AgentWorkspaceSplitMemory,
  DEFAULT_AGENT_WORKSPACE_SPLIT,
} from "./agentWorkspaceMemory";

type SplitAxis = "columns" | "rows";

const MIN_SIZES = {
  columns: { graph: 300, detail: 320 },
  rows: { graph: 190, detail: 260 },
};
const DRAG_THRESHOLD = 4;

interface SplitGeometry {
  axis: SplitAxis;
  available: number;
  gutter: number;
  min: number;
  max: number;
  ratio: number;
}

interface DragSession {
  id: number;
  start: number;
  ratio: number;
  geometry: SplitGeometry;
  moved: boolean;
  cursor: string;
  userSelect: string;
}

/** Retain separate graph/detail proportions across the docked and expanded workspace. */
export function AgentWorkspaceSplit({
  graph,
  detail,
  memory,
}: {
  graph: ReactNode;
  detail: ReactNode;
  memory: AgentWorkspaceSplitMemory;
}) {
  const t = useT();
  const graphId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState<SplitGeometry>({
    axis: "rows",
    available: 0,
    gutter: 0,
    min: 0,
    max: 1,
    ratio: DEFAULT_AGENT_WORKSPACE_SPLIT.rows,
  });

  useLayoutEffect(() => {
    const root = rootRef.current;
    const handle = handleRef.current;
    if (!root || !handle) return;
    let current: SplitGeometry | null = null;
    let drag: DragSession | null = null;

    const syncAria = (next: SplitGeometry): void => {
      const graphPercent = Math.round(next.ratio * 100);
      handle.setAttribute("aria-orientation", next.axis === "columns" ? "vertical" : "horizontal");
      handle.setAttribute("aria-valuemin", String(Math.round(next.min * 100)));
      handle.setAttribute("aria-valuemax", String(Math.round(next.max * 100)));
      handle.setAttribute("aria-valuenow", String(graphPercent));
      handle.setAttribute(
        "aria-valuetext",
        t("agentWorkspace.splitValue", { graph: graphPercent, detail: 100 - graphPercent }),
      );
    };

    const apply = (ratio: number): void => {
      if (!current) return;
      current = { ...current, ratio: Math.max(current.min, Math.min(current.max, ratio)) };
      const tracks = `${current.available * current.ratio}px ${current.gutter}px minmax(0, 1fr)`;
      // Write the grid property directly so dragging does not invalidate inherited styles in either pane.
      if (current.axis === "columns") {
        root.style.gridTemplateColumns = tracks;
        root.style.gridTemplateRows = "minmax(0, 1fr)";
      } else {
        root.style.gridTemplateColumns = "minmax(0, 1fr)";
        root.style.gridTemplateRows = tracks;
      }
      syncAria(current);
    };

    const finish = (publish = true): void => {
      const session = drag;
      if (!session) return;
      drag = null;
      delete handle.dataset.dragging;
      if (session.moved) {
        document.body.style.cursor = session.cursor;
        document.body.style.userSelect = session.userSelect;
        if (current) memory[session.geometry.axis] = current.ratio;
      }
      if (handle.hasPointerCapture(session.id)) handle.releasePointerCapture(session.id);
      if (publish && current) setGeometry(current);
    };

    const measure = (): void => {
      // The container query remains the single source of truth for the layout breakpoint.
      const axis: SplitAxis =
        getComputedStyle(root).getPropertyValue("--agent-workspace-split-axis").trim() === "columns"
          ? "columns"
          : "rows";
      finish();
      if (current?.axis !== axis) {
        root.style.removeProperty("grid-template-columns");
        root.style.removeProperty("grid-template-rows");
      }
      const extent = axis === "columns" ? root.clientWidth : root.clientHeight;
      const gutter = axis === "columns" ? handle.offsetWidth : handle.offsetHeight;
      const available = Math.max(0, extent - gutter);
      if (!available) return;
      const minimum = MIN_SIZES[axis];
      const constrained = available < minimum.graph + minimum.detail;
      const min = constrained
        ? minimum.graph / (minimum.graph + minimum.detail)
        : minimum.graph / available;
      const max = constrained ? min : 1 - minimum.detail / available;
      current = { axis, available, gutter, min, max, ratio: memory[axis] };
      apply(memory[axis]);
      if (current) setGeometry(current);
    };

    const down = (event: PointerEvent): void => {
      if (event.button !== 0 || drag || !current || current.min === current.max) return;
      event.preventDefault();
      handle.focus({ preventScroll: true });
      handle.setPointerCapture(event.pointerId);
      drag = {
        id: event.pointerId,
        start: current.axis === "columns" ? event.clientX : event.clientY,
        ratio: current.ratio,
        geometry: current,
        moved: false,
        cursor: document.body.style.cursor,
        userSelect: document.body.style.userSelect,
      };
    };

    const move = (event: PointerEvent): void => {
      if (!drag || event.pointerId !== drag.id) return;
      const position = drag.geometry.axis === "columns" ? event.clientX : event.clientY;
      const delta = position - drag.start;
      if (!drag.moved) {
        if (Math.abs(delta) < DRAG_THRESHOLD) return;
        drag.moved = true;
        handle.dataset.dragging = "true";
        document.body.style.cursor = drag.geometry.axis === "columns" ? "col-resize" : "row-resize";
        document.body.style.userSelect = "none";
      }
      apply(drag.ratio + delta / drag.geometry.available);
    };

    const up = (event: PointerEvent): void => {
      if (event.pointerId !== drag?.id) return;
      move(event);
      finish();
    };
    const cancel = (event: PointerEvent): void => {
      if (event.pointerId === drag?.id) finish();
    };
    const blur = (): void => finish();
    const reset = (): void => {
      if (!current) return;
      finish();
      memory[current.axis] = DEFAULT_AGENT_WORKSPACE_SPLIT[current.axis];
      apply(memory[current.axis]);
      if (current) setGeometry(current);
    };
    const keydown = (event: KeyboardEvent): void => {
      if (!current || event.altKey || event.ctrlKey || event.metaKey) return;
      const previous = current.axis === "columns" ? "ArrowLeft" : "ArrowUp";
      const next = current.axis === "columns" ? "ArrowRight" : "ArrowDown";
      if (![previous, next, "Home", "End", "Enter"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      finish();
      if (event.key === "Enter") {
        reset();
        return;
      }
      const step = event.shiftKey ? 0.1 : 0.02;
      const ratio =
        event.key === "Home"
          ? current.min
          : event.key === "End"
            ? current.max
            : current.ratio + (event.key === previous ? -step : step);
      apply(ratio);
      if (current) {
        memory[current.axis] = current.ratio;
        setGeometry(current);
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    handle.addEventListener("pointerdown", down);
    handle.addEventListener("lostpointercapture", cancel);
    handle.addEventListener("dblclick", reset);
    handle.addEventListener("keydown", keydown);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("blur", blur);
    return () => {
      observer.disconnect();
      handle.removeEventListener("pointerdown", down);
      handle.removeEventListener("lostpointercapture", cancel);
      handle.removeEventListener("dblclick", reset);
      handle.removeEventListener("keydown", keydown);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("blur", blur);
      finish(false);
    };
  }, [memory, t]);

  const graphPercent = Math.round(geometry.ratio * 100);
  return (
    <div ref={rootRef} className={styles.split} data-agent-workspace-split="">
      <div id={graphId} className={styles.pane}>
        {graph}
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: focusable window splitters expose adjustable separator values */}
      <div
        ref={handleRef}
        className={styles.handle}
        role="separator"
        tabIndex={0}
        aria-label={t("agentWorkspace.resize")}
        aria-controls={graphId}
        aria-orientation={geometry.axis === "columns" ? "vertical" : "horizontal"}
        aria-valuemin={Math.round(geometry.min * 100)}
        aria-valuemax={Math.round(geometry.max * 100)}
        aria-valuenow={graphPercent}
        aria-valuetext={t("agentWorkspace.splitValue", {
          graph: graphPercent,
          detail: 100 - graphPercent,
        })}
        title={t("agentWorkspace.resizeHint")}
      />
      <div className={styles.pane}>{detail}</div>
    </div>
  );
}
