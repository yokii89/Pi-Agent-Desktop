import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionRuntimeState } from "../../shared/contribution";

const fake = vi.hoisted(() => ({
  settings: { sessionIdleReclaimMinutes: 30 },
  alive: new Set<string>(),
  tokens: new Map<string, object>(),
  candidates: [] as Array<{
    sessionId: string;
    lastActivityAt: number | null;
    state: SessionRuntimeState;
    hasActivationTxn: boolean;
  }>,
  pendingUi: new Map<string, number>(),
  pendingRpc: new Set<string>(),
  modal: new Set<string>(),
  disposed: [] as string[],
  watched: null as string | null,
  background: vi.fn(),
  probe: vi.fn(),
  disposal: vi.fn(),
  listeners: new Map<string, () => void>(),
}));
vi.mock("electron", () => ({
  powerMonitor: {
    on: (event: string, handler: () => void) => fake.listeners.set(event, handler),
    off: (event: string) => fake.listeners.delete(event),
  },
}));
vi.mock("./backgroundJobs", () => ({ hasLiveBackgroundJobs: fake.background }));
vi.mock("../view/viewHost", () => ({ hasSessionModal: (id: string) => fake.modal.has(id) }));
vi.mock("../settings/settings", () => ({ getSettings: () => fake.settings }));
vi.mock("./piSession", () => ({
  hasSession: (id: string) => fake.alive.has(id),
  getSessionProcessToken: (id: string) => (fake.alive.has(id) ? fake.tokens.get(id) : null),
  hasPendingSessionRequests: (id: string) => fake.pendingRpc.has(id),
  fetchSessionState: fake.probe,
  disposeSession: (id: string) => {
    fake.disposed.push(id);
    fake.alive.delete(id);
  },
  waitForSessionDisposal: fake.disposal,
}));
vi.mock("./extensionUi", () => ({
  pendingUiCount: (id: string) => fake.pendingUi.get(id) ?? 0,
}));
vi.mock("./runtimeCoordinator", () => ({
  listIdleReclaimCandidates: () => fake.candidates.map((item) => ({ ...item })),
  getWatchedSession: () => fake.watched,
  noteWatchedSession: (id: string | null) => {
    fake.watched = id;
  },
  noteRuntimeTouched: (id: string) => {
    const item = fake.candidates.find((row) => row.sessionId === id);
    if (item && fake.alive.has(id)) item.lastActivityAt = Date.now();
  },
  deferRuntimeIdleReclaim: (id: string) => {
    const item = fake.candidates.find((row) => row.sessionId === id);
    if (item && fake.alive.has(id)) item.lastActivityAt = Date.now();
  },
}));

import {
  __resetIdleReclaimForTests,
  disposeIdleReclaim,
  getIdleReclaimStats,
  initIdleReclaim,
  noteViewingSession,
  scanIdleSessions,
  setScheduledOccupancy,
} from "./idleReclaim";

const NOW = 100_000_000;
const IDLE_MS = 30 * 60_000;
const IDLE = { isStreaming: false, isCompacting: false, pendingMessageCount: 0 };

function add(id = "a", age = IDLE_MS + 1) {
  fake.alive.add(id);
  fake.tokens.set(id, {});
  const item = {
    sessionId: id,
    lastActivityAt: NOW - age,
    state: "idle" as SessionRuntimeState,
    hasActivationTxn: false,
  };
  fake.candidates.push(item);
  return item;
}

function report() {
  noteViewingSession({ sessionId: null, sessionPage: false });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  __resetIdleReclaimForTests();
  fake.settings = { sessionIdleReclaimMinutes: 30 };
  fake.alive.clear();
  fake.tokens.clear();
  fake.pendingRpc.clear();
  fake.modal.clear();
  fake.pendingUi.clear();
  fake.candidates.length = 0;
  fake.disposed.length = 0;
  fake.watched = null;
  fake.background.mockReset().mockResolvedValue(false);
  fake.probe.mockReset().mockResolvedValue(IDLE);
  fake.disposal.mockReset().mockResolvedValue(undefined);
  report();
});
afterEach(() => {
  __resetIdleReclaimForTests();
  vi.useRealTimers();
});

describe("空闲回收的正常边界", () => {
  it.each([IDLE_MS, IDLE_MS + 1, IDLE_MS * 8])("空闲 %i ms 且证据完整才关闭", async (age) => {
    add("a", age);
    expect((await scanIdleSessions()).reclaimed).toEqual(["a"]);
    expect(fake.probe).toHaveBeenCalledWith("a", 5000);
    expect(fake.disposal).toHaveBeenCalledWith("a");
    expect(getIdleReclaimStats().reclaimed).toBe(1);
  });
  it.each([0, IDLE_MS - 1, -1])("空闲 %i ms 未到期", async (age) => {
    add("a", age);
    await scanIdleSessions();
    expect(fake.disposed).toEqual([]);
    expect(fake.probe).not.toHaveBeenCalled();
  });
  it("关闭档不探测或关闭", async () => {
    add();
    fake.settings.sessionIdleReclaimMinutes = 0;
    await scanIdleSessions();
    expect(fake.disposed).toEqual([]);
    expect(fake.background).not.toHaveBeenCalled();
  });
  it.each(["busy", "starting", "cold", "failed", "stopping"] as const)(
    "%s 不关闭",
    async (state) => {
      add().state = state;
      await scanIdleSessions();
      expect(fake.disposed).toEqual([]);
    },
  );
  it("ready 也需实际 RPC 确认", async () => {
    add().state = "ready";
    fake.probe.mockResolvedValue({ ...IDLE, isCompacting: true });
    await scanIdleSessions();
    expect(fake.disposed).toEqual([]);
  });
  it("同一轮最多两个，第三个留到下轮", async () => {
    for (const id of ["a", "b", "c"]) add(id);
    expect((await scanIdleSessions()).reclaimed).toEqual(["a", "b"]);
    expect((await scanIdleSessions()).reclaimed).toEqual(["c"]);
  });
  it("死进程不重复关闭", async () => {
    add();
    fake.alive.clear();
    await scanIdleSessions();
    expect(fake.disposed).toEqual([]);
  });
  it.each(["active", "dialog", "modal", "rpc", "activation", "scheduled", "background"])(
    "%s 保护并延后空闲起点",
    async (kind) => {
      const item = add();
      if (kind === "active") fake.watched = "a";
      if (kind === "dialog") fake.pendingUi.set("a", 1);
      if (kind === "modal") fake.modal.add("a");
      if (kind === "rpc") fake.pendingRpc.add("a");
      if (kind === "activation") item.hasActivationTxn = true;
      if (kind === "scheduled") setScheduledOccupancy(() => true);
      if (kind === "background") fake.background.mockResolvedValue(true);
      await scanIdleSessions();
      expect(fake.disposed).toEqual([]);
      expect(item.lastActivityAt).toBe(NOW);
    },
  );
  it("后台作业结束后重新等满阈值", async () => {
    add();
    fake.background.mockResolvedValueOnce(true);
    await scanIdleSessions();
    for (let minute = 1; minute < 30; minute += 1) {
      vi.setSystemTime(NOW + minute * 60_000);
      report();
      await scanIdleSessions();
    }
    expect(fake.disposed).toEqual([]);
    vi.setSystemTime(NOW + IDLE_MS);
    report();
    await scanIdleSessions();
    expect(fake.disposed).toEqual(["a"]);
  });
});

describe("异步探测期间的真实竞态", () => {
  it.each([
    "busy",
    "dialog",
    "modal",
    "rpc",
    "activation",
    "scheduled",
    "active",
    "touch",
    "exit",
    "replacement",
    "disabled",
    "threshold",
    "dispose",
  ])("RPC 返回前出现 %s，撤销本次回收", async (kind) => {
    const item = add();
    fake.probe.mockImplementation(async () => {
      if (kind === "busy") item.state = "busy";
      if (kind === "dialog") fake.pendingUi.set("a", 1);
      if (kind === "modal") fake.modal.add("a");
      if (kind === "rpc") fake.pendingRpc.add("a");
      if (kind === "activation") item.hasActivationTxn = true;
      if (kind === "scheduled") setScheduledOccupancy(() => true);
      if (kind === "active") noteViewingSession({ sessionId: "a", sessionPage: true });
      if (kind === "touch") item.lastActivityAt = NOW;
      if (kind === "exit") fake.alive.clear();
      if (kind === "replacement") fake.tokens.set("a", {});
      if (kind === "disabled") fake.settings.sessionIdleReclaimMinutes = 0;
      if (kind === "threshold") fake.settings.sessionIdleReclaimMinutes = 60;
      if (kind === "dispose") disposeIdleReclaim();
      return IDLE;
    });
    expect((await scanIdleSessions()).unsure).toEqual(["a"]);
    expect(fake.disposed).toEqual([]);
  });
  it("后台枚举期间变忙，不再发送状态探针", async () => {
    const item = add();
    fake.background.mockImplementation(async () => {
      item.state = "busy";
      return false;
    });
    await scanIdleSessions();
    expect(fake.probe).not.toHaveBeenCalled();
    expect(fake.disposed).toEqual([]);
  });
  it("并发扫描合流，慢探针期间不会重复 dispose", async () => {
    add();
    let resolve!: (value: boolean) => void;
    fake.background.mockReturnValue(
      new Promise<boolean>((done) => {
        resolve = done;
      }),
    );
    const first = scanIdleSessions();
    expect(scanIdleSessions()).toBe(first);
    resolve(false);
    await first;
    expect(fake.disposed).toEqual(["a"]);
  });
  it("首个候选核对时切到第二个，第二个必须保留", async () => {
    add("a");
    add("b");
    fake.probe.mockImplementation(async () => {
      noteViewingSession({ sessionId: "b", sessionPage: true });
      return IDLE;
    });
    expect((await scanIdleSessions()).reclaimed).toEqual(["a"]);
  });
  it("旧占用查询的解绑不能覆盖新的查询", async () => {
    add();
    const off = setScheduledOccupancy(() => false);
    setScheduledOccupancy(() => true);
    off();
    await scanIdleSessions();
    expect(fake.disposed).toEqual([]);
  });
});

describe("证据缺失或协议仍有工作", () => {
  it.each([
    null,
    undefined,
    {},
    [],
    "idle",
    { ...IDLE, isStreaming: true },
    { ...IDLE, isCompacting: true },
    { ...IDLE, pendingMessageCount: 1 },
    { ...IDLE, pendingMessageCount: -1 },
    { ...IDLE, pendingMessageCount: "0" },
    { ...IDLE, isRetrying: true },
  ])("RPC 状态 %j 不允许回收", async (state) => {
    add();
    fake.probe.mockResolvedValue(state);
    await scanIdleSessions();
    expect(fake.disposed).toEqual([]);
  });
  it.each(["background", "probe"] as const)("%s 超时/抛错时保留", async (target) => {
    add();
    fake[target].mockRejectedValue(new Error("timeout"));
    await scanIdleSessions();
    expect(fake.disposed).toEqual([]);
  });
  it("旧预加载从未上报时不回收", async () => {
    __resetIdleReclaimForTests();
    add();
    await scanIdleSessions();
    expect(fake.disposed).toEqual([]);
  });
  it("心跳失联时不回收任何候选", async () => {
    add();
    vi.setSystemTime(NOW + 180_001);
    await scanIdleSessions();
    expect(fake.disposed).toEqual([]);
  });
});

describe("查看、休眠与时钟", () => {
  it("离开长时间最小化的 active 会话时从离开时重新计时", () => {
    const item = add();
    noteViewingSession({ sessionId: "a", sessionPage: true });
    vi.setSystemTime(NOW + IDLE_MS * 8);
    report();
    expect(item.lastActivityAt).toBe(NOW + IDLE_MS * 8);
    expect(fake.watched).toBeNull();
  });
  it.each([undefined, {}, { sessionId: "b" }, { sessionPage: false }])(
    "坏上报 %j 不撤销保护",
    (request) => {
      noteViewingSession({ sessionId: "a", sessionPage: true });
      noteViewingSession(request);
      expect(fake.watched).toBe("a");
    },
  );
  it.each([IDLE_MS * 8, -IDLE_MS])("时钟跳变 %i ms 后重新等满阈值", async (jump) => {
    const item = add("a", 0);
    await scanIdleSessions();
    vi.setSystemTime(NOW + jump);
    item.lastActivityAt = Date.now() - IDLE_MS * 10;
    report();
    await scanIdleSessions();
    expect(fake.disposed).toEqual([]);
    for (let minute = 1; minute <= 30; minute += 1) {
      vi.setSystemTime(NOW + jump + minute * 60_000);
      report();
      await scanIdleSessions();
      expect(fake.disposed).toEqual(minute < 30 ? [] : ["a"]);
    }
  });
  it("唤醒不立即回收，必须有新心跳且重新等待", async () => {
    add("a", 0);
    initIdleReclaim();
    await scanIdleSessions();
    fake.listeners.get("suspend")?.();
    vi.setSystemTime(NOW + IDLE_MS * 8);
    fake.listeners.get("resume")?.();
    report();
    await scanIdleSessions();
    expect(fake.disposed).toEqual([]);
    expect(fake.listeners.size).toBe(2);
    disposeIdleReclaim();
    expect(fake.listeners.size).toBe(0);
  });
  it("探测途中休眠使旧扫描失效", async () => {
    initIdleReclaim();
    await scanIdleSessions();
    add();
    fake.probe.mockImplementation(async () => {
      fake.listeners.get("suspend")?.();
      return IDLE;
    });
    await scanIdleSessions();
    expect(fake.disposed).toEqual([]);
  });
});
