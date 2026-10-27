import { describe, expect, it, vi } from "vitest";
import { t } from "../../shared/i18n";
import type { PiAgentEvent, PiChatMessage } from "../../shared/ipc";
import { findRetrySurfaceId, type SessionEntry, sessionEntriesReducer } from "./sessionTranscript";

/**
 * docs/design/13 P0-2：run 收口不变量——
 * run 一旦不是 running，其下不允许残留 streaming: true 的 text/thinking 块。
 * 正常路径由 message_end 复位；这里验证中断 / 进程错误等 message_end 缺失的路径。
 */

function streamEvents(): PiAgentEvent[] {
  return [
    { type: "agent_start" },
    { type: "message_start", message: { role: "assistant", content: [] } },
    { type: "message_update", assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } },
    {
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "思考中", contentIndex: 0 },
    },
    { type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 1 } },
    {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "回答", contentIndex: 1 },
    },
  ];
}

function run(entries: SessionEntry[]): Extract<SessionEntry, { kind: "run" }> {
  const runEntry = entries.find((entry) => entry.kind === "run");
  if (runEntry?.kind !== "run") throw new Error("missing run entry");
  return runEntry;
}

function expectNoStreamingBlocks(entries: SessionEntry[]): void {
  const streaming = entries
    .flatMap((entry) => (entry.kind === "assistant" ? entry.blocks : []))
    .filter(
      (block) => (block.kind === "text" || block.kind === "thinking") && block.streaming === true,
    );
  expect(streaming).toHaveLength(0);
}

describe("run close resets streaming blocks (docs/design/13 P0-2)", () => {
  it("userStop closes streaming text/thinking without message_end", () => {
    let entries: SessionEntry[] = [];
    for (const event of streamEvents()) {
      entries = sessionEntriesReducer(entries, { type: "event", event });
    }
    // 前置：中断前确实存在 streaming 块
    const hadStreaming = entries.some((entry) =>
      entry.kind === "assistant"
        ? entry.blocks.some(
            (block) =>
              (block.kind === "text" || block.kind === "thinking") && block.streaming === true,
          )
        : false,
    );
    expect(hadStreaming).toBe(true);

    entries = sessionEntriesReducer(entries, { type: "userStop" });
    expect(run(entries).status).toBe("interrupted");
    expectNoStreamingBlocks(entries);
  });

  it("processError card keeps run open; later agent_settled closes and resets", () => {
    let entries: SessionEntry[] = [];
    for (const event of streamEvents()) {
      entries = sessionEntriesReducer(entries, { type: "event", event });
    }
    // stderr 错误卡是运行中插入，run 不收口（appendProcessError 语义）
    entries = sessionEntriesReducer(entries, { type: "processError", message: "进程崩溃" });
    expect(run(entries).status).toBe("running");

    entries = sessionEntriesReducer(entries, {
      type: "event",
      event: { type: "agent_settled", aborted: false },
    });
    expect(run(entries).status).toBe("completed");
    expectNoStreamingBlocks(entries);
  });

  it("agent_end 不再收口（P1）：run 保持 running，streaming 块要等 agent_settled 才复位", () => {
    let entries: SessionEntry[] = [];
    for (const event of streamEvents()) {
      entries = sessionEntriesReducer(entries, { type: "event", event });
    }
    entries = sessionEntriesReducer(entries, { type: "event", event: { type: "agent_end" } });
    expect(run(entries).status).toBe("running");
    // agent_end 之后还可能自动重试／压缩恢复／before_settle 续跑，不能当终态
    entries = sessionEntriesReducer(entries, {
      type: "event",
      event: { type: "agent_settled", aborted: false },
    });
    expect(run(entries).status).toBe("completed");
    expectNoStreamingBlocks(entries);
  });
});

/**
 * pi abort 残留（docs 核查 2026-09-19）：abort 后 agent 循环用已 abort 的信号
 * 再发起一次模型调用，失败以 stop=error + AbortError 文案落盘/广播。
 * 这是用户中断的痕迹，必须按 interrupted 收口，不得渲染成「模型调用失败」。
 */
describe("abort residue stop=error is an interruption, not a model failure", () => {
  const TOOL_CALL_ID = "call_abort_1";

  function abortedTurnMessages(): PiChatMessage[] {
    return [
      { role: "user", content: [{ type: "text", text: "问个问题" }] },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "思考" },
          { type: "toolCall", id: TOOL_CALL_ID, name: "ask_user_question", arguments: {} },
        ],
        stopReason: "toolUse",
      },
      {
        role: "toolResult",
        content: [{ type: "text", text: "User declined to answer questions" }],
        toolCallId: TOOL_CALL_ID,
        toolName: "ask_user_question",
        isError: false,
      },
      {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "This operation was aborted",
      },
    ];
  }

  function toolBlock(entries: SessionEntry[]) {
    const asst = entries.find((entry) => entry.kind === "assistant");
    if (asst?.kind !== "assistant") throw new Error("missing assistant entry");
    const tool = asst.blocks.find((block) => block.kind === "tool");
    if (tool?.kind !== "tool") throw new Error("missing tool block");
    return tool;
  }

  it("history load rebuilds interrupted run with tool result attached, no failure card", () => {
    const entries = sessionEntriesReducer([], {
      type: "loadMessages",
      messages: abortedTurnMessages(),
    });
    expect(entries.map((entry) => entry.kind)).toEqual(["user", "run", "assistant"]);
    expect(run(entries).status).toBe("interrupted");
    // attachToolResult 补丁必须真实写回：工具块拿到结果并落在 ok 态
    const tool = toolBlock(entries);
    expect(tool.status).toBe("ok");
    expect(tool.resultText).toContain("User declined to answer questions");
    expect(entries.some((entry) => entry.kind === "error")).toBe(false);
  });

  it("live path: abort residue closes running run as interrupted without card", () => {
    let entries: SessionEntry[] = [];
    entries = sessionEntriesReducer(entries, { type: "userMessage", text: "q" });
    for (const event of [
      { type: "agent_start" },
      {
        type: "message_start",
        message: { role: "assistant", content: [] },
      },
      {
        type: "message_end",
        message: {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "This operation was aborted",
        },
      },
      { type: "agent_end" },
      { type: "agent_settled", aborted: true },
    ] as PiAgentEvent[]) {
      entries = sessionEntriesReducer(entries, { type: "event", event });
    }
    expect(run(entries).status).toBe("interrupted");
    expect(entries.some((entry) => entry.kind === "error")).toBe(false);
  });

  it("real model failure keeps failed status and failure card", () => {
    let entries: SessionEntry[] = [];
    entries = sessionEntriesReducer(entries, { type: "userMessage", text: "q" });
    for (const event of [
      { type: "agent_start" },
      {
        type: "message_start",
        message: { role: "assistant", content: [] },
      },
      {
        type: "message_end",
        message: {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "fetch failed",
        },
      },
      { type: "agent_end" },
      { type: "agent_settled", aborted: false },
    ] as PiAgentEvent[]) {
      entries = sessionEntriesReducer(entries, { type: "event", event });
    }
    expect(run(entries).status).toBe("failed");
    const card = entries.find((entry) => entry.kind === "error");
    expect(card).toMatchObject({ title: "模型调用失败", message: "fetch failed" });
  });

  it("auto_retry_end aborted by user closes as interrupted without card", () => {
    let entries: SessionEntry[] = [];
    entries = sessionEntriesReducer(entries, { type: "userMessage", text: "q" });
    for (const event of [
      { type: "agent_start" },
      {
        type: "auto_retry_start",
        attempt: 1,
        maxAttempts: 3,
        errorMessage: "fetch failed",
      },
      {
        type: "auto_retry_end",
        success: false,
        attempt: 1,
        finalError: "Retry cancelled",
      },
      { type: "agent_end" },
      { type: "agent_settled", aborted: true },
    ] as PiAgentEvent[]) {
      entries = sessionEntriesReducer(entries, { type: "event", event });
    }
    expect(run(entries).status).toBe("interrupted");
    expect(entries.some((entry) => entry.kind === "error")).toBe(false);
  });
});

/** docs/design/21：用户附件图片——乐观插入与历史 content 拆块回读。 */
describe("user image attachments (docs/design/21)", () => {
  it("optimistic userMessage keeps display images", () => {
    const entries = sessionEntriesReducer([], {
      type: "userMessage",
      text: "看这张图",
      images: [{ src: "data:image/png;base64,AAAA", mimeType: "image/png", name: "a.png" }],
    });
    expect(entries).toHaveLength(1);
    const user = entries[0];
    expect(user).toMatchObject({
      kind: "user",
      text: "看这张图",
      images: [{ src: "data:image/png;base64,AAAA", mimeType: "image/png", name: "a.png" }],
    });
  });

  it("history load splits text + ImageContent and keeps image-only messages", () => {
    const entries = sessionEntriesReducer([], {
      type: "loadMessages",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "对比这两张" },
            { type: "image", data: "AAAA", mimeType: "image/png" },
            { type: "image", data: "BBBB", mimeType: "image/jpeg" },
          ],
        },
        {
          role: "user",
          content: [{ type: "image", data: "CCCC", mimeType: "image/webp" }],
        },
      ],
    });
    const users = entries.filter((entry) => entry.kind === "user");
    expect(users).toHaveLength(2);
    expect(users[0]).toMatchObject({
      text: "对比这两张",
      images: [
        { src: "data:image/png;base64,AAAA", mimeType: "image/png" },
        { src: "data:image/jpeg;base64,BBBB", mimeType: "image/jpeg" },
      ],
    });
    // 仅图无文也保留（「看这张图」合法）
    expect(users[1]).toMatchObject({
      text: "",
      images: [{ src: "data:image/webp;base64,CCCC", mimeType: "image/webp" }],
    });
  });
});

/**
 * 终态失败只保留一个「重试」落点：中间 attempt 的 run 头不带按钮，
 * 有错误卡时按钮挂在错误卡上（findRetrySurfaceId）。
 */
describe("findRetrySurfaceId keeps a single retry surface", () => {
  function failedRun(id: string): SessionEntry {
    return {
      kind: "run",
      id,
      status: "failed",
      startedAt: 1,
      endedAt: 2,
      retry: null,
      retryCount: 1,
      usage: null,
      lastStopReason: "error",
      lastErrorMessage: "boom",
      errorEntryId: null,
    };
  }

  it("prefers the trailing error card over intermediate failed run heads", () => {
    const entries: SessionEntry[] = [
      { kind: "user", id: "u1", text: "hi" },
      failedRun("r1"),
      failedRun("r2"),
      failedRun("r3"),
      { kind: "error", id: "e1", title: "模型调用失败", message: "boom", at: 3 },
    ];
    expect(findRetrySurfaceId(entries)).toBe("e1");
  });

  it("uses the last failed run when there is no error card", () => {
    const entries: SessionEntry[] = [
      { kind: "user", id: "u1", text: "hi" },
      failedRun("r1"),
      {
        kind: "run",
        id: "r2",
        status: "interrupted",
        startedAt: 1,
        endedAt: 2,
        retry: null,
        retryCount: 0,
        usage: null,
        lastStopReason: "aborted",
        lastErrorMessage: null,
        errorEntryId: null,
      },
    ];
    expect(findRetrySurfaceId(entries)).toBe("r2");
  });

  it("returns null for a successful turn even with leftover error cards", () => {
    const entries: SessionEntry[] = [
      { kind: "user", id: "u1", text: "first" },
      failedRun("r1"),
      { kind: "error", id: "e1", title: "模型调用失败", message: "boom", at: 1 },
      { kind: "user", id: "u2", text: "second" },
      {
        kind: "run",
        id: "r2",
        status: "completed",
        startedAt: 2,
        endedAt: 3,
        retry: null,
        retryCount: 0,
        usage: null,
        lastStopReason: "stop",
        lastErrorMessage: null,
        errorEntryId: null,
      },
    ];
    expect(findRetrySurfaceId(entries)).toBeNull();
  });

  it("returns null while the current run is still open", () => {
    const entries: SessionEntry[] = [
      failedRun("r0"),
      { kind: "user", id: "u1", text: "hi" },
      {
        kind: "run",
        id: "r1",
        status: "running",
        startedAt: 1,
        endedAt: null,
        retry: null,
        retryCount: 0,
        usage: null,
        lastStopReason: null,
        lastErrorMessage: null,
        errorEntryId: null,
      },
    ];
    expect(findRetrySurfaceId(entries)).toBeNull();
  });
});

/**
 * run 用量累加（message_end 权威值求和）：
 * pi 的流式 usage 嵌在 message_update.message 内（事件顶层不存在），
 * 因此 live 路径只在 message_end 累加；历史装载按同口径合成。
 */
describe("run usage accumulation on message_end", () => {
  const usage1 = {
    input: 100,
    output: 10,
    cacheRead: 50,
    cacheWrite: 0,
    totalTokens: 160,
    cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
  };
  const usage2 = {
    input: 200,
    output: 20,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 220,
    cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
  };

  it("accumulates usage across assistant messages within one run", () => {
    let entries: SessionEntry[] = [];
    entries = sessionEntriesReducer(entries, { type: "userMessage", text: "q" });
    entries = sessionEntriesReducer(entries, {
      type: "event",
      event: { type: "agent_start" },
    });
    entries = sessionEntriesReducer(entries, {
      type: "event",
      event: {
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "a" }], usage: usage1 },
      },
    });
    entries = sessionEntriesReducer(entries, {
      type: "event",
      event: {
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "b" }], usage: usage2 },
      },
    });
    const runEntry = run(entries);
    expect(runEntry.usage).not.toBeNull();
    expect(runEntry.usage?.input).toBe(300);
    expect(runEntry.usage?.totalTokens).toBe(380);
    expect(runEntry.usage?.cost?.total).toBeCloseTo(0.33);
  });

  it("ignores all-zero usage from aborted/error messages", () => {
    let entries: SessionEntry[] = [];
    entries = sessionEntriesReducer(entries, { type: "userMessage", text: "q" });
    entries = sessionEntriesReducer(entries, {
      type: "event",
      event: { type: "agent_start" },
    });
    entries = sessionEntriesReducer(entries, {
      type: "event",
      event: {
        type: "message_end",
        message: {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "aborted",
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
        },
      },
    });
    expect(run(entries).usage).toBeNull();
  });

  it("history load sums assistant usage into the synthetic run", () => {
    const entries = sessionEntriesReducer([], {
      type: "loadMessages",
      messages: [
        { role: "user", content: [{ type: "text", text: "问" }] },
        {
          role: "assistant",
          content: [{ type: "text", text: "答" }],
          usage: usage1,
        },
        { role: "user", content: [{ type: "text", text: "再问" }] },
        {
          role: "assistant",
          content: [{ type: "text", text: "再答" }],
          usage: usage2,
        },
      ],
    });
    const runs = entries.filter(
      (item): item is Extract<SessionEntry, { kind: "run" }> => item.kind === "run",
    );
    expect(runs).toHaveLength(2);
    expect(runs[0].usage?.totalTokens).toBe(160);
    expect(runs[1].usage?.totalTokens).toBe(220);
    expect(runs[1].usage?.input).toBe(200);
  });

  it("history load closes the last synthetic run with a real endedAt", () => {
    const entries = sessionEntriesReducer([], {
      type: "loadMessages",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "问" }],
          timestamp: 1_000,
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "答" }],
          usage: usage1,
          timestamp: 4_000,
        },
      ],
    });
    const last = run(entries);
    expect(last.status).toBe("completed");
    expect(last.startedAt).toBe(1_000);
    // 终态必须落真实 endedAt：null 会让 run 头用时随组件重挂载一直变大
    expect(last.endedAt).toBe(4_000);
    expect(last.usage?.totalTokens).toBe(160);
  });
});

describe("noop compaction notice (docs/design/47/48 F2)", () => {
  it("renders the skipped copy without token numbers when the extension marks a degenerate response", () => {
    let entries: SessionEntry[] = [];
    entries = sessionEntriesReducer(entries, {
      type: "event",
      event: { type: "compaction_start", reason: "overflow" },
    });
    entries = sessionEntriesReducer(entries, {
      type: "event",
      event: {
        type: "compaction_end",
        reason: "overflow",
        result: {
          tokensBefore: 73397,
          estimatedTokensAfter: 73390,
          details: { kind: "pidesk.noop-compaction" },
        },
      },
    });
    const notice = entries.at(-1);
    if (notice?.kind !== "notice") throw new Error("expected notice entry");
    expect(notice.text).toBe(t("session.compact.skipped"));
    expect(notice.text).not.toContain("73.4k");
    expect(notice.pending).toBe(false);
  });

  it("keeps the usual done notice with numbers for regular compactions", () => {
    let entries: SessionEntry[] = [];
    entries = sessionEntriesReducer(entries, {
      type: "event",
      event: { type: "compaction_start", reason: "overflow" },
    });
    entries = sessionEntriesReducer(entries, {
      type: "event",
      event: {
        type: "compaction_end",
        reason: "overflow",
        result: { tokensBefore: 73397, estimatedTokensAfter: 30100 },
      },
    });
    const notice = entries.at(-1);
    if (notice?.kind !== "notice") throw new Error("expected notice entry");
    expect(notice.text).toContain("73.4k");
    expect(notice.text).not.toBe(t("session.compact.skipped"));
  });
});

describe("tool row duration (pi durationMs + wall-clock fallback)", () => {
  const TOOL_CALL_ID = "call_duration_1";

  function toolOf(entries: SessionEntry[]) {
    for (const entry of entries) {
      if (entry.kind !== "assistant") continue;
      const tool = entry.blocks.find((block) => block.kind === "tool");
      if (tool?.kind === "tool") return tool;
    }
    throw new Error("missing tool block");
  }

  function startTool(entries: SessionEntry[]): SessionEntry[] {
    let next = entries;
    next = sessionEntriesReducer(next, { type: "event", event: { type: "agent_start" } });
    next = sessionEntriesReducer(next, {
      type: "event",
      event: { type: "message_start", message: { role: "assistant", content: [] } },
    });
    next = sessionEntriesReducer(next, {
      type: "event",
      event: {
        type: "tool_execution_start",
        toolCallId: TOOL_CALL_ID,
        toolName: "bash",
        args: { command: "sleep 5" },
      },
    });
    return next;
  }

  it("stores the pi durationMs from tool_execution_end", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      let entries = startTool([]);
      // 墙钟推进 5s，但 pi 实测值优先
      vi.advanceTimersByTime(5000);
      entries = sessionEntriesReducer(entries, {
        type: "event",
        event: {
          type: "tool_execution_end",
          toolCallId: TOOL_CALL_ID,
          toolName: "bash",
          result: { content: [{ type: "text", text: "ok" }] },
          isError: false,
          durationMs: 1234,
        },
      });
      expect(toolOf(entries).durationMs).toBe(1234);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to wall clock when durationMs is missing", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      let entries = startTool([]);
      vi.advanceTimersByTime(5000);
      entries = sessionEntriesReducer(entries, {
        type: "event",
        event: {
          type: "tool_execution_end",
          toolCallId: TOOL_CALL_ID,
          toolName: "bash",
          result: undefined,
          isError: false,
        },
      });
      expect(toolOf(entries).durationMs).toBe(5000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps duration null for tools cancelled by run close", () => {
    const entries = sessionEntriesReducer(startTool([]), { type: "userStop" });
    expect(toolOf(entries).status).toBe("cancelled");
    expect(toolOf(entries).durationMs).toBeNull();
  });
});

describe("discardOptimisticUser reconciles optimistic sends (docs/design/73)", () => {
  it("removes only the optimistic entry, keeping a delivered user entry after it", () => {
    let entries: SessionEntry[] = [];
    entries = sessionEntriesReducer(entries, { type: "userMessage", text: "first" });
    entries = sessionEntriesReducer(entries, { type: "event", event: { type: "agent_start" } });
    entries = sessionEntriesReducer(entries, {
      type: "userMessage",
      text: "optimistic",
      optimistic: true,
    });
    // 同一窗口内交付的排队消息（非乐观）排在后面
    entries = sessionEntriesReducer(entries, { type: "userMessage", text: "delivered" });
    entries = sessionEntriesReducer(entries, { type: "discardOptimisticUser" });
    expect(entries.flatMap((entry) => (entry.kind === "user" ? [entry.text] : []))).toEqual([
      "first",
      "delivered",
    ]);
    expect(entries.some((entry) => entry.kind === "run")).toBe(true);
  });

  it("is a no-op when no optimistic user entry exists", () => {
    let entries = sessionEntriesReducer([], { type: "userMessage", text: "loaded" });
    entries = sessionEntriesReducer(entries, { type: "discardOptimisticUser" });
    expect(entries).toHaveLength(1);
  });
});

/**
 * 会话收口统一到 agent_settled（docs/design/76 P0+P1）：
 * P0 修「中断被误判」——退避期停止没有终态 agent_end、首条 assistant 前的合成消息没有错误卡；
 * P1 把终态收口点整个搬到 settled，agent_end 之后的一切自动工作（重试／压缩恢复／
 * before_settle 续跑）都落在同一个 run 头上，aborted 为中断的权威真值。
 */
describe("agent_settled 收口 (docs/design/76)", () => {
  function replay(events: PiAgentEvent[]): SessionEntry[] {
    let entries: SessionEntry[] = [];
    for (const event of events) {
      entries = sessionEntriesReducer(entries, { type: "event", event });
    }
    return entries;
  }

  const assistantEnd = (
    stopReason: string,
    errorMessage?: string,
    content: PiChatMessage["content"] = [],
  ): PiAgentEvent => ({
    type: "message_end",
    message: { role: "assistant", content, stopReason, errorMessage },
  });

  const errorCards = (entries: SessionEntry[]): SessionEntry[] =>
    entries.filter((entry) => entry.kind === "error");

  it("重试退避期被中断（无终态 agent_end）：settled(aborted) 落成 interrupted，无错误卡", () => {
    const entries = replay([
      { type: "agent_start" },
      assistantEnd("error", "overloaded_error"),
      { type: "agent_end", willRetry: true },
      { type: "auto_retry_start", attempt: 1, maxAttempts: 3, errorMessage: "overloaded_error" },
      { type: "auto_retry_end", success: false, finalError: "Retry cancelled" },
      { type: "agent_settled", aborted: true },
    ]);
    expect(run(entries).status).toBe("interrupted");
    expect(errorCards(entries)).toHaveLength(0);
  });

  it("settled(aborted) 清掉重试链路留下的模型失败卡", () => {
    const retryFailed: PiAgentEvent[] = [
      { type: "agent_start" },
      assistantEnd("error", "overloaded_error"),
      { type: "agent_end", willRetry: true },
      { type: "auto_retry_end", success: false, finalError: "overloaded_error" },
    ];
    // 前置：这一串把 run 收成「等待重试」，模型失败卡已落、run 仍开着
    expect(errorCards(replay(retryFailed))).toHaveLength(1);

    const entries = replay([...retryFailed, { type: "agent_settled", aborted: true }]);
    expect(run(entries).status).toBe("interrupted");
    expect(errorCards(entries)).toHaveLength(0);
  });

  it("首条 assistant 前的合成中断消息：补录 stopReason 后收口为 interrupted", () => {
    const entries = replay([
      { type: "agent_start" },
      { type: "message_start", message: { role: "assistant", content: [] } },
      assistantEnd("aborted", "This operation was aborted"),
      { type: "agent_end" },
      { type: "agent_settled", aborted: true },
    ]);
    expect(run(entries).status).toBe("interrupted");
    expect(errorCards(entries)).toHaveLength(0);
    // 空 assistant 壳仍然不入流
    expect(entries.some((entry) => entry.kind === "assistant")).toBe(false);
  });

  it("正常完成：settled(aborted=false) 按最近 stopReason 收口为 completed", () => {
    const entries = replay([
      { type: "agent_start" },
      assistantEnd("stop", undefined, [{ type: "text", text: "答" }]),
      { type: "agent_end" },
      { type: "agent_settled", aborted: false },
    ]);
    expect(run(entries).status).toBe("completed");
  });

  it("P1 #9340 边界：失败 attempt 后 agent_end、settled(aborted) 判 interrupted 且不挂失败卡", () => {
    const entries = replay([
      { type: "agent_start" },
      assistantEnd("error", "overloaded_error"),
      // 终态 agent_end 不再收口（P1），本轮由 settled 落定
      { type: "agent_end" },
      { type: "auto_retry_end", success: false, finalError: "overloaded_error" },
      { type: "agent_settled", aborted: true },
    ]);
    expect(run(entries).status).toBe("interrupted");
    // 卡片与 run 头要么都在、要么都不在：中断不留「模型调用失败」
    expect(errorCards(entries)).toHaveLength(0);
  });

  it("P1 before_settle 续跑中被停止：agent_end 已给出但仍按 aborted 判 interrupted", () => {
    const entries = replay([
      { type: "agent_start" },
      assistantEnd("stop", undefined, [{ type: "text", text: "答" }]),
      { type: "agent_end" },
      { type: "agent_settled", aborted: true },
    ]);
    expect(run(entries).status).toBe("interrupted");
  });

  it("P1 settled 重复到达不重复收口", () => {
    const entries = replay([
      { type: "agent_start" },
      assistantEnd("stop", undefined, [{ type: "text", text: "答" }]),
      { type: "agent_end" },
      { type: "agent_settled", aborted: false },
      { type: "agent_settled", aborted: true },
    ]);
    // 已经收口的 run 不被后到的 settled 改写
    expect(run(entries).status).toBe("completed");
  });

  it("旧 pi 无 aborted 字段：沿用 statusFromLastError 的既有判定", () => {
    const entries = replay([
      { type: "agent_start" },
      assistantEnd("error", "overloaded_error"),
      { type: "agent_end", willRetry: true },
      { type: "auto_retry_end", success: false, finalError: "overloaded_error" },
      { type: "agent_settled" },
    ]);
    expect(run(entries).status).toBe("failed");
    expect(errorCards(entries)).toHaveLength(1);

    const ok = replay([
      { type: "agent_start" },
      assistantEnd("stop", undefined, [{ type: "text", text: "答" }]),
      { type: "agent_end", willRetry: true },
      { type: "agent_settled" },
    ]);
    expect(run(ok).status).toBe("completed");
  });
});
