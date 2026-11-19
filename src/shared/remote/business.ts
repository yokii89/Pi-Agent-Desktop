// Business frame schema version 1, carried by the v2 relay control protocol.
export const PROTOCOL_VERSION = 1;
export const MAX_FRAME_BYTES = 64 * 1024;
export const MAX_PROMPT_LENGTH = 16_000;
export const MAX_REQUESTS = 64;
export const COMMANDS = [
  "projects.list",
  "sessions.list",
  "sessions.history",
  "sessions.history.sync",
  "sessions.subscribe",
  "sessions.send",
  "sessions.stop",
  "sessions.create",
  "interactions.list",
  "interactions.answer",
  "requests.lookup",
] as const;
export type Command = (typeof COMMANDS)[number];

export interface RequestFrame {
  version: typeof PROTOCOL_VERSION;
  type: "request";
  id: string;
  command: Command;
  payload: Record<string, unknown>;
}

export type ServerFrame =
  | { version: 1; type: "response"; id: string; status: "accepted" | "completed"; data: unknown }
  | {
      version: 1;
      type: "response";
      id: string;
      status: "failed";
      error: { code: string; message: string };
    }
  | {
      version: 1;
      type: "event";
      sessionId: string;
      epoch: string;
      sequence: number;
      payload: Record<string, unknown>;
    };

export class ProtocolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProtocolError";
  }
}

/** Count UTF-8 bytes without requiring TextEncoder, which is not built into every Hermes runtime. */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

/** Validate untrusted envelopes before routing; command payloads need domain validation too. */
export function parseServerFrame(raw: string): ServerFrame {
  if (utf8ByteLength(raw) > MAX_FRAME_BYTES) {
    throw new ProtocolError("FRAME_TOO_LARGE", "Frame exceeds budget");
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ProtocolError("INVALID_JSON", "Invalid JSON frame");
  }
  if (!isRecord(value) || value.version !== PROTOCOL_VERSION) {
    throw new ProtocolError("VERSION_MISMATCH", "Unsupported protocol version");
  }
  if (value.type === "response" && isId(value.id)) {
    if (value.status === "accepted" || value.status === "completed") {
      return { version: 1, type: "response", id: value.id, status: value.status, data: value.data };
    }
    if (
      value.status === "failed" &&
      isRecord(value.error) &&
      typeof value.error.code === "string" &&
      typeof value.error.message === "string"
    ) {
      return {
        version: 1,
        type: "response",
        id: value.id,
        status: "failed",
        error: { code: value.error.code, message: value.error.message },
      };
    }
  }
  if (
    value.type === "event" &&
    isId(value.sessionId) &&
    isId(value.epoch) &&
    typeof value.sequence === "number" &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence >= 1 &&
    isRecord(value.payload)
  ) {
    return {
      version: 1,
      type: "event",
      sessionId: value.sessionId,
      epoch: value.epoch,
      sequence: value.sequence,
      payload: value.payload,
    };
  }
  throw new ProtocolError("INVALID_FRAME", "Invalid frame shape");
}

/** A gap or changed process epoch requires a snapshot before accepting more events. */
export function checkSequence(
  cursor: { epoch: string; sequence: number },
  event: { epoch: string; sequence: number },
): "apply" | "duplicate" | "resync" {
  if (cursor.epoch !== event.epoch) return "resync";
  if (event.sequence <= cursor.sequence) return "duplicate";
  return event.sequence === cursor.sequence + 1 ? "apply" : "resync";
}

/** In-memory request ledger. Unknown commands are never automatically retried after a disconnect. */
export class RequestLedger {
  private entries = new Map<
    string,
    "pending" | "accepted" | "completed" | "failed" | "uncertain"
  >();

  begin(id: string): boolean {
    if (!isId(id)) throw new ProtocolError("INVALID_ID", "Invalid request ID");
    if (this.entries.has(id)) return false;
    if (this.entries.size >= MAX_REQUESTS) {
      for (const [key, status] of this.entries) {
        if (status === "completed" || status === "failed") {
          this.entries.delete(key);
          break;
        }
      }
    }
    if (this.entries.size >= MAX_REQUESTS)
      throw new ProtocolError("BUSY", "Too many unresolved requests");
    this.entries.set(id, "pending");
    return true;
  }

  settle(frame: Extract<ServerFrame, { type: "response" }>): void {
    const previous = this.entries.get(frame.id);
    if (!previous || previous === "completed" || previous === "failed") return;
    // A late acceptance cannot undo an ambiguous result after connection loss.
    if (previous === "uncertain" && frame.status === "accepted") return;
    this.entries.set(frame.id, frame.status);
  }

  disconnect(): void {
    for (const [id, status] of this.entries) {
      if (status === "pending" || status === "accepted") this.entries.set(id, "uncertain");
    }
  }

  get(id: string) {
    return this.entries.get(id);
  }
}
