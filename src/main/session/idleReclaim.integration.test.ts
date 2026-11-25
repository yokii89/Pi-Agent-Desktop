import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry } from "@earendil-works/pi-durable";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DurableCommand, RuntimeSessionUpdate } from "../../shared/durableProtocol";
import type { SessionSummary } from "../../shared/ipc";
import type { SchedulerSnapshot } from "../../shared/scheduler";

const f = vi.hoisted(() => ({
  root: "",
  summaries: [] as SessionSummary[],
  request: vi.fn(),
  updates: new Set<(update: RuntimeSessionUpdate) => void>(),
  scheduler: { tasks: [], runs: [] } as SchedulerSnapshot,
}));
vi.mock("electron", () => ({ powerMonitor: { on() {}, off() {} }, shell: { trashItem: vi.fn() } }));
vi.mock("../window/createMainWindow", () => ({ getMainWindow: () => null }));
vi.mock("../extension/contributionCatalog", () => ({
  getCatalogSnapshot: () => ({ fingerprint: "test" }),
}));
vi.mock("../view/viewHost", () => ({ hasSessionModal: () => false }));
vi.mock("./extensionUi", () => ({ pendingUiCount: () => 0, pendingUiRequests: () => [] }));
vi.mock("./piSession", () => ({ respondSessionUi: () => false }));
vi.mock("./backgroundJobs", () => ({ hasLiveBackgroundJobs: async () => false }));
vi.mock("./piInfo", () => ({ getPiAgentDir: () => f.root }));
vi.mock("../settings/settings", () => ({
  getSettings: () => ({
    maxParallelSessions: 8,
    sessionIdleReclaimMinutes: 30,
    archivedSessions: {},
    projects: [{ id: "project", name: "Project", dir: f.root }],
  }),
}));
vi.mock("../settings/scheduledTaskStore", () => ({
  loadScheduledTasks: () => f.scheduler,
  saveScheduledTasks: (value: SchedulerSnapshot) => {
    f.scheduler = value;
  },
  trimScheduledRuns: (runs: unknown[]) => runs,
}));
vi.mock("../settings/durableStore", () => ({
  durableStorageRoot: () => path.join(f.root, "durable"),
  durableCatalog: () => [...f.summaries],
  readDurableModel: () => ({ modelId: "faux" }),
  saveDurableSummary: (summary: SessionSummary) => {
    f.summaries = [...f.summaries.filter((item) => item.id !== summary.id), summary];
  },
  removeDurableSummary: (id: string) => {
    f.summaries = f.summaries.filter((item) => item.id !== id);
  },
}));
vi.mock("../agentRuntime/agentRuntimeManager", () => ({
  agentRuntimeManager: {
    request: (command: DurableCommand) => f.request(command),
    pid: () => 1234,
    subscribe: (update: (value: RuntimeSessionUpdate) => void) => {
      f.updates.add(update);
      return () => f.updates.delete(update);
    },
  },
}));

import { readDurableEntries } from "../../agentRuntime/durableHistory";
import { DurableSessions } from "../../agentRuntime/durableSessions";
import { desktopSessions } from "../agentRuntime/desktopSessions";
import { DesktopReadOnlySource } from "../remote/desktopSource";
import {
  createScheduledTask,
  disposeTaskScheduler,
  getSchedulerSnapshot,
  initTaskScheduler,
  runScheduledTaskNow,
} from "../scheduler/taskScheduler";
import { disposeIdleSession } from "./disposeIdleSession";
import { __resetIdleReclaimForTests, noteViewingSession, scanIdleSessions } from "./idleReclaim";
import {
  __resetRuntimeCoordinatorForTests,
  getRuntimeState,
  listLiveSessionSnapshots,
  listRuntimeSnapshots,
} from "./runtimeCoordinator";
import { encodeCwdToSessionDir } from "./sessionHistory";
import { sessionRepository } from "./sessionRepository";

let service: DurableSessions;
let faux: ReturnType<typeof fauxProvider>;
async function until(check: () => boolean | Promise<boolean>) {
  const deadline = performance.now() + 5000;
  while (!(await check())) {
    if (performance.now() > deadline) throw new Error("Durable integration timed out.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

beforeEach(async () => {
  f.root = await mkdtemp(path.join(tmpdir(), "pidesk-lifecycle-"));
  f.summaries = [];
  f.scheduler = { tasks: [], runs: [] };
  __resetRuntimeCoordinatorForTests();
  __resetIdleReclaimForTests();
  const models = createModels();
  faux = fauxProvider();
  models.setProvider(faux.provider);
  service = new DurableSessions(
    path.join(f.root, "durable"),
    () => ({ models, registry: createRegistry() }),
    (update) => {
      for (const listener of f.updates) listener(update);
    },
  );
  f.request.mockImplementation(async (command: DurableCommand) => {
    if (command.op === "initialize") return null;
    if (command.op === "model") return null;
    const id = command.sessionId;
    switch (command.op) {
      case "open":
        return service.open({
          ...command,
          agent: { model: { provider: faux.provider.id, modelId: faux.models[0].id } },
        });
      case "submit":
        return {
          ...(await service.submit(id, {
            type: "input",
            content: command.text,
            requestId: command.requestId,
            whenBusy: command.mode,
          })),
          disposition: "started",
        };
      case "close":
        return service.close(id);
      case "closeIdle":
        return service.closeIdle(id);
      case "abort":
        return service.abort(id);
      case "history":
        return service.entries(id, command.before as never, command.limit);
      case "readHistory":
        return readDurableEntries(path.join(f.root, "durable"), id, command.before, command.limit);
      case "snapshot": {
        const view = await service.snapshot(id);
        for (const listener of f.updates) listener({ type: "snapshot", sessionId: id, view });
        return null;
      }
      default:
        throw new Error(`Unexpected test command: ${command.op}`);
    }
  });
});
afterEach(async () => {
  disposeTaskScheduler();
  __resetIdleReclaimForTests();
  for (const row of listRuntimeSnapshots(true)) await desktopSessions.close(row.sessionId);
  await service.dispose();
  vi.useRealTimers();
  await rm(f.root, { recursive: true, force: true });
});

async function open() {
  const id = await desktopSessions.start({ cwd: f.root });
  await until(() => getRuntimeState(id) === "idle");
  return id;
}
async function legacy(count = 205) {
  const directory = path.join(f.root, "sessions", encodeCwdToSessionDir(f.root));
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, "legacy.jsonl");
  const rows: unknown[] = [
    { type: "session", id: "legacy", cwd: f.root, timestamp: new Date().toISOString() },
  ];
  for (let i = 0; i < count; i++)
    rows.push({
      type: "message",
      message: { role: "user", content: [{ type: "text", text: `legacy-${i}` }] },
    });
  await writeFile(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  return file;
}

describe("Durable application lifecycle and stored history", () => {
  it("lists the actual attachment and closes only its writer, preserving saved history", async () => {
    const a = await open();
    const b = await open();
    expect(listLiveSessionSnapshots().map((row) => row.sessionId)).toEqual([a, b]);
    expect(await disposeIdleSession(a)).toBe("ended");
    expect(listLiveSessionSnapshots().map((row) => row.sessionId)).toEqual([b]);
    expect(await disposeIdleSession(a)).toBe("not-running");
    expect(await sessionRepository.list(f.root)).toHaveLength(2);
  });

  it("keeps busy through execution and rejects idle close until the real settled event", async () => {
    const id = await open();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    faux.setResponses([
      async () => {
        await held;
        return fauxAssistantMessage("answer");
      },
    ]);
    try {
      await desktopSessions.submit(id, "work");
      await until(() => faux.state.callCount === 1);
      expect(getRuntimeState(id)).toBe("busy");
      expect(await disposeIdleSession(id)).toBe("busy");
    } finally {
      release();
    }
    await until(() => getRuntimeState(id) === "idle");
    expect(await disposeIdleSession(id)).toBe("ended");
  });

  it("reclaims an unwatched idle attachment and keeps the watched one", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const a = await open();
    const b = await open();
    vi.setSystemTime(Date.now() + 31 * 60_000);
    noteViewingSession({ sessionId: b, sessionPage: true });
    expect((await scanIdleSessions()).reclaimed).toEqual([a]);
    expect(getRuntimeState(b)).toBe("idle");
  });

  it("dispatches scheduled work to Durable and fills finishedAt only after settlement", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    faux.setResponses([
      async () => {
        await held;
        return fauxAssistantMessage("scheduled result");
      },
    ]);
    initTaskScheduler();
    const task = createScheduledTask({
      name: "test",
      prompt: "scheduled",
      cwd: f.root,
      rule: { kind: "interval", minutes: 10 },
    });
    runScheduledTaskNow(task.id);
    try {
      await until(() => faux.state.callCount === 1);
      const run = getSchedulerSnapshot().runs[0];
      expect(run.sessionFile).toMatch(/^durable:/);
      expect(run.finishedAt).toBeUndefined();
      expect(runScheduledTaskNow(task.id)).toEqual({ kind: "skipped", reason: "conflict" });
    } finally {
      release();
    }
    await until(() => getSchedulerSnapshot().runs[0].finishedAt !== undefined);
    expect(getSchedulerSnapshot().runs[0].status).toBe("dispatched");
  });

  it("settles an interrupted scheduled run as failed", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    faux.setResponses([
      async () => {
        await held;
        return fauxAssistantMessage("late");
      },
    ]);
    initTaskScheduler();
    const task = createScheduledTask({
      name: "test",
      prompt: "scheduled",
      cwd: f.root,
      rule: { kind: "interval", minutes: 10 },
    });
    runScheduledTaskNow(task.id);
    await until(() => faux.state.callCount === 1);
    const run = getSchedulerSnapshot().runs[0];
    release();
    await desktopSessions.close(run.sessionId as string);
    expect(run.status).toBe("failed");
    expect(run.finishedAt).toBeTypeOf("number");
  });

  it("pages both repositories and reads closed SQLite without resuming a session", async () => {
    const file = await legacy();
    const ref = { kind: "legacy-jsonl", file } as const;
    const first = await sessionRepository.page(ref);
    const second = await sessionRepository.page(ref, first.nextBefore as number);
    const third = await sessionRepository.page(ref, second.nextBefore as number);
    expect([first.messages.length, second.messages.length, third.messages.length]).toEqual([
      100, 100, 5,
    ]);
    expect(third.nextBefore).toBeNull();
    const id = await open();
    faux.setResponses([fauxAssistantMessage("saved")]);
    await desktopSessions.submit(id, "hello");
    await until(() => getRuntimeState(id) === "idle");
    const durable = f.summaries[0].ref as { kind: "durable"; id: string };
    await desktopSessions.close(id);
    expect((await sessionRepository.transcript(durable)).messages).toHaveLength(2);
    expect(listLiveSessionSnapshots()).toEqual([]);
    expect(faux.state.callCount).toBe(1);
    expect((await sessionRepository.list(f.root)).map((item) => item.ref?.kind).sort()).toEqual([
      "durable",
      "legacy-jsonl",
    ]);
  });

  it("rejects legacy execution in desktop, scheduler and remote while leaving the source unchanged", async () => {
    const file = await legacy(1);
    const before = await readFile(file);
    await expect(desktopSessions.start({ cwd: f.root, sessionFile: file })).rejects.toThrow(
      "read-only",
    );
    initTaskScheduler();
    expect(() =>
      createScheduledTask({
        name: "legacy",
        prompt: "do not run",
        cwd: f.root,
        sessionFile: file,
        rule: { kind: "interval", minutes: 10 },
      }),
    ).toThrow("read-only");
    const source = new DesktopReadOnlySource();
    const [session] = await source.sessions(["project"]);
    await expect(source.send(session, "do not run")).rejects.toThrow("read-only");
    expect(await readFile(file)).toEqual(before);
    expect(listLiveSessionSnapshots()).toEqual([]);
  });

  it("exposes Durable saved history through the remote catalog and enforces project ownership", async () => {
    const id = await open();
    faux.setResponses([fauxAssistantMessage("remote saved")]);
    await desktopSessions.submit(id, "hello");
    await until(() => getRuntimeState(id) === "idle");
    const source = new DesktopReadOnlySource();
    const [session] = await source.sessions(["project"]);
    expect((await source.messages(session)).map((item) => item.text)).toContain("remote saved");
    await expect(
      sessionRepository.executable(f.summaries[0].file, path.join(f.root, "other")),
    ).rejects.toThrow("another project");
    expect(await source.sessions([randomUUID()])).toEqual([]);
  });
});
