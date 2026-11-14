/**
 * 使用隔离的 Node 子进程充当 pi；实际走 JSONL、pendingRequests、runtime 与 dispose，
 * 不启动真实 pi、不访问用户会话文件。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  state: { isStreaming: false, isCompacting: false, pendingMessageCount: 0 },
  script: [
    "const readline = require('node:readline');",
    "const state = JSON.parse(process.argv[1]);",
    "const send = (record) => process.stdout.write(JSON.stringify(record) + '\\n');",
    "readline.createInterface({ input: process.stdin }).on('line', (line) => {",
    "  const req = JSON.parse(line);",
    "  if (req.type === 'prompt' && req.message === 'pending') return;",
    "  if (req.type === 'prompt' && req.message === 'retry') {",
    "    send({ type: 'agent_start' });",
    "    send({ type: 'agent_end', willRetry: true });",
    "    send({ type: 'auto_retry_start', attempt: 1 });",
    "  }",
    "  if (req.type === 'set_thinking_level' && req.level === 'settle') send({ type: 'agent_settled' });",
    "  if (req.type === 'set_thinking_level' && req.level === 'dialog') send({",
    "    type: 'extension_ui_request', id: 'question', method: 'confirm', title: 'Continue?',",
    "  });",
    "  send({ type: 'response', id: req.id, success: true, data: req.type === 'get_state' ? state : {} });",
    "});",
  ].join("\n"),
}));
vi.mock("electron", () => ({ powerMonitor: { on: vi.fn(), off: vi.fn() } }));
vi.mock("../settings/settings", () => ({
  getSettings: () => ({
    sessionIdleReclaimMinutes: 30,
    maxParallelSessions: 8,
  }),
}));
vi.mock("../window/createMainWindow", () => ({
  getMainWindow: () => ({
    webContents: { send: vi.fn() },
  }),
}));
vi.mock("../proc/procService", () => ({
  procService: {
    noteSessionDisposed: vi.fn(),
    noteSessionFile: vi.fn(),
    noteBashStart: vi.fn(),
    noteBashEnd: vi.fn(),
  },
}));
vi.mock("../view/viewHost", () => ({
  hasSessionModal: () => false,
  ensureViewHost: async () => null,
  closeSessionViews: vi.fn(),
  retainSessionViews: vi.fn(),
  getViewHostRendezvousPath: () => "",
}));
vi.mock("../extension/contributionCatalog", () => ({
  getCatalogSnapshot: () => ({ fingerprint: "test" }),
}));
vi.mock("./piLauncher", () => ({
  resolvePiCommand: () => ({
    file: process.execPath,
    args: ["-e", fixture.script, JSON.stringify(fixture.state)],
  }),
}));

import { setBackgroundJobProbe } from "./backgroundJobs";
import { __resetIdleReclaimForTests, noteViewingSession, scanIdleSessions } from "./idleReclaim";
import {
  disposeSession,
  fetchSessionState,
  hasPendingSessionRequests,
  hasSession,
  listLiveSessions,
  promptSession,
  respondSessionUi,
  setThinkingLevel,
  startSession,
  waitForSessionDisposal,
} from "./piSession";
import {
  __resetRuntimeCoordinatorForTests,
  ensureSessionReady,
  getRuntimeState,
  listIdleReclaimCandidates,
  markRuntimeReady,
} from "./runtimeCoordinator";

const BASE = 1_000_000;
const THRESHOLD = 30 * 60_000;
let now = BASE;
let detach = () => {};

beforeEach(() => {
  now = BASE;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  fixture.state = { isStreaming: false, isCompacting: false, pendingMessageCount: 0 };
  __resetIdleReclaimForTests();
  __resetRuntimeCoordinatorForTests();
  detach = setBackgroundJobProbe(() => false);
});

afterEach(async () => {
  const ids = listLiveSessions();
  for (const id of ids) disposeSession(id);
  await Promise.all(ids.map(waitForSessionDisposal));
  detach();
  __resetIdleReclaimForTests();
  __resetRuntimeCoordinatorForTests();
  vi.restoreAllMocks();
});

async function launch() {
  const id = await startSession({ cwd: process.cwd() });
  await fetchSessionState(id, 5000);
  markRuntimeReady(id);
  return id;
}
function age() {
  now += THRESHOLD + 1;
  noteViewingSession({ sessionId: null, sessionPage: false });
}

describe("空闲回收的实际 RPC 与子进程生命周期", () => {
  it("空闲进程干净退出，可用同 id 再启动", async () => {
    const id = await launch();
    age();
    expect((await scanIdleSessions()).reclaimed).toEqual([id]);
    expect(hasSession(id)).toBe(false);
    expect(getRuntimeState(id)).toBe("cold");
    await startSession({ sessionId: id, cwd: process.cwd() });
    expect(hasSession(id)).toBe(true);
    expect(await fetchSessionState(id, 5000)).toMatchObject({ isStreaming: false });
  });
  it("长期没有响应的 prompt 即使 runtime idle 也不关闭", async () => {
    const id = await launch();
    const prompt = promptSession(id, "pending").catch(() => undefined);
    age();
    expect(hasPendingSessionRequests(id)).toBe(true);
    expect(getRuntimeState(id)).toBe("idle");
    expect((await scanIdleSessions()).reclaimed).toEqual([]);
    expect(hasSession(id)).toBe(true);
    disposeSession(id);
    await Promise.all([prompt, waitForSessionDisposal(id)]);
  });
  it.each([
    { isStreaming: true, isCompacting: false, pendingMessageCount: 0 },
    { isStreaming: false, isCompacting: true, pendingMessageCount: 0 },
    { isStreaming: false, isCompacting: false, pendingMessageCount: 1 },
  ])("真实状态 %j 拦住过期的本地 idle", async (state) => {
    fixture.state = state;
    const id = await launch();
    age();
    expect((await scanIdleSessions()).reclaimed).toEqual([]);
    expect(hasSession(id)).toBe(true);
  });
  it("agent_end 和重试不会变为空闲，agent_settled 才重新计时", async () => {
    const id = await launch();
    await promptSession(id, "retry");
    expect(getRuntimeState(id)).toBe("busy");
    age();
    expect((await scanIdleSessions()).reclaimed).toEqual([]);
    await setThinkingLevel(id, "settle");
    expect(getRuntimeState(id)).toBe("idle");
    expect(listIdleReclaimCandidates().find((item) => item.sessionId === id)?.lastActivityAt).toBe(
      now,
    );
    expect((await scanIdleSessions()).reclaimed).toEqual([]);
    expect(hasSession(id)).toBe(true);
  });
  it("未答扩展请求保持进程，答复后重新计时", async () => {
    const id = await launch();
    await setThinkingLevel(id, "dialog");
    age();
    expect((await scanIdleSessions()).reclaimed).toEqual([]);
    now += 1000;
    expect(respondSessionUi(id, "question", { confirmed: true })).toBe(true);
    expect(listIdleReclaimCandidates().find((item) => item.sessionId === id)?.lastActivityAt).toBe(
      now,
    );
    expect((await scanIdleSessions()).reclaimed).toEqual([]);
  });
  it("按 id 复用已热会话也必须更新使用时刻", async () => {
    const id = await launch();
    age();
    await ensureSessionReady({ sessionId: id, reason: "send" });
    expect(listIdleReclaimCandidates().find((item) => item.sessionId === id)?.lastActivityAt).toBe(
      now,
    );
    expect((await scanIdleSessions()).reclaimed).toEqual([]);
    expect(hasSession(id)).toBe(true);
  });
});
