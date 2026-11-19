import { createHash } from "node:crypto";
import { fail, id } from "../../shared/remote";

export type RemoteOperationState = "running" | "completed" | "failed" | "uncertain";
export type WriteCommand =
  | "sessions.send"
  | "sessions.stop"
  | "sessions.create"
  | "interactions.answer";
export interface RemoteOperation {
  deviceId: string;
  requestId: string;
  command: WriteCommand;
  digest: string;
  state: RemoteOperationState;
  result: unknown | null;
  errorCode: string | null;
  updatedAt: number;
}
export interface RemoteOperationStore {
  load(): RemoteOperation[];
  save(operations: RemoteOperation[]): void;
}
const MAX_OPERATIONS = 256;
const RETAIN_MS = 30 * 86_400_000;

/**
 * Desktop-authoritative bounded idempotency journal. Payloads are hashed, never persisted.
 * An interrupted operation becomes uncertain after restart and is never replayed automatically.
 */
export class RemoteOperationLedger {
  private readonly operations = new Map<string, RemoteOperation>();
  private readonly flights = new Map<string, Promise<unknown>>();
  constructor(
    private readonly store: RemoteOperationStore,
    private readonly now = Date.now,
  ) {
    for (const loaded of store.load()) {
      const operation = structuredClone(loaded);
      if (operation.state === "running") {
        operation.state = "uncertain";
        operation.result = null;
        operation.errorCode = "RESULT_UNCERTAIN";
      }
      this.operations.set(this.key(operation.deviceId, operation.requestId), operation);
    }
    this.prune();
    this.persist();
  }
  private key(deviceId: string, requestId: string): string {
    return `${deviceId}:${requestId}`;
  }
  private fingerprint(command: WriteCommand, payload: unknown): string {
    return createHash("sha256").update(JSON.stringify([command, payload])).digest("hex");
  }
  private persist(): void {
    this.store.save([...this.operations.values()]);
  }
  private prune(): void {
    const now = this.now();
    for (const [key, operation] of this.operations)
      if (operation.state !== "running" && now - operation.updatedAt > RETAIN_MS)
        this.operations.delete(key);
    while (this.operations.size >= MAX_OPERATIONS) {
      const oldest = [...this.operations.entries()].find(([, operation]) => operation.state !== "running");
      if (!oldest) fail("BUSY");
      this.operations.delete(oldest[0]);
    }
  }
  private conflict(operation: RemoteOperation, command: WriteCommand, digest: string): void {
    if (operation.command !== command || operation.digest !== digest) fail("IDEMPOTENCY_CONFLICT");
  }
  async execute(
    deviceId: string,
    requestId: string,
    command: WriteCommand,
    payload: unknown,
    action: () => Promise<unknown>,
  ): Promise<Pick<RemoteOperation, "state" | "result" | "errorCode">> {
    id(requestId);
    const key = this.key(deviceId, requestId);
    const digest = this.fingerprint(command, payload);
    const previous = this.operations.get(key);
    if (previous) {
      this.conflict(previous, command, digest);
      const flight = this.flights.get(key);
      if (flight) {
        await flight.catch(() => {});
      }
      const current = this.operations.get(key) ?? previous;
      return this.describe(current);
    }

    this.prune();
    const operation: RemoteOperation = {
      deviceId,
      requestId,
      command,
      digest,
      state: "running",
      result: null,
      errorCode: null,
      updatedAt: this.now(),
    };
    this.operations.set(key, operation);
    // The durable marker must be written before any session side effect.
    this.persist();

    const flight = (async (): Promise<unknown> => {
      let result: unknown;
      try {
        result = await action();
      } catch (cause) {
        operation.state = "failed";
        operation.errorCode = cause instanceof Error ? cause.message : "CONTROL_FAILED";
        operation.updatedAt = this.now();
        this.persist();
        return null;
      }
      operation.state = "completed";
      operation.result = result;
      operation.updatedAt = this.now();
      try {
        this.persist();
      } catch {
        // The action may have taken effect; leave the prior durable `running` record as uncertain.
        operation.state = "uncertain";
        operation.result = null;
        operation.errorCode = "RESULT_UNCERTAIN";
        try {
          this.persist();
        } catch {
          // The on-disk running marker still prevents replay after restart.
        }
      }
      return result;
    })().finally(() => this.flights.delete(key));
    this.flights.set(key, flight);
    await flight;
    return this.describe(operation);
  }
  lookup(deviceId: string, requestId: string): Omit<RemoteOperation, "digest"> | null {
    id(requestId);
    const operation = this.operations.get(this.key(deviceId, requestId));
    if (!operation) return null;
    const { digest: _digest, ...publicRecord } = operation;
    if (operation.state === "running" && !this.flights.has(this.key(deviceId, requestId))) {
      return { ...publicRecord, state: "uncertain", errorCode: "RESULT_UNCERTAIN" };
    }
    return publicRecord;
  }
  private describe(
    operation: RemoteOperation,
  ): Pick<RemoteOperation, "state" | "result" | "errorCode"> {
    return { state: operation.state, result: operation.result, errorCode: operation.errorCode };
  }
}

export class MemoryRemoteOperationStore implements RemoteOperationStore {
  private operations: RemoteOperation[] = [];
  load(): RemoteOperation[] {
    return structuredClone(this.operations);
  }
  save(operations: RemoteOperation[]): void {
    this.operations = structuredClone(operations);
  }
}
