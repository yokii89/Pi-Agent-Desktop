import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ManagedProcess, PROC_OUTPUT_TAIL_CAP } from "../../shared/ipc";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  onChanged: vi.fn((_cb: unknown) => () => {}),
  onOutput: vi.fn((_cb: unknown) => () => {}),
  outputStart: vi.fn(),
  outputStop: vi.fn(() => Promise.resolve()),
}));

vi.mock("../services/procService", () => ({
  procService: {
    list: mocks.list,
    onChanged: mocks.onChanged,
    onOutput: mocks.onOutput,
    outputStart: mocks.outputStart,
    outputStop: mocks.outputStop,
  },
}));

import {
  bindProcOutputStream,
  getProcOutput,
  refreshSessionProcesses,
  startOutputFeed,
  stopOutputFeed,
} from "./procStore";

function push(message: { id: string; type: "data" | "ended"; payload: string }): void {
  const handler = mocks.onOutput.mock.calls.at(-1)?.[0] as ((message: unknown) => void) | undefined;
  if (handler) handler(message);
}

describe("refreshSessionProcesses", () => {
  beforeEach(() => {
    mocks.list.mockReset();
  });

  it("同会话并发只发一次 list", async () => {
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
    resolveList([]);
    await Promise.all([first, second]);
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

describe("实时输出跟随（方案 B）", () => {
  beforeEach(() => {
    mocks.outputStart.mockReset();
    mocks.outputStop.mockClear();
    mocks.onOutput.mockClear();
    bindProcOutputStream();
  });

  it("data 增量合并、ended 终态、stop 保留文本", async () => {
    mocks.outputStart.mockResolvedValue({ logPath: "/tmp/j1.log" });
    await startOutputFeed("p1");
    push({ id: "p1", type: "data", payload: "hello " });
    push({ id: "p1", type: "data", payload: "world" });
    expect(getProcOutput("p1")).toMatchObject({
      text: "hello world",
      ended: false,
      active: true,
      logPath: "/tmp/j1.log",
    });
    stopOutputFeed("p1");
    expect(getProcOutput("p1")?.active).toBe(false);
    expect(getProcOutput("p1")?.text).toBe("hello world");
    push({ id: "p1", type: "ended", payload: "" });
    expect(getProcOutput("p1")?.ended).toBe(true);
  });

  it("重复 start 幂等：active 期间不再发 outputStart，且文本重置由主进程首帧重发覆盖", async () => {
    mocks.outputStart.mockResolvedValue({ logPath: null });
    await startOutputFeed("p1");
    push({ id: "p1", type: "data", payload: "chunk" });
    await startOutputFeed("p1");
    expect(mocks.outputStart).toHaveBeenCalledTimes(1);
    expect(getProcOutput("p1")?.text).toBe("chunk");
  });

  it("文本超 64KB 只保留尾部（与主进程读入口径一致）", () => {
    push({ id: "p2", type: "data", payload: "x".repeat(PROC_OUTPUT_TAIL_CAP + 100) });
    const feed = getProcOutput("p2");
    expect(feed?.text.length).toBe(PROC_OUTPUT_TAIL_CAP);
  });

  it("outputStart 失败：feed 落到空 ended 态，不展示跟随", async () => {
    mocks.outputStart.mockRejectedValue(new Error("进程登记项不存在"));
    await expect(startOutputFeed("p3")).resolves.toBeNull();
    expect(getProcOutput("p3")).toMatchObject({ ended: true, active: false, text: "" });
  });

  it("登记行消失时 prune 掉对应 feed（applySession 驱动）", async () => {
    mocks.outputStart.mockResolvedValue({ logPath: null });
    await startOutputFeed("p4");
    push({ id: "p4", type: "data", payload: "text" });
    mocks.list.mockResolvedValue([]);
    await refreshSessionProcesses("s1");
    expect(getProcOutput("p4")).toBeNull();
  });
});
