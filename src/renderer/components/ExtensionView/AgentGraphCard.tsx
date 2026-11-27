import { Crosshair, GitBranch, Robot, TreeStructure } from "@phosphor-icons/react";
import type { CSSProperties, KeyboardEvent, Ref } from "react";
import type { ViewAgentNode } from "../../../shared/view";
import { useT } from "../../hooks/useT";
import { GlideChevron } from "../ui/GlideChevron";
import styles from "./AgentGraph.module.css";
import { AgentGraphStateFrame } from "./AgentGraphStateFrame";
import { AgentStatus } from "./AgentStatus";
import { AGENT_NODE_WIDTH, type AgentGraphPosition } from "./agentGraphLayout";

function BranchSummary({ tasks }: { tasks: ViewAgentNode[] }) {
  const t = useT();
  return (
    <span className={styles.canvasBranchSummary}>
      <strong>{t("agentWorkspace.foldedCount", { count: tasks.length })}</strong>
      <span className={styles.canvasBranchStates}>
        {(["completed", "running", "queued", "error", "stopped", "idle"] as const).map((state) => {
          const count = tasks.filter((task) => task.state === state).length;
          return count ? (
            <span key={state} data-state={state}>
              <i aria-hidden="true" />
              {count} {t(`agentWorkspace.${state === "error" ? "failed" : state}`)}
            </span>
          ) : null;
        })}
      </span>
    </span>
  );
}

/** Selection, execution state, and folded descendants have independent visual cues. */
export function AgentGraphCard({
  node,
  index,
  childCount,
  descendants,
  folded,
  selected,
  traced,
  context,
  buttonRef,
  onSelect,
  onNavigate,
  onToggle,
}: {
  node: AgentGraphPosition;
  index: number;
  childCount: number;
  descendants: ViewAgentNode[];
  folded: boolean;
  selected: boolean;
  traced: boolean;
  context: boolean;
  buttonRef: Ref<HTMLButtonElement>;
  onSelect: () => void;
  onNavigate: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onToggle: () => void;
}) {
  const t = useT();
  const { agent } = node;
  const main = agent.kind === "main";
  const content = (
    <>
      <span className={styles.canvasCardEyebrow}>
        <span>
          {main
            ? t("agentWorkspace.orchestrator")
            : t("agentWorkspace.agentNumber", { number: String(index).padStart(2, "0") })}
        </span>
        {main ? (
          <TreeStructure size={16} />
        ) : childCount ? (
          <GitBranch size={16} />
        ) : (
          <Robot size={16} />
        )}
      </span>
      <strong title={agent.label}>{agent.label}</strong>
      <span className={styles.canvasCardDescription} title={agent.description}>
        {agent.description || (main ? t("agentWorkspace.rootDescription") : "")}
      </span>
      <span className={styles.canvasCardFooter}>
        <AgentStatus state={agent.state} label={agent.stateLabel} />
        <span title={agent.meta?.join(" · ")}>
          {main ? t("agentWorkspace.branches", { count: childCount }) : agent.meta?.[0]}
        </span>
      </span>
    </>
  );
  return (
    <div
      className={styles.canvasNode}
      data-layout-key={agent.id}
      style={{ left: node.x, top: node.y, width: AGENT_NODE_WIDTH, height: node.height }}
      data-agent-id={agent.id}
      data-agent-kind={agent.kind ?? "agent"}
      data-agent-state={agent.state}
      data-depth={node.depth}
      data-selected={selected}
      data-traced={traced}
      data-main={main}
      data-state={agent.state}
      data-collapsed={folded}
      data-context={context}
    >
      {main ? (
        <div className={`${styles.canvasCard} ${styles.mainCard}`}>{content}</div>
      ) : (
        <button
          type="button"
          className={styles.canvasCard}
          aria-pressed={selected}
          aria-label={`${agent.label}, ${agent.description}, ${agent.stateLabel ?? t(`agentWorkspace.${agent.state === "error" ? "failed" : agent.state}`)}`}
          data-canvas-agent={agent.id}
          ref={buttonRef}
          onClick={onSelect}
          onKeyDown={onNavigate}
        >
          {content}
        </button>
      )}
      {!main ? <AgentGraphStateFrame state={agent.state} /> : null}
      {folded ? <BranchSummary tasks={descendants} /> : null}
      {!main && childCount ? (
        <button
          type="button"
          className={styles.canvasBranchToggle}
          aria-expanded={!folded}
          aria-label={t(folded ? "agentWorkspace.expandBranch" : "agentWorkspace.collapseBranch", {
            name: agent.label,
          })}
          onClick={onToggle}
          style={{ "--gs-chev": folded ? "-90deg" : "0deg" } as CSSProperties}
        >
          <GlideChevron size={12} />
          <span>{folded ? t("agentWorkspace.expandTasks") : childCount}</span>
        </button>
      ) : null}
      {selected ? (
        <span className={styles.canvasSelectedCaption}>
          <Crosshair size={16} />
          {t("agentWorkspace.inspecting")}
        </span>
      ) : null}
    </div>
  );
}
