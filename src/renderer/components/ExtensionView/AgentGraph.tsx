import { CornersOut, Minus, Plus, Robot, TreeStructure } from "@phosphor-icons/react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ViewAgentNode } from "../../../shared/view";
import { useT } from "../../hooks/useT";
import { IconButton } from "../ui/IconButton";
import { AgentStatus } from "./AgentStatus";
import styles from "./AgentWorkspace.module.css";
import {
  AGENT_NODE_HEIGHT,
  AGENT_NODE_WIDTH,
  agentAncestry,
  layoutAgentGraph,
} from "./agentGraphLayout";

interface Props {
  agents: ViewAgentNode[];
  selectedId?: string;
  onSelect: (id: string) => void;
}

export function AgentGraph({ agents, selectedId, onSelect }: Props) {
  const t = useT();
  const viewportRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const layout = useMemo(
    () => layoutAgentGraph(agents, viewportSize.width),
    [agents, viewportSize.width],
  );
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const scaleRef = useRef(1);
  const originRef = useRef({ x: 0, y: 0 });
  const overviewRef = useRef(false);
  const [zoomPercent, setZoomPercent] = useState(100);
  const path = new Set(
    selectedId ? agentAncestry(agents, selectedId).map((agent) => agent.id) : [],
  );

  const applyScale = useCallback((scale: number): void => {
    const viewport = viewportRef.current;
    const surface = surfaceRef.current;
    const plane = planeRef.current;
    if (!viewport || !surface || !plane) return;
    const current = layoutRef.current;
    const width = current.width * scale;
    const height = current.height * scale;
    const origin = {
      x: Math.max(0, (viewport.clientWidth - width) / 2),
      y: Math.max(0, (viewport.clientHeight - height) / 2),
    };
    // Native scroll bounds must follow the scaled canvas, not its unscaled DOM dimensions.
    surface.style.width = `${Math.max(viewport.clientWidth, width)}px`;
    surface.style.height = `${Math.max(viewport.clientHeight, height)}px`;
    plane.style.transform = `translate(${origin.x}px, ${origin.y}px) scale(${scale})`;
    originRef.current = origin;
    scaleRef.current = scale;
    setZoomPercent(Math.round(scale * 100));
  }, []);

  const fitGraph = useCallback((): void => {
    const viewport = viewportRef.current;
    if (!viewport || viewport.clientWidth === 0 || viewport.clientHeight === 0) return;
    const current = layoutRef.current;
    applyScale(
      Math.max(
        0.05,
        Math.min(
          (viewport.clientWidth - 24) / current.width,
          (viewport.clientHeight - 24) / current.height,
          1,
        ),
      ),
    );
    viewport.scrollTo(0, 0);
    overviewRef.current = true;
  }, [applyScale]);

  const resetGraph = useCallback((): void => {
    overviewRef.current = false;
    applyScale(1);
    viewportRef.current?.scrollTo(0, 0);
  }, [applyScale]);

  const zoom = useCallback(
    (factor: number, x?: number, y?: number): void => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const scale = scaleRef.current;
      const next = Math.max(0.05, Math.min(2, scale * factor));
      const anchorX = x ?? viewport.clientWidth / 2;
      const anchorY = y ?? viewport.clientHeight / 2;
      const graphX = (viewport.scrollLeft + anchorX - originRef.current.x) / scale;
      const graphY = (viewport.scrollTop + anchorY - originRef.current.y) / scale;
      overviewRef.current = false;
      applyScale(next);
      viewport.scrollLeft = graphX * next + originRef.current.x - anchorX;
      viewport.scrollTop = graphY * next + originRef.current.y - anchorY;
    },
    [applyScale],
  );

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = (): void => {
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      setViewportSize((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  // Execution updates keep both the readable scale and the user's scroll position.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only canvas dimensions should refresh scroll bounds; status frames must not refit the overview
  useLayoutEffect(() => {
    if (!viewportSize.width || !viewportSize.height) return;
    if (overviewRef.current) fitGraph();
    else applyScale(scaleRef.current);
  }, [applyScale, fitGraph, layout.width, layout.height, viewportSize.width, viewportSize.height]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let drag: { id: number; x: number; y: number; left: number; top: number } | null = null;
    const wheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const bounds = viewport.getBoundingClientRect();
      zoom(
        Math.exp(-event.deltaY * 0.0015),
        event.clientX - bounds.left,
        event.clientY - bounds.top,
      );
    };
    const down = (event: PointerEvent): void => {
      if (event.button !== 0 || (event.target as Element).closest("button")) return;
      const bounds = viewport.getBoundingClientRect();
      if (
        event.clientX - bounds.left >= viewport.clientWidth ||
        event.clientY - bounds.top >= viewport.clientHeight
      )
        return;
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
      };
      event.preventDefault();
      viewport.setPointerCapture(event.pointerId);
      viewport.dataset.dragging = "true";
    };
    const move = (event: PointerEvent): void => {
      if (!drag || drag.id !== event.pointerId) return;
      overviewRef.current = false;
      viewport.scrollLeft = drag.left + drag.x - event.clientX;
      viewport.scrollTop = drag.top + drag.y - event.clientY;
    };
    const up = (event: PointerEvent): void => {
      if (drag?.id !== event.pointerId) return;
      drag = null;
      delete viewport.dataset.dragging;
    };
    viewport.addEventListener("wheel", wheel, { passive: false });
    viewport.addEventListener("pointerdown", down);
    viewport.addEventListener("pointermove", move);
    viewport.addEventListener("pointerup", up);
    viewport.addEventListener("pointercancel", up);
    viewport.addEventListener("lostpointercapture", up);
    return () => {
      viewport.removeEventListener("wheel", wheel);
      viewport.removeEventListener("pointerdown", down);
      viewport.removeEventListener("pointermove", move);
      viewport.removeEventListener("pointerup", up);
      viewport.removeEventListener("pointercancel", up);
      viewport.removeEventListener("lostpointercapture", up);
    };
  }, [zoom]);

  const revealAgent = useCallback((id: string): void => {
    const position = layoutRef.current.nodes.find((item) => item.agent.id === id);
    const viewport = viewportRef.current;
    if (!position || !viewport) return;
    const scale = scaleRef.current;
    const x = originRef.current.x + position.x * scale;
    const y = originRef.current.y + position.y * scale;
    if (x < viewport.scrollLeft) viewport.scrollLeft = x - 16;
    else if (x + AGENT_NODE_WIDTH * scale > viewport.scrollLeft + viewport.clientWidth)
      viewport.scrollLeft = x + AGENT_NODE_WIDTH * scale - viewport.clientWidth + 16;
    if (y < viewport.scrollTop) viewport.scrollTop = y - 16;
    else if (y + AGENT_NODE_HEIGHT * scale > viewport.scrollTop + viewport.clientHeight)
      viewport.scrollTop = y + AGENT_NODE_HEIGHT * scale - viewport.clientHeight + 16;
  }, []);

  useEffect(() => {
    if (selectedId && viewportSize.width) revealAgent(selectedId);
  }, [selectedId, viewportSize.width, revealAgent]);

  const navigate = (event: KeyboardEvent<HTMLButtonElement>, agent: ViewAgentNode): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    let target: ViewAgentNode | undefined;
    if (event.key === "Home") target = agents.find((item) => item.kind !== "main");
    if (event.key === "ArrowUp") target = agents.find((item) => item.id === agent.parentId);
    if (event.key === "ArrowDown") target = agents.find((item) => item.parentId === agent.id);
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const siblings = agents.filter((item) => item.parentId === agent.parentId);
      target = siblings[siblings.indexOf(agent) + (event.key === "ArrowLeft" ? -1 : 1)];
    }
    if (!["Home", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    if (!target || target.kind === "main") return;
    onSelect(target.id);
    buttonRefs.current.get(target.id)?.focus({ preventScroll: true });
  };

  return (
    <section className={styles.graphPanel} aria-label={t("agentWorkspace.graph")}>
      <div className={styles.panelHeading}>
        <TreeStructure size={16} weight="regular" />
        <span title={t("agentWorkspace.hint")}>{t("agentWorkspace.graph")}</span>
        <div className={styles.graphControls}>
          <IconButton title={t("agentWorkspace.zoomOut")} onClick={() => zoom(1 / 1.2)}>
            <Minus size={16} weight="regular" />
          </IconButton>
          <button
            type="button"
            className={styles.zoom}
            title={t("agentWorkspace.reset")}
            aria-label={t("agentWorkspace.reset")}
            onClick={resetGraph}
          >
            {zoomPercent}%
          </button>
          <IconButton title={t("agentWorkspace.zoomIn")} onClick={() => zoom(1.2)}>
            <Plus size={16} weight="regular" />
          </IconButton>
          <IconButton title={t("agentWorkspace.fit")} onClick={fitGraph}>
            <CornersOut size={16} weight="regular" />
          </IconButton>
        </div>
      </div>
      <div className={styles.viewport} ref={viewportRef} data-agent-graph="">
        <div className={styles.graphSurface} ref={surfaceRef}>
          <div
            ref={planeRef}
            className={styles.plane}
            style={{ width: layout.width, height: layout.height }}
          >
            <svg
              className={styles.connections}
              width={layout.width}
              height={layout.height}
              aria-hidden="true"
            >
              {layout.edges.map(({ child, points }) => (
                <path
                  key={child.agent.id}
                  className={[styles.edge, path.has(child.agent.id) ? styles.pathEdge : ""].join(
                    " ",
                  )}
                  data-state={child.agent.state}
                  d={points.map(({ x, y }, index) => `${index ? "L" : "M"} ${x} ${y}`).join(" ")}
                />
              ))}
            </svg>
            {layout.nodes.map(({ agent, x, y }) => {
              const isMain = agent.kind === "main";
              const label = `${agent.label}, ${agent.description}, ${agent.stateLabel ?? t(`agentWorkspace.${agent.state === "error" ? "failed" : agent.state}`)}`;
              const content = (
                <>
                  <span className={styles.nodeTop}>
                    <span className={styles.nodeIcon}>
                      {isMain ? (
                        <TreeStructure size={16} weight="regular" />
                      ) : (
                        <Robot size={16} weight="regular" />
                      )}
                    </span>
                    <span className={styles.nodeLabel} title={agent.label}>
                      {agent.label}
                    </span>
                  </span>
                  <span className={styles.nodeDescription} title={agent.description}>
                    {agent.description}
                  </span>
                  <span className={styles.nodeBottom}>
                    <AgentStatus state={agent.state} label={agent.stateLabel} />
                    <span title={agent.meta?.join(" · ")}>{agent.meta?.[0]}</span>
                  </span>
                  {agent.state === "running" ? (
                    <span className={styles.activity} aria-hidden="true" />
                  ) : null}
                </>
              );
              const commonProps = {
                className: styles.agentNode,
                "data-agent-id": agent.id,
                "data-agent-kind": agent.kind ?? "agent",
                "data-agent-state": agent.state,
                style: { left: x, top: y, width: AGENT_NODE_WIDTH, height: AGENT_NODE_HEIGHT },
              };
              return isMain ? (
                <div key={agent.id} {...commonProps}>
                  {content}
                </div>
              ) : (
                <button
                  key={agent.id}
                  type="button"
                  {...commonProps}
                  aria-label={label}
                  aria-pressed={agent.id === selectedId}
                  ref={(element) => {
                    if (element) buttonRefs.current.set(agent.id, element);
                    else buttonRefs.current.delete(agent.id);
                  }}
                  onClick={() => onSelect(agent.id)}
                  onFocus={() => revealAgent(agent.id)}
                  onKeyDown={(event) => navigate(event, agent)}
                >
                  {content}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className={styles.graphFooter}>{t("agentWorkspace.gestures")}</div>
    </section>
  );
}
