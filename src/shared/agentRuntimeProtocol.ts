import {
  boundedJson,
  boundedText,
  type DurableCommand,
  parseDurableCommand,
  parseRuntimeUpdate,
  type RuntimeSessionUpdate,
  record,
} from "./durableProtocol";

export const AGENT_RUNTIME_PROTOCOL_VERSION = 3;

export type AgentRuntimeRequest =
  | { id: string; type: "smoke-test"; storageRoot: string }
  | { id: string; type: "command"; command: DurableCommand }
  | { id: string; type: "shutdown" };

export type AgentRuntimeMessage =
  | { type: "ready"; protocolVersion: number; nodeVersion: string }
  | { type: "response"; id: string; ok: true; result: unknown }
  | { type: "response"; id: string; ok: false; error: string }
  | { type: "update"; update: RuntimeSessionUpdate }
  | { type: "stopped"; id: string }
  | { type: "protocol-error"; error: string };

export function parseAgentRuntimeRequest(value: unknown): AgentRuntimeRequest | null {
  if (!record(value) || !boundedText(value.id, 128)) return null;
  if (value.type === "shutdown") return { id: value.id, type: "shutdown" };
  if (value.type === "command") {
    const command = parseDurableCommand(value.command);
    return command ? { id: value.id, type: "command", command } : null;
  }
  if (value.type === "smoke-test" && boundedText(value.storageRoot, 32_768))
    return { id: value.id, type: "smoke-test", storageRoot: value.storageRoot };
  return null;
}

export function parseAgentRuntimeMessage(value: unknown): AgentRuntimeMessage | null {
  if (!record(value)) return null;
  if (value.type === "ready")
    return Number.isInteger(value.protocolVersion) && boundedText(value.nodeVersion, 64)
      ? (value as AgentRuntimeMessage)
      : null;
  if (value.type === "update") {
    const update = parseRuntimeUpdate(value.update);
    return update ? { type: "update", update } : null;
  }
  if (value.type === "response" && boundedText(value.id, 128)) {
    if (value.ok === true && boundedJson(value.result))
      return { type: "response", id: value.id, ok: true, result: value.result };
    if (value.ok === false && boundedText(value.error, 2000, true))
      return { type: "response", id: value.id, ok: false, error: value.error };
    return null;
  }
  if (value.type === "stopped" && boundedText(value.id, 128))
    return { type: "stopped", id: value.id };
  if (value.type === "protocol-error" && boundedText(value.error, 2000, true))
    return { type: "protocol-error", error: value.error };
  return null;
}
