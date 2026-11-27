import type { ViewAgentEvent, ViewAgentNode, ViewAgentState, ViewNode } from "../../shared/view";
import { VIEW_LIMITS } from "../../shared/view";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isAgentState(value: unknown): value is ViewAgentState {
  return (
    value === "idle" ||
    value === "queued" ||
    value === "running" ||
    value === "completed" ||
    value === "stopped" ||
    value === "error"
  );
}

function isEventKind(value: unknown): value is ViewAgentEvent["kind"] {
  return (
    value === "user" ||
    value === "assistant" ||
    value === "thinking" ||
    value === "tool" ||
    value === "notice" ||
    value === "error"
  );
}

/** Cut missing/self/cyclic parent edges in input order without recursive parent walks. */
function sanitizeParents(agents: ViewAgentNode[]): void {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  for (const agent of agents) {
    if (
      agent.parentId === agent.id ||
      (agent.parentId !== undefined && !byId.has(agent.parentId))
    ) {
      delete agent.parentId;
    }
  }
  const settled = new Set<string>();
  for (const agent of agents) {
    const path = new Set<string>();
    let current: ViewAgentNode | undefined = agent;
    while (current && !settled.has(current.id)) {
      if (path.has(current.id)) {
        delete current.parentId;
        break;
      }
      path.add(current.id);
      current = current.parentId === undefined ? undefined : byId.get(current.parentId);
    }
    for (const id of path) settled.add(id);
  }
}

/**
 * Sanitize workspace data after sanitizeTree has charged every capped array entry.
 * The caller supplies its existing UTF-8 truncation rule; no wire data is executable.
 */
export function sanitizeAgentWorkspace(
  record: Record<string, unknown>,
  truncate: (value: string) => string,
): ViewNode {
  const text = (value: unknown): string | undefined =>
    typeof value === "string" ? truncate(value) : undefined;
  const identity = (value: unknown): string | undefined => {
    const id = text(value);
    return id !== undefined && id.trim().length > 0 ? id : undefined;
  };
  const id = identity(record.id);
  if (id === undefined || !Array.isArray(record.agents) || !Array.isArray(record.events)) {
    return { type: "unknown", originalType: "agent-workspace" };
  }

  const agents: ViewAgentNode[] = [];
  const agentIds = new Set<string>();
  for (const item of record.agents.slice(0, VIEW_LIMITS.maxOptionItems)) {
    const agent = asRecord(item);
    if (!agent) continue;
    const agentId = identity(agent.id);
    if (
      agentId === undefined ||
      agentIds.has(agentId) ||
      typeof agent.label !== "string" ||
      typeof agent.description !== "string" ||
      !isAgentState(agent.state)
    ) {
      continue;
    }
    agentIds.add(agentId);
    agents.push({
      id: agentId,
      parentId: identity(agent.parentId),
      label: truncate(agent.label),
      description: truncate(agent.description),
      state: agent.state,
      stateLabel: text(agent.stateLabel),
      meta: Array.isArray(agent.meta)
        ? agent.meta
            .slice(0, 8)
            .filter((value): value is string => typeof value === "string")
            .map(truncate)
        : undefined,
      kind: agent.kind === "main" || agent.kind === "agent" ? agent.kind : undefined,
    });
  }
  sanitizeParents(agents);

  const selection = (value: unknown): string | undefined => {
    const candidate = identity(value);
    return candidate !== undefined && agentIds.has(candidate) ? candidate : undefined;
  };
  const streamAgentId = selection(record.streamAgentId);
  const events: ViewAgentEvent[] = [];
  const eventIds = new Set<string>();
  // Never guess that an unowned stream belongs to the selected Agent.
  if (streamAgentId !== undefined) {
    for (const item of record.events.slice(0, VIEW_LIMITS.maxOptionItems)) {
      const event = asRecord(item);
      if (!event) continue;
      const eventId = identity(event.id);
      if (
        eventId === undefined ||
        eventIds.has(eventId) ||
        !isEventKind(event.kind) ||
        typeof event.content !== "string"
      ) {
        continue;
      }
      eventIds.add(eventId);
      events.push({
        id: eventId,
        kind: event.kind,
        title: text(event.title),
        content: truncate(event.content),
        timestamp:
          typeof event.timestamp === "number" && Number.isFinite(event.timestamp)
            ? event.timestamp
            : undefined,
        toolName: text(event.toolName),
        input: text(event.input),
        state: isAgentState(event.state) ? event.state : undefined,
      });
    }
  }
  return {
    type: "agent-workspace",
    id,
    agents,
    value: selection(record.value),
    streamAgentId,
    events,
    emptyText: text(record.emptyText),
    notice: text(record.notice),
    loadEarlierActionId: identity(record.loadEarlierActionId),
  };
}
