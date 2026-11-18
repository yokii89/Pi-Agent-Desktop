import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  token: null as object | null,
  runtime: "idle",
  pendingRpc: false,
  modeTransition: false,
  pendingUi: 0,
  modal: false,
  fetchState: vi.fn<() => Promise<unknown>>(),
  dispose: vi.fn(),
}));

vi.mock("../view/viewHost", () => ({ hasSessionModal: () => fake.modal }));
vi.mock("./extensionUi", () => ({ pendingUiCount: () => fake.pendingUi }));
vi.mock("./piSession", () => ({
  getSessionProcessToken: () => fake.token,
  hasPendingSessionRequests: () => fake.pendingRpc,
  fetchSessionState: fake.fetchState,
  disposeSession: fake.dispose,
}));
vi.mock("./runtimeCoordinator", () => ({
  getRuntimeState: () => fake.runtime,
  hasModeTransition: () => fake.modeTransition,
}));

import { disposeIdleSession } from "./disposeIdleSession";

const IDLE = { isStreaming: false, isCompacting: false, pendingMessageCount: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  fake.token = {};
  fake.runtime = "idle";
  fake.pendingRpc = false;
  fake.modeTransition = false;
  fake.pendingUi = 0;
  fake.modal = false;
  fake.fetchState.mockResolvedValue(IDLE);
});

describe("手动关闭空闲会话", () => {
  it("允许没有 JSONL 的实例按运行时 ID 关闭", async () => {
    expect(await disposeIdleSession("new-session")).toBe("ended");
    expect(fake.dispose).toHaveBeenCalledWith("new-session");
  });

  it("进程已经退出时幂等返回", async () => {
    fake.token = null;
    expect(await disposeIdleSession("session")).toBe("not-running");
    expect(fake.fetchState).not.toHaveBeenCalled();
    expect(fake.dispose).not.toHaveBeenCalled();
  });

  it.each(["busy", "starting", "stopping", "cold", "failed"])("%s 状态不可关闭", async (state) => {
    fake.runtime = state;
    expect(await disposeIdleSession("session")).toBe("busy");
    expect(fake.fetchState).not.toHaveBeenCalled();
    expect(fake.dispose).not.toHaveBeenCalled();
  });

  it.each(["pendingRpc", "modeTransition", "pendingUi", "modal"] as const)(
    "%s 未完成时保留实例",
    async (guard) => {
      if (guard === "pendingUi") fake.pendingUi = 1;
      else fake[guard] = true;
      expect(await disposeIdleSession("session")).toBe("busy");
      expect(fake.dispose).not.toHaveBeenCalled();
    },
  );

  it.each([
    { ...IDLE, isStreaming: true },
    { ...IDLE, isCompacting: true },
    { ...IDLE, pendingMessageCount: 1 },
    { ...IDLE, isRetrying: true },
    {},
    null,
  ])("RPC 状态不能确认空闲时保留实例：%j", async (state) => {
    fake.fetchState.mockResolvedValue(state);
    expect(await disposeIdleSession("session")).toBe("busy");
    expect(fake.dispose).not.toHaveBeenCalled();
  });

  it.each(["busy", "replaced", "mode", "rpc", "ui", "modal", "exited"])(
    "异步核对期间出现 %s 时不关闭",
    async (change) => {
      fake.fetchState.mockImplementation(async () => {
        if (change === "busy") fake.runtime = "busy";
        if (change === "replaced") fake.token = {};
        if (change === "mode") fake.modeTransition = true;
        if (change === "rpc") fake.pendingRpc = true;
        if (change === "ui") fake.pendingUi = 1;
        if (change === "modal") fake.modal = true;
        if (change === "exited") fake.token = null;
        return IDLE;
      });
      expect(await disposeIdleSession("session")).toBe(
        change === "exited" ? "not-running" : "busy",
      );
      expect(fake.dispose).not.toHaveBeenCalled();
    },
  );

  it("核对失败向调用方报告错误，不提前移除实例", async () => {
    fake.fetchState.mockRejectedValue(new Error("get_state timeout"));
    await expect(disposeIdleSession("session")).rejects.toThrow("get_state timeout");
    expect(fake.dispose).not.toHaveBeenCalled();
  });
});
