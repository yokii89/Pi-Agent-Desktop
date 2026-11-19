import { byteLength, exact, fail, id, record } from "./contract";

export const HISTORY_PAGE_LIMIT = 50;
export const HISTORY_CURSOR_LIMIT = 160;
export const HISTORY_TAIL_BYTES = 8 * 1024;
export const HISTORY_TEXT_LIMIT = 6_000;

export interface HistoryMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
  state: "done" | "running";
  toolName?: string;
  isError?: boolean;
}

export interface HistoryRecord extends HistoryMessage {
  position: number;
  state: "done";
}

export interface HistoryTail {
  revision: string;
  messages: HistoryMessage[];
}

export interface HistoryQuery {
  sessionId: string;
  direction: "latest" | "after" | "before";
  cursor: string | null;
  limit: number;
  tailRevision: string | null;
}

export interface HistoryPage {
  status: "page";
  messages: HistoryRecord[];
  checkpoint: string | null;
  beforeCursor: string | null;
  more: boolean;
  tail?: HistoryTail;
}

export type HistoryReply =
  | HistoryPage
  | { status: "unchanged"; tail?: HistoryTail }
  | { status: "reset_required" };

function cursor(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > HISTORY_CURSOR_LIMIT)
    return fail("INVALID_CURSOR");
  return value;
}

export function parseHistoryQuery(value: unknown): HistoryQuery {
  const r = exact(value, ["sessionId", "direction", "cursor", "limit", "tailRevision"]);
  const direction = r.direction;
  const limit = r.limit;
  if (
    (direction !== "latest" && direction !== "after" && direction !== "before") ||
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > HISTORY_PAGE_LIMIT
  )
    return fail("INVALID_FRAME");
  const anchor = cursor(r.cursor);
  if ((direction === "latest") !== (anchor === null)) return fail("INVALID_CURSOR");
  return {
    sessionId: id(r.sessionId),
    direction,
    limit,
    cursor: anchor,
    tailRevision: r.tailRevision === null ? null : id(r.tailRevision),
  };
}

function message(value: unknown): HistoryMessage {
  const r = record(value);
  const { role, state, text, toolName, isError } = r;
  if (
    (role !== "user" && role !== "assistant" && role !== "tool") ||
    (state !== "done" && state !== "running") ||
    typeof text !== "string" ||
    text.length > HISTORY_TEXT_LIMIT ||
    (toolName !== undefined && (typeof toolName !== "string" || toolName.length > 120)) ||
    (isError !== undefined && typeof isError !== "boolean")
  )
    return fail("INVALID_FRAME");
  return {
    id: id(r.id),
    role,
    state,
    text,
    ...(toolName !== undefined ? { toolName } : {}),
    ...(isError === true ? { isError } : {}),
  };
}

export function parseHistoryRecord(value: unknown): HistoryRecord {
  const r = record(value);
  const item = message(r);
  if (
    item.state !== "done" ||
    typeof r.position !== "number" ||
    !Number.isSafeInteger(r.position) ||
    r.position < 0
  )
    return fail("INVALID_FRAME");
  return { ...item, state: "done", position: r.position };
}

export function parseHistoryReply(value: unknown, query: HistoryQuery): HistoryReply {
  const r = record(value);
  if (r.status === "reset_required") {
    exact(r, ["status"]);
    return query.direction === "latest" ? fail("INVALID_FRAME") : { status: "reset_required" };
  }
  let tail: HistoryTail | undefined;
  if (Object.hasOwn(r, "tail")) {
    const t = exact(r.tail, ["revision", "messages"]);
    if (query.direction === "before" || !Array.isArray(t.messages) || t.messages.length > 4)
      return fail("INVALID_FRAME");
    if (byteLength(JSON.stringify(t)) > HISTORY_TAIL_BYTES) return fail("FRAME_TOO_LARGE");
    tail = { revision: id(t.revision), messages: t.messages.map(message) };
  }
  const extra = tail ? ["tail"] : [];
  if (r.status === "unchanged") {
    exact(r, ["status", ...extra]);
    return query.direction === "after"
      ? { status: "unchanged", ...(tail ? { tail } : {}) }
      : fail("INVALID_FRAME");
  }
  exact(r, ["status", "messages", "checkpoint", "beforeCursor", "more", ...extra]);
  if (
    r.status !== "page" ||
    !Array.isArray(r.messages) ||
    r.messages.length > query.limit ||
    typeof r.more !== "boolean" ||
    (query.direction !== "latest" && r.messages.length === 0)
  )
    return fail("INVALID_FRAME");
  const checkpoint = cursor(r.checkpoint);
  if ((query.direction === "before") !== (checkpoint === null) || checkpoint === query.cursor)
    return fail("INVALID_CURSOR");
  const beforeCursor = cursor(r.beforeCursor);
  if (query.direction === "before" && beforeCursor === query.cursor) return fail("INVALID_CURSOR");
  const messages = r.messages.map(parseHistoryRecord);
  const first = messages[0]?.position;
  if (
    messages.some((m, i) => m.position !== (first ?? 0) + i) ||
    new Set(messages.map((m) => m.id)).size !== messages.length ||
    (first === undefined || first === 0) !== (beforeCursor === null) ||
    (query.direction !== "after" && r.more)
  )
    return fail("INVALID_FRAME");
  return {
    status: "page",
    messages,
    checkpoint,
    beforeCursor,
    more: r.more,
    ...(tail ? { tail } : {}),
  };
}
