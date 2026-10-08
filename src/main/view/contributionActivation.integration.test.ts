import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  alive: false,
  active: false,
  key: "plan-key",
  view: "v1" as string | null,
  send: vi.fn(),
  wait: vi.fn(),
  start: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("../window/createMainWindow", () => ({ getMainWindow: () => null }));
vi.mock("../session/sessionCwdRegistry", () => ({ getSessionCwd: () => "project" }));
vi.mock("../extension/contributionCatalog", () => ({
  getCatalogSnapshot: () => ({
    fingerprint: "fp",
    entries: [
      { key: fake.key, placement: "access-mode", workerSafe: false },
      { key: "panel-key", placement: "panel", workerSafe: false },
      { key: "settings-key", placement: "settings", workerSafe: false },
      { key: "worker-settings-key", placement: "settings", workerSafe: true },
    ],
  }),
}));
vi.mock("../session/piSession", () => ({
  hasSession: () => fake.alive,
  startSession: fake.start,
  fetchSessionState: async () => ({}),
  disposeSession: fake.dispose,
  waitForSessionDisposal: async () => {},
}));
vi.mock("./viewHost", () => ({
  getContributionViewId: () => fake.view,
  getViewModeState: () => ({ active: fake.active, detail: "declined" }),
  sendViewEvent: fake.send,
  waitForContribution: fake.wait,
}));

import { __resetRuntimeCoordinatorForTests } from "../session/runtimeCoordinator";
import { activateContribution } from "./contributionActivation";

const request = {
  sessionId: "s1",
  cwd: "project",
  contributionKey: "plan-key",
  actionId: "mode:activate" as const,
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  __resetRuntimeCoordinatorForTests();
  fake.alive = false;
  fake.active = false;
  fake.view = "v1";
  fake.start.mockImplementation(async () => {
    fake.alive = true;
    return "s1";
  });
  fake.send.mockImplementation(() => {
    fake.active = true;
  });
});
afterEach(() => vi.useRealTimers());
describe("atomic activation", () => {
  it("double click starts once and returns only after live confirmation", async () => {
    const [a, b] = await Promise.all([
      activateContribution(request),
      activateContribution(request),
    ]);
    expect(fake.start).toHaveBeenCalledTimes(1);
    expect(fake.send).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ sessionId: "s1", liveViewId: "v1", state: "active" });
  });
  it("rejects foreign catalog keys before starting a process", async () => {
    await expect(
      activateContribution({ ...request, contributionKey: "foreign" }),
    ).rejects.toMatchObject({ code: "catalog-missing" });
    expect(fake.start).not.toHaveBeenCalled();
  });
  it("registration failure leaves the ready session alive", async () => {
    fake.view = null;
    fake.wait.mockRejectedValue(new Error("timeout"));
    await expect(activateContribution(request)).rejects.toMatchObject({
      code: "contribution-not-registered",
    });
    expect(fake.dispose).not.toHaveBeenCalled();
  });
  it("preserves rejection detail without optimistically confirming", async () => {
    fake.send.mockImplementation(() => {});
    const result = activateContribution(request);
    const check = expect(result).rejects.toMatchObject({
      code: "activation-not-confirmed",
      message: "declined",
    });
    await vi.advanceTimersByTimeAsync(5200);
    await check;
    expect(fake.dispose).not.toHaveBeenCalled();
  });
});

describe("view:open activation (docs/design/19 §10.1/§10.2)", () => {
  it("panel view:open succeeds once the live contribution registers (no mode action)", async () => {
    fake.view = "panel-live";
    fake.wait.mockResolvedValue("panel-live");
    const result = await activateContribution({
      sessionId: "s1",
      cwd: "project",
      contributionKey: "panel-key",
      actionId: "view:open",
    });
    expect(result).toMatchObject({
      sessionId: "s1",
      contributionKey: "panel-key",
      liveViewId: "panel-live",
      state: "active",
    });
    expect(fake.send).not.toHaveBeenCalled();
  });

  it("settings view:open uses the same wait-for-registration path", async () => {
    fake.view = null;
    fake.wait.mockResolvedValue("settings-live");
    const result = await activateContribution({
      sessionId: "s1",
      cwd: "project",
      contributionKey: "settings-key",
      actionId: "view:open",
    });
    expect(result.liveViewId).toBe("settings-live");
    expect(fake.send).not.toHaveBeenCalled();
  });

  it("rejects worker-safe settings with activation-rejected before ensureSession", async () => {
    await expect(
      activateContribution({
        sessionId: "s1",
        cwd: "project",
        contributionKey: "worker-settings-key",
        actionId: "view:open",
      }),
    ).rejects.toMatchObject({ code: "activation-rejected" });
    expect(fake.start).not.toHaveBeenCalled();
  });

  it("rejects view:open for access-mode placement", async () => {
    await expect(
      activateContribution({
        sessionId: "s1",
        cwd: "project",
        contributionKey: "plan-key",
        actionId: "view:open",
      }),
    ).rejects.toMatchObject({ code: "invalid-request" });
  });

  it("rejects mode:activate for panel placement", async () => {
    await expect(
      activateContribution({
        sessionId: "s1",
        cwd: "project",
        contributionKey: "panel-key",
        actionId: "mode:activate",
      }),
    ).rejects.toMatchObject({ code: "invalid-request" });
  });

  it("registration timeout leaves the ready session alive", async () => {
    fake.view = null;
    fake.wait.mockRejectedValue(new Error("timeout"));
    await expect(
      activateContribution({
        sessionId: "s1",
        cwd: "project",
        contributionKey: "panel-key",
        actionId: "view:open",
      }),
    ).rejects.toMatchObject({ code: "contribution-not-registered" });
    expect(fake.dispose).not.toHaveBeenCalled();
  });
});
