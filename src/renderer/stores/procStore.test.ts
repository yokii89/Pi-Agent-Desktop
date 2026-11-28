import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagedProcess } from "../../shared/ipc";

const mocks = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("../services/procService", () => ({
  procService: { list: mocks.list },
}));

import { procStore, refreshSessionProcesses } from "./procStore";

describe("refreshSessionProcesses", () => {
  beforeEach(() => {
    mocks.list.mockReset();
    procStore.applySession("s1", []);
  });

  it("同会话并发只发一次 list 并更新存活计数", async () => {
    let resolveList!: (value: ManagedProcess[]) => void;
    mocks.list.mockImplementation(
      () =>
        new Promise<ManagedProcess[]>((resolve) => {
          resolveList = resolve;
        }),
    );
    const first = refreshSessionProcesses("s1");
    const second = refreshSessionProcesses("s1");
    await Promise.resolve();
    expect(mocks.list).toHaveBeenCalledTimes(1);
    resolveList([{ id: "p1", status: "alive" } as ManagedProcess]);
    await Promise.all([first, second]);
    expect(procStore.aliveCount("s1")).toBe(1);
  });

  it("list 同步抛出后不留下已完成的在途条目", async () => {
    mocks.list.mockImplementation(() => {
      throw new Error("preload 未就绪");
    });
    await expect(refreshSessionProcesses("s1")).resolves.toBeUndefined();
    await expect(refreshSessionProcesses("s1")).resolves.toBeUndefined();
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });
});
