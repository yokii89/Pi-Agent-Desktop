import { describe, expect, it } from "vitest";
import type { ManagedProcess } from "../../shared/ipc";
import { isPidReuse, parseProcessJson, selectSyncKillTargets } from "./processKill";
import type { ProcessSnapshot } from "./processWatch";

describe("isPidReuse", () => {
  it("flags missing process as reuse/not-stoppable", () => {
    expect(isPidReuse({ commandLine: "node vite", startedAt: 1000 }, null)).toBe(true);
  });

  it("rejects when command line differs", () => {
    expect(
      isPidReuse(
        { commandLine: "node vite", startedAt: 1000 },
        { commandLine: "totally different", startedAt: 1000 },
      ),
    ).toBe(true);
  });

  it("rejects when creation time drifts beyond 2s", () => {
    expect(
      isPidReuse(
        { commandLine: "node vite", startedAt: 10_000 },
        { commandLine: "node vite", startedAt: 14_000 },
      ),
    ).toBe(true);
  });

  it("accepts matching command line and close start time", () => {
    expect(
      isPidReuse(
        { commandLine: "  node   vite ", startedAt: 10_000 },
        { commandLine: "node vite", startedAt: 10_500 },
      ),
    ).toBe(false);
  });

  it("skips checks when fields unknown", () => {
    expect(isPidReuse({ commandLine: "", startedAt: 0 }, { commandLine: "", startedAt: 0 })).toBe(
      false,
    );
  });
});

describe("selectSyncKillTargets", () => {
  const proc: ManagedProcess = {
    id: "s1:100:10000",
    sessionId: "s1",
    pid: 100,
    ppid: 50,
    commandLine: "node vite",
    name: "node.exe",
    startedAt: 10_000,
    registeredAt: 12_000,
    status: "alive",
  };

  function snapshot(partial: Partial<{ commandLine: string; startedAt: number }>): ProcessSnapshot {
    return new Map([
      [
        100,
        {
          pid: 100,
          ppid: 50,
          name: "node.exe",
          commandLine: "node vite",
          startedAt: 10_000,
          ...partial,
        },
      ],
    ]);
  }

  it("仍匹配的项保留", () => {
    expect(selectSyncKillTargets([proc], snapshot({ startedAt: 10_500 }))).toEqual([proc]);
  });

  it("命令行或启动时间变化 / PID 已消失的项剔除", () => {
    expect(selectSyncKillTargets([proc], snapshot({ commandLine: "other.exe" }))).toEqual([]);
    expect(selectSyncKillTargets([proc], snapshot({ startedAt: 40_000 }))).toEqual([]);
    expect(selectSyncKillTargets([proc], new Map())).toEqual([]);
  });

  it("没有快照时一个都不杀", () => {
    expect(selectSyncKillTargets([proc], null)).toEqual([]);
  });
});

describe("parseProcessJson", () => {
  it("parses single object and array shapes", () => {
    const single = parseProcessJson(
      '{"pid":12,"ppid":4,"name":"node.exe","commandLine":"node vite","startedAt":99}',
    );
    expect(single?.get(12)?.commandLine).toBe("node vite");

    const many = parseProcessJson(
      '[{"pid":1,"ppid":0,"name":"a.exe","commandLine":"a","startedAt":1},{"pid":2,"ppid":1,"name":"b.exe","commandLine":"b","startedAt":2}]',
    );
    expect(many?.size).toBe(2);
    expect(many?.get(2)?.ppid).toBe(1);
  });

  it("returns null on empty or invalid json", () => {
    expect(parseProcessJson("")).toBeNull();
    expect(parseProcessJson("not-json")).toBeNull();
    expect(parseProcessJson("[]")).toBeNull();
  });
});
