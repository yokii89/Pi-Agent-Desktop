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
    expect(request).toHaveBeenCalledTimes(1);
    protocol.decide({ id: 1, action: "tray", remember: true });
    protocol.decide({ id: 1, action: "quit", remember: true });
    vi.runAllTimers();
    expect(execute).toHaveBeenCalledExactlyOnceWith("tray", true);
    expect(settled).toHaveBeenCalledExactlyOnceWith(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("waits without a deadline once the dialog acknowledges mounting", () => {
    const { protocol, fallback, execute } = setup();
    protocol.request();
    protocol.ready(1);
    vi.advanceTimersByTime(60_000);
    expect(fallback).not.toHaveBeenCalled();
    protocol.decide({ id: 1, action: "quit", remember: false });
    expect(execute).toHaveBeenCalledExactlyOnceWith("quit", false);
  });

  it("falls back once after two seconds without a valid ready receipt", () => {
    const { protocol, fallback, settled, request } = setup();
    protocol.request();
    protocol.ready(999);
    vi.advanceTimersByTime(1_999);
    expect(fallback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    protocol.fail();
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledExactlyOnceWith(1);
    protocol.request();
    expect(request).toHaveBeenLastCalledWith(2);
  });

  it("ignores stale decisions and treats malformed actions as cancellation", () => {
    const { protocol, execute } = setup();
    protocol.request();
    protocol.decide({ id: 1, action: "cancel", remember: false });
    protocol.request();
    protocol.ready(2);
    protocol.decide(null);
    protocol.decide({ id: 1, action: "quit", remember: true });
    expect(execute).toHaveBeenCalledTimes(1);
    protocol.decide({ id: 2, action: "unknown", remember: "true" });
    expect(execute).toHaveBeenLastCalledWith("cancel", false);
  });

  it("recovers when an acknowledged renderer reloads or crashes", () => {
    const { protocol, fallback } = setup();
    protocol.request();
    protocol.ready(1);
    protocol.fail();
    protocol.fail();
    vi.runAllTimers();
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("allows another choice after tray creation or persistence fails", () => {
    const { protocol, execute, settled } = setup();
    protocol.request();
    protocol.ready(1);
    execute.mockImplementationOnce(() => {
      throw new Error("tray unavailable");
    });
    expect(() => protocol.decide({ id: 1, action: "tray" })).toThrow("tray unavailable");
    expect(settled).not.toHaveBeenCalled();
    protocol.decide({ id: 1, action: "cancel" });
    expect(settled).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("cleans up without fallback when the window is destroyed", () => {
    const { protocol, fallback, execute } = setup();
    protocol.request();
    protocol.dispose();
    vi.runAllTimers();
    protocol.decide({ id: 1, action: "quit" });
    expect(fallback).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
