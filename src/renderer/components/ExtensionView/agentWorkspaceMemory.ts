import type { FloatingWindowMemory } from "../../utils/floatingWindowGeometry";
import type { AgentReadingPosition } from "./AgentConversation";

export interface AgentWorkspaceSplitMemory {
  columns: number;
  rows: number;
}

export const DEFAULT_AGENT_WORKSPACE_SPLIT: Readonly<AgentWorkspaceSplitMemory> = {
  columns: 5 / 9,
  rows: 0.4,
};

export interface AgentWorkspaceMemory {
  split: AgentWorkspaceSplitMemory;
  readings: Map<string, AgentReadingPosition>;
  window: FloatingWindowMemory;
}

/** Keep presentation state with the owning View, across panel and floating mounts. */
export function createAgentWorkspaceMemory(): AgentWorkspaceMemory {
  return {
    split: { ...DEFAULT_AGENT_WORKSPACE_SPLIT },
    readings: new Map(),
    window: {},
  };
}
