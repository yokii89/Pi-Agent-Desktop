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

interface Camera {
  x: number;
  y: number;
  scale: number;
}
interface Props {
  agents: ViewAgentNode[];
  selectedId?: string;
  onSelect: (id: string) => void;
}

export function AgentGraph({ agents, selectedId, onSelect }: Props) {
  const t = useT();
  const viewportRef = useRef<HTMLDivElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const layout = useMemo(() => layoutAgentGraph(agents), [agents]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const cameraRef = useRef<Camera>({ x: 0, y: 0, scale: 1 });
  const fittedRef = useRef(true);
  const [zoomPercent, setZoomPercent] = useState(100);
  const path = new Set(
    selectedId ? agentAncestry(agents, selectedId).map((agent) => agent.id) : [],
  );

  const applyCamera = useCallback((camera: Camera): void => {
    cameraRef.current = camera;
    if (planeRef.current)
      planeRef.current.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
    setZoomPercent(Math.round(camera.scale * 100));
  }, []);

  const fitGraph = useCallback((): void => {
    const viewport = viewportRef.current;
    if (!viewport || viewport.clientWidth === 0 || viewport.clientHeight === 0) return;
    const current = layoutRef.current;
    const scale = Math.max(
      0.05,
      Math.min(
        (viewport.clientWidth - 24) / current.width,
        (viewport.clientHeight - 64) / current.height,
        1.1,
      ),
    );
    applyCamera({
      x: (viewport.clientWidth - current.width * scale) / 2,
      y: (viewport.clientHeight - current.height * scale) / 2,
      scale,
    });
    fittedRef.current = true;
  }, [applyCamera]);

  const zoom = useCallback(
    (factor: number, x?: number, y?: number): void => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const camera = cameraRef.current;
      const next = Math.max(0.05, Math.min(2, camera.scale * factor));
      const anchorX = x ?? viewport.clientWidth / 2;
      const anchorY = y ?? viewport.clientHeight / 2;
      applyCamera({
        x: anchorX - ((anchorX - camera.x) * next) / camera.scale,
        y: anchorY - ((anchorY - camera.y) * next) / camera.scale,
        scale: next,
      });
      fittedRef.current = false;
    },
    [applyCamera],
  );

  // Status/stream frames must not reset a user's pan. Refit only when graph identity changes.
  const layoutKey = layout.nodes
    .map(({ agent }) => `${agent.id}:${agent.parentId ?? ""}`)
    .join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: only structural graph changes should trigger refitting
  useLayoutEffect(() => {
    if (fittedRef.current) fitGraph();
  }, [fitGraph, layoutKey]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let drag: { id: number; x: number; y: number } | null = null;
    const observer = new ResizeObserver(() => {
      if (fittedRef.current) fitGraph();
    });
    observer.observe(viewport);
    const wheel = (event: WheelEvent): void => {
      if ((event.target as Element).closest("button")) return;
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
      drag = {
        id: event.pointerId,
        x: event.clientX - cameraRef.current.x,
        y: event.clientY - cameraRef.current.y,
      };
      viewport.setPointerCapture(event.pointerId);
      viewport.dataset.dragging = "true";
    };
    const move = (event: PointerEvent): void => {
      if (!drag || drag.id !== event.pointerId) return;
      fittedRef.current = false;
      applyCamera({ ...cameraRef.current, x: event.clientX - drag.x, y: event.clientY - drag.y });
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
      observer.disconnect();
      viewport.removeEventListener("wheel", wheel);
      viewport.removeEventListener("pointerdown", down);
      viewport.removeEventListener("pointermove", move);
      viewport.removeEventListener("pointerup", up);
      viewport.removeEventListener("pointercancel", up);
      viewport.removeEventListener("lostpointercapture", up);
    };
  }, [fitGraph, zoom, applyCamera]);

  const navigate = (event: KeyboardEvent<HTMLButtonElement>, agent: ViewAgentNode): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    let target: ViewAgentNode | undefined;
    if (event.key === "Home") target = agents.find((item) => item.kind === "main") ?? agents[0];
    if (event.key === "ArrowUp") target = agents.find((item) => item.id === agent.parentId);
    if (event.key === "ArrowDown") target = agents.find((item) => item.parentId === agent.id);
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const siblings = agents.filter((item) => item.parentId === agent.parentId);
      target = siblings[siblings.indexOf(agent) + (event.key === "ArrowLeft" ? -1 : 1)];
    }
    if (!["Home", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    if (!target) return;
    onSelect(target.id);
    buttonRefs.current.get(target.id)?.focus({ preventScroll: true });
    const position = layout.nodes.find((item) => item.agent.id === target.id);
    const viewport = viewportRef.current;
    if (!position || !viewport) return;
    const camera = cameraRef.current;
    const x = camera.x + position.x * camera.scale;
    const y = camera.y + position.y * camera.scale;
    if (
      x < 0 ||
      y < 0 ||
      x + AGENT_NODE_WIDTH * camera.scale > viewport.clientWidth ||
      y + AGENT_NODE_HEIGHT * camera.scale > viewport.clientHeight
    ) {
      fittedRef.current = false;
      applyCamera({
        ...camera,
        x: viewport.clientWidth / 2 - (position.x + AGENT_NODE_WIDTH / 2) * camera.scale,
        y: viewport.clientHeight / 2 - (position.y + AGENT_NODE_HEIGHT / 2) * camera.scale,
      });
    }
  };

  return (
    <section className={styles.graphPanel} aria-label={t("agentWorkspace.graph")}>
      <div className={styles.panelHeading}>
        <TreeStructure size={16} weight="regular" />
        <span>{t("agentWorkspace.graph")}</span>
      </div>
      <div className={styles.viewport} ref={viewportRef} data-agent-graph="">
        <div className={styles.canvasHint}>{t("agentWorkspace.hint")}</div>
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
            {layout.edges.map(({ parent, child }) => {
              const x1 = parent.x + AGENT_NODE_WIDTH / 2;
              const y1 = parent.y + AGENT_NODE_HEIGHT;
              const x2 = child.x + AGENT_NODE_WIDTH / 2;
              const y2 = child.y;
              const mid = (y1 + y2) / 2;
              return (
                <path
                  key={child.agent.id}
                  className={[styles.edge, path.has(child.agent.id) ? styles.pathEdge : ""].join(
                    " ",
                  )}
                  data-state={child.agent.state}
                  d={`M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`}
                />
              );
            })}
          </svg>
          {layout.nodes.map(({ agent, x, y }) => (
            <button
              key={agent.id}
              type="button"
              className={styles.agentNode}
              data-agent-id={agent.id}
              data-agent-state={agent.state}
              aria-pressed={agent.id === selectedId}
              aria-label={`${agent.label}, ${agent.description}, ${agent.stateLabel ?? t(`agentWorkspace.${agent.state === "error" ? "failed" : agent.state}`)}`}
              style={{ left: x, top: y, width: AGENT_NODE_WIDTH, height: AGENT_NODE_HEIGHT }}
              ref={(element) => {
                if (element) buttonRefs.current.set(agent.id, element);
                else buttonRefs.current.delete(agent.id);
              }}
              onClick={() => onSelect(agent.id)}
              onKeyDown={(event) => navigate(event, agent)}
            >
              <span className={styles.nodeTop}>
                <span className={styles.nodeIcon}>
                  {agent.kind === "main" ? (
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
            </button>
          ))}
        </div>
        <div className={styles.graphControls}>
          <IconButton title={t("agentWorkspace.zoomOut")} onClick={() => zoom(1 / 1.2)}>
            <Minus size={16} weight="regular" />
          </IconButton>
          <output className={styles.zoom}>{zoomPercent}%</output>
          <IconButton title={t("agentWorkspace.zoomIn")} onClick={() => zoom(1.2)}>
            <Plus size={16} weight="regular" />
          </IconButton>
          <IconButton title={t("agentWorkspace.fit")} onClick={fitGraph}>
            <CornersOut size={16} weight="regular" />
          </IconButton>
        </div>
      </div>
      <div className={styles.graphFooter}>{t("agentWorkspace.gestures")}</div>
    </section>
  );
}
