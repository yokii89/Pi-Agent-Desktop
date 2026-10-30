import { describe, expect, it } from "vitest";
import type { SessionId, SessionSummary } from "../../shared/ipc";
import { emptyBucket, type SessionPhase } from "./sessionBuckets";
import { mergeSessionLists, pickClaimedFile } from "./sessionStore";

function bucketPatch(
  id: string,
  patch: {
    sessionFile?: string | null;
    processAlive?: boolean;
    phase?: SessionPhase;
    firstUser?: string;
    cwd?: string | null;
  },
) {
  const entries =
    patch.firstUser != null ? [{ kind: "user" as const, id: "u1", text: patch.firstUser }] : [];
  return emptyBucket(id, {
    sessionFile: patch.sessionFile ?? null,
    processAlive: patch.processAlive ?? false,
    phase: patch.phase ?? "empty",
    cwd: patch.cwd ?? null,
    entries: entries as never,
  });
}

/** 发送瞬间登记的乐观行（store 里由 upsertPendingSummary 产出）。 */
function seedRow(sessionId: string, firstUserMessage: string, at: number): SessionSummary {
  return {
    file: `pending:${sessionId}`,
    id: sessionId,
    startedAt: at,
    updatedAt: at,
    firstUserMessage,
    sessionName: null,
    cwd: null,
  };
}

describe("mergeSessionLists optimistic pending rows", () => {
  it("shows pending row when session has user text but no real JSONL yet", () => {
    const buckets = new Map([
      [
        "s1",
        bucketPatch("s1", { firstUser: "帮我写个函数", processAlive: true, phase: "running" }),
      ],
    ]);
    const disk: SessionSummary[] = [];
    const merged = mergeSessionLists(disk, buckets);
    expect(merged).toHaveLength(1);
    expect(merged[0].file).toBe("pending:s1");
    expect(merged[0].firstUserMessage).toBe("帮我写个函数");
  });

  it("treats pending: sessionFile as not-yet-on-disk (still emit pending row)", () => {
    const buckets = new Map([
      [
        "s1",
        bucketPatch("s1", { sessionFile: "pending:s1", firstUser: "hello", processAlive: true }),
      ],
    ]);
    const merged = mergeSessionLists([], buckets);
    expect(merged.some((s) => s.file === "pending:s1" && s.firstUserMessage === "hello")).toBe(
      true,
    );
  });

  it("drops pending row once real sessionFile is claimed", () => {
    const buckets = new Map([
      [
        "s1",
        bucketPatch("s1", {
          sessionFile: "/tmp/real.jsonl",
          firstUser: "hello",
          processAlive: true,
        }),
      ],
    ]);
    const disk: SessionSummary[] = [
      {
        file: "/tmp/real.jsonl",
        id: "real",
        startedAt: 1,
        updatedAt: 2,
        firstUserMessage: "hello",
        sessionName: null,
        cwd: null,
      },
    ];
    const merged = mergeSessionLists(disk, buckets);
    expect(merged.every((s) => !s.file.startsWith("pending:"))).toBe(true);
  });

  it("skips empty buckets with no user text and not running", () => {
    const buckets = new Map([["s1", bucketPatch("s1", {})]]);
    expect(mergeSessionLists([], buckets)).toEqual([]);
  });

  it("keeps the row registered at send time while the bucket is still empty", () => {
    // 冷启动期间：桶既没有用户消息也没 running，只有发送瞬间登记的乐观行能撑住侧栏
    const buckets = new Map([["s1", bucketPatch("s1", {})]]);
    const rows = new Map<SessionId, SessionSummary>([["s1", seedRow("s1", "帮我写个函数", 1000)]]);
    const merged = mergeSessionLists([], buckets, undefined, rows);
    expect(merged).toHaveLength(1);
    expect(merged[0].file).toBe("pending:s1");
    expect(merged[0].firstUserMessage).toBe("帮我写个函数");
    expect(merged[0].startedAt).toBe(1000);
  });

  it("prefers the bucket's own first user message over the registered row", () => {
    const buckets = new Map([["s1", bucketPatch("s1", { firstUser: "真实的气泡文本" })]]);
    const rows = new Map<SessionId, SessionSummary>([["s1", seedRow("s1", "登记的旧文本", 1000)]]);
    expect(mergeSessionLists([], buckets, undefined, rows)[0].firstUserMessage).toBe(
      "真实的气泡文本",
    );
  });

  it("ignores the registered row once the real JSONL is claimed", () => {
    const buckets = new Map([
      ["s1", bucketPatch("s1", { sessionFile: "/tmp/real.jsonl", firstUser: "hello" })],
    ]);
    const rows = new Map<SessionId, SessionSummary>([["s1", seedRow("s1", "hello", 1000)]]);
    const merged = mergeSessionLists([], buckets, undefined, rows);
    expect(merged.every((s) => !s.file.startsWith("pending:"))).toBe(true);
  });

  it("pending row uses the name recorded before the JSONL is claimed", () => {
    const buckets = new Map([
      ["s1", bucketPatch("s1", { firstUser: "hello", processAlive: true })],
    ]);
    const names = new Map<string, string | null>([["pending:s1", "改过的名字"]]);
    const merged = mergeSessionLists([], buckets, names);
    expect(merged[0].sessionName).toBe("改过的名字");
  });

  it("claimed rows keep the disk name instead of the pending override", () => {
    const buckets = new Map([
      [
        "s1",
        bucketPatch("s1", {
          sessionFile: "/tmp/real.jsonl",
          firstUser: "hello",
          processAlive: true,
        }),
      ],
    ]);
    const names = new Map<string, string | null>([["pending:s1", "旧名字"]]);
    const disk: SessionSummary[] = [
      {
        file: "/tmp/real.jsonl",
        id: "real",
        startedAt: 1,
        updatedAt: 2,
        firstUserMessage: "hello",
        sessionName: "磁盘名字",
        cwd: null,
      },
    ];
    const merged = mergeSessionLists(disk, buckets, names);
    expect(merged[0].sessionName).toBe("磁盘名字");
  });
});

describe("pickClaimedFile claim disambiguation", () => {
  const summary = (
    file: string,
    firstUserMessage: string | null,
    startedAt = 0,
  ): SessionSummary => ({
    file,
    id: file,
    startedAt,
    updatedAt: startedAt,
    firstUserMessage,
    sessionName: null,
    cwd: null,
  });

  it("prefers the file whose first user message matches the bucket text", () => {
    // B 的 JSONL 更新但先认领的是 A：按消息匹配拿 A 的文件，不按 startedAt 抢最新
    const created = [summary("/b.jsonl", "B 的消息", 200), summary("/a.jsonl", "A 的消息", 100)];
    expect(pickClaimedFile(created, new Set(), "A 的消息")).toBe("/a.jsonl");
  });

  it("falls back to newest-first when no message matches", () => {
    const created = [summary("/a.jsonl", null, 200), summary("/b.jsonl", "x", 100)];
    expect(pickClaimedFile(created, new Set(), "别的")).toBe("/a.jsonl");
    expect(pickClaimedFile(created, new Set(), null)).toBe("/a.jsonl");
  });

  it("skips taken files and pending keys", () => {
    const created = [
      summary("pending:s1", "A 的消息", 300),
      summary("/a.jsonl", "A 的消息", 200),
      summary("/b.jsonl", "A 的消息", 100),
    ];
    expect(pickClaimedFile(created, new Set(["/a.jsonl"]), "A 的消息")).toBe("/b.jsonl");
  });

  it("normalizes whitespace before matching", () => {
    const created = [summary("/a.jsonl", "hello\n  world", 200)];
    expect(pickClaimedFile(created, new Set(), "hello world")).toBe("/a.jsonl");
  });

  it("returns null when every candidate is taken", () => {
    const created = [summary("/a.jsonl", "A 的消息", 200)];
    expect(pickClaimedFile(created, new Set(["/a.jsonl"]), "A 的消息")).toBeNull();
  });
});
