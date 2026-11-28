import { describe, expect, it } from "vitest";
import type { ProcDetailRow } from "../../../shared/ipc";
import type { SessionEntry, ToolAssistantBlock } from "../../stores/sessionTranscript";
import {
  findSourceToolBlock,
  formatRuntimeBytes,
  formatRuntimeCpu,
  formatRuntimeEndpoint,
  readTimeoutSeconds,
  runtimeMemoryPoints,
  runtimePortOwner,
  runtimeProcessRows,
  SOURCE_OUTPUT_LIMIT,
  sourceToolData,
} from "./bashRuntimeData";

function process(pid: number, ppid: number): ProcDetailRow {
  return { pid, ppid, name: `process-${pid}`, commandLine: "", startedAt: 1_000 };
}

function tool(overrides: Partial<ToolAssistantBlock> = {}): ToolAssistantBlock {
  return {
    kind: "tool",
    toolCallId: "original",
    name: "bash",
    toolKind: "terminal",
    action: "Run",
    subject: "short subject",
    argsText: "",
    args: { command: "pnpm dev", timeout: 30 },
    status: "ok",
    result: null,
    resultText: "startup output",
    startedAt: 1_000,
    endedAt: 2_000,
    durationMs: 1_000,
    contentIndex: 0,
    ...overrides,
  };
}

describe("runtime presentation", () => {
  it("distinguishes unknown readings from zero and preserves IPv6 endpoints", () => {
    expect(formatRuntimeCpu(null)).toBe("—");
    expect(formatRuntimeCpu(undefined)).toBe("—");
    expect(formatRuntimeCpu(Number.NaN)).toBe("—");
    expect(formatRuntimeCpu(0)).toBe("0%");
    expect(formatRuntimeBytes(undefined)).toBe("—");
    expect(formatRuntimeBytes(-1)).toBe("—");
    expect(formatRuntimeBytes(0)).toBe("0 B");
    expect(formatRuntimeBytes(1_536)).toBe("1.5 KB");
    expect(formatRuntimeEndpoint("::1", 5173)).toBe("[::1]:5173");
    expect(formatRuntimeEndpoint("", 80)).toBe("*:80");
  });

  it("orders the process hierarchy and tolerates cycles, duplicates, and missing parents", () => {
    const root = process(1, 0);
    const descendants = [process(3, 2), process(2, 1), process(4, 999), process(3, 2)];
    expect(
      runtimeProcessRows(root, descendants).map(({ process: row, depth }) => [row.pid, depth]),
    ).toEqual([
      [1, 0],
      [2, 1],
      [3, 2],
      [4, 1],
    ]);
    expect(runtimeProcessRows(null, [process(5, 6), process(6, 5)])).toHaveLength(2);
    expect(runtimePortOwner(3, root, descendants)).toBe("process-3 #3");
    expect(runtimePortOwner(9, root, descendants)).toBe("#9");
  });

  it("draws equal memory readings horizontally without NaN or infinite coordinates", () => {
    expect(runtimeMemoryPoints([5])).toBe("");
    expect(runtimeMemoryPoints([5, 5])).toBe("0.0,12.0 80.0,12.0");
    expect(runtimeMemoryPoints([0, 10])).toBe("0.0,22.0 80.0,2.0");
  });
});

describe("source tool lookup and captured result", () => {
  it("finds the newest exact tool identity and reports missing IDs", () => {
    const old = tool({ subject: "old" });
    const latest = tool({ subject: "new" });
    const entries: SessionEntry[] = [
      { kind: "user", id: "u", text: "launch" },
      { kind: "assistant", id: "a", blocks: [old] },
      { kind: "assistant", id: "b", blocks: [latest] },
    ];
    expect(findSourceToolBlock(entries, "original")).toBe(latest);
    expect(findSourceToolBlock(entries, undefined)).toBeNull();
    expect(findSourceToolBlock(entries, "missing")).toBeNull();
  });

  it("reads the original command, timeout, and exit code independently of the job status", () => {
    const source = sourceToolData(
      tool({
        result: {
          kind: "terminal",
          command: "short",
          output: "launched",
          exitCode: null,
          truncated: false,
        },
      }),
    );
    expect(source).toMatchObject({
      command: "pnpm dev",
      timeout: 30,
      exitCode: null,
      pending: false,
    });
    expect(sourceToolData(tool({ status: "running" })).pending).toBe(true);
    expect(readTimeoutSeconds({ timeout: "12" })).toBe(12);
    for (const timeout of [false, true, [], {}, null, "", "bad", -1, 0, Number.NaN]) {
      expect(readTimeoutSeconds({ timeout })).toBeNull();
    }
  });

  it("keeps display truncation separate from upstream tool result truncation", () => {
    const data = sourceToolData(
      tool({
        result: {
          kind: "terminal",
          command: "launch",
          output: "x".repeat(SOURCE_OUTPUT_LIMIT + 10),
          exitCode: 7,
          truncated: true,
        },
      }),
    );
    expect(data.output).toHaveLength(SOURCE_OUTPUT_LIMIT);
    expect(data).toMatchObject({ capped: true, truncated: true, exitCode: 7 });
    expect(sourceToolData(tool())).toMatchObject({
      output: "startup output",
      capped: false,
      truncated: false,
    });
  });
});
