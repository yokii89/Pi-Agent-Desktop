import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import type { ProcessSnapshot, ProcessSnapshotRow } from "./processWatch";

/**
 * 重启收养（docs/design/37 §5.4 P1 落地为 docs/design/133 §3）：
 * 登记项落盘 → 启动时逐个验存活 → 进待认领池 → 用户打开对应会话（同 sessionFile）时才成行。
 * 磁盘与 PowerShell 枚举都在 mock 之下，只验编排。
 */

const store = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  ignored: [] as { sessionFile: string; pid: number; commandLine: string; startedAt: number }[],
}));

vi.mock("../settings/procRegistryStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../settings/procRegistryStore")>();
  return {
    ...actual,
    loadProcRegistry: () => store.load(),
    saveProcRegistry: (file: { entries: unknown[]; ignored: unknown[] }) => {
      store.save(file);
      store.ignored = file.ignored as typeof store.ignored;
    },
  };
});

// isPidReuse 是纯函数，保持真实实现；只有会起 PowerShell 的两个入口换掉
vi.mock("./processKill", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./processKill")>();
  return {
    ...actual,
    enumerateProcesses: vi.fn(),
    getProcessSnapshot: vi.fn(),
  };
});

vi.mock("../window/createMainWindow", () => ({ getMainWindow: () => null }));

import type { PersistedProc } from "../settings/procRegistryStore";
import { getProcessSnapshot } from "./processKill";
import { createProcService } from "./procService";

function row(partial: Partial<ProcessSnapshotRow> & { pid: number }): ProcessSnapshotRow {
  return { ppid: 1, name: "node.exe", commandLine: "", startedAt: 1000, ...partial };
}

function snap(...rows: ProcessSnapshotRow[]): ProcessSnapshot {
  return new Map(rows.map((r) => [r.pid, r]));
}

function entry(partial: Partial<PersistedProc> = {}): PersistedProc {
  return {
    sessionFile: "/sessions/a.jsonl",
    pid: 400,
    ppid: 2,
    name: "curl.exe",
    commandLine: "curl -o isubs.tar https://x",
    startedAt: 1000,
    registeredAt: 1000,
    origin: "job",
    ...partial,
  };
}

function file(entries: PersistedProc[], ignored: unknown[] = []) {
  return { version: 1, entries, ignored };
}

function service(snapshots: (ProcessSnapshot | null)[]) {
  const enumerate = vi.fn<() => Promise<ProcessSnapshot | null>>();
  for (const s of snapshots) enumerate.mockResolvedValueOnce(s);
  (getProcessSnapshot as Mock).mockResolvedValue(snapshots[0] ?? null);
  return createProcService(enumerate);
}

const ALIVE = snap(row({ pid: 400, commandLine: "curl -o isubs.tar https://x", startedAt: 1000 }));

describe("procService 重启收养", () => {
  afterEach(() => {
    vi.clearAllMocks();
    store.load.mockReset();
    store.save.mockReset();
    store.ignored = [];
    (getProcessSnapshot as Mock).mockReset();
  });

  it("启动只验存活，会话开起来才成行", async () => {
    store.load.mockReturnValue(file([entry()]));
    const svc = service([ALIVE]);

    await svc.adoptSurvivors();
    expect(svc.listAllAlive()).toHaveLength(0);

    svc.noteSessionFile("sess_new", "/sessions/a.jsonl");
    await vi.waitFor(() => expect(svc.listAllAlive()).toHaveLength(1));
    const [proc] = svc.listAllAlive();
    expect(proc).toMatchObject({ pid: 400, origin: "job", sessionId: "sess_new" });
  });

  it("换个会话不开同名 sessionFile 就不会误认领", async () => {
    store.load.mockReturnValue(file([entry()]));
    const svc = service([ALIVE]);
    await svc.adoptSurvivors();
    svc.noteSessionFile("sess_other", "/sessions/b.jsonl");
    await new Promise((r) => setTimeout(r, 0));
    expect(svc.listAllAlive()).toHaveLength(0);
  });

  it("进程已经不在了就丢弃，并把它从盘上抹掉", async () => {
    store.load.mockReturnValue(file([entry()]));
    const svc = service([snap()]);
    await svc.adoptSurvivors();
    expect(svc.listAllAlive()).toHaveLength(0);
    expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ entries: [] }));
  });

  it("PID 被复用（创建时间漂移）不当成同一个进程", async () => {
    store.load.mockReturnValue(file([entry()]));
    const svc = service([snap(row({ pid: 400, startedAt: 999_000 }))]);
    await svc.adoptSurvivors();
    expect(svc.listAllAlive()).toHaveLength(0);
  });

  it("忽略过的进程重开后不回来", async () => {
    store.load.mockReturnValue(
      file(
        [entry()],
        [{ sessionFile: "/sessions/a.jsonl", pid: 400, commandLine: "", startedAt: 1000 }],
      ),
    );
    const svc = service([ALIVE]);
    await svc.adoptSurvivors();
    svc.noteSessionFile("s1", "/sessions/a.jsonl");
    await new Promise((r) => setTimeout(r, 0));
    expect(svc.listAllAlive()).toHaveLength(0);
  });

  it("枚举失败时不认领，条目留给下次", async () => {
    store.load.mockReturnValue(file([entry()]));
    const svc = service([null]);
    await svc.adoptSurvivors();
    svc.noteSessionFile("s1", "/sessions/a.jsonl");
    await new Promise((r) => setTimeout(r, 0));
    expect(svc.listAllAlive()).toHaveLength(0);
    expect(store.save).not.toHaveBeenCalled();
  });

  it("落盘写的是在世项，并带上会话锚点", async () => {
    store.load.mockReturnValue(file([]));
    const svc = service([ALIVE]);
    await svc.adoptSurvivors();
    svc.noteSessionFile("s1", "/sessions/a.jsonl");
    svc.registry.register({
      sessionId: "s1",
      pid: 700,
      ppid: 2,
      commandLine: "node vite",
      name: "node.exe",
      startedAt: 2000,
      origin: "service",
    });
    // 落盘是合批的（PERSIST_DEBOUNCE_MS），等过那个窗口
    await vi.waitFor(
      () =>
        expect(store.save).toHaveBeenCalledWith(
          expect.objectContaining({
            entries: [
              expect.objectContaining({
                pid: 700,
                sessionFile: "/sessions/a.jsonl",
                origin: "service",
              }),
            ],
          }),
        ),
      { timeout: 4_000, interval: 50 },
    );
  });
});
