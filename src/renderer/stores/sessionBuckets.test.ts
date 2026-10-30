import { describe, expect, it } from "vitest";
import type { PiChatMessage } from "../../shared/ipc";
import {
  applyEntries,
  attentionKindForStopReason,
  claimFile,
  clearAttention,
  clearStartPending,
  convertQueueItem,
  createBucketsState,
  deliveredQueueTexts,
  deriveRunningFiles,
  dropFileIndex,
  emptyBucket,
  ensureBucket,
  findCommandBorrowSessionId,
  isFileProcessAlive,
  isFileRunning,
  loadMessagesIntoBucket,
  moveQueueItem,
  patchBucket,
  removeQueueItem,
  sameQueue,
  setActiveKey,
  setAttention,
} from "./sessionBuckets";

function userMessage(text: string): PiChatMessage {
  return { role: "user", content: [{ type: "text", text }] };
}

function assistantMessage(text: string): PiChatMessage {
  return { role: "assistant", content: [{ type: "text", text }] };
}

describe("sessionBuckets dual index", () => {
  it("creates bucket on demand without file", () => {
    let state = createBucketsState();
    state = ensureBucket(state, "s1");
    expect(state.buckets.get("s1")?.sessionId).toBe("s1");
    expect(state.fileIndex.size).toBe(0);
  });

  it("claimFile writes fileIndex; two sessions stay independent", () => {
    let state = createBucketsState();
    state = claimFile(state, "s1", "a.jsonl");
    state = claimFile(state, "s2", "b.jsonl");
    state = patchBucket(state, "s1", { processAlive: true, phase: "running" });
    state = patchBucket(state, "s2", { processAlive: true, phase: "running" });
    expect(state.fileIndex.get("a.jsonl")).toBe("s1");
    expect(state.fileIndex.get("b.jsonl")).toBe("s2");
    expect(deriveRunningFiles(state).size).toBe(2);
  });

  it("running derives from fileIndex + bucket phase, not active only", () => {
    let state = createBucketsState();
    state = claimFile(state, "s1", "a.jsonl");
    state = patchBucket(state, "s1", { processAlive: true, phase: "running" });
    state = setActiveKey(state, "s2");
    expect(isFileRunning(state, "a.jsonl")).toBe(true);
  });

  it("dropFileIndex after end-process clears alive lookup for that file", () => {
    let state = createBucketsState();
    state = claimFile(state, "s1", "a.jsonl");
    state = patchBucket(state, "s1", { processAlive: true, phase: "idle" });
    state = dropFileIndex(state, "a.jsonl");
    expect(isFileProcessAlive(state, "a.jsonl")).toBe(false);
    // bucket entries preserved
    expect(state.buckets.get("s1")).toBeTruthy();
  });

  it("attentionFiles can hold multiple markers of different kinds", () => {
    let state = createBucketsState();
    state = setAttention(state, "a.jsonl", "done");
    state = setAttention(state, "b.jsonl", "error");
    state = setAttention(state, "c.jsonl", "unread");
    expect(state.attentionFiles.size).toBe(3);
    expect(state.attentionFiles.get("a.jsonl")).toBe("done");
    expect(state.attentionFiles.get("b.jsonl")).toBe("error");
    state = clearAttention(state, "a.jsonl");
    expect(state.attentionFiles.has("a.jsonl")).toBe(false);
    expect(state.attentionFiles.has("b.jsonl")).toBe(true);
  });

  it("attentionKindForStopReason treats error and length as abnormal", () => {
    expect(attentionKindForStopReason("error")).toBe("error");
    expect(attentionKindForStopReason("length")).toBe("error");
    expect(attentionKindForStopReason("stop")).toBe("done");
    expect(attentionKindForStopReason("toolUse")).toBe("done");
    expect(attentionKindForStopReason(null)).toBe("done");
  });

  it("emptyBucket defaults processAlive false", () => {
    const b = emptyBucket("s1");
    expect(b.processAlive).toBe(false);
    expect(b.phase).toBe("empty");
    expect(b.queue).toEqual({ steering: [], followUp: [] });
    expect(b.queueClearing).toBe(false);
  });
});

describe("queue delivery diff (docs/design/73)", () => {
  it("takes delivered items from the head FIFO per kind", () => {
    expect(
      deliveredQueueTexts(
        { steering: ["a", "b"], followUp: ["c"] },
        { steering: ["b"], followUp: [] },
      ),
    ).toEqual(["a", "c"]);
  });

  it("returns nothing on growth or unchanged snapshots", () => {
    expect(
      deliveredQueueTexts({ steering: [], followUp: [] }, { steering: ["a"], followUp: [] }),
    ).toEqual([]);
    expect(
      deliveredQueueTexts({ steering: ["a"], followUp: [] }, { steering: ["a"], followUp: [] }),
    ).toEqual([]);
  });

  it("aligns duplicate texts by count instead of matching text", () => {
    expect(
      deliveredQueueTexts(
        { steering: ["same", "same", "x"], followUp: [] },
        { steering: ["same"], followUp: [] },
      ),
    ).toEqual(["same", "same"]);
  });

  it("removes a queued item without reordering the rest", () => {
    expect(removeQueueItem({ steering: ["A", "B"], followUp: ["C"] }, "steer", 1, "B")).toEqual({
      removed: "B",
      steering: ["A"],
      followUp: ["C"],
    });
    expect(removeQueueItem({ steering: ["A"], followUp: ["C", "D"] }, "followUp", 0, "C")).toEqual({
      removed: "C",
      steering: ["A"],
      followUp: ["D"],
    });
  });

  it("converts a follow-up to steering by appending to the steering queue", () => {
    expect(convertQueueItem({ steering: ["A"], followUp: ["C", "D"] }, "followUp", 0, "C")).toEqual(
      {
        removed: "C",
        steering: ["A", "C"],
        followUp: ["D"],
      },
    );
  });

  it("converts a steering item back to the follow-up tail", () => {
    expect(convertQueueItem({ steering: ["A", "B"], followUp: ["C"] }, "steer", 0, "A")).toEqual({
      removed: "A",
      steering: ["B"],
      followUp: ["C", "A"],
    });
  });

  it("moves an item within its own queue and leaves the other queue alone", () => {
    expect(
      moveQueueItem({ steering: ["A", "B", "C"], followUp: ["D"] }, "steer", 0, 2, "A"),
    ).toEqual({
      steering: ["B", "C", "A"],
      followUp: ["D"],
    });
    expect(moveQueueItem({ steering: ["A"], followUp: ["C", "D"] }, "followUp", 1, 0, "D")).toEqual(
      {
        steering: ["A"],
        followUp: ["D", "C"],
      },
    );
  });

  it("treats a same-index move as a no-op", () => {
    expect(moveQueueItem({ steering: ["A", "B"], followUp: [] }, "steer", 1, 1, "B")).toEqual({
      steering: ["A", "B"],
      followUp: [],
    });
  });

  it("rejects out-of-range indexes", () => {
    expect(removeQueueItem({ steering: ["A"], followUp: [] }, "steer", 1, "x")).toBeNull();
    expect(removeQueueItem({ steering: [], followUp: [] }, "followUp", 0, "x")).toBeNull();
    expect(moveQueueItem({ steering: ["A"], followUp: [] }, "steer", 2, 0, "A")).toBeNull();
  });

  it("rejects a stale index whose text no longer matches (delivery raced the clear)", () => {
    expect(removeQueueItem({ steering: ["B"], followUp: [] }, "steer", 0, "A")).toBeNull();
    expect(convertQueueItem({ steering: ["B"], followUp: [] }, "steer", 0, "A")).toBeNull();
    expect(moveQueueItem({ steering: ["B"], followUp: [] }, "steer", 0, 0, "A")).toBeNull();
  });

  it("treats byte-identical snapshots as unchanged (skip redundant renders)", () => {
    expect(
      sameQueue(
        { steering: ["a", "b"], followUp: ["c"] },
        { steering: ["a", "b"], followUp: ["c"] },
      ),
    ).toBe(true);
    expect(sameQueue({ steering: [], followUp: [] }, { steering: [], followUp: [] })).toBe(true);
    expect(sameQueue({ steering: ["a"], followUp: [] }, { steering: ["b"], followUp: [] })).toBe(
      false,
    );
    expect(sameQueue({ steering: ["a"], followUp: [] }, { steering: ["a"], followUp: ["b"] })).toBe(
      false,
    );
    expect(sameQueue({ steering: ["a"], followUp: [] }, { steering: [], followUp: [] })).toBe(
      false,
    );
  });
});

describe("startPending（冷启动进度条驱动源，docs/会话进程懒加载方案 §3.2）", () => {
  it("defaults false and round-trips through patchBucket", () => {
    let state = createBucketsState();
    state = ensureBucket(state, "s1");
    expect(state.buckets.get("s1")?.startPending).toBe(false);
    state = patchBucket(state, "s1", { startPending: true });
    expect(state.buckets.get("s1")?.startPending).toBe(true);
    state = clearStartPending(state, "s1");
    expect(state.buckets.get("s1")?.startPending).toBe(false);
  });

  it("clearStartPending does not resurrect a deleted (migrated-away) bucket", () => {
    let state = createBucketsState();
    state = patchBucket(state, "s1", { startPending: true });
    // 模拟 runStartBucket 迁移分支：旧桶被 delete
    const buckets = new Map(state.buckets);
    buckets.delete("s1");
    state = { ...state, buckets };
    const next = clearStartPending(state, "s1");
    expect(next.buckets.has("s1")).toBe(false);
  });

  it("survives bucket migration when carried through emptyBucket", () => {
    // sessionStore 迁移分支用 emptyBucket 重建权威桶；startPending 必须透传
    const src = patchBucket(createBucketsState(), "tmp", { startPending: true }).buckets.get("tmp");
    const migrated = emptyBucket("auth", {
      processAlive: true,
      entries: src?.entries ?? [],
      startPending: src?.startPending,
    });
    expect(migrated.startPending).toBe(true);
  });
});

describe("loadMessagesIntoBucket（冷打开竞态守卫，§3.3）", () => {
  it("clean bucket: disk entries replace (original loadMessages semantics)", () => {
    let state = createBucketsState();
    state = ensureBucket(state, "s1");
    state = loadMessagesIntoBucket(state, "s1", [userMessage("old")]);
    const entries = state.buckets.get("s1")?.entries ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "user", text: "old" });
  });

  it("optimistic user entry: disk first, tail preserved after merge", () => {
    let state = createBucketsState();
    state = ensureBucket(state, "s1");
    // 冷打开后、transcript 落桶前，用户抢先发送（乐观插入）
    state = applyEntries(state, "s1", { type: "userMessage", text: "new question" });
    state = loadMessagesIntoBucket(state, "s1", [
      userMessage("old-1"),
      assistantMessage("old-reply"),
    ]);
    const entries = state.buckets.get("s1")?.entries ?? [];
    // 磁盘装载按用户消息合成 run 边界：user → run → assistant（文本在 blocks），
    // 其后接乐观插入的尾部条目
    expect(entries.map((e) => e.kind)).toEqual(["user", "run", "assistant", "user"]);
    expect(entries[0]).toMatchObject({ kind: "user", text: "old-1" });
    expect(entries.at(-1)).toMatchObject({ kind: "user", text: "new question" });
  });

  it("running phase merges too even without user entry", () => {
    let state = createBucketsState();
    state = ensureBucket(state, "s1");
    state = patchBucket(state, "s1", { phase: "running" });
    state = loadMessagesIntoBucket(state, "s1", [userMessage("old")]);
    const entries = state.buckets.get("s1")?.entries ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "user", text: "old" });
  });

  it("does not touch fileIndex", () => {
    let state = createBucketsState();
    state = ensureBucket(state, "s1");
    state = loadMessagesIntoBucket(state, "s1", [userMessage("old")]);
    expect(state.fileIndex.size).toBe(0);
  });

  it("live-rendered tail already on disk: tail wins, turn not duplicated", () => {
    // 发送 → pi 落盘 → 读回的竞态窗口：桶内已直播渲染同一轮（原双气泡 bug 场景）
    let state = createBucketsState();
    state = ensureBucket(state, "s1");
    state = applyEntries(state, "s1", { type: "userMessage", text: "问个问题" });
    state = applyEntries(state, "s1", { type: "event", event: { type: "agent_start" } });
    state = applyEntries(state, "s1", {
      type: "event",
      event: { type: "message_start", message: { role: "assistant", content: [] } },
    });
    state = applyEntries(state, "s1", {
      type: "event",
      event: {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "回答", contentIndex: 0 },
      },
    });
    state = loadMessagesIntoBucket(state, "s1", [
      userMessage("问个问题"),
      assistantMessage("回答"),
    ]);
    const entries = state.buckets.get("s1")?.entries ?? [];
    expect(entries.filter((entry) => entry.kind === "user")).toHaveLength(1);
    expect(entries.filter((entry) => entry.kind === "run")).toHaveLength(1);
    expect(entries.at(-1)).toMatchObject({ kind: "assistant" });
  });

  it("persisted new turn in cold-open race: disk history kept, optimistic bubble deduped", () => {
    let state = createBucketsState();
    state = ensureBucket(state, "s1");
    state = applyEntries(state, "s1", { type: "userMessage", text: "new" });
    state = loadMessagesIntoBucket(state, "s1", [
      userMessage("old"),
      assistantMessage("old-reply"),
      userMessage("new"),
    ]);
    const entries = state.buckets.get("s1")?.entries ?? [];
    // 磁盘旧历史在前；"new" 轮以直播条目为准，只出现一次
    expect(entries.map((entry) => entry.kind)).toEqual(["user", "run", "assistant", "user"]);
    expect(entries.at(-1)).toMatchObject({ kind: "user", text: "new" });
    expect(entries.filter((entry) => entry.kind === "user")).toHaveLength(2);
  });

  it("disk user text wrapped in browser context still aligns by inclusion", () => {
    let state = createBucketsState();
    state = ensureBucket(state, "s1");
    state = applyEntries(state, "s1", { type: "userMessage", text: "总结页面" });
    state = loadMessagesIntoBucket(state, "s1", [
      userMessage("<page-context>页面内容</page-context>\n总结页面"),
      assistantMessage("好"),
    ]);
    const entries = state.buckets.get("s1")?.entries ?? [];
    expect(entries.filter((entry) => entry.kind === "user")).toHaveLength(1);
    expect(entries.at(-1)).toMatchObject({ kind: "assistant" });
  });
});

describe("findCommandBorrowSessionId（命令借用，§5.2）", () => {
  it("borrows an alive bucket with the same cwd, normalized for Windows", () => {
    let state = createBucketsState();
    state = claimFile(state, "s1", "a.jsonl");
    state = patchBucket(state, "s1", { processAlive: true, cwd: "D:\\Code\\PI" });
    expect(findCommandBorrowSessionId(state, "d:/code/pi")).toBe("s1");
  });

  it("skips dead buckets", () => {
    let state = createBucketsState();
    state = claimFile(state, "s1", "a.jsonl");
    state = patchBucket(state, "s1", { processAlive: false, cwd: "D:\\a" });
    expect(findCommandBorrowSessionId(state, "d:/a")).toBeNull();
  });

  it("skips buckets in another cwd (跨 cwd 不共享)", () => {
    let state = createBucketsState();
    state = claimFile(state, "s1", "a.jsonl");
    state = patchBucket(state, "s1", { processAlive: true, cwd: "D:\\other" });
    expect(findCommandBorrowSessionId(state, "d:/a")).toBeNull();
  });

  it("returns null for blank cwd", () => {
    let state = createBucketsState();
    state = claimFile(state, "s1", "a.jsonl");
    state = patchBucket(state, "s1", { processAlive: true, cwd: "D:\\a" });
    expect(findCommandBorrowSessionId(state, null)).toBeNull();
    expect(findCommandBorrowSessionId(state, "  ")).toBeNull();
  });
});
