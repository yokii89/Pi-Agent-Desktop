import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopViewClient } from "./client.js";
import {
  __resetProcessViewClientForTests,
  acquireProcessViewClient,
  disposeProcessViewClient,
  getProcessViewClient,
  processViewClientRefCount,
  releaseProcessViewClient,
} from "./processClient.js";

const connectDesktopView = vi.fn();

vi.mock("./client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client.js")>();
  return {
    ...actual,
    connectDesktopView: (options?: unknown) => connectDesktopView(options),
  };
});

describe("process-level desktop client", () => {
  beforeEach(() => {
    connectDesktopView.mockReset();
    __resetProcessViewClientForTests();
  });

  afterEach(() => {
    __resetProcessViewClientForTests();
  });

  it("returns null when not under a host and does not cache the miss", () => {
    connectDesktopView.mockReturnValue(null);
    expect(acquireProcessViewClient()).toBeNull();
    expect(acquireProcessViewClient()).toBeNull();
    expect(connectDesktopView).toHaveBeenCalledTimes(2);
    expect(processViewClientRefCount()).toBe(0);
  });

  it("shares one client across acquires and tracks refcount", () => {
    const client = { dispose: vi.fn() } as unknown as DesktopViewClient;
    connectDesktopView.mockReturnValue(client);
    expect(acquireProcessViewClient()).toBe(client);
    expect(acquireProcessViewClient()).toBe(client);
    expect(connectDesktopView).toHaveBeenCalledTimes(1);
    expect(processViewClientRefCount()).toBe(2);
  });

  it("releaseProcessViewClient disposes only on last release", () => {
    const client = { dispose: vi.fn() } as unknown as DesktopViewClient;
    connectDesktopView.mockReturnValue(client);
    acquireProcessViewClient();
    acquireProcessViewClient();
    releaseProcessViewClient();
    expect(client.dispose).not.toHaveBeenCalled();
    expect(processViewClientRefCount()).toBe(1);
    releaseProcessViewClient();
    expect(client.dispose).toHaveBeenCalledTimes(1);
    expect(processViewClientRefCount()).toBe(0);
  });

  it("disposeProcessViewClient force-disposes regardless of refcount", () => {
    const client = { dispose: vi.fn() } as unknown as DesktopViewClient;
    connectDesktopView.mockReturnValueOnce(client).mockReturnValueOnce(null);
    acquireProcessViewClient();
    acquireProcessViewClient();
    disposeProcessViewClient();
    expect(client.dispose).toHaveBeenCalledTimes(1);
    expect(getProcessViewClient()).toBeNull();
  });
});
