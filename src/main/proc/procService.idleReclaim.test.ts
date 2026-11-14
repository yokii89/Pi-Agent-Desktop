import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProcessSnapshot, ProcessSnapshotRow } from "./processWatch";

const disk = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../settings/procRegistryStore", () => ({
  loadProcRegistry: disk.load,
  saveProcRegistry: vi.fn(),
  procIdentity: (file: string, pid: number, startedAt: number) => `${file}:${pid}:${startedAt}`,
}));
vi.mock("../window/createMainWindow", () => ({ getMainWindow: () => null }));
vi.mock("./processKill", async (original) => ({
  ...(await original<typeof import("./processKill")>()),
  getProcessSnapshot: async () => null,
}));

import { ProcessWatcher, WATCH_TIMING } from "./processWatch";
import { createProcService } from "./procService";

const ROOT: ProcessSnapshotRow = {
  pid: 1,
  ppid: 0,
  startedAt: 1,
  name: "node.exe",
  commandLine: "pi",
};
const JOB: ProcessSnapshotRow = {
  pid: 2,
  ppid: 1,
  startedAt: 1100,
  name: "curl.exe",
  commandLine: "curl file",
};
function snapshot(...rows: ProcessSnapshotRow[]): ProcessSnapshot {
  return new Map(rows.map((row) => [row.pid, row]));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  disk.load.mockReturnValue({ version: 1, entries: [], ignored: [] });
});
afterEach(() => vi.useRealTimers());

describe("后台回收不使用展示过滤作为存活证据", () => {
  it.each(["alive", "ignored"] as const)("%s 的长任务都保护，消失后才放行", async (status) => {
    const enumerate = vi.fn().mockResolvedValue(snapshot(JOB));
    const svc = createProcService(enumerate);
    const proc = svc.registry.register({ ...JOB, sessionId: "a", origin: "job" });
    expect(proc).not.toBeNull();
    if (proc) svc.registry.setStatus(proc.id, status);
    expect(await svc.hasBackgroundWork("a")).toBe(true);
    enumerate.mockResolvedValue(snapshot());
    expect(await svc.hasBackgroundWork("a")).toBe(false);
  });
  it("命令行变化不能冒充进程已退出", async () => {
    const svc = createProcService(async () => snapshot({ ...JOB, commandLine: "new title" }));
    svc.registry.register({ ...JOB, sessionId: "a", origin: "job" });
    expect(await svc.hasBackgroundWork("a")).toBe(true);
  });
  it("缺失创建时间保留，明确 PID 复用才放行", async () => {
    const enumerate = vi.fn().mockResolvedValue(snapshot({ ...JOB, startedAt: 0 }));
    const svc = createProcService(enumerate);
    svc.registry.register({ ...JOB, sessionId: "a", origin: "job" });
    expect(await svc.hasBackgroundWork("a")).toBe(true);
    enumerate.mockResolvedValue(snapshot({ ...JOB, startedAt: 999_999 }));
    expect(await svc.hasBackgroundWork("a")).toBe(false);
  });
  it("没有登记项但枚举失败时仍保留", async () => {
    expect(await createProcService(async () => null).hasBackgroundWork("a")).toBe(true);
  });
  it("上次运行忽略的存活进程依然保护同一 sessionFile", async () => {
    disk.load.mockReturnValue({
      version: 1,
      entries: [],
      ignored: [{ sessionFile: "/a.jsonl", ...JOB }],
    });
    const svc = createProcService(async () => snapshot(JOB));
    await svc.adoptSurvivors();
    svc.noteSessionFile("a", "/a.jsonl");
    expect(await svc.hasBackgroundWork("a")).toBe(true);
    expect(await svc.hasBackgroundWork("b")).toBe(false);
  });
  it("待认领记录不能因为还未进 UI 登记表而漏保护", async () => {
    disk.load.mockReturnValue({
      version: 1,
      ignored: [],
      entries: [{ ...JOB, sessionFile: "/a.jsonl", registeredAt: 1000, origin: "job" }],
    });
    const enumerate = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(snapshot(JOB));
    const svc = createProcService(enumerate);
    await svc.adoptSurvivors();
    svc.noteSessionFile("a", "/a.jsonl");
    expect(svc.countAlive("a")).toBe(0);
    expect(await svc.hasBackgroundWork("a")).toBe(true);
  });
});

describe("完整 bash 边界证据", () => {
  it("baseline 尚未返回时不允许回收", async () => {
    let resolve!: (value: ProcessSnapshot) => void;
    const watcher = new ProcessWatcher({
      enumerate: () =>
        new Promise((done) => {
          resolve = done;
        }),
      register: vi.fn(),
      markExited: vi.fn(),
    });
    const start = watcher.noteBashStart("a", 1, "tool");
    expect(watcher.hasPotentialBackgroundWork("a", snapshot(ROOT))).toBe(true);
    resolve(snapshot(ROOT));
    await start;
    watcher.dispose();
  });
  it.each(["powershell.exe", "curl.exe", "node.exe"])(
    "%s 尚未登记也保护，完整消失才放行",
    async (name) => {
      const job = { ...JOB, name };
      const enumerate = vi
        .fn()
        .mockResolvedValueOnce(snapshot(ROOT))
        .mockResolvedValue(snapshot(ROOT, job));
      const register = vi.fn();
      const watcher = new ProcessWatcher({ enumerate, register, markExited: vi.fn() });
      await watcher.noteBashStart("a", 1, "tool");
      watcher.noteBashEnd("a", "tool");
      await vi.advanceTimersByTimeAsync(WATCH_TIMING.settleMs);
      expect(register).not.toHaveBeenCalled();
      expect(watcher.hasPotentialBackgroundWork("a", snapshot(ROOT, job))).toBe(true);
      expect(watcher.hasPotentialBackgroundWork("a", snapshot(ROOT))).toBe(false);
      watcher.dispose();
    },
  );
  it.each(["baseline", "end"])("%s 枚举失败不能推断无任务", async (where) => {
    const enumerate = vi
      .fn()
      .mockResolvedValueOnce(where === "baseline" ? null : snapshot(ROOT))
      .mockResolvedValue(where === "end" ? null : snapshot(ROOT));
    const watcher = new ProcessWatcher({ enumerate, register: vi.fn(), markExited: vi.fn() });
    await watcher.noteBashStart("a", 1, "tool");
    watcher.noteBashEnd("a", "tool");
    await vi.advanceTimersByTimeAsync(WATCH_TIMING.settleMs);
    expect(watcher.hasPotentialBackgroundWork("a", snapshot(ROOT))).toBe(true);
    watcher.cancelSession("a");
    expect(watcher.hasPotentialBackgroundWork("a", snapshot(ROOT))).toBe(false);
    watcher.dispose();
  });
  it("短命命令的完整快照为空时不会永久阻止回收", async () => {
    const watcher = new ProcessWatcher({
      enumerate: async () => snapshot(ROOT),
      register: vi.fn(),
      markExited: vi.fn(),
    });
    await watcher.noteBashStart("a", 1, "tool");
    watcher.noteBashEnd("a", "tool");
    await vi.advanceTimersByTimeAsync(WATCH_TIMING.settleMs);
    expect(watcher.hasPotentialBackgroundWork("a", snapshot(ROOT))).toBe(false);
    watcher.dispose();
  });
});
