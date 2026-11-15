import { afterEach, describe, expect, it, vi } from "vitest";
import type { IpcResult } from "../../shared/ipc";
import { subscribeSystemAccentColor } from "./themeService";

function setup() {
  let resolve!: (value: IpcResult<string | null>) => void;
  const initial = new Promise<IpcResult<string | null>>((done) => {
    resolve = done;
  });
  let push!: (color: string | null) => void;
  const unsubscribe = vi.fn();
  vi.stubGlobal("window", {
    pidesk: {
      theme: {
        getSystemAccentColor: () => initial,
        onSystemAccentColorChanged: (callback: typeof push) => {
          push = callback;
          return unsubscribe;
        },
      },
    },
  });
  const receive = vi.fn();
  const dispose = subscribeSystemAccentColor(receive);
  return { resolve, push, unsubscribe, receive, dispose };
}

afterEach(() => vi.unstubAllGlobals());

describe("system accent color subscription", () => {
  it("reads the initial color then follows changes", async () => {
    const test = setup();
    test.resolve({ ok: true, data: "#0078d4" });
    await vi.waitFor(() => expect(test.receive).toHaveBeenLastCalledWith("#0078d4"));
    test.push("#e5484d");
    expect(test.receive).toHaveBeenLastCalledWith("#e5484d");
    test.dispose();
    expect(test.unsubscribe).toHaveBeenCalledOnce();
  });

  it("does not let an older initial snapshot overwrite a change", async () => {
    const test = setup();
    test.push("#e5484d");
    test.resolve({ ok: true, data: "#0078d4" });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(test.receive).toHaveBeenCalledExactlyOnceWith("#e5484d");
    test.dispose();
  });

  it("ignores pending reads and pushes after disposal", async () => {
    const test = setup();
    test.dispose();
    test.resolve({ ok: true, data: "#0078d4" });
    test.push("#e5484d");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(test.receive).not.toHaveBeenCalled();
    expect(test.unsubscribe).toHaveBeenCalledOnce();
  });

  it("falls back without losing the subscription when the initial IPC fails", async () => {
    const test = setup();
    test.resolve({ ok: false, error: "unavailable" });
    await vi.waitFor(() => expect(test.receive).toHaveBeenLastCalledWith(null));
    test.push("#0078d4");
    expect(test.receive).toHaveBeenLastCalledWith("#0078d4");
    test.dispose();
  });

  it("allows renderer-only previews without a preload", () => {
    vi.stubGlobal("window", {});
    const receive = vi.fn();
    subscribeSystemAccentColor(receive)();
    expect(receive).not.toHaveBeenCalled();
  });
});
