import { describe, expect, it } from "vitest";
import type { SessionSummary } from "../../../shared/ipc";
import { noteNewPendingSessions } from "./revealPending";

function summary(file: string, id: string): SessionSummary {
  return {
    file,
    id,
    startedAt: 1,
    updatedAt: 1,
    firstUserMessage: "hello",
    sessionName: null,
    cwd: null,
  };
}

describe("noteNewPendingSessions", () => {
  it("reveals on the first pending row of a session", () => {
    const seen = new Set<string>();
    expect(noteNewPendingSessions([summary("pending:s1", "s1")], seen)).toBe(true);
    expect(seen.has("s1")).toBe(true);
  });

  it("never reveals for rows already on disk", () => {
    // 启动首次 listAll 会一次涌进大量磁盘历史，据此展开等于把所有分组打开
    const seen = new Set<string>();
    expect(noteNewPendingSessions([summary("/a.jsonl", "a"), summary("/b.jsonl", "b")], seen)).toBe(
      false,
    );
    expect(seen.size).toBe(0);
  });

  it("does not reveal again when the pending row is replaced by the claimed file", () => {
    const seen = new Set<string>();
    noteNewPendingSessions([summary("pending:s1", "s1")], seen);
    expect(noteNewPendingSessions([summary("/tmp/real.jsonl", "s1")], seen)).toBe(false);
  });

  it("reveals a second new session but not a known one", () => {
    const seen = new Set<string>();
    noteNewPendingSessions([summary("pending:s1", "s1")], seen);
    expect(
      noteNewPendingSessions([summary("pending:s1", "s1"), summary("pending:s2", "s2")], seen),
    ).toBe(true);
    expect(
      noteNewPendingSessions([summary("pending:s1", "s1"), summary("pending:s2", "s2")], seen),
    ).toBe(false);
  });
});
