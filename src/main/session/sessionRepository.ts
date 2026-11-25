import path from "node:path";
import type { EntryRecord } from "@earendil-works/pi-durable";
import type { PiChatMessage, SessionSummary, SessionTranscriptPayload } from "../../shared/ipc";
import { type SessionRef, sessionRefFromKey, sessionRefKey } from "../../shared/sessionRef";
import { desktopSessions } from "../agentRuntime/desktopSessions";
import { durableCatalog } from "../settings/durableStore";
import { getSessionMeta, listAllSessions, listSessions } from "./sessionHistory";
import { assertSessionFile, readSessionTranscript } from "./sessionTranscriptRead";

export const LEGACY_READ_ONLY =
  "Legacy JSONL sessions are read-only. Create a new Durable session to send messages.";
export function sameProject(a: string, b: string): boolean {
  const normalize = (value: string) =>
    process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalize(a) === normalize(b);
}

/** The application boundary for stored history. Reading never opens an executing session. */
export class SessionRepository {
  async list(cwd?: string): Promise<SessionSummary[]> {
    const legacy = cwd ? await listSessions(cwd) : await listAllSessions();
    return [
      ...durableCatalog(),
      ...legacy.map((item) => ({
        ...item,
        ref: { kind: "legacy-jsonl" as const, file: item.file },
      })),
    ]
      .filter((item) => !cwd || (!!item.cwd && sameProject(item.cwd, cwd)))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async summary(ref: SessionRef): Promise<SessionSummary> {
    if (ref.kind === "durable") {
      const item = durableCatalog().find((item) => item.file === sessionRefKey(ref));
      if (!item) throw new Error("Unknown Durable session.");
      return item;
    }
    const file = assertSessionFile(ref.file);
    const meta = await getSessionMeta(file);
    if (!meta.header) throw new Error("Unknown legacy session.");
    const startedAt = Date.parse(meta.header.timestamp);
    return {
      ref: { kind: "legacy-jsonl", file },
      file,
      id: meta.header.id,
      cwd: meta.header.cwd ?? null,
      startedAt,
      updatedAt: meta.lastActivityAt ?? startedAt,
      firstUserMessage: meta.firstUserMessage,
      latestUserMessage: meta.latestUserMessage,
      sessionName: meta.sessionName,
    };
  }

  async executable(key: string, cwd: string): Promise<SessionRef & { kind: "durable" }> {
    const ref = sessionRefFromKey(key);
    if (ref.kind === "legacy-jsonl") throw new Error(LEGACY_READ_ONLY);
    const summary = await this.summary(ref);
    if (!summary.cwd || !sameProject(summary.cwd, cwd))
      throw new Error("Session belongs to another project.");
    return ref;
  }

  async entries(
    ref: SessionRef & { kind: "durable" },
    before?: number,
    limit = 100,
  ): Promise<readonly EntryRecord[]> {
    await this.summary(ref);
    return desktopSessions.readEntries(ref.id, before, limit);
  }

  async page(ref: SessionRef, before?: number, limit = 100): Promise<SessionTranscriptPayload> {
    const summary = await this.summary(ref);
    if (ref.kind === "legacy-jsonl") return readSessionTranscript(ref.file, { before, limit });
    const entries = await this.entries(ref, before, limit);
    return {
      messages: [...entries].reverse().flatMap(entryMessages),
      startedAt: summary.startedAt,
      truncated: entries.length === limit,
      nextBefore: entries.length === limit ? entries.at(-1)?.id : null,
    };
  }

  async transcript(ref: SessionRef): Promise<SessionTranscriptPayload> {
    const pages: PiChatMessage[][] = [];
    let before: number | undefined;
    let startedAt: number | null = null;
    let count = 0;
    for (;;) {
      const page = await this.page(ref, before);
      startedAt = page.startedAt;
      pages.push(page.messages);
      count += page.messages.length;
      if (count > 100_000)
        throw new Error("Session exceeds the full transcript read budget. Use paged history.");
      if (!page.nextBefore) break;
      before = page.nextBefore;
    }
    return { messages: pages.reverse().flat(), startedAt, truncated: false };
  }

  rename(ref: SessionRef, title: string): string | null {
    if (ref.kind === "legacy-jsonl") throw new Error(LEGACY_READ_ONLY);
    return desktopSessions.rename(sessionRefKey(ref), title);
  }
}

/** Convert only saved model messages; custom entries remain available through entries(). */
export function entryMessages(entry: EntryRecord): PiChatMessage[] {
  return (entry.model ?? [])
    .filter((message) => message.role !== "system")
    .map(
      (message) =>
        ({
          ...message,
          content:
            typeof message.content === "string"
              ? [{ type: "text", text: message.content }]
              : message.content,
        }) as PiChatMessage,
    );
}

export const sessionRepository = new SessionRepository();
