import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClosePromptProtocol } from "./closePromptProtocol";

function setup() {
  const callbacks = { request: vi.fn(), settled: vi.fn(), execute: vi.fn(), fallback: vi.fn() };
  return { protocol: new ClosePromptProtocol(callbacks), ...callbacks };
}

describe("close prompt handshake", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("merges repeated closes and accepts only one decision", () => {
    const { protocol, request, execute, settled, fallback } = setup();
    protocol.request();
    protocol.request();
    protocol.request();
    expect(request).toHaveBeenCalledExactlyOnceWith(1, "window");
    protocol.decide({ kind: "window", id: 1, action: "tray", remember: true });
    protocol.decide({ kind: "window", id: 1, action: "quit", remember: true });
    vi.runAllTimers();
    expect(execute).toHaveBeenCalledExactlyOnceWith({
      kind: "window",
      id: 1,
      action: "tray",
      remember: true,
    });
    expect(settled).toHaveBeenCalledExactlyOnceWith(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("waits without a deadline once the dialog acknowledges mounting", () => {
    const { protocol, fallback, execute } = setup();
    protocol.request();
    protocol.ready(1);
    vi.advanceTimersByTime(60_000);
    expect(fallback).not.toHaveBeenCalled();
    protocol.decide({ kind: "window", id: 1, action: "quit", remember: false });
    expect(execute).toHaveBeenCalledExactlyOnceWith({
      kind: "window",
      id: 1,
      action: "quit",
      remember: false,
    });
  });

  it("falls back once after two seconds without a valid ready receipt", () => {
    const { protocol, fallback, settled, request } = setup();
    protocol.request();
    protocol.ready(999);
    vi.advanceTimersByTime(1_999);
    expect(fallback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    protocol.fail();
    expect(fallback).toHaveBeenCalledExactlyOnceWith("window");
    expect(settled).toHaveBeenCalledExactlyOnceWith(1);
    protocol.request();
    expect(request).toHaveBeenLastCalledWith(2, "window");
  });

  it("ignores stale or mismatched decisions and treats malformed actions as cancellation", () => {
    const { protocol, execute } = setup();
    protocol.request();
    protocol.fail();
    protocol.request();
    protocol.ready(2);
    protocol.decide(null);
    protocol.decide({ kind: "window", id: 1, action: "quit", remember: true });
    protocol.decide({ kind: "process-quit", id: 2, action: "keep" });
    expect(execute).not.toHaveBeenCalled();
    protocol.decide({ kind: "window", id: 2, action: "unknown", remember: "true" });
    expect(execute).toHaveBeenCalledExactlyOnceWith({
      kind: "window",
      id: 2,
      action: "cancel",
      remember: false,
    });
  });

  it("process-quit requests replace an active window prompt and accept keep or kill", () => {
    const { protocol, request, execute, settled } = setup();
    protocol.request();
    protocol.request("process-quit");
    expect(settled).toHaveBeenCalledExactlyOnceWith(1);
    expect(request).toHaveBeenLastCalledWith(2, "process-quit");
    protocol.ready(2);
    protocol.decide({ kind: "process-quit", id: 2, action: "keep" });
    expect(execute).toHaveBeenCalledExactlyOnceWith({
      kind: "process-quit",
      id: 2,
      action: "keep",
    });
    protocol.request("process-quit");
    protocol.ready(3);
    protocol.decide({ kind: "process-quit", id: 3, action: "kill" });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenLastCalledWith({ kind: "process-quit", id: 3, action: "kill" });
  });

  it("passes the process-quit kind to the fallback", () => {
    const { protocol, fallback } = setup();
    protocol.request("process-quit");
    protocol.fail();
    expect(fallback).toHaveBeenCalledExactlyOnceWith("process-quit");
  });

  it("recovers when an acknowledged renderer reloads or crashes", () => {
    const { protocol, fallback } = setup();
    protocol.request();
    protocol.ready(1);
    protocol.fail();
    protocol.fail();
    vi.runAllTimers();
    expect(fallback).toHaveBeenCalledExactlyOnceWith("window");
  });

  it("allows another choice after tray creation or persistence fails", () => {
    const { protocol, execute, settled } = setup();
    protocol.request();
    protocol.ready(1);
    execute.mockImplementationOnce(() => {
      throw new Error("tray unavailable");
    });
    expect(() =>
      protocol.decide({ kind: "window", id: 1, action: "tray", remember: false }),
    ).toThrow("tray unavailable");
    expect(settled).not.toHaveBeenCalled();
    protocol.decide({ kind: "window", id: 1, action: "cancel", remember: false });
    expect(settled).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("cleans up without fallback when the window is destroyed", () => {
    const { protocol, fallback, execute } = setup();
    protocol.request();
    protocol.dispose();
    vi.runAllTimers();
    protocol.decide({ kind: "window", id: 1, action: "quit", remember: false });
    expect(fallback).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
