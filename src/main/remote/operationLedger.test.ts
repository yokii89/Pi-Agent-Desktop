import { describe, expect, it, vi } from "vitest";
import { ControlError } from "../../shared/remote";
import {
  MemoryRemoteOperationStore,
  RemoteOperationLedger,
  type RemoteOperationStore,
} from "./operationLedger";

const now = Date.parse("2026-11-19T10:00:00Z");
const payload = { sessionId: "session-1", text: "private prompt" };
const result = { disposition: "started", privateResult: "private response" };

function execute(ledger: RemoteOperationLedger, action: () => Promise<unknown>) {
  return ledger.execute("device-1", "operation-1", "sessions.send", payload, action);
}

describe("remote operation journal", () => {
  it("loads lazily so module construction does not access Electron storage", () => {
    const store: RemoteOperationStore = { load: vi.fn(() => []), save: vi.fn() };
    new RemoteOperationLedger(store, () => now);
    expect(store.load).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it("coalesces concurrent duplicates and never persists prompt or result contents", async () => {
    const store = new MemoryRemoteOperationStore();
    const ledger = new RemoteOperationLedger(store, () => now);
    let finish: (value: unknown) => void = () => {};
    const pending = new Promise<unknown>((resolve) => {
      finish = resolve;
    });
    const action = vi.fn(() => pending);
    const first = execute(ledger, action);
    const second = execute(ledger, action);
    expect(action).toHaveBeenCalledTimes(1);
    expect(ledger.lookup("device-1", "operation-1")?.state).toBe("running");
    finish(result);
    await expect(first).resolves.toEqual({ state: "completed", result, errorCode: null });
    await expect(second).resolves.toEqual({ state: "completed", result, errorCode: null });
    await execute(ledger, action);
    expect(action).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(store.load())).not.toContain("private");
    expect(store.load()[0].result).toBeNull();
  });

  it("rejects reused identifiers with different payloads or commands", async () => {
    const ledger = new RemoteOperationLedger(new MemoryRemoteOperationStore(), () => now);
    const action = vi.fn(async () => result);
    await execute(ledger, action);
    await expect(
      ledger.execute("device-1", "operation-1", "sessions.send", { text: "different" }, action),
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    await expect(
      ledger.execute("device-1", "operation-1", "sessions.stop", payload, action),
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    expect(action).toHaveBeenCalledTimes(1);
    expect(ledger.lookup("other-device", "operation-1")).toBeNull();
  });

  it("restores completed markers without replaying actions or restoring sensitive results", async () => {
    const store = new MemoryRemoteOperationStore();
    await execute(new RemoteOperationLedger(store, () => now), async () => result);
    const restored = new RemoteOperationLedger(store, () => now);
    const action = vi.fn(async () => result);
    await expect(execute(restored, action)).resolves.toEqual({
      state: "completed",
      result: null,
      errorCode: null,
    });
    expect(action).not.toHaveBeenCalled();
  });

  it("retries failed journal loads before it can execute a previously completed operation", async () => {
    const backing = new MemoryRemoteOperationStore();
    await execute(new RemoteOperationLedger(backing, () => now), async () => result);
    const store: RemoteOperationStore = {
      load: vi
        .fn(() => backing.load())
        .mockImplementationOnce(() => {
          throw new ControlError("STATE_UNAVAILABLE");
        }),
      save: (operations) => backing.save(operations),
    };
    const ledger = new RemoteOperationLedger(store, () => now);
    const action = vi.fn(async () => result);
    await expect(execute(ledger, action)).rejects.toThrow("STATE_UNAVAILABLE");
    await expect(execute(ledger, action)).resolves.toMatchObject({ state: "completed" });
    expect(action).not.toHaveBeenCalled();
    expect(store.load).toHaveBeenCalledTimes(2);
  });

  it("retries initialization when normalizing the durable journal cannot be saved", async () => {
    const backing = new MemoryRemoteOperationStore();
    await execute(new RemoteOperationLedger(backing, () => now), async () => result);
    const store: RemoteOperationStore = {
      load: vi.fn(() => backing.load()),
      save: vi
        .fn((operations) => backing.save(operations))
        .mockImplementationOnce(() => {
          throw new ControlError("STATE_UNAVAILABLE");
        }),
    };
    const ledger = new RemoteOperationLedger(store, () => now);
    const action = vi.fn(async () => result);
    await expect(execute(ledger, action)).rejects.toThrow("STATE_UNAVAILABLE");
    await expect(execute(ledger, action)).resolves.toMatchObject({ state: "completed" });
    expect(store.load).toHaveBeenCalledTimes(2);
    expect(action).not.toHaveBeenCalled();
  });

  it("never performs an action if its running marker cannot be saved", async () => {
    let saves = 0;
    const ledger = new RemoteOperationLedger(
      {
        load: () => [],
        save: () => {
          if (++saves === 2) throw new ControlError("STATE_UNAVAILABLE");
        },
      },
      () => now,
    );
    const action = vi.fn(async () => result);
    await expect(execute(ledger, action)).rejects.toThrow("STATE_UNAVAILABLE");
    await execute(ledger, action);
    expect(action).not.toHaveBeenCalled();
    expect(ledger.lookup("device-1", "operation-1")).toMatchObject({ state: "uncertain" });
  });

  it.each([
    new Error("private transport details"),
    new ControlError("CONTROL_FAILED"),
    new ControlError("NETWORK_UNCERTAIN"),
  ])(
    "keeps ambiguous action failures uncertain without exposing internal errors: %s",
    async (cause) => {
      const ledger = new RemoteOperationLedger(new MemoryRemoteOperationStore(), () => now);
      const action = vi.fn(async () => {
        throw cause;
      });
      const outcome = await execute(ledger, action);
      expect(outcome).toEqual({ state: "uncertain", result: null, errorCode: "RESULT_UNCERTAIN" });
      expect(JSON.stringify(outcome)).not.toContain("private");
      await execute(ledger, action);
      expect(action).toHaveBeenCalledTimes(1);
    },
  );

  it("preserves a definitive application rejection", async () => {
    const ledger = new RemoteOperationLedger(new MemoryRemoteOperationStore(), () => now);
    await expect(
      execute(ledger, async () => {
        throw new ControlError("INTERACTION_SETTLED");
      }),
    ).resolves.toEqual({ state: "failed", result: null, errorCode: "INTERACTION_SETTLED" });
  });

  it("keeps a completed action uncertain when final persistence fails, including after restart", async () => {
    const backing = new MemoryRemoteOperationStore();
    let saves = 0;
    const ledger = new RemoteOperationLedger(
      {
        load: () => backing.load(),
        save: (operations) => {
          if (++saves >= 3) throw new ControlError("STATE_UNAVAILABLE");
          backing.save(operations);
        },
      },
      () => now,
    );
    const action = vi.fn(async () => result);
    await expect(execute(ledger, action)).resolves.toEqual({
      state: "uncertain",
      result: null,
      errorCode: "RESULT_UNCERTAIN",
    });
    expect(backing.load()[0].state).toBe("running");
    const restored = new RemoteOperationLedger(backing, () => now);
    await expect(execute(restored, action)).resolves.toMatchObject({ state: "uncertain" });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("preserves a full journal across restart and makes room only when inserting", async () => {
    const store = new MemoryRemoteOperationStore();
    await execute(new RemoteOperationLedger(store, () => now), async () => result);
    const seed = store.load()[0];
    store.save(Array.from({ length: 256 }, (_, index) => ({ ...seed, requestId: `op-${index}` })));
    const restored = new RemoteOperationLedger(store, () => now);
    expect(restored.lookup("device-1", "op-0")?.state).toBe("completed");
    expect(store.load()).toHaveLength(256);
    await execute(restored, async () => result);
    expect(store.load()).toHaveLength(256);
  });
});
