import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ProcessSnapshot,
  type ProcessSnapshotRow,
  ProcessWatcher,
  WATCH_TIMING,
} from "./processWatch";

function row(partial: Partial<ProcessSnapshotRow> & { pid: number }): ProcessSnapshotRow {
  return {
    ppid: 0,
    name: "node.exe",
    commandLine: "",
    startedAt: 1000,
    ...partial,
  };
}

function snap(...rows: ProcessSnapshotRow[]): ProcessSnapshot {
  return new Map(rows.map((r) => [r.pid, r]));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** 根 pi → bash 壳 → vite 服务。 */
const baselineWithService = snap(
  row({ pid: 1, ppid: 0 }),
  row({ pid: 2, ppid: 1, name: "bash.exe", startedAt: 900 }),
  row({ pid: 300, ppid: 2, commandLine: "node vite", startedAt: 1100 }),
);
const baselineWithoutService = snap(
  row({ pid: 1, ppid: 0 }),
  row({ pid: 2, ppid: 1, name: "bash.exe", startedAt: 900 }),
);

describe("ProcessWatcher 边界编排", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("end 先于 baseline 到达：baseline 补齐后仍收口并登记", async () => {
    const baseline = deferred<ProcessSnapshot | null>();
    const enumerate = vi
      .fn<() => Promise<ProcessSnapshot | null>>()
      .mockImplementationOnce(() => baseline.promise)
      .mockResolvedValue(baselineWithService);
    const register = vi.fn();
    const watcher = new ProcessWatcher({ enumerate, register, markExited: vi.fn() });

    const started = watcher.noteBashStart("s1", 1, "t1");
    watcher.noteBashEnd("s1", "t1");
    baseline.resolve(baselineWithService);
    await started;

    await vi.advanceTimersByTimeAsync(WATCH_TIMING.settleMs + WATCH_TIMING.recheckMs[0]);
    expect(register).toHaveBeenCalledTimes(1);
    expect(register.mock.calls[0]?.[0]).toMatchObject({
      sessionId: "s1",
      pid: 300,
      sourceToolCallId: "t1",
    });
    watcher.dispose();
  });

  it("baseline 晚拍已含新服务：按创建时间判据仍登记", async () => {
    const enumerate = vi
      .fn<() => Promise<ProcessSnapshot | null>>()
      .mockResolvedValue(baselineWithService);
    const register = vi.fn();
    const watcher = new ProcessWatcher({ enumerate, register, markExited: vi.fn() });

    await watcher.noteBashStart("s1", 1, "t1");
    watcher.noteBashEnd("s1", "t1");
    await vi.advanceTimersByTimeAsync(WATCH_TIMING.settleMs + WATCH_TIMING.recheckMs[0]);
    expect(register).toHaveBeenCalledTimes(1);
    expect(register.mock.calls[0]?.[0]).toMatchObject({ pid: 300 });
    watcher.dispose();
  });

  it("baseline 里早于 bash 起点的既有服务不重复登记", async () => {
    const preexisting = snap(
      row({ pid: 1, ppid: 0 }),
      row({ pid: 2, ppid: 1, name: "bash.exe", startedAt: 900 }),
      row({ pid: 300, ppid: 2, commandLine: "node vite", startedAt: 500 }),
    );
    const enumerate = vi.fn<() => Promise<ProcessSnapshot | null>>().mockResolvedValue(preexisting);
    const register = vi.fn();
    const watcher = new ProcessWatcher({ enumerate, register, markExited: vi.fn() });

    await watcher.noteBashStart("s1", 1, "t1");
    watcher.noteBashEnd("s1", "t1");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(register).not.toHaveBeenCalled();
    watcher.dispose();
  });

  it("复核枚举失败不标 exited，后续档继续检查", async () => {
    const enumerate = vi
      .fn<() => Promise<ProcessSnapshot | null>>()
      .mockResolvedValueOnce(baselineWithoutService) // baseline
      .mockResolvedValueOnce(baselineWithService) // boundary
      .mockResolvedValueOnce(baselineWithService) // 1s：登记
      .mockResolvedValueOnce(null) // 5s：枚举失败
      .mockResolvedValue(baselineWithService); // 15s
    const register = vi.fn();
    const markExited = vi.fn();
    const watcher = new ProcessWatcher({ enumerate, register, markExited });

    await watcher.noteBashStart("s1", 1, "t1");
    watcher.noteBashEnd("s1", "t1");
    await vi.advanceTimersByTimeAsync(WATCH_TIMING.settleMs + WATCH_TIMING.recheckMs[2] + 1000);
    expect(register).toHaveBeenCalledTimes(1);
    expect(markExited).not.toHaveBeenCalled();
    watcher.dispose();
  });

  it("第 0 档枚举失败重试一次，成功后登记", async () => {
    const enumerate = vi
      .fn<() => Promise<ProcessSnapshot | null>>()
      .mockResolvedValueOnce(baselineWithoutService) // baseline
      .mockResolvedValueOnce(baselineWithService) // boundary
      .mockResolvedValueOnce(null) // 1s：失败
      .mockResolvedValue(baselineWithService); // 重试成功
    const register = vi.fn();
    const markExited = vi.fn();
    const watcher = new ProcessWatcher({ enumerate, register, markExited });

    await watcher.noteBashStart("s1", 1, "t1");
    watcher.noteBashEnd("s1", "t1");
    await vi.advanceTimersByTimeAsync(
      WATCH_TIMING.settleMs + WATCH_TIMING.recheckMs[0] + WATCH_TIMING.recheckRetryMs,
    );
    expect(register).toHaveBeenCalledTimes(1);
    expect(markExited).not.toHaveBeenCalled();
    watcher.dispose();
  });

  it("复核确认 PID 消失时（非枚举失败）标 exited", async () => {
    const withoutService = snap(
      row({ pid: 1, ppid: 0 }),
      row({ pid: 2, ppid: 1, name: "bash.exe", startedAt: 900 }),
    );
    const enumerate = vi
      .fn<() => Promise<ProcessSnapshot | null>>()
      .mockResolvedValueOnce(baselineWithoutService) // baseline
      .mockResolvedValueOnce(baselineWithService) // boundary
      .mockResolvedValueOnce(baselineWithService) // 1s：登记
      .mockResolvedValue(withoutService); // 5s：确实消失
    const register = vi.fn();
    const markExited = vi.fn();
    const watcher = new ProcessWatcher({ enumerate, register, markExited });

    await watcher.noteBashStart("s1", 1, "t1");
    watcher.noteBashEnd("s1", "t1");
    await vi.advanceTimersByTimeAsync(WATCH_TIMING.settleMs + WATCH_TIMING.recheckMs[1]);
    expect(register).toHaveBeenCalledTimes(1);
    expect(markExited).toHaveBeenCalledWith(300, "s1");
    watcher.dispose();
  });
});
