import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ManagedProcess, ProcDetail } from "../../shared/ipc";
import type { ViewBashJob } from "../../shared/view";
import type { ProcessSnapshotRow } from "../proc/processWatch";
import { BashJobAccess, type BashJobAccessPorts, savedBashLogPath } from "./bashJobAccess";

const job: ViewBashJob = {
  id: "J-1",
  command: "pnpm dev",
  mode: "detach",
  status: "running",
  reason: "explicit",
  pid: 20,
  startedAt: 1000,
  lastOutputAt: 1000,
  detached: true,
  outputBytes: 0,
  outputLines: 0,
  processStartedAt: 1000,
  logSessionId: "pi-session",
  logAvailable: true,
};
const row: ProcessSnapshotRow = {
  pid: 20,
  ppid: 10,
  name: "bash.exe",
  commandLine: "bash pnpm dev",
  startedAt: 1000,
};
const detail: ProcDetail = {
  at: 3000,
  alive: true,
  descendants: [],
  ports: [],
  memoryBytes: 128,
  processCount: 1,
  portsReadable: true,
  cpuPercent: null,
};

function fixture(overrides: Partial<BashJobAccessPorts> = {}) {
  const ports: BashJobAccessPorts = {
    resolve: () => ({ sessionId: "host-session", job }),
    snapshot: async () =>
      new Map([
        [10, { ...row, pid: 10, ppid: 1, startedAt: 500 }],
        [20, row],
      ]),
    sessionPid: () => 10,
    processes: () => [],
    detail: vi.fn(async () => detail),
    agentDir: () => "/agent",
    openLog: vi.fn(async () => {}),
    ...overrides,
  };
  return { ports, access: new BashJobAccess(ports) };
}

describe("Bash workspace scoped Host access", () => {
  it("reads the job's verified session process without accepting a renderer PID", async () => {
    const { access, ports } = fixture();
    const result = await access.inspect("view", "J-1");
    expect(result.alive).toBe(true);
    expect(result.root?.pid).toBe(20);
    expect(result.cpuPercent).toBeNull();
    expect(ports.detail).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "host-session", pid: 20, origin: "job" }),
    );
  });

  it("rejects unavailable workspaces before performing OS queries", async () => {
    const snapshot = vi.fn(async () => null);
    const { access } = fixture({
      snapshot,
      resolve: () => {
        throw new Error("closed");
      },
    });
    await expect(access.inspect("closed", "J-1")).rejects.toThrow("closed");
    expect(snapshot).not.toHaveBeenCalled();
  });

  it("rejects a process outside the owning session tree", async () => {
    const { access, ports } = fixture({ sessionPid: () => 99 });
    await expect(access.inspect("view", "J-1")).rejects.toThrow("belong");
    expect(ports.detail).not.toHaveBeenCalled();
  });

  it("allows a verified survivor already adopted by that session", async () => {
    const managed: ManagedProcess = {
      ...row,
      id: "adopted",
      sessionId: "host-session",
      registeredAt: 1000,
      origin: "job",
      status: "alive",
    };
    const { access } = fixture({ sessionPid: () => 99, processes: () => [managed] });
    await expect(access.inspect("view", "J-1")).resolves.toMatchObject({ alive: true });
  });

  it("refuses reused PIDs even when a new occupant is a descendant of the same session", async () => {
    const { access } = fixture({
      resolve: () => ({ sessionId: "host-session", job: { ...job, processStartedAt: 900 } }),
    });
    await expect(access.inspect("view", "J-1")).rejects.toThrow("identity");
  });

  it("does not treat a failed process query as an observed exit", async () => {
    const { access } = fixture({ snapshot: async () => null });
    await expect(access.inspect("view", "J-1")).rejects.toThrow("unavailable");
  });

  it("reports an absent process without inventing an exit code", async () => {
    const { access } = fixture({ snapshot: async () => new Map() });
    const result = await access.inspect("view", "J-1");
    expect(result).toMatchObject({ alive: false, root: null, cpuPercent: null });
    expect(result).not.toHaveProperty("exitCode");
  });

  it("discards an asynchronous result after the View changes owners", async () => {
    let sessionId = "host-session";
    const { access } = fixture({
      resolve: () => ({ sessionId, job }),
      detail: async () => {
        sessionId = "other-session";
        return detail;
      },
    });
    await expect(access.inspect("view", "J-1")).rejects.toThrow("changed");
  });

  it("opens a derived retained log, including a prior /new log owner", async () => {
    const { access, ports } = fixture();
    await access.openLog("view", "J-1");
    expect(ports.openLog).toHaveBeenCalledWith(
      join("/agent", "bash-jobs", "logs", "pi-session", "J-1.log"),
      join("/agent", "bash-jobs", "logs"),
    );
  });

  it.each(["../escape", "a/b", "a\\b", ".", ""]) (
    "rejects non-identifier log owners: %s",
    (logSessionId) => {
      expect(() => savedBashLogPath("/agent", { ...job, logSessionId })).toThrow();
    },
  );
});
