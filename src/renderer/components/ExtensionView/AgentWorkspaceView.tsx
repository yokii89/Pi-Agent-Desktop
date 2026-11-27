import { ArrowsIn, ArrowsOut, TreeStructure } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import type { ViewAgentWorkspaceNode } from "../../../shared/view";
import { useT } from "../../hooks/useT";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Modal } from "../ui/Modal";
import { AgentConversation, type AgentReadingPosition } from "./AgentConversation";
import { AgentGraph } from "./AgentGraph";
import styles from "./AgentWorkspace.module.css";
import type { ViewFormBridge } from "./ViewNodeRenderer";

/** The Host owns presentation; selection and execution remain authoritative in the extension. */
export function AgentWorkspaceView({
  node,
  bridge,
}: {
  node: ViewAgentWorkspaceNode;
  bridge: ViewFormBridge;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const readings = useRef(new Map<string, AgentReadingPosition>());
  const value = bridge.values[node.id];
  const requested = typeof value === "string" ? value : node.value;
  const selected =
    node.agents.find((agent) => agent.id === requested) ??
    node.agents.find((agent) => agent.id === node.value) ??
    node.agents[0];
  const memoryKey = selected?.id ?? "";
  let memory = readings.current.get(memoryKey);
  if (!memory) {
    memory = { top: 0, follow: true };
    if (readings.current.size >= 256) {
      const oldest = readings.current.keys().next().value;
      if (oldest !== undefined) readings.current.delete(oldest);
    }
    readings.current.set(memoryKey, memory);
  }
  const select = (id: string): void => bridge.onChange(node.id, id);
  const ready = node.streamAgentId === selected?.id;
  const content = (
    <div className={styles.workspace} data-agent-workspace={node.id}>
      <header className={styles.workspaceHeader}>
        <div>
          <div className={styles.workspaceTitle}>
            <TreeStructure size={20} weight="regular" />
            {t("agentWorkspace.title")}
          </div>
          {expanded ? <p>{t("agentWorkspace.description")}</p> : null}
        </div>
        <IconButton
          title={t(expanded ? "agentWorkspace.collapse" : "agentWorkspace.expand")}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ArrowsIn size={20} weight="regular" />
          ) : (
            <ArrowsOut size={20} weight="regular" />
          )}
        </IconButton>
      </header>
      {node.notice ? (
        <p className={styles.notice} role="status" data-selectable-text="">
          {node.notice}
        </p>
      ) : null}
      {node.agents.length === 0 ? (
        <p className={styles.empty}>{node.emptyText ?? t("agentWorkspace.empty")}</p>
      ) : (
        <div className={styles.panels}>
          <AgentGraph agents={node.agents} selectedId={selected?.id} onSelect={select} />
          <AgentConversation
            key={memoryKey}
            agent={selected}
            agents={node.agents}
            ready={ready}
            events={ready ? node.events : []}
            memory={memory}
            onSelect={select}
            onLoadEarlier={
              ready && node.loadEarlierActionId
                ? () => bridge.onButtonAction(node.loadEarlierActionId ?? "")
                : undefined
            }
          />
        </div>
      )}
      {expanded && bridge.actions?.length ? (
        <footer className={styles.workspaceActions}>
          {bridge.actions.map((action) => (
            <Button
              key={action.id}
              variant={
                action.variant === "primary"
                  ? "primary"
                  : action.variant === "danger"
                    ? "danger"
                    : "default"
              }
              disabled={action.disabled}
              onClick={() => bridge.onButtonAction(action.id)}
            >
              {action.label}
            </Button>
          ))}
        </footer>
      ) : null}
    </div>
  );
  return (
    <>
      {!expanded ? content : null}
      <Modal
        open={expanded}
        onClose={() => setExpanded(false)}
        ariaLabel={t("agentWorkspace.title")}
        panelClassName={styles.expandedPanel}
      >
        {expanded ? content : null}
      </Modal>
    </>
  );
}
