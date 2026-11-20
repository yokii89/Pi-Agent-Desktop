import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionRenewal } from "./connectionRenewal";
import type { Principal } from "./contract";

const owner = `account-v1-${"a".repeat(64)}`;
const principal = (expires = Date.now() + 300_000): Principal => ({
  relayInstanceId: "relay",
  desktopId: "desktop",
  deviceId: "phone",
  grantId: "grant",
  grantVersion: 1,
  role: "mobile",
  connectionGeneration: 3,
  accessExpiresAt: new Date(expires).toISOString(),
});
afterEach(() => vi.useRealTimers());
function fixture() {
  vi.useFakeTimers();
  const send = vi.fn(),
    close = vi.fn(),
    renewed = vi.fn();
  const credentials = vi.fn(async () => ({
    accessToken: "room-token",
    accountToken: "account-token",
  }));
  const renewal = new ConnectionRenewal(
    { accountId: owner, newId: () => "renew-1", now: Date.now, credentials, send, close, renewed },
    principal(),
  );
  renewal.start(new Date(Date.now() + 900_000).toISOString());
  return { renewal, send, close, renewed, credentials };
}

describe("socket credential renewal", () => {
  it("renews before expiry and preserves generation while extending the deadline", async () => {
    const f = fixture();
    await vi.advanceTimersByTimeAsync(240_000);
    expect(f.send).toHaveBeenCalledExactlyOnceWith({
      controlVersion: 2,
      type: "reauthenticate",
      renewalId: "renew-1",
      accessToken: "room-token",
      accountToken: "account-token",
    });
    f.renewal.accept({
      renewalId: "renew-1",
      principal: { ...principal(), accountId: owner },
      accountExpiresAt: new Date(Date.now() + 900_000).toISOString(),
    });
    await vi.advanceTimersByTimeAsync(61_000);
    expect(f.close).not.toHaveBeenCalled();
    expect(f.renewed).toHaveBeenCalledWith(expect.objectContaining({ connectionGeneration: 3 }));
    f.renewal.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects a different subject or generation in the acknowledgement", async () => {
    const f = fixture();
    await vi.advanceTimersByTimeAsync(240_000);
    expect(() =>
      f.renewal.accept({
        renewalId: "renew-1",
        principal: { ...principal(), accountId: owner, connectionGeneration: 4 },
      }),
    ).toThrow("AUTH_REQUIRED");
    expect(() =>
      f.renewal.accept({
        renewalId: "renew-1",
        principal: { ...principal(), accountId: owner, deviceId: "other" },
      }),
    ).toThrow("AUTH_REQUIRED");
    f.renewal.dispose();
  });
  it("does not revive a socket when credentials finish after disposal", async () => {
    const f = fixture();
    let complete!: (value: { accessToken: string; accountToken: string }) => void;
    f.credentials.mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    await vi.advanceTimersByTimeAsync(240_000);
    f.renewal.dispose();
    complete({ accessToken: "late", accountToken: "late" });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(f.send).not.toHaveBeenCalled();
    expect(f.close).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds retries and closes at the original expiry if refresh stays unavailable", async () => {
    const f = fixture();
    f.credentials.mockRejectedValue(new Error("network unavailable"));
    await vi.advanceTimersByTimeAsync(300_001);
    expect(f.credentials.mock.calls.length).toBeLessThanOrEqual(12);
    expect(f.close).toHaveBeenCalled();
    f.renewal.dispose();
  });
});
