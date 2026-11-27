import {
  CheckCircle,
  Circle,
  CircleNotch,
  Clock,
  StopCircle,
  WarningCircle,
} from "@phosphor-icons/react";
import type { ViewAgentState } from "../../../shared/view";
import { useT } from "../../hooks/useT";
import styles from "./AgentWorkspace.module.css";

export function AgentStatus({ state, label }: { state: ViewAgentState; label?: string }) {
  const t = useT();
  const StatusIcon = {
    idle: Circle,
    queued: Clock,
    running: CircleNotch,
    completed: CheckCircle,
    stopped: StopCircle,
    error: WarningCircle,
  }[state];
  const text = label ?? t(`agentWorkspace.${state === "error" ? "failed" : state}`);
  return (
    <span className={styles.status} data-agent-state={state}>
      <StatusIcon
        size={16}
        weight="regular"
        className={state === "running" ? styles.spinner : undefined}
      />
      <span>{text}</span>
    </span>
  );
}
