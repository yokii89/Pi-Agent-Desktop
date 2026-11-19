import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ControlClient, type ControlFetch } from "./client";
import { ControlError } from "./contract";

const owner = `account-v1-${"a".repeat(64)}`;
const desktop = "00000000-0000-4000-8000-000000000001";
const options = {
  account: { accountId: owner, token: async () => "account-token" },
  desktopId: desktop,
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("v2 control request lifecycle", () => {
  it("keeps the request deadline active while reading a stalled response body", async () => {
    let signal: AbortSignal | undefined;
    let reading = false;
    let settled = false;
    const fetcher = vi.fn<ControlFetch>(async (_url, init) => {
      signal = init.signal;
      return {
        status: 200,
        headers: new Headers(),
        text: () =>
          new Promise<string>((_resolve, reject) => {
            reading = true;
            init.signal?.addEventListener("abort", () => reject(new Error("body aborted")), {
              once: true,
            });
          }),
      };
    });
    const client = new ControlClient(
      "https://relay.example",
      () => "request",
      fetcher,
      Date.now,
      options,
    );
    const result = client
      .request("GET", "/state", null, null, (v) => v)
      .then(
        () => {
          settled = true;
          return null;
        },
        (cause: unknown) => {
          settled = true;
          return cause;
        },
      );
    await vi.advanceTimersByTimeAsync(0);
    expect(reading).toBe(true);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(signal?.aborted).toBe(false);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    expect(await result).toEqual(new ControlError("NETWORK_UNCERTAIN", true));
    expect(fetcher).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the deadline after a successful response", async () => {
    let signal: AbortSignal | undefined;
    const fetcher = vi.fn<ControlFetch>(async (_url, init) => {
      signal = init.signal;
      return {
        status: 200,
        headers: new Headers(),
        text: async () =>
          JSON.stringify({
            controlVersion: 2,
            requestId: init.headers["X-Request-Id"],
            serverTime: new Date().toISOString(),
            data: { state: "ready" },
          }),
      };
    });
    const client = new ControlClient(
      "https://relay.example",
      () => "request",
      fetcher,
      Date.now,
      options,
    );
    await expect(client.request("GET", "/state", null, null, (v) => v)).resolves.toEqual({
      state: "ready",
    });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(signal?.aborted).toBe(false);
  });

  it("clears the deadline and preserves uncertainty without retrying a failed mutation", async () => {
    const fetcher = vi.fn<ControlFetch>(async () => {
      throw new Error("connection interrupted");
    });
    const client = new ControlClient(
      "https://relay.example",
      () => "request",
      fetcher,
      Date.now,
      options,
    );
    await expect(
      client.request("POST", "/pairings", "room-token", {}, (v) => v, "stable-request"),
    ).rejects.toMatchObject({ code: "NETWORK_UNCERTAIN", retryable: true });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases the deadline after malformed response data", async () => {
    const fetcher = vi.fn<ControlFetch>(async () => ({
      status: 200,
      headers: new Headers(),
      text: async () => "invalid JSON",
    }));
    const client = new ControlClient(
      "https://relay.example",
      () => "request",
      fetcher,
      Date.now,
      options,
    );
    await expect(client.request("GET", "/state", null, null, (v) => v)).rejects.toMatchObject({
      code: "NETWORK_UNCERTAIN",
      retryable: true,
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
