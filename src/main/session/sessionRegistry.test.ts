import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_PARALLEL_SESSIONS,
  normalizeMaxParallelSessions,
  SessionRegistry,
} from "./sessionRegistry";

function live(id: string, sessionFile: string | null = null) {
  return { id, sessionFile, childAlive: true, shuttingDown: false };
}

describe("normalizeMaxParallelSessions", () => {
  it("defaults invalid values to 8", () => {
    expect(normalizeMaxParallelSessions(undefined)).toBe(DEFAULT_MAX_PARALLEL_SESSIONS);
    expect(normalizeMaxParallelSessions(0)).toBe(DEFAULT_MAX_PARALLEL_SESSIONS);
    expect(normalizeMaxParallelSessions(-3)).toBe(DEFAULT_MAX_PARALLEL_SESSIONS);
    expect(normalizeMaxParallelSessions("x")).toBe(DEFAULT_MAX_PARALLEL_SESSIONS);
  });

  it("floors valid numbers to >= 1", () => {
    expect(normalizeMaxParallelSessions(3.9)).toBe(3);
    expect(normalizeMaxParallelSessions(1)).toBe(1);
  });
});

describe("SessionRegistry.decideStart", () => {
  it("parallel starts on different files spawn distinct instances", () => {
    const reg = new SessionRegistry();
    const d1 = reg.decideStart({ sessionFile: "a.jsonl" }, () => "s1", 8);
    const d2 = reg.decideStart({ sessionFile: "b.jsonl" }, () => "s2", 8);
    expect(d1).toEqual({ kind: "spawn", sessionId: "s1" });
    expect(d2).toEqual({ kind: "spawn", sessionId: "s2" });
  });

  it("same file live instance returns existing id without second spawn", () => {
    const reg = new SessionRegistry();
    reg.upsert(live("s1", "a.jsonl"));
    const d = reg.decideStart({ sessionFile: "a.jsonl" }, () => "s2", 8);
    expect(d).toEqual({ kind: "reuse", sessionId: "s1" });
  });

  it("same file shutting down rejects (no dual write)", () => {
    const reg = new SessionRegistry();
    reg.upsert({ id: "s1", sessionFile: "a.jsonl", childAlive: false, shuttingDown: true });
    const d = reg.decideStart({ sessionFile: "a.jsonl" }, () => "s2", 8);
    expect(d.kind).toBe("reject");
  });

  it("same sessionId restarts instead of spawning a second identity", () => {
    const reg = new SessionRegistry();
    reg.upsert(live("s1", null));
    const d = reg.decideStart({ sessionId: "s1" }, () => "s2", 8);
    expect(d).toEqual({ kind: "restart", sessionId: "s1" });
  });

  it("rejects when over maxParallelSessions without killing oldest", () => {
    const reg = new SessionRegistry();
    reg.upsert(live("s1"));
    reg.upsert(live("s2"));
    const d = reg.decideStart({ sessionFile: "c.jsonl" }, () => "s3", 2);
    expect(d.kind).toBe("reject-limit");
    expect(d.kind === "reject-limit" && d.error).toContain("2");
  });

  it("reuses existing file instance even at capacity", () => {
    const reg = new SessionRegistry();
    reg.upsert(live("s1", "a.jsonl"));
    reg.upsert(live("s2"));
    const d = reg.decideStart({ sessionFile: "a.jsonl" }, () => "s3", 2);
    expect(d).toEqual({ kind: "reuse", sessionId: "s1" });
  });
});

describe("SessionRegistry file index lifecycle", () => {
  it("clears fileToSessionId on remove (exit/dispose)", () => {
    const reg = new SessionRegistry();
    reg.upsert(live("s1", "a.jsonl"));
    expect(reg.sessionIdForFile("a.jsonl")).toBe("s1");
    reg.remove("s1");
    expect(reg.sessionIdForFile("a.jsonl")).toBeNull();
    expect(reg.has("s1")).toBe(false);
  });

  it("TOCTOU: concurrent file starts share one inflight promise", async () => {
    const reg = new SessionRegistry();
    let spawned = 0;
    const task = async () => {
      spawned += 1;
      await new Promise((r) => setTimeout(r, 5));
      return "s1";
    };
    const [a, b] = await Promise.all([
      reg.beginFileStart("a.jsonl", task),
      reg.beginFileStart("a.jsonl", task),
    ]);
    expect(a).toBe("s1");
    expect(b).toBe("s1");
    expect(spawned).toBe(1);
  });
});

describe("SessionRegistry pending isolation", () => {
  it("remove does not touch other instances", () => {
    const reg = new SessionRegistry();
    reg.upsert(live("s1", "a.jsonl"));
    reg.upsert(live("s2", "b.jsonl"));
    reg.remove("s1");
    expect(reg.has("s2")).toBe(true);
    expect(reg.sessionIdForFile("b.jsonl")).toBe("s2");
  });
});
