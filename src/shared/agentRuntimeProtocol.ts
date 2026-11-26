import {
  boundedJson,
  boundedText,
  DURABLE_RUNTIME_MESSAGE_MAX_BYTES,
  type DurableCommand,
  parseDurableCommand,
  parseRuntimeUpdate,
  type RuntimeSessionUpdate,
  record,
} from "./durableProtocol";
import { DURABLE_SESSION_ID } from "./sessionRef";
import type { TelegramHostRequest } from "./telegram";

export const AGENT_RUNTIME_PROTOCOL_VERSION = 8;

export type AgentRuntimeRequest =
  | { id: string; type: "smoke-test"; storageRoot: string }
  | { id: string; type: "command"; command: DurableCommand }
  | { id: string; type: "shutdown" }
  | { id: string; type: "host-response"; ok: true; result: string }
  | { id: string; type: "host-response"; ok: false; error: string };

export type AgentRuntimeMessage =
  | { type: "ready"; protocolVersion: number; nodeVersion: string }
  | { type: "response"; id: string; ok: true; result: unknown }
  | { type: "response"; id: string; ok: false; error: string }
  | { type: "update"; update: RuntimeSessionUpdate }
  | { type: "stopped"; id: string }
  | { type: "protocol-error"; error: string }
  | { type: "host-request"; id: string; request: TelegramHostRequest }
  | { type: "host-cancel"; id: string };

export function parseAgentRuntimeRequest(value: unknown): AgentRuntimeRequest | null {
  if (!record(value) || !boundedText(value.id, 128)) return null;
  if (value.type === "host-response") {
    if (value.ok === true && boundedText(value.result, 16000, true))
      return { type: "host-response", id: value.id, ok: true, result: value.result };
    if (value.ok === false && boundedText(value.error, 2000, true))
      return { type: "host-response", id: value.id, ok: false, error: value.error };
    return null;
  }
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
  if (value.type === "host-cancel" && boundedText(value.id, 128))
    return { type: "host-cancel", id: value.id };
  if (value.type === "host-request" && boundedText(value.id, 128)) {
    const request = value.request;
    if (
      !record(request) ||
      !boundedJson(request, 512000) ||
      typeof request.sessionId !== "string" ||
      !DURABLE_SESSION_ID.test(request.sessionId)
    )
      return null;
    if (request.op === "telegram_help")
      return {
        type: "host-request",
        id: value.id,
        request: { op: request.op, sessionId: request.sessionId },
      };
    if (request.op === "telegram_message" && boundedText(request.text, 32000))
      return {
        type: "host-request",
        id: value.id,
        request: { op: request.op, sessionId: request.sessionId, text: request.text },
      };
    if (
      request.op === "telegram_attach" &&
      Array.isArray(request.paths) &&
      request.paths.length > 0 &&
      request.paths.length <= 10 &&
      request.paths.every((file) => boundedText(file, 32768))
    )
      return {
        type: "host-request",
        id: value.id,
        request: { op: request.op, sessionId: request.sessionId, paths: request.paths as string[] },
      };
    return null;
  }
  if (value.type === "ready")
    return Number.isInteger(value.protocolVersion) && boundedText(value.nodeVersion, 64)
      ? (value as AgentRuntimeMessage)
      : null;
  if (value.type === "update") {
    const update = parseRuntimeUpdate(value.update);
    return update ? { type: "update", update } : null;
  }
  if (value.type === "response" && boundedText(value.id, 128)) {
    if (value.ok === true && boundedJson(value.result, DURABLE_RUNTIME_MESSAGE_MAX_BYTES))
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
