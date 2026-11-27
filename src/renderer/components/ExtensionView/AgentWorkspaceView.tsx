import { ArrowsIn, ArrowsOut, TreeStructure } from "@phosphor-icons/react";
import { type Ref, useState } from "react";
import type { ViewAgentWorkspaceNode } from "../../../shared/view";
import { useT } from "../../hooks/useT";
import { Button } from "../ui/Button";
import { FloatingWindow } from "../ui/FloatingWindow";
import { IconButton } from "../ui/IconButton";
import { AgentConversation } from "./AgentConversation";
import { AgentGraph } from "./AgentGraph";
import styles from "./AgentWorkspace.module.css";
import { AgentWorkspaceSplit } from "./AgentWorkspaceSplit";
import { type AgentWorkspaceMemory, createAgentWorkspaceMemory } from "./agentWorkspaceMemory";
import type { ViewFormBridge } from "./ViewNodeRenderer";

const FLOAT_SIZE = { width: 1100, height: 760 };

/** The Host owns presentation; selection and execution remain authoritative in the extension. */
export function AgentWorkspaceView({
  node,
  bridge,
  memory: sharedMemory,
  floating,
  onToggleFloating,
  contentRef,
}: {
  node: ViewAgentWorkspaceNode;
  bridge: ViewFormBridge;
  memory?: AgentWorkspaceMemory;
  floating?: boolean;
  onToggleFloating?: () => void;
  contentRef?: Ref<HTMLDivElement>;
}) {
  const t = useT();
  const [localExpanded, setLocalExpanded] = useState(false);
  const [localMemory] = useState(createAgentWorkspaceMemory);
  const workspaceMemory = sharedMemory ?? localMemory;
  const expanded = floating ?? localExpanded;
  const toggleFloating = onToggleFloating ?? (() => setLocalExpanded(!localExpanded));
  const readings = workspaceMemory.readings;
  const value = bridge.values[node.id];
  const requested = typeof value === "string" ? value : node.value;
  const selected =
    node.agents.find((agent) => agent.id === requested && agent.kind !== "main") ??
    node.agents.find((agent) => agent.id === node.value && agent.kind !== "main");
  const memoryKey = selected?.id ?? "";
  let memory = readings.get(memoryKey);
  if (!memory) {
    memory = { top: 0, follow: true };
    if (readings.size >= 256) {
      const oldest = readings.keys().next().value;
      if (oldest !== undefined) readings.delete(oldest);
    }
    readings.set(memoryKey, memory);
  }
  const select = (id: string): void => bridge.onChange(node.id, id);
  const ready = node.streamAgentId === selected?.id;
  const content = (
    <div
      ref={contentRef}
      className={[styles.workspace, expanded ? styles.floatingWorkspace : ""].join(" ")}
      data-agent-workspace={node.id}
      data-selectable-text=""
    >
      {!expanded ? (
        <header className={styles.workspaceHeader}>
          <div className={styles.workspaceTitle}>
            <TreeStructure size={16} weight="regular" />
            {t("agentWorkspace.title")}
          </div>
          <IconButton title={t("agentWorkspace.expand")} onClick={toggleFloating}>
            <ArrowsOut size={16} weight="regular" />
          </IconButton>
        </header>
      ) : null}
      {node.agents.length === 0 ? (
        <p className={styles.empty}>{node.emptyText ?? t("agentWorkspace.empty")}</p>
      ) : (
        <AgentWorkspaceSplit
          memory={workspaceMemory.split}
          graph={<AgentGraph agents={node.agents} selectedId={selected?.id} onSelect={select} />}
          detail={
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
          }
        />
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
  if (!expanded) return content;
  return (
    <FloatingWindow
      title={t("agentWorkspace.title")}
      icon={<TreeStructure size={16} weight="regular" />}
      memory={workspaceMemory.window}
      initialSize={FLOAT_SIZE}
      onClose={toggleFloating}
      actions={
        <>
          <div className={styles.windowSpacer} />
          <IconButton title={t("agentWorkspace.collapse")} onClick={toggleFloating}>
            <ArrowsIn size={16} weight="regular" />
          </IconButton>
        </>
      }
    >
      {content}
    </FloatingWindow>
  );
}
