import { afterEach, describe, expect, it, vi } from "vitest";
import type { ManagedProcess } from "../../shared/ipc";
import { ENDED_IDLE_MS, nextReadRange, ProcOutputTailer } from "./processOutputTail";

function proc(partial: Partial<ManagedProcess> = {}): ManagedProcess {
  return {
    id: "s1:100:1000",
    sessionId: "s1",
    pid: 100,
    ppid: 50,
    commandLine: "curl big file",
    name: "curl.exe",
    startedAt: 1000,
    registeredAt: 2000,
    origin: "job",
    status: "alive",
    ...partial,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("nextReadRange", () => {
  it("首读取尾部 headCap", () => {
    expect(nextReadRange(0, 1000, 400)).toEqual({ start: 600, end: 1000, truncated: false });
  });

  it("无增量返回 null；空文件返回 null", () => {
    expect(nextReadRange(1000, 1000)).toBeNull();
    expect(nextReadRange(0, 0)).toBeNull();
  });

  it("增量从上次偏移继续；不超 headCap 不跳段", () => {
    expect(nextReadRange(1000, 1500, 600)).toEqual({ start: 1000, end: 1500, truncated: false });
    expect(nextReadRange(1000, 1500, 400)).toEqual({ start: 1100, end: 1500, truncated: false });
  });

  it("单帧增量超 headCap 只读尾部一段（渲染层只展示尾部）", () => {
    expect(nextReadRange(100, 10_000, 400)).toEqual({ start: 9600, end: 10_000, truncated: false });
  });

  it("文件被截断重写（size < offset）：从尾部重读", () => {
    expect(nextReadRange(2000, 800, 400)).toEqual({ start: 400, end: 800, truncated: true });
  });
});

describe("ProcOutputTailer", () => {
  it("首帧读尾部、无增量不推；作业结束静默后推 ended 并停止", async () => {
    vi.useFakeTimers();
    const now = { value: 10_000 };
    const isJobLive = vi.fn((): boolean | null => true);
    const push = vi.fn();
    const tailer = new ProcOutputTailer({
      readSlice: vi.fn(async (_path: string, start: number, end: number) => `[${start}-${end}]`),
      sizeOf: vi.fn((_path: string) => 300),
      now: () => now.value,
      isJobLive,
    });
    const p = proc();
    tailer.start(p, "/logs/J-1.log", push);

    await vi.advanceTimersByTimeAsync(300);
    expect(push).toHaveBeenCalledWith({
      sessionId: "s1",
      id: p.id,
      type: "data",
      payload: "[0-300]",
    });
    // 偏移已到文件尾：无增量不推
    await vi.advanceTimersByTimeAsync(600);
    expect(push).toHaveBeenCalledTimes(1);

    // 作业翻 settled：静默超过宽限期后收尾
    isJobLive.mockReturnValue(false);
    now.value += ENDED_IDLE_MS + 100;
    await vi.advanceTimersByTimeAsync(300);
    expect(push).toHaveBeenCalledWith({ sessionId: "s1", id: p.id, type: "ended", payload: "" });
    // tail 已移除：后续 tick 不再有推送
    const calls = push.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1200);
    expect(push.mock.calls.length).toBe(calls);
  });

  it("文件缺失但作业仍 live：不 ended（可能尚未产生输出）", async () => {
    vi.useFakeTimers();
    const isJobLive = vi.fn((): boolean | null => true);
    const push = vi.fn();
    const tailer = new ProcOutputTailer({
      readSlice: vi.fn(async () => ""),
      sizeOf: vi.fn(() => null),
      now: () => 10_000,
      isJobLive,
    });
    tailer.start(proc(), "/logs/J-1.log", push);
    await vi.advanceTimersByTimeAsync(3000);
    expect(push).not.toHaveBeenCalled();
    tailer.stopAll();
  });

  it("文件连续缺失且作业已结束：推 ended", async () => {
    vi.useFakeTimers();
    const isJobLive = vi.fn((): boolean | null => false);
    const push = vi.fn();
    const tailer = new ProcOutputTailer({
      readSlice: vi.fn(async () => ""),
      sizeOf: vi.fn(() => null),
      now: () => 10_000,
      isJobLive,
    });
    tailer.start(proc(), "/logs/J-1.log", push);
    await vi.advanceTimersByTimeAsync(1200);
    expect(push).toHaveBeenCalledWith({
      sessionId: "s1",
      id: proc().id,
      type: "ended",
      payload: "",
    });
  });

  it("start 同 id 幂等（路径相同），stop 后不再推送", async () => {
    vi.useFakeTimers();
    const push = vi.fn();
    const tailer = new ProcOutputTailer({
      readSlice: vi.fn(async () => "x"),
      sizeOf: vi.fn(() => 10),
      now: () => 10_000,
      isJobLive: () => true,
    });
    const p = proc();
    tailer.start(p, "/logs/J-1.log", push);
    tailer.start(p, "/logs/J-1.log", push);
    tailer.stop(p.id);
    await vi.advanceTimersByTimeAsync(1200);
    expect(push).not.toHaveBeenCalled();
  });
});
