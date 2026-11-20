import { describe, expect, it } from "vitest";
import type { SessionRuntimeSnapshot, SessionRuntimeState } from "../../shared/contribution";
import { createBucketsState, getActiveBucket, patchBucket, setActiveKey } from "./sessionBuckets";
import { reconcileSessionRuntime } from "./useRuntimeReconciliation";

function snapshot(
  state: SessionRuntimeState,
  sessionFile: string | null = null,
): SessionRuntimeSnapshot {
  return {
    sessionId: "s1",
    sessionFile,
    cwd: "C:/project",
    state,
    reason: "slash-command",
    createdBy: "slash-command",
    startedAt: 1,
    lastActivityAt: 1,
    extensionFingerprint: null,
    staleExtension: false,
  };
}

function home() {
  return setActiveKey(patchBucket(createBucketsState(), "s1", { phase: "empty" }), "s1");
}

describe("runtime reconciliation preserves unsubmitted home drafts", () => {
  it.each<SessionRuntimeState>(["ready", "idle", "failed", "cold"])(
    "%s does not turn a prewarmed empty bucket into a conversation",
    (state) => {
      const next = reconcileSessionRuntime(home(), snapshot(state));
      expect(getActiveBucket(next)?.phase).toBe("empty");
      expect(getActiveBucket(next)?.processAlive).toBe(state === "ready" || state === "idle");
      expect(next.activeKey).toBe("s1");
    },
  );

  it("keeps a real historical conversation idle and claims its file", () => {
    const next = reconcileSessionRuntime(home(), snapshot("ready", "C:/history/session.jsonl"));
    expect(getActiveBucket(next)?.phase).toBe("idle");
    expect(next.fileIndex.get("C:/history/session.jsonl")).toBe("s1");
  });

  it("marks a submitted busy session as running", () => {
    expect(getActiveBucket(reconcileSessionRuntime(home(), snapshot("busy")))?.phase).toBe(
      "running",
    );
  });

  it("does not activate a restored background session or create a missing dead bucket", () => {
    const state = createBucketsState();
    const restored = reconcileSessionRuntime(state, snapshot("ready", "C:/history/session.jsonl"));
    expect(restored.activeKey).toBe(null);
    expect(restored.buckets.get("s1")?.phase).toBe("idle");
    expect(reconcileSessionRuntime(state, snapshot("failed"))).toBe(state);
  });

  it.each<SessionRuntimeState>(["starting", "stopping"])(
    "%s leaves the current draft's bucket untouched",
    (runtimeState) => {
      const state = home();
      expect(reconcileSessionRuntime(state, snapshot(runtimeState))).toBe(state);
    },
  );
});
