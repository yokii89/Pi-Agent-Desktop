import { describe, expect, it } from "vitest";
import type { ManagedProcess } from "../../shared/ipc";
import { orderProcesses, procRowTitle } from "./procRows";

function proc(partial: Partial<ManagedProcess> & { id: string }): ManagedProcess {
  return {
    sessionId: "s1",
    pid: 100,
    ppid: 50,
    commandLine: "node vite",
    name: "node.exe",
    startedAt: 1000,
    registeredAt: 1000,
    origin: "service",
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

/** 登记口径进 tooltip（行太窄）：后台作业要说清是长任务转了后台，不是起错了服务。 */
describe("procRowTitle", () => {
  const t = (key: string) => `«${key}»`;

  it("服务行只带命令行与口径", () => {
    const title = procRowTitle(t, proc({ id: "a", commandLine: "node vite" }));
    expect(title).toBe("node vite\n«proc.origin.service»");
  });

  it("作业行附解释，且不吞掉附加行", () => {
    const title = procRowTitle(t, proc({ id: "a", commandLine: "curl -o x", origin: "job" }), [
      "2h",
    ]);
    expect(title).toBe("curl -o x\n2h\n«proc.origin.job»\n«proc.origin.job.hint»");
  });
});
