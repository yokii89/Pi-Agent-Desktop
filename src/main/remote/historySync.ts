import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import {
  type Binding,
  fail,
  HISTORY_TAIL_BYTES,
  type HistoryQuery,
  type HistoryRecord,
  type HistoryReply,
  type HistoryTail,
} from "../../shared/remote";
import { MAX_FRAME_BYTES } from "../../shared/remote/business";
import { projectRemoteMessages, REMOTE_HISTORY_BYTES, remoteSessionFile } from "./readAdapter";

const digest = (...values: unknown[]) =>
  createHash("sha256").update(JSON.stringify(values)).digest("hex");
const hashBytes = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const INDEX_LIMIT = 8;
export const EMPTY_TAIL: HistoryTail = { revision: "empty", messages: [] };

interface Entry {
  parent: string | null;
  toolCalls: string[];
  toolResult: string | null;
  closesTools: boolean;
  messages: Omit<HistoryRecord, "position">[];
}

export interface HistoryView {
  identity: string;
  messages: HistoryRecord[];
  prefixes: string[];
  pendingToolStart?: number | null;
}

interface HistoryIndex extends HistoryView {
  entries: Map<string, Entry>;
  leaf: string | null;
  size: number;
  mtime: number;
  ctime: number;
  completeBytes: number;
  pendingTools: string[];
  completeHash: string;
}

function indexLines(index: HistoryIndex, bytes: Buffer): void {
  for (const line of bytes.toString("utf8").split("\n")) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      entry = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    if (entry.type === "session") continue;
    // pi v1 transcripts were linear and had no entry IDs.
    const key =
      typeof entry.id === "string" ? entry.id : `legacy_${index.entries.size}_${digest(line)}`;
    const parent =
      entry.parentId === null || typeof entry.parentId === "string" ? entry.parentId : index.leaf;
    const messages =
      entry.type === "message" && entry.display !== false
        ? projectRemoteMessages([entry.message]).map((message, part) => ({
            ...message,
            id: digest(key, part),
            state: "done" as const,
          }))
        : [];
    const message =
      entry.message && typeof entry.message === "object"
        ? (entry.message as Record<string, unknown>)
        : {};
    const toolCalls =
      message.role === "assistant" && Array.isArray(message.content)
        ? message.content.flatMap((part: Record<string, unknown>) =>
            part.type === "toolCall" && typeof part.id === "string" ? [part.id] : [],
          )
        : [];
    const metadata = {
      toolCalls,
      toolResult:
        message.role === "toolResult" && typeof message.toolCallId === "string"
          ? message.toolCallId
          : null,
      closesTools: message.role === "assistant" || message.role === "user",
    };
    const extendsBranch = parent === index.leaf && !index.entries.has(key);
    const indexed = { parent, messages, ...metadata };
    index.entries.set(key, indexed);
    index.leaf = key;
    if (extendsBranch) appendEntry(index, indexed);
    else rebuildBranch(index);
  }
}

function appendEntry(index: HistoryIndex, entry: Entry): void {
  if (entry.closesTools) {
    index.pendingTools = [...entry.toolCalls];
    index.pendingToolStart = null;
  }
  if (entry.toolResult && index.pendingTools.includes(entry.toolResult)) {
    index.pendingToolStart ??= index.messages.length;
    index.pendingTools = index.pendingTools.filter((id) => id !== entry.toolResult);
    if (!index.pendingTools.length) index.pendingToolStart = null;
  }
  append(index, entry.messages);
}

function append(index: HistoryIndex, messages: Entry["messages"]): void {
  for (const item of messages) {
    const message = { ...item, position: index.messages.length };
    index.prefixes.push(digest(index.prefixes.at(-1), message));
    index.messages.push(message);
  }
}

function rebuildBranch(index: HistoryIndex): void {
  const branch: Entry[] = [];
  const seen = new Set<string>();
  let key = index.leaf;
  while (key !== null && !seen.has(key)) {
    const entry = index.entries.get(key);
    if (!entry) break;
    seen.add(key);
    branch.push(entry);
    key = entry.parent;
  }
  index.messages = [];
  index.prefixes = [];
  index.pendingTools = [];
  index.pendingToolStart = null;
  for (const entry of branch.reverse()) appendEntry(index, entry);
}

/** Cache projections by file identity and verify the previous prefix before appending. */
export class RemoteHistoryReader {
  private readonly indexes = new Map<string, HistoryIndex>();
  private readonly pending = new Map<string, Promise<HistoryView>>();

  read(file: string, directory: string, root: string): Promise<HistoryView> {
    const active = this.pending.get(file);
    if (active) return active;
    const pending = this.load(file, directory, root).finally(() => this.pending.delete(file));
    this.pending.set(file, pending);
    return pending;
  }

  private async load(file: string, directory: string, root: string): Promise<HistoryView> {
    const resolved = await remoteSessionFile(file, directory, root);
    const handle = await open(resolved, "r");
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > REMOTE_HISTORY_BYTES) return fail("RESOURCE_UNAVAILABLE");
      const identity = digest(resolved, info.dev, info.ino, info.birthtimeMs);
      const cached = this.indexes.get(resolved);
      let index: HistoryIndex;
      if (
        cached?.identity === identity &&
        cached.size === info.size &&
        cached.mtime === info.mtimeMs &&
        cached.ctime === info.ctimeMs
      ) {
        index = cached;
      } else {
        const bytes = Buffer.alloc(info.size);
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
          if (!bytesRead) return fail("STATE_UNAVAILABLE");
          offset += bytesRead;
        }
        const completeBytes = bytes.lastIndexOf(0x0a) + 1;
        const matchingPrefix =
          cached?.identity === identity &&
          info.size >= cached.size &&
          completeBytes >= cached.completeBytes &&
          hashBytes(bytes.subarray(0, cached.completeBytes)) === cached.completeHash;
        index = {
          identity,
          size: info.size,
          mtime: info.mtimeMs,
          ctime: info.ctimeMs,
          completeBytes,
          completeHash: hashBytes(bytes.subarray(0, completeBytes)),
          entries: matchingPrefix ? new Map(cached.entries) : new Map(),
          leaf: matchingPrefix ? cached.leaf : null,
          messages: matchingPrefix ? [...cached.messages] : [],
          prefixes: matchingPrefix ? [...cached.prefixes] : [],
          pendingTools: matchingPrefix ? [...cached.pendingTools] : [],
          pendingToolStart: matchingPrefix ? cached.pendingToolStart : null,
        };
        indexLines(index, bytes.subarray(matchingPrefix ? cached.completeBytes : 0, completeBytes));
      }
      if ((await remoteSessionFile(file, directory, root)) !== resolved)
        return fail("RESOURCE_UNAVAILABLE");
      const current = await stat(resolved);
      if (
        current.dev !== info.dev ||
        current.ino !== info.ino ||
        current.birthtimeMs !== info.birthtimeMs
      )
        return fail("RESOURCE_UNAVAILABLE");
      if (
        current.size !== info.size ||
        current.mtimeMs !== info.mtimeMs ||
        current.ctimeMs !== info.ctimeMs
      )
        return fail("STATE_UNAVAILABLE");
      this.indexes.delete(resolved);
      this.indexes.set(resolved, index);
      if (this.indexes.size > INDEX_LIMIT) {
        const oldest = this.indexes.keys().next().value;
        if (oldest !== undefined) this.indexes.delete(oldest);
      }
      return index;
    } finally {
      await handle.close();
    }
  }
}

export function completedHistory(view: HistoryView, settled: boolean): HistoryView {
  const boundary = settled ? null : view.pendingToolStart;
  return boundary === null || boundary === undefined
    ? view
    : {
        ...view,
        messages: view.messages.slice(0, boundary),
        prefixes: view.prefixes.slice(0, boundary),
      };
}

export function historyRevision(view: HistoryView): string {
  return digest(view.identity, view.prefixes.at(-1));
}

type CursorDirection = "after" | "before";

function issue(
  view: HistoryView,
  binding: Binding,
  query: HistoryQuery,
  direction: CursorDirection,
  position: number,
): string {
  const scope = [
    binding.relayInstanceId,
    binding.desktopId,
    binding.deviceId,
    binding.grantId,
    binding.grantVersion,
  ];
  return `1.${position}.${digest(scope, query.sessionId, view.identity, direction, position, view.prefixes[position])}`;
}

export function historyPage(
  view: HistoryView,
  binding: Binding,
  query: HistoryQuery,
  tail: HistoryTail,
): HistoryReply {
  const { messages } = view;
  const { direction } = query;
  let start = direction === "latest" ? messages.length : 0;
  let end = start;
  if (direction !== "latest") {
    const match = /^1\.(-1|0|[1-9]\d{0,8})\.[0-9a-f]{64}$/.exec(query.cursor ?? "");
    const position = match ? Number(match[1]) : Number.NaN;
    if (
      !Number.isInteger(position) ||
      position >= messages.length ||
      (direction === "before" && position <= 0) ||
      issue(view, binding, query, direction, position) !== query.cursor
    )
      return { status: "reset_required" };
    start = end = direction === "after" ? position + 1 : position;
  }
  const extra = direction !== "before" && query.tailRevision !== tail.revision ? { tail } : {};
  if (direction === "after" && start === messages.length) return { status: "unchanged", ...extra };
  let bytes = 0;
  // Leave room for the relay envelope, page metadata, and the optional live tail.
  const budget = MAX_FRAME_BYTES - HISTORY_TAIL_BYTES - 2_048;
  for (let count = 0; count < query.limit; count++) {
    const candidate = messages[direction === "after" ? end : start - 1];
    if (!candidate) break;
    bytes += Buffer.byteLength(JSON.stringify(candidate)) + 1;
    if (bytes > budget) break;
    if (direction === "after") end++;
    else start--;
  }
  if (start === end && messages.length > 0) return fail("FRAME_TOO_LARGE");
  return {
    status: "page",
    messages: messages.slice(start, end),
    checkpoint: direction === "before" ? null : issue(view, binding, query, "after", end - 1),
    beforeCursor: start > 0 ? issue(view, binding, query, "before", start) : null,
    more: direction === "after" && end < messages.length,
    ...extra,
  };
}
