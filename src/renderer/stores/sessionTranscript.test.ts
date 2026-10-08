import { describe, expect, it } from "vitest";
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

  it("processError card keeps run open; later agent_end closes and resets", () => {
    let entries: SessionEntry[] = [];
    for (const event of streamEvents()) {
      entries = sessionEntriesReducer(entries, { type: "event", event });
    }
    // stderr 错误卡是运行中插入，run 不收口（appendProcessError 语义）
    entries = sessionEntriesReducer(entries, { type: "processError", message: "进程崩溃" });
    expect(run(entries).status).toBe("running");

    entries = sessionEntriesReducer(entries, { type: "event", event: { type: "agent_end" } });
    expect(run(entries).status).toBe("completed");
    expectNoStreamingBlocks(entries);
  });

  it("agent_end closes streaming blocks when message_end is missing", () => {
    let entries: SessionEntry[] = [];
    for (const event of streamEvents()) {
      entries = sessionEntriesReducer(entries, { type: "event", event });
    }
    entries = sessionEntriesReducer(entries, { type: "event", event: { type: "agent_end" } });
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
