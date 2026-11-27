import { describe, expect, it } from "vitest";
import type { PiChatMessage } from "../../shared/ipc";
import { sessionEntriesReducer } from "./sessionTranscript";
import { parseTaskNotifications } from "./taskNotification";

const PARTIAL = `<task-notification>
<task-id>task-partial</task-id>
<tool-use-id>call-one|call-two</tool-use-id>
<output-file>C:\\Temp\\subagents\\task.output</output-file>
<status>Wrapped up (turn limit)</status>
<summary>Agent "定位 API 配置" steered (wrapped up at the turn limit — output may be partial)</summary>
<result>已定位：**使用 newapi provider。**

| 配置 | 结果 |
|---|---|
| auth.json | 已确认 |
...(truncated, use get_subagent_result for full output)</result>
<usage><total_tokens>268793</total_tokens><tool_uses>70</tool_uses><context_percent>7</context_percent><duration_ms>138604</duration_ms></usage>
</task-notification>`;

const COMPLETED = `<task-notification>
<task-id>task-complete</task-id>
<status>Done</status>
<summary>Agent "检查配置" completed</summary>
<result>**检查完成。**</result>
</task-notification>`;

describe("parseTaskNotifications", () => {
  it("reads the real turn-limit envelope and removes only its truncation marker", () => {
    expect(parseTaskNotifications(PARTIAL)).toEqual([
      {
        taskId: "task-partial",
        toolUseId: "call-one|call-two",
        outputFile: "C:\\Temp\\subagents\\task.output",
        script: null,
        failures: null,
        source: "agent",
        title: "定位 API 配置",
        summary:
          'Agent "定位 API 配置" steered (wrapped up at the turn limit — output may be partial)',
        rawStatus: "Wrapped up (turn limit)",
        status: "partial",
        rawResult:
          "已定位：**使用 newapi provider。**\n\n| 配置 | 结果 |\n|---|---|\n| auth.json | 已确认 |\n...(truncated, use get_subagent_result for full output)",
        result:
          "已定位：**使用 newapi provider。**\n\n| 配置 | 结果 |\n|---|---|\n| auth.json | 已确认 |",
        truncated: true,
        usage: {
          totalTokens: 268793,
          toolUses: 70,
          contextPercent: 7,
          durationMs: 138604,
          compactions: null,
          estimatedCostUsd: null,
        },
      },
    ]);
  });

  it("accepts producer preambles, transcript footers and multiple task envelopes in order", () => {
    const grouped = `Background agent group completed: 2 agent(s) finished\n\n${PARTIAL}\n\n${COMPLETED}\n\nUse get_subagent_result for full output.`;
    expect(parseTaskNotifications(grouped)?.map((task) => task.taskId)).toEqual([
      "task-partial",
      "task-complete",
    ]);
    expect(
      parseTaskNotifications(`${PARTIAL}\nFull transcript available at: C:\\Temp\\task.output`),
    ).toHaveLength(1);
  });

  it.each([
    ["Done", "complete"],
    ["Completed", "complete"],
    ["Failed", "failed"],
    ["Error: cannot read configuration", "failed"],
    ["Error: cannot read configuration\n    at readConfig (config.ts:12)", "failed"],
    ["Error:\r\naccess denied", "failed"],
    ["Wrapped up (turn limit)", "partial"],
    ["Aborted (max turns exceeded)", "partial"],
    ["Stopped", "stopped"],
    ["Cancelled", "stopped"],
    ["Waiting for review", "unknown"],
  ])("maps %s without treating an unknown status as success", (status, expected) => {
    const parsed = parseTaskNotifications(
      COMPLETED.replace("<status>Done</status>", `<status>${status}</status>`),
    );
    expect(parsed?.[0].status).toBe(expected);
    expect(parsed?.[0].rawStatus).toBe(status);
  });

  it("decodes XML once while preserving Markdown, quoted names and literal markup", () => {
    const text = COMPLETED.replace(
      'Agent "检查配置"',
      "Agent &quot;A &amp; B &#x1f680;&quot;",
    ).replace(
      "**检查完成。**",
      "`&lt;script&gt;` &amp;lt;literal&amp;gt; &#65; &apos;quoted&apos;",
    );
    const task = parseTaskNotifications(text)?.[0];
    expect(task?.title).toBe("A & B 🚀");
    expect(task?.result).toBe("`<script>` &lt;literal&gt; A 'quoted'");
  });

  it.each([
    "    const first = 1;\n    const second = 2;\n",
    "\tindented code\n\n",
    "\n\n    indented code\r\n\r\nparagraph with a hard break  \r\nnext line  ",
  ])("preserves result whitespace for Markdown rendering and copying", (result) => {
    const task = parseTaskNotifications(COMPLETED.replace("**检查完成。**", result))?.[0];
    expect(task?.result).toBe(result);
    expect(task?.rawResult).toBe(result);
    expect(task?.truncated).toBe(false);
  });

  it.each(["...(truncated)", "...(truncated, use get_subagent_result for full output)"])(
    "preserves the original truncation marker in the copy source",
    (marker) => {
      const result = `    partial output  \r\n${marker}\r\n`;
      const task = parseTaskNotifications(COMPLETED.replace("**检查完成。**", result))?.[0];
      expect(task?.result).toBe("    partial output  ");
      expect(task?.rawResult).toBe(result);
      expect(task?.truncated).toBe(true);
    },
  );

  it("uses the legacy transcript footer when the output-file field is absent", () => {
    const path = "C:\\Temp\\old task\\task.output";
    const text = `${COMPLETED}\nFull transcript available at: ${path}`;
    expect(parseTaskNotifications(text)?.[0].outputFile).toBe(path);
    expect(
      parseTaskNotifications(`${PARTIAL}\nFull transcript available at: ${path}`)?.[0].outputFile,
    ).toBe("C:\\Temp\\subagents\\task.output");
  });

  it("associates legacy footers with their own task and leaves raw paths undecoded", () => {
    const first = `${COMPLETED}\r\nFull transcript available at: /tmp/A &amp; B/task.output\r\n`;
    const second = `${COMPLETED.replaceAll("task-complete", "task-second")}\nFull transcript available at: D:/my tasks/second.output`;
    expect(parseTaskNotifications(`${first}\n${second}`)?.map((task) => task.outputFile)).toEqual([
      "/tmp/A &amp; B/task.output",
      "D:/my tasks/second.output",
    ]);
  });

  it("does not use result text or another task's footer as a transcript path", () => {
    const first = COMPLETED.replace(
      "**检查完成。**",
      "Full transcript available at: /tmp/example.output",
    );
    const second = `${COMPLETED.replaceAll("task-complete", "task-second")}\nFull transcript available at: /tmp/second.output`;
    expect(parseTaskNotifications(`${first}\n${second}`)?.map((task) => task.outputFile)).toEqual([
      null,
      "/tmp/second.output",
    ]);
  });

  it("keeps absent usage unknown and preserves explicitly reported zero values", () => {
    const absent = parseTaskNotifications(COMPLETED)?.[0];
    expect(absent?.usage).toEqual({
      totalTokens: null,
      toolUses: null,
      contextPercent: null,
      durationMs: null,
      compactions: null,
      estimatedCostUsd: null,
    });
    const withUsage = COMPLETED.replace(
      "</task-notification>",
      "<usage><total_tokens>0</total_tokens><tool_uses>-1</tool_uses><duration_ms>NaN</duration_ms><context_percent>0</context_percent><estimated_cost_usd>0.0123</estimated_cost_usd><compactions>2</compactions></usage></task-notification>",
    );
    expect(parseTaskNotifications(withUsage)?.[0].usage).toEqual({
      totalTokens: 0,
      toolUses: null,
      contextPercent: 0,
      durationMs: null,
      compactions: 2,
      estimatedCostUsd: 0.0123,
    });
  });

  it("handles workflows and their short truncation marker without losing failure details", () => {
    const text = COMPLETED.replace(
      'Agent "检查配置" completed',
      'Workflow "检查配置" completed — 2/2 agents',
    )
      .replace("**检查完成。**", "已有结果\n...(truncated)")
      .replace(
        "<status>",
        "<script>D:/work/check.ts</script><failures>reader: access denied</failures><status>",
      );
    expect(parseTaskNotifications(text)?.[0]).toMatchObject({
      source: "workflow",
      title: "检查配置",
      script: "D:/work/check.ts",
      failures: "reader: access denied",
      result: "已有结果",
      truncated: true,
    });
  });

  it("allows an empty result but does not invent a name when the summary format changes", () => {
    const text = COMPLETED.replace('Agent "检查配置" completed', "Task completed").replace(
      "**检查完成。**",
      "",
    );
    expect(parseTaskNotifications(text)?.[0]).toMatchObject({
      title: "task-complete",
      result: "",
      truncated: false,
    });
  });

  it.each([
    "plain extension message",
    COMPLETED.replace("</result>", ""),
    COMPLETED.replace("<task-id>task-complete</task-id>", ""),
    COMPLETED.replace("<status>Done</status>", "<status>Done</status><status>Failed</status>"),
    COMPLETED.replace("<result>", "<unexpected><result>"),
    `${COMPLETED}\n<task-notification>unfinished`,
    `${COMPLETED}\n${COMPLETED}`,
    `${COMPLETED}\n${PARTIAL.replace("</usage>", "")}`,
  ])("falls back as a whole when any notification is malformed or ambiguous", (text) => {
    expect(parseTaskNotifications(text)).toBeNull();
  });
});

describe("subtask notices in the existing transcript channel", () => {
  const message = {
    role: "custom",
    customType: "subagent-notification",
    display: true,
    content: [{ type: "text", text: PARTIAL }],
  } as unknown as PiChatMessage;

  it("gives live and restored notices the same renderable data without assistant usage", () => {
    let live = sessionEntriesReducer([], { type: "event", event: { type: "agent_start" } });
    live = sessionEntriesReducer(live, {
      type: "event",
      event: { type: "message_start", message },
    });
    live = sessionEntriesReducer(live, { type: "event", event: { type: "message_end", message } });
    const history = sessionEntriesReducer([], { type: "loadMessages", messages: [message] });
    const liveNotices = live.filter((entry) => entry.kind === "custom");
    const restored = history.find((entry) => entry.kind === "custom");
    expect(liveNotices).toHaveLength(1);
    expect(restored?.customType).toBe("subagent-notification");
    expect(parseTaskNotifications(liveNotices[0].text)).toEqual(
      parseTaskNotifications(restored?.text ?? ""),
    );
    expect(live.find((entry) => entry.kind === "run")?.usage).toBeNull();
    expect(live.some((entry) => entry.kind === "assistant")).toBe(false);
  });

  it("respects display:false in live events and restored history", () => {
    const hidden = { ...message, display: false } as unknown as PiChatMessage;
    expect(
      sessionEntriesReducer([], {
        type: "event",
        event: { type: "message_start", message: hidden },
      }),
    ).toEqual([]);
    expect(sessionEntriesReducer([], { type: "loadMessages", messages: [hidden] })).toEqual([]);
  });
});
