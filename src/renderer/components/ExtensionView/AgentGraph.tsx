import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CornersOut,
  Crosshair,
  GitBranch,
  ListBullets,
  Minus,
  Play,
  Plus,
  TreeStructure,
  WarningCircle,
} from "@phosphor-icons/react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ViewAgentNode } from "../../../shared/view";
import { useT } from "../../hooks/useT";
import { IconButton } from "../ui/IconButton";
import { Segmented } from "../ui/Segmented";
import styles from "./AgentGraph.module.css";
import { AgentGraphCard } from "./AgentGraphCard";
import { AgentGraphConnectionSignal, useAgentGraphSignals } from "./AgentGraphConnection";
import workspaceStyles from "./AgentWorkspace.module.css";
import {
  AGENT_COLUMN,
  AGENT_NODE_WIDTH,
  AGENT_PADDING,
  type AgentGraphFilter,
  type AgentGraphPosition,
  agentAncestry,
  agentDescendants,
  layoutAgentGraph,
  matchesAgentFilter,
} from "./agentGraphLayout";
import { type AgentGraphReveals, reconcileAgentGraphBranches } from "./agentGraphState";
import { agentGraphZoomPercent } from "./agentGraphViewportGeometry";
import { useAgentGraphLayoutMotion } from "./useAgentGraphLayoutMotion";
import { useAgentGraphViewport } from "./useAgentGraphViewport";

interface Props {
  agents: ViewAgentNode[];
  selectedId?: string;
  onSelect: (id: string) => void;
}

/** Host presentation stays local; task selection uses the existing View change contract. */
export function AgentGraph({ agents, selectedId, onSelect }: Props) {
  const t = useT();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<AgentGraphFilter>("all");
  const [compact, setCompact] = useState(agents.length > 13);
  const [traceOnly, setTraceOnly] = useState(false);
  const [locateTick, setLocateTick] = useState(0);
  const centerNext = useRef(false);
  const focusNext = useRef(false);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const layout = useMemo(
    () => layoutAgentGraph(agents, { collapsed, compact, filter }),
    [agents, collapsed, compact, filter],
  );
  const view = useAgentGraphViewport(layout.width, layout.height);
  const { viewport, surface, plane, ruler, bounds, measure, reveal } = view;
  const path = useMemo(
    () => (selectedId ? agentAncestry(agents, selectedId) : []),
    [agents, selectedId],
  );
  const pathIds = new Set(path.map((agent) => agent.id));
  const hasSelection = path.length > 0 && path[path.length - 1].kind !== "main";
  const focusBranch = traceOnly && hasSelection;
  const tasks = agents.filter((agent) => agent.kind !== "main");
  const running = tasks.filter((agent) => matchesAgentFilter(agent, "running"));
  const attention = tasks.filter((agent) => matchesAgentFilter(agent, "attention"));
  const completed = tasks.filter((agent) => agent.state === "completed").length;
  const height = Math.max(layout.height, bounds.height);
  const nodes = layout.nodes.map((node) =>
    node.agent.kind === "main" &&
    layout.nodes.filter((other) => other.depth === node.depth).length === 1
      ? {
          ...node,
          y: Math.max(
            AGENT_PADDING,
            Math.min(
              height - node.height - AGENT_PADDING,
              bounds.top + (bounds.height - node.height) / 2,
            ),
          ),
        }
      : node,
  );
  const byId = new Map(nodes.map((node) => [node.agent.id, node]));
  const layoutKey = [
    compact,
    filter,
    ...layout.nodes.map((node) => `${node.agent.id}:${node.x}:${node.y}:${node.height}`),
  ].join("|");
  useAgentGraphLayoutMotion(plane, layoutKey);
  const { signals, complete } = useAgentGraphSignals(agents);

  const previousReveals = useRef<AgentGraphReveals>(new Map());
  useEffect(() => {
    const next = reconcileAgentGraphBranches(
      agents,
      collapsed,
      filter,
      selectedId,
      previousReveals.current,
    );
    previousReveals.current = next.reveals;
    if (next.collapsed !== collapsed) setCollapsed(next.collapsed);
  }, [agents, collapsed, filter, selectedId]);
  useEffect(() => {
    if (hasSelection) return;
    setTraceOnly(false);
    centerNext.current = false;
    focusNext.current = false;
  }, [hasSelection]);
  const previousSelection = useRef(selectedId);
  useEffect(() => {
    if (previousSelection.current === selectedId) return;
    previousSelection.current = selectedId;
    const selected = agents.find((agent) => agent.id === selectedId);
    if (selected && !layout.visibleIds.has(selected.id)) setFilter("all");
  }, [agents, selectedId, layout.visibleIds]);

  const select = (id: string, center = false): void => {
    const agent = agents.find((item) => item.id === id);
    if (!agent || agent.kind === "main") return;
    if (!layout.visibleIds.has(agent.id)) setFilter("all");
    const ancestors = agentAncestry(agents, id).slice(0, -1);
    setCollapsed((previous) => {
      const next = new Set(previous);
      for (const ancestor of ancestors) next.delete(ancestor.id);
      return next.size === previous.size ? previous : next;
    });
    centerNext.current = center;
    focusNext.current = true;
    setLocateTick((value) => value + 1);
    onSelect(id);
  };
  const locate = (targets: ViewAgentNode[]): void => {
    if (!targets.length) return;
    const index = targets.findIndex((agent) => agent.id === selectedId);
    const target = targets[(index + 1) % targets.length];
    if (!matchesAgentFilter(target, filter)) setFilter("all");
    select(target.id, true);
  };
  const navigate = (event: KeyboardEvent<HTMLButtonElement>, node: AgentGraphPosition): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const siblings = nodes
      .filter((other) => other.depth === node.depth && other.agent.kind !== "main")
      .sort((a, b) => a.y - b.y);
    const index = siblings.indexOf(node);
    let target: ViewAgentNode | undefined;
    if (event.key === "ArrowUp") target = siblings[index - 1]?.agent;
    else if (event.key === "ArrowDown") target = siblings[index + 1]?.agent;
    else if (event.key === "ArrowLeft")
      target = byId.get(layout.parents.get(node.agent.id) ?? "")?.agent;
    else if (event.key === "ArrowRight")
      target = layout.children.get(node.agent.id)?.find((child) => layout.visibleIds.has(child.id));
    else if (event.key === "Home")
      target = nodes.find((other) => other.agent.kind !== "main")?.agent;
    else if (event.key === "End")
      target = [...nodes].reverse().find((other) => other.agent.kind !== "main")?.agent;
    else return;
    event.preventDefault();
    if (target?.kind !== "main" && target) select(target.id);
  };
  const selectedPosition = layout.nodes.find((node) => node.agent.id === selectedId);
  const selectedX = selectedPosition?.x;
  const selectedY = selectedPosition?.y;
  const selectedHeight = selectedPosition?.height;
  // Scroll requests depend on final layout coordinates, never a tween's intermediate rectangle.
  // biome-ignore lint/correctness/useExhaustiveDependencies: locateTick intentionally repeats a request at unchanged coordinates.
  useEffect(() => {
    if (selectedX === undefined || selectedY === undefined || !selectedHeight || !selectedId)
      return;
    const frame = requestAnimationFrame(() => {
      reveal({ x: selectedX, y: selectedY, height: selectedHeight }, centerNext.current);
      centerNext.current = false;
      if (focusNext.current) buttons.current.get(selectedId)?.focus({ preventScroll: true });
      focusNext.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [
    selectedId,
    selectedX,
    selectedY,
    selectedHeight,
    locateTick,
    reveal,
    bounds.paneWidth,
    bounds.paneHeight,
  ]);

  return (
    <section
      className={`${workspaceStyles.graphPanel} ${styles.hierarchyCanvas}`}
      data-compact={compact}
      data-selectable-text=""
      aria-label={t("agentWorkspace.graph")}
    >
      <div className={`${workspaceStyles.panelHeading} ${styles.graphHeading}`}>
        <TreeStructure size={16} />
        <span title={t("agentWorkspace.hint")}>{t("agentWorkspace.graph")}</span>
        <div className={styles.graphControls}>
          <IconButton title={t("agentWorkspace.zoomOut")} onClick={() => view.zoom(1 / 1.2)}>
            <Minus size={16} />
          </IconButton>
          <button
            type="button"
            className={styles.zoom}
            title={t("agentWorkspace.reset")}
            aria-label={t("agentWorkspace.reset")}
            onClick={view.reset}
          >
            {agentGraphZoomPercent(bounds.scale)}%
          </button>
          <IconButton title={t("agentWorkspace.zoomIn")} onClick={() => view.zoom(1.2)}>
            <Plus size={16} />
          </IconButton>
          <IconButton title={t("agentWorkspace.fit")} onClick={view.fitGraph}>
            <CornersOut size={16} />
          </IconButton>
        </div>
      </div>
      <div className={styles.graphSummary}>
        <span>{t("agentWorkspace.activeCount", { count: running.length })}</span>
        <span>
          {t("agentWorkspace.completionCount", { done: completed, total: tasks.length })}
          <span className={styles.completionTrack} aria-hidden="true">
            <span style={{ width: `${tasks.length ? (completed / tasks.length) * 100 : 0}%` }} />
          </span>
        </span>
      </div>
      <div className={styles.canvasTools}>
        <Segmented<AgentGraphFilter>
          ariaLabel={t("agentWorkspace.filter")}
          value={filter}
          items={(["all", "running", "attention"] as const).map((value) => ({
            value,
            label: t(`agentWorkspace.filter.${value}`),
          }))}
          onChange={setFilter}
          semantics="radio"
          size="sm"
          equal={false}
        />
        <button
          type="button"
          className={styles.canvasTool}
          data-action="compact"
          aria-pressed={compact}
          onClick={() => setCompact(!compact)}
        >
          <ListBullets size={16} />
          {t("agentWorkspace.compact")}
        </button>
        <button
          type="button"
          className={`${styles.canvasTool} ${styles.canvasSmallTrace}`}
          title={t("agentWorkspace.focusBranch")}
          aria-label={t("agentWorkspace.focusBranch")}
          aria-pressed={focusBranch}
          disabled={!hasSelection}
          onClick={() => setTraceOnly(!traceOnly)}
        >
          <GitBranch size={16} />
        </button>
        <div className={styles.canvasLocators}>
          <button
            type="button"
            className={styles.canvasTool}
            data-action="locate-running"
            disabled={!running.length}
            title={t("agentWorkspace.nextRunning")}
            onClick={() => locate(running)}
          >
            <Play size={16} />
            {t("agentWorkspace.locateRunning")}
            <span>{running.length}</span>
          </button>
          <button
            type="button"
            className={styles.canvasTool}
            data-action="locate-attention"
            disabled={!attention.length}
            title={t("agentWorkspace.nextAttention")}
            onClick={() => locate(attention)}
          >
            <WarningCircle size={16} />
            {t("agentWorkspace.locateAttention")}
            <span>{attention.length}</span>
          </button>
          <IconButton
            title={t("agentWorkspace.locateSelected")}
            disabled={!hasSelection}
            onClick={() => {
              if (selectedId) select(selectedId, true);
            }}
          >
            <Crosshair size={16} />
          </IconButton>
        </div>
      </div>
      <div className={styles.canvasRuler} ref={ruler}>
        <div
          className={styles.canvasRulerInner}
          style={{ width: Math.max(layout.width * bounds.scale, bounds.width) }}
        >
          {Array.from({ length: layout.maxDepth + 1 }, (_, depth) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: depth identifies a fixed delegation column.
              key={depth}
              className={styles.canvasLevel}
              style={{
                width: AGENT_NODE_WIDTH * bounds.scale,
                left: bounds.origin + (AGENT_PADDING + depth * AGENT_COLUMN) * bounds.scale,
              }}
            >
              <span className={styles.canvasLevelNumber}>{String(depth).padStart(2, "0")}</span>
              <span>
                {t(
                  depth === 0
                    ? "agentWorkspace.coordination"
                    : depth === 1
                      ? "agentWorkspace.delegation"
                      : "agentWorkspace.subdelegation",
                )}
              </span>
              <span className={styles.canvasLevelCount}>
                {nodes.filter((node) => node.depth === depth).length}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div
        className={styles.canvasViewport}
        ref={viewport}
        onScroll={measure}
        data-agent-graph=""
        title={t("agentWorkspace.gestures")}
      >
        {!layout.matches ? (
          <div className={styles.canvasEmpty} role="status">
            <WarningCircle size={24} />
            <strong>{t(tasks.length ? "agentWorkspace.noMatches" : "agentWorkspace.empty")}</strong>
            {filter !== "all" ? (
              <button type="button" onClick={() => setFilter("all")}>
                {t("agentWorkspace.showAll")}
              </button>
            ) : null}
          </div>
        ) : null}
        <div className={styles.canvasSurface} ref={surface}>
          <div
            className={styles.canvasPlane}
            ref={plane}
            style={{ width: layout.width, height }}
            data-trace-only={focusBranch}
          >
            {Array.from({ length: layout.maxDepth + 1 }, (_, depth) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: depth identifies a fixed delegation lane.
                key={depth}
                className={styles.canvasLane}
                style={{
                  left: AGENT_PADDING + depth * AGENT_COLUMN - 12,
                  width: AGENT_NODE_WIDTH + 24,
                }}
              />
            ))}
            {nodes.map((node) => {
              const parent = byId.get(layout.parents.get(node.agent.id) ?? "");
              if (!parent) return null;
              const startX = parent.x + AGENT_NODE_WIDTH;
              const startY = parent.y + parent.height / 2;
              const endY = node.y + node.height / 2;
              const half = (AGENT_COLUMN - AGENT_NODE_WIDTH) / 2;
              const middle = startX + half;
              const onPath = pathIds.has(node.agent.id) && pathIds.has(parent.agent.id);
              const signalPath = `path("M ${startX} ${startY} H ${middle} V ${endY} H ${node.x}")`;
              return (
                <div
                  key={node.agent.id}
                  className={styles.canvasConnection}
                  data-traced={onPath}
                  aria-hidden="true"
                >
                  <span
                    className={styles.wireStart}
                    data-layout-key={`${node.agent.id}:start`}
                    data-layout-wire="true"
                    style={{ left: startX, top: startY, width: half, height: 1 }}
                  />
                  <span
                    className={styles.wireTurn}
                    data-layout-key={`${node.agent.id}:turn`}
                    data-layout-wire="true"
                    style={{
                      left: middle,
                      top: Math.min(startY, endY),
                      width: 1,
                      height: Math.abs(endY - startY),
                    }}
                  />
                  <span
                    className={styles.wireEnd}
                    data-layout-key={`${node.agent.id}:end`}
                    data-layout-wire="true"
                    style={{ left: middle, top: endY, width: half, height: 1 }}
                  />
                  <span
                    className={styles.wirePort}
                    data-layout-key={`${node.agent.id}:port`}
                    style={{ left: node.x - 3, top: endY - 3 }}
                  />
                  {signals
                    .filter((signal) => signal.agentId === node.agent.id)
                    .map((signal) => (
                      <AgentGraphConnectionSignal
                        key={signal.key}
                        signal={signal}
                        path={signalPath}
                        onComplete={complete}
                      />
                    ))}
                </div>
              );
            })}
            {nodes.map((node) => {
              const children = layout.children.get(node.agent.id) ?? [];
              return (
                <AgentGraphCard
                  key={node.agent.id}
                  node={node}
                  index={agents.indexOf(node.agent)}
                  childCount={children.length}
                  descendants={agentDescendants(node.agent.id, layout.children)}
                  folded={collapsed.has(node.agent.id) && !!children.length}
                  selected={node.agent.id === selectedId}
                  traced={pathIds.has(node.agent.id)}
                  context={
                    filter !== "all" &&
                    node.agent.kind !== "main" &&
                    !matchesAgentFilter(node.agent, filter)
                  }
                  buttonRef={(element) => {
                    if (element) buttons.current.set(node.agent.id, element);
                    else buttons.current.delete(node.agent.id);
                  }}
                  onSelect={() => select(node.agent.id)}
                  onNavigate={(event) => navigate(event, node)}
                  onToggle={() => {
                    const next = new Set(collapsed);
                    if (next.has(node.agent.id)) next.delete(node.agent.id);
                    else {
                      next.add(node.agent.id);
                      if (pathIds.has(node.agent.id)) onSelect(node.agent.id);
                    }
                    setCollapsed(next);
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>
      <footer className={styles.canvasFooter} title={t("agentWorkspace.gestures")}>
        <span className={styles.canvasTransferLegend} data-direction="delegate">
          <ArrowUpRight size={16} />
          {t("agentWorkspace.delegate")}
        </span>
        <span className={styles.canvasTransferLegend} data-direction="return">
          <ArrowDownLeft size={16} />
          {t("agentWorkspace.return")}
        </span>
        <button
          type="button"
          className={styles.canvasTraceToggle}
          disabled={!hasSelection}
          aria-pressed={focusBranch}
          onClick={() => setTraceOnly(!traceOnly)}
        >
          <GitBranch size={16} />
          {t("agentWorkspace.focusBranch")}
          <ArrowRight size={16} />
        </button>
      </footer>
    </section>
  );
}
