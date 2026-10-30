import { describe, expect, it } from "vitest";
import type { ManagedProcess, ProcDetailRow } from "../../../../shared/ipc";
import type { SessionEntry } from "../../../stores/sessionTranscript";
import {
  descendantDepth,
  findSourceToolBlock,
  formatBytes,
  formatEndpointAddress,
  formatStartTime,
  readTimeoutSeconds,
  resolveSelectedProc,
} from "./procPanelData";

function proc(partial: Partial<ManagedProcess> & { id: string }): ManagedProcess {
  return {
    sessionId: "s1",
    pid: 100,
    ppid: 50,
    commandLine: "node vite",
    name: "node.exe",
    startedAt: 1000,
    registeredAt: 2000,
    status: "alive",
    ...partial,
  };
}

function assistantWithTool(toolCallId: string, text = "已执行"): SessionEntry {
  return {
    kind: "assistant",
    id: `a-${toolCallId}`,
    blocks: [
      {
        kind: "tool",
        toolCallId,
        name: "bash",
        toolKind: "terminal",
        action: "已执行",
        subject: text,
        argsText: "{}",
        args: {},
        status: "ok",
        result: null,
        resultText: null,
        startedAt: null,
        endedAt: null,
        durationMs: null,
        contentIndex: 0,
      },
    ],
  };
}

describe("resolveSelectedProc", () => {
  const processes = [
    proc({ id: "a", status: "exited", registeredAt: 1000 }),
    proc({ id: "b", status: "alive", registeredAt: 2000 }),
    proc({ id: "c", status: "alive", registeredAt: 3000 }),
  ];

  it("显式选中优先", () => {
    expect(resolveSelectedProc(processes, "a")?.id).toBe("a");
  });

  it("选中项不存在时回退首个存活", () => {
    expect(resolveSelectedProc(processes, "missing")?.id).toBe("b");
  });

  it("全部退出时回退最近登记的已结束项", () => {
    const exited = [
      proc({ id: "old", status: "exited", registeredAt: 1000 }),
      proc({ id: "new", status: "killed", registeredAt: 3000 }),
    ];
    expect(resolveSelectedProc(exited, null)?.id).toBe("new");
  });

  it("忽略的登记项不参与选中", () => {
    const ignored = [
      proc({ id: "ignored", status: "ignored", registeredAt: 3000 }),
      proc({ id: "alive", status: "alive", registeredAt: 1000 }),
    ];
    expect(resolveSelectedProc(ignored, "ignored")?.id).toBe("alive");
  });

  it("没有任何登记项返回 null", () => {
    expect(resolveSelectedProc([], "x")).toBeNull();
  });
});

describe("findSourceToolBlock", () => {
  it("按 toolCallId 命中工具块（从新到旧）", () => {
    const entries: SessionEntry[] = [
      { kind: "user", id: "u1", text: "起服务" },
      assistantWithTool("t1"),
      assistantWithTool("t2"),
    ];
    expect(findSourceToolBlock(entries, "t1")?.toolCallId).toBe("t1");
    expect(findSourceToolBlock(entries, "t2")?.toolCallId).toBe("t2");
  });

  it("没有来源 id / 找不到时返回 null", () => {
    expect(findSourceToolBlock([assistantWithTool("t1")], undefined)).toBeNull();
    expect(findSourceToolBlock([assistantWithTool("t1")], "nope")).toBeNull();
  });
});

describe("formatBytes", () => {
  it("按 B / KB / MB / GB 分档", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(2.5 * 1024 * 1024)).toBe("2.5 MB");
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.0 GB");
  });
});

describe("readTimeoutSeconds", () => {
  it("读 pi bash 参数里的 timeout（秒），缺失或非法返回 null", () => {
    expect(readTimeoutSeconds({ command: "npm run dev", timeout: 30 })).toBe(30);
    expect(readTimeoutSeconds({ command: "npm run dev" })).toBeNull();
    expect(readTimeoutSeconds({ timeout: 0 })).toBeNull();
    expect(readTimeoutSeconds({ timeout: "abc" })).toBeNull();
    expect(readTimeoutSeconds(null)).toBeNull();
  });
});

describe("formatStartTime", () => {
  it("同年只显示月-日 时:分，跨年带年份", () => {
    const now = new Date(2026, 9, 30, 12, 0).getTime();
    const sameYear = new Date(2026, 9, 30, 9, 5).getTime();
    const otherYear = new Date(2025, 11, 31, 23, 59).getTime();
    expect(formatStartTime(sameYear, now)).toBe("10-30 09:05");
    expect(formatStartTime(otherYear, now)).toBe("2025-12-31");
    expect(formatStartTime(0, now)).toBe("—");
  });
});

describe("formatEndpointAddress", () => {
  it("IPv6 加方括号，空地址用 *", () => {
    expect(formatEndpointAddress("127.0.0.1", 5173)).toBe("127.0.0.1:5173");
    expect(formatEndpointAddress("::1", 5000)).toBe("[::1]:5000");
    expect(formatEndpointAddress("", 80)).toBe("*:80");
  });
});

describe("descendantDepth", () => {
  it("按父子链计算缩进深度", () => {
    const rows: ProcDetailRow[] = [
      { pid: 101, ppid: 100, name: "npm.exe", commandLine: "", startedAt: 1 },
      { pid: 102, ppid: 101, name: "node.exe", commandLine: "", startedAt: 1 },
    ];
    const depth = descendantDepth(100, rows);
    expect(depth.get(100)).toBe(0);
    expect(depth.get(101)).toBe(1);
    expect(depth.get(102)).toBe(2);
  });
});
