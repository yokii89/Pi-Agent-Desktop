import type { ViewAgentNode, ViewAgentState } from "../../../shared/view";

export interface AgentGraphTransfer {
  agentId: string;
  direction: "delegate" | "return";
}

export interface AgentGraphSignal extends AgentGraphTransfer {
  key: number;
  delay: number;
  /** Absolute deadline; unrelated packets cannot extend this signal's lifetime. */
  expiresAt: number;
}

/** Remove expired or superseded packets, including wires hidden by a fold or filter. */
export function retainAgentGraphSignals(
  signals: readonly AgentGraphSignal[],
  states: ReadonlyMap<string, ViewAgentState>,
  now: number,
): AgentGraphSignal[] {
  return signals.filter(
    (signal) =>
      signal.expiresAt > now &&
      states.get(signal.agentId) === (signal.direction === "return" ? "completed" : "running"),
  );
}

/** Snapshots provide states, not delivery receipts; only observed transitions animate. */
export function agentGraphTransfers(
  previous: ReadonlyMap<string, ViewAgentState> | undefined,
  agents: readonly ViewAgentNode[],
): AgentGraphTransfer[] {
  if (!previous) return [];
  return agents.flatMap((agent): AgentGraphTransfer[] => {
    if (agent.kind === "main" || previous.get(agent.id) === agent.state) return [];
    if (agent.state === "running") return [{ agentId: agent.id, direction: "delegate" }];
    if (agent.state === "completed" && previous.has(agent.id))
      return [{ agentId: agent.id, direction: "return" }];
    return [];
  });
}
