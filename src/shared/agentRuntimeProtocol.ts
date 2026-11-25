export const AGENT_RUNTIME_PROTOCOL_VERSION = 2;

export type AgentRuntimeRequest =
  | { id: string; type: "smoke-test"; storageRoot: string }
  | { id: string; type: "shutdown" };

export type AgentRuntimeMessage =
  | {
      type: "ready";
      protocolVersion: number;
      nodeVersion: string;
    }
  | {
      type: "response";
      id: string;
      ok: true;
      result: { conversationId: number; reply: string };
    }
  | {
      type: "response";
      id: string;
      ok: false;
      error: string;
    }
  | { type: "stopped"; id: string }
  | { type: "protocol-error"; error: string };

const MAX_ID_LENGTH = 128;
const MAX_PATH_LENGTH = 32_768;

export function parseAgentRuntimeRequest(value: unknown): AgentRuntimeRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.type === "shutdown") {
    if (
      typeof record.id === "string" &&
      record.id.length > 0 &&
      record.id.length <= MAX_ID_LENGTH
    ) {
      return { id: record.id, type: "shutdown" };
    }
    return null;
  }
  if (
    record.type !== "smoke-test" ||
    typeof record.id !== "string" ||
    record.id.length === 0 ||
    record.id.length > MAX_ID_LENGTH ||
    typeof record.storageRoot !== "string" ||
    record.storageRoot.length === 0 ||
    record.storageRoot.length > MAX_PATH_LENGTH
  ) {
    return null;
  }
  return { id: record.id, type: "smoke-test", storageRoot: record.storageRoot };
}

export function parseAgentRuntimeMessage(value: unknown): AgentRuntimeMessage | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.type === "ready") {
    if (
      typeof record.protocolVersion === "number" &&
      Number.isInteger(record.protocolVersion) &&
      typeof record.nodeVersion === "string" &&
      record.nodeVersion.length <= 64
    ) {
      return {
        type: "ready",
        protocolVersion: record.protocolVersion,
        nodeVersion: record.nodeVersion,
      };
    }
    return null;
  }
  if (record.type === "response") {
    if (
      typeof record.id !== "string" ||
      record.id.length === 0 ||
      record.id.length > MAX_ID_LENGTH
    ) {
      return null;
    }
    if (
      record.ok === true &&
      typeof record.result === "object" &&
      record.result !== null &&
      !Array.isArray(record.result)
    ) {
      const result = record.result as Record<string, unknown>;
      if (typeof result.conversationId === "number" && typeof result.reply === "string") {
        return {
          type: "response",
          id: record.id,
          ok: true,
          result: { conversationId: result.conversationId, reply: result.reply },
        };
      }
      return null;
    }
    if (record.ok === false && typeof record.error === "string" && record.error.length <= 2_000) {
      return { type: "response", id: record.id, ok: false, error: record.error };
    }
    return null;
  }
  if (record.type === "stopped" && typeof record.id === "string" && record.id.length > 0) {
    return { type: "stopped", id: record.id };
  }
  if (
    record.type === "protocol-error" &&
    typeof record.error === "string" &&
    record.error.length <= 2_000
  ) {
    return { type: "protocol-error", error: record.error };
  }
  return null;
}
