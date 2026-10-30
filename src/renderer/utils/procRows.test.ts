import { describe, expect, it } from "vitest";
import type { ManagedProcess } from "../../shared/ipc";
import { orderProcesses } from "./procRows";

function proc(partial: Partial<ManagedProcess> & { id: string }): ManagedProcess {
  return {
    sessionId: "s1",
    pid: 100,
    ppid: 50,
    commandLine: "node vite",
    name: "node.exe",
    startedAt: 1000,
    registeredAt: 1000,
    status: "alive",
    ...partial,
  };
}

describe("orderProcesses", () => {
  it("存活在前，已结束在后且新的在前", () => {
    const ordered = orderProcesses([
      proc({ id: "dead-old", status: "killed", registeredAt: 100 }),
      proc({ id: "alive-2", registeredAt: 300 }),
      proc({ id: "dead-new", status: "exited", registeredAt: 900 }),
      proc({ id: "alive-1", registeredAt: 200 }),
    ]);
    expect(ordered.map((p) => p.id)).toEqual(["alive-1", "alive-2", "dead-new", "dead-old"]);
  });

  it("忽略的不展示", () => {
    const ordered = orderProcesses([
      proc({ id: "ignored", status: "ignored" }),
      proc({ id: "alive" }),
    ]);
    expect(ordered.map((p) => p.id)).toEqual(["alive"]);
  });

  it("空列表返回空数组", () => {
    expect(orderProcesses([])).toEqual([]);
  });
});
