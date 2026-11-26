import { afterEach, describe, expect, it, vi } from "vitest";
import type { DurableExtensionSpec } from "../../shared/durableExtension";
import { NativeExtensionHosts } from "./nativeExtensionHosts";

const spec = {
  id: "settings",
  root: "/package",
  entry: "/package/desktop.mjs",
  scope: "user",
  capabilities: ["views"],
  hosts: ["app", "settings"],
} satisfies DurableExtensionSpec;
function host() {
  const request = vi.fn().mockResolvedValue(null);
  const discover = vi.fn(() => [spec]);
  const revoke = vi.fn();
  const bind = vi.fn(async (specs: DurableExtensionSpec[]) => specs);
  return {
    request,
    discover,
    revoke,
    bind,
    host: new NativeExtensionHosts({ request, discover, revoke, bind, cwd: "/home" }),
  };
}
afterEach(() => vi.useRealTimers());

describe("native app/settings extension lifecycle", () => {
  it("shares the settings host until the last lease expires, without opening a conversation", async () => {
    vi.useFakeTimers();
    const f = host();
    await Promise.all([f.host.acquire(), f.host.acquire()]);
    expect(f.request).toHaveBeenCalledTimes(1);
    expect(f.request.mock.calls[0][0]).toMatchObject({
      op: "openExtensionHost",
      hostScope: "settings",
    });
    expect(f.host.status()).toMatchObject({ ready: true, leases: 2 });
    f.host.release();
    await vi.advanceTimersByTimeAsync(45000);
    expect(f.host.status().running).toBe(true);
    f.host.release();
    await vi.advanceTimersByTimeAsync(45000);
    expect(f.host.status().running).toBe(false);
    expect(f.revoke).toHaveBeenCalledTimes(1);
    await f.host.dispose();
  });
  it("keeps app lifetime separate, serializes reloads, and revokes credentials before close", async () => {
    const f = host();
    await f.host.startApp();
    await f.host.acquire();
    await Promise.all([f.host.reload(), f.host.reload()]);
    expect(f.host.status().ready).toBe(true);
    const scopes = f.request.mock.calls
      .filter(([command]) => command.op === "openExtensionHost")
      .map(([command]) => command.hostScope);
    expect(scopes).toEqual(["app", "settings", "app", "settings", "app", "settings"]);
    await f.host.dispose();
    expect(f.host.status()).toMatchObject({ running: false, leases: 0 });
    expect(f.revoke).toHaveBeenCalledTimes(6);
  });
  it("retries failed cleanup before replacing a settings host", async () => {
    const f = host();
    f.request.mockImplementation(async (command) => {
      if (command.op === "openExtensionHost") throw new Error("factory failed");
      if (command.op === "closeExtensionHost") throw new Error("cleanup failed");
      return null;
    });
    expect((await f.host.acquire()).status).toMatchObject({ running: true, ready: false });
    const retained = f.request.mock.calls[0][0].hostId;
    f.request.mockResolvedValue(null);
    await f.host.acquire();
    expect(f.request.mock.calls[2][0]).toEqual({ op: "closeExtensionHost", hostId: retained });
    expect(f.request.mock.calls[3][0]).toMatchObject({ op: "openExtensionHost" });
    expect(f.request.mock.calls[3][0].hostId).not.toBe(retained);
    await f.host.dispose();
  });

  it("retries recovery failures with a bound and keeps the other lifetime available", async () => {
    vi.useFakeTimers();
    const f = host();
    await f.host.startApp();
    await f.host.acquire();
    f.request.mockImplementation(async (command) => {
      if (command.op === "openExtensionHost" && command.hostScope === "app")
        throw new Error("unavailable");
      return null;
    });
    f.host.fault();
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.host.status().ready).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    const opens = f.request.mock.calls.filter(([command]) => command.op === "openExtensionHost");
    expect(opens.filter(([command]) => command.hostScope === "app")).toHaveLength(4);
    expect(opens.filter(([command]) => command.hostScope === "settings")).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10000);
    expect(
      f.request.mock.calls.filter(([command]) => command.op === "openExtensionHost"),
    ).toHaveLength(opens.length);
    await f.host.dispose();
  });

  it("revokes pending bindings when the runtime faults before a factory starts", async () => {
    vi.useFakeTimers();
    const f = host();
    let finish!: (specs: DurableExtensionSpec[]) => void;
    f.bind.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const acquiring = f.host.acquire();
    await Promise.resolve();
    f.host.fault();
    finish([spec]);
    await acquiring;
    expect(f.request).not.toHaveBeenCalled();
    expect(f.revoke).toHaveBeenCalledTimes(1);
    await f.host.dispose();
  });

  it("does not load legacy or undeclared settings code, and recovers from a runtime fault", async () => {
    const f = host();
    f.discover.mockReturnValueOnce([]);
    expect((await f.host.acquire()).status.running).toBe(false);
    expect(f.request).not.toHaveBeenCalled();
    await f.host.reload();
    expect(f.host.status().ready).toBe(true);
    f.host.fault();
    expect(f.host.status()).toMatchObject({ running: false, ready: false });
    await f.host.reload();
    expect(f.host.status().ready).toBe(true);
    await f.host.dispose();
  });
});
