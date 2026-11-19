import { describe, expect, it, vi } from "vitest";
import {
  type Grant,
  LIMITS,
  READ_SCOPES,
  type RoutingContext,
  type Scope,
} from "../../shared/remote";
import { MemoryRemoteOperationStore, RemoteOperationLedger } from "./operationLedger";
import {
  ReadOnlyBridge,
  type ReadOnlySource,
  type RemoteMessage,
  type RemoteProject,
  type RemoteSession,
} from "./readOnlyBridge";

const now = Date.parse("2026-11-18T10:00:00Z");
const baseGrant = (): Grant => ({
  relayInstanceId: "relay-1",
  desktopId: "desktop-1",
  deviceId: "phone-1",
  grantId: "grant-1",
  grantVersion: 1,
  state: "active",
  scopes: [...READ_SCOPES],
  projectIds: ["allowed"],
  createdAt: new Date(now - 1000).toISOString(),
  expiresAt: new Date(now + LIMITS.grantMs).toISOString(),
  revokedAt: null,
  revocationReason: null,
  approvalId: "approval-1",
  activationId: "activation-1",
  activationExpiresAt: new Date(now + 10_000).toISOString(),
});
const context = (connectionGeneration = 1): RoutingContext => ({
  relayInstanceId: "relay-1",
  desktopId: "desktop-1",
  deviceId: "phone-1",
  grantId: "grant-1",
  grantVersion: 1,
  connectionGeneration,
  accessExpiresAt: new Date(now + LIMITS.accessMs).toISOString(),
});
const projects: RemoteProject[] = ["allowed", "private"].map((id) => ({
  id,
  name: id,
  description: { "zh-CN": "", "en-US": "" },
}));
const sessions: RemoteSession[] = [
  {
    id: "allowed-session",
    projectId: "allowed",
    title: "Allowed",
    status: "idle",
    updatedAt: 2,
    preview: "safe",
  },
  {
    id: "private-session",
    projectId: "private",
    title: "Private",
    status: "idle",
    updatedAt: 1,
    preview: "secret",
  },
];
const transcript: RemoteMessage[] = [
  { id: "message-1", role: "user", text: "hello", state: "done" },
  { id: "message-2", role: "assistant", text: "world", state: "done" },
];
function frame(command: string, payload: Record<string, unknown> = {}, id = "request-1") {
  return { version: 1, type: "request", id, command, payload };
}
function fixture(
  scopes: readonly Scope[] = READ_SCOPES,
  overrides: Partial<ReadOnlySource> = {},
  deviceId = "phone-1",
) {
  let current: Grant | null = { ...baseGrant(), deviceId, scopes: [...scopes] };
  let time = now;
  let sessionReads = 0;
  let historyReads = 0;
  const operations = new RemoteOperationLedger(new MemoryRemoteOperationStore(), () => time);
  const bridge = new ReadOnlyBridge(
    () => current,
    {
      projects: () => projects,
      sessions: async (allowed) => {
        sessionReads++;
        return sessions.filter((s) => allowed.includes(s.projectId));
      },
      messages: async (session) => {
        historyReads++;
        return session.projectId === "allowed" ? transcript : [];
      },
      interactions: async () => [],
      send: async (_session, _message) => ({ disposition: "started" }),
      stop: async () => ({ requested: true }),
      create: async () => sessions[0],
      answer: () => ({ settled: true }),
      ...overrides,
    },
    "process-epoch",
    () => time,
    operations,
  );
  return {
    bridge,
    operations,
    context: (generation = 1) => ({ ...context(generation), deviceId }),
    revoke: () => {
      current = { ...baseGrant(), deviceId, state: "revoked", grantVersion: 2 };
    },
    expire: (ms: number) => {
      time += ms;
    },
    sessionReads: () => sessionReads,
    historyReads: () => historyReads,
  };
}

describe("desktop read-only authority and project isolation", () => {
  it("authorizes incremental pages and never uses the legacy full transcript path", async () => {
    const history = vi.fn(async () => ({
      view: { identity: "file", messages: [], prefixes: [] },
      tail: { revision: "empty", messages: [] },
    }));
    const f = fixture(READ_SCOPES, { history });
    const payload = {
      sessionId: "allowed-session",
      direction: "latest",
      cursor: null,
      limit: 50,
      tailRevision: null,
    };
    expect(
      await f.bridge.request(f.context(), frame("sessions.history.sync", payload)),
    ).toMatchObject({
      data: { status: "page", messages: [], checkpoint: expect.any(String), beforeCursor: null },
    });
    expect(f.historyReads()).toBe(0);
    await expect(
      f.bridge.request(
        f.context(),
        frame("sessions.history.sync", { ...payload, sessionId: "private-session" }),
      ),
    ).rejects.toThrow("RESOURCE_UNAVAILABLE");
    expect(history).toHaveBeenCalledOnce();
    history.mockImplementationOnce(async () => {
      f.revoke();
      return {
        view: { identity: "file", messages: [], prefixes: [] },
        tail: { revision: "empty", messages: [] },
      };
    });
    await expect(
      f.bridge.request(f.context(), frame("sessions.history.sync", payload)),
    ).rejects.toThrow("DEVICE_REVOKED");
  });
  it("filters unauthorized project metadata, sessions, pages and history", async () => {
    const f = fixture();
    const projectResult = await f.bridge.request(f.context(), frame("projects.list"));
    expect(JSON.stringify(projectResult)).not.toContain("private");
    const list = await f.bridge.request(
      f.context(),
      frame("sessions.list", { projectId: null, cursor: null, limit: 50 }),
    );
    expect(JSON.stringify(list)).not.toContain("private");
    const history = await f.bridge.request(
      f.context(),
      frame("sessions.history", { sessionId: "allowed-session", cursor: null, limit: 50 }),
    );
    expect(history).toMatchObject({
      type: "response",
      status: "completed",
      data: { messages: transcript, nextCursor: null },
    });
  });
  it("looks up session ownership on the desktop and never trusts a claimed project id", async () => {
    const f = fixture();
    await expect(
      f.bridge.request(
        f.context(),
        frame("sessions.list", { projectId: "private", cursor: null, limit: 50 }),
      ),
    ).rejects.toThrow("RESOURCE_UNAVAILABLE");
    const before = f.sessionReads();
    await expect(
      f.bridge.request(
        f.context(),
        frame("sessions.history", { sessionId: "private-session", cursor: null, limit: 50 }),
      ),
    ).rejects.toThrow("RESOURCE_UNAVAILABLE");
    expect(f.historyReads()).toBe(0);
    expect(f.sessionReads()).toBeGreaterThan(before);
  });
  it("checks authentication and scope before touching application services", async () => {
    const f = fixture();
    f.revoke();
    await expect(f.bridge.request(f.context(), frame("projects.list"))).rejects.toThrow(
      "DEVICE_REVOKED",
    );
    expect(f.sessionReads()).toBe(0);
    const forged = { ...f.context(), grantVersion: 2 };
    await expect(f.bridge.request(forged, frame("sessions.send"))).rejects.toThrow(
      "DEVICE_REVOKED",
    );
  });
  it("rejects writes, extensions, extra fields, malformed IDs and unbounded page requests", async () => {
    const f = fixture();
    await expect(f.bridge.request(f.context(), frame("sessions.send"))).rejects.toThrow(
      "FORBIDDEN",
    );
    await expect(f.bridge.request(f.context(), frame("interactions.answer"))).rejects.toThrow(
      "FORBIDDEN",
    );
    await expect(f.bridge.request(f.context(), frame("unknown.command"))).rejects.toThrow(
      "INVALID_COMMAND",
    );
    await expect(
      f.bridge.request(f.context(), { ...frame("projects.list"), grantId: "forged" }),
    ).rejects.toThrow("INVALID_FRAME");
    await expect(
      f.bridge.request(
        f.context(),
        frame("sessions.list", { projectId: null, cursor: null, limit: 500 }),
      ),
    ).rejects.toThrow("INVALID_FRAME");
    await expect(
      f.bridge.request(
        f.context(),
        frame("sessions.history", { sessionId: "../private", cursor: null, limit: 50 }),
      ),
    ).rejects.toThrow("INVALID_FRAME");
  });
  it("uses desktop-authored bounded cursors and rechecks history authorization before returning", async () => {
    const _f = fixture();
    const items = Array.from({ length: 61 }, (_, i) => ({
      id: `m${i}`,
      role: "user" as const,
      text: "x",
      state: "done" as const,
    }));
    let enabled = true;
    const bridge = new ReadOnlyBridge(
      () => (enabled ? baseGrant() : { ...baseGrant(), state: "revoked", grantVersion: 2 }),
      {
        projects: () => projects.filter((p) => p.id === "allowed"),
        sessions: async (ids) => sessions.filter((s) => ids.includes(s.projectId)),
        messages: async () => items,
        interactions: async () => [],
        send: async () => ({ disposition: "started" }),
        stop: async () => ({ requested: true }),
        create: async () => sessions[0],
        answer: () => ({ settled: true }),
      },
      "epoch",
      () => now,
    );
    const page = await bridge.request(
      context(),
      frame("sessions.history", { sessionId: "allowed-session", cursor: null, limit: 50 }),
    );
    expect(page).toMatchObject({ data: { messages: items.slice(0, 50), nextCursor: "50" } });
    enabled = false;
    await expect(
      bridge.request(
        context(),
        frame(
          "sessions.history",
          { sessionId: "allowed-session", cursor: "50", limit: 50 },
          "request-2",
        ),
      ),
    ).rejects.toThrow("DEVICE_REVOKED");
  });
  it("keeps subscription leases bounded and checks revocation before sending events", async () => {
    const f = fixture();
    await f.bridge.request(
      f.context(),
      frame("sessions.subscribe", { sessionId: "allowed-session" }),
    );
    const emitted: unknown[] = [];
    await f.bridge.tick((_context, event) => emitted.push(event));
    expect(emitted).toMatchObject([
      { type: "event", sessionId: "overview", epoch: "process-epoch", sequence: 1 },
      { type: "event", sessionId: "allowed-session", epoch: "process-epoch", sequence: 2 },
    ]);
    await f.bridge.tick((_context, event) => emitted.push(event));
    expect(emitted).toHaveLength(2);
    f.revoke();
    await f.bridge.tick((_context, event) => emitted.push(event));
    expect(emitted).toHaveLength(2);
    expect(f.bridge.isViewing("allowed-session")).toBe(false);
  });
  it("does not read interaction details when only the session overview is authorized", async () => {
    const interactions = vi.fn(async () => []);
    const f = fixture(READ_SCOPES, { interactions });
    await f.bridge.request(f.context(), frame("projects.list"));
    const send = vi.fn();
    await f.bridge.tick(send);
    expect(interactions).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      f.context(),
      expect.objectContaining({ sessionId: "overview" }),
    );
  });
  it("still detects interaction changes when that capability is granted", async () => {
    const interactions = vi.fn(async () => [
      {
        id: "interaction",
        sessionId: "allowed-session",
        projectId: "allowed",
        kind: "confirm" as const,
        title: "Continue?",
        description: "",
      },
    ]);
    const f = fixture([...READ_SCOPES, "interactions.read"], { interactions });
    await f.bridge.request(f.context(), frame("projects.list"));
    const send = vi.fn();
    await f.bridge.tick(send);
    expect(send).toHaveBeenCalledTimes(1);
    interactions.mockResolvedValue([]);
    await f.bridge.tick(send);
    expect(interactions).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("shares overlapping event and periodic ticks without duplicate reads or events", async () => {
    const readSessions = vi.fn(async (_projects: string[]) => [sessions[0]]);
    const f = fixture(READ_SCOPES, { sessions: readSessions });
    await f.bridge.request(
      f.context(),
      frame("sessions.subscribe", { sessionId: "allowed-session" }),
    );
    let resolve!: (items: RemoteSession[]) => void;
    readSessions.mockClear();
    readSessions.mockReturnValueOnce(
      new Promise<RemoteSession[]>((done) => {
        resolve = done;
      }),
    );
    const send = vi.fn();
    const ticks = [f.bridge.tick(send), f.bridge.tick(send), f.bridge.tick(send)];
    resolve([sessions[0]]);
    await Promise.all(ticks);
    expect(readSessions).toHaveBeenCalledTimes(1);
    expect(f.historyReads()).toBe(1);
    expect(send).toHaveBeenCalledTimes(2);

    await f.bridge.tick(send);
    expect(readSessions).toHaveBeenCalledTimes(2);
    expect(f.historyReads()).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("lets a fresh connection sync while discarding a tick from before clear", async () => {
    const readSessions = vi.fn(async (_projects: string[]) => [sessions[0]]);
    const f = fixture(READ_SCOPES, { sessions: readSessions });
    await f.bridge.request(
      f.context(),
      frame("sessions.subscribe", { sessionId: "allowed-session" }),
    );
    let resolve!: (items: RemoteSession[]) => void;
    readSessions.mockReturnValueOnce(
      new Promise<RemoteSession[]>((done) => {
        resolve = done;
      }),
    );
    const staleSend = vi.fn();
    const stale = f.bridge.tick(staleSend);
    f.bridge.clear();
    await f.bridge.request(
      f.context(2),
      frame("sessions.subscribe", { sessionId: "allowed-session" }),
    );
    const send = vi.fn();
    await f.bridge.tick(send);
    expect(send).toHaveBeenCalledTimes(2);
    resolve([sessions[0]]);
    await stale;
    expect(staleSend).not.toHaveBeenCalled();
    expect(f.historyReads()).toBe(1);
    await f.bridge.tick(send);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("does not let a failed stale tick remove the new connection's subscription", async () => {
    const readSessions = vi.fn(async (_projects: string[]) => [sessions[0]]);
    const f = fixture(READ_SCOPES, { sessions: readSessions });
    await f.bridge.request(f.context(), frame("projects.list"));
    let reject!: (cause: Error) => void;
    readSessions.mockReturnValueOnce(
      new Promise<RemoteSession[]>((_resolve, fail) => {
        reject = fail;
      }),
    );
    const staleSend = vi.fn();
    const stale = f.bridge.tick(staleSend);
    f.bridge.clear();
    await f.bridge.request(
      f.context(2),
      frame("sessions.subscribe", { sessionId: "allowed-session" }),
    );
    reject(new Error("old connection read failed"));
    await stale;
    const send = vi.fn();
    await f.bridge.tick(send);
    expect(send).toHaveBeenCalledTimes(2);
    expect(staleSend).not.toHaveBeenCalled();
    expect(f.bridge.isViewing("allowed-session")).toBe(true);
  });
  it("still rechecks revocation after a shared tick finishes its reads", async () => {
    const readSessions = vi.fn(async (_projects: string[]) => [sessions[0]]);
    const f = fixture(READ_SCOPES, { sessions: readSessions });
    await f.bridge.request(f.context(), frame("projects.list"));
    let resolve!: (items: RemoteSession[]) => void;
    readSessions.mockReturnValueOnce(
      new Promise<RemoteSession[]>((done) => {
        resolve = done;
      }),
    );
    const send = vi.fn();
    const ticks = [f.bridge.tick(send), f.bridge.tick(send)];
    f.revoke();
    resolve([sessions[0]]);
    await Promise.all(ticks);
    expect(send).not.toHaveBeenCalled();
  });
  it("expires a viewing lease without continuing to read its session history", async () => {
    const f = fixture();
    await f.bridge.request(
      f.context(),
      frame("sessions.subscribe", { sessionId: "allowed-session" }),
    );
    expect(f.bridge.isViewing("allowed-session")).toBe(true);
    await f.bridge.tick(() => {});
    const reads = f.historyReads();
    f.expire(30_000);
    expect(f.bridge.isViewing("allowed-session")).toBe(false);
    await f.bridge.tick(() => {});
    expect(f.historyReads()).toBe(reads);
  });
  it("rejects a connection older than a previously observed generation and enforces expiry", async () => {
    const f = fixture();
    await f.bridge.request(f.context(2), frame("projects.list"));
    await expect(f.bridge.request(f.context(1), frame("projects.list"))).rejects.toThrow(
      "AUTH_EXPIRED",
    );
    const g = fixture();
    g.expire(LIMITS.accessMs);
    await expect(g.bridge.request(g.context(), frame("projects.list"))).rejects.toThrow(
      "DEVICE_REVOKED",
    );
  });
  it("rejects oversized payloads before invoking a service", async () => {
    const f = fixture();
    const oversized = frame("sessions.list", {
      projectId: null,
      cursor: "0".repeat(LIMITS.businessBytes + 1),
      limit: 50,
    });
    await expect(f.bridge.request(f.context(), oversized)).rejects.toThrow("FRAME_TOO_LARGE");
    expect(f.sessionReads()).toBe(0);
  });
});

describe("remote write authorization and outcome reconciliation", () => {
  it("executes an authorized message once and reconciles the result by operation id", async () => {
    const send = vi.fn(async () => ({ disposition: "started" }));
    const f = fixture([...READ_SCOPES, "sessions.send"], { send });
    const payload = { operationId: "operation-1", sessionId: "allowed-session", text: "hello" };
    await expect(
      f.bridge.request(f.context(), frame("sessions.send", payload)),
    ).resolves.toMatchObject({
      status: "completed",
      data: { disposition: "started" },
    });
    await f.bridge.request(f.context(), frame("sessions.send", payload, "request-2"));
    expect(send).toHaveBeenCalledTimes(1);
    await expect(
      f.bridge.request(f.context(), frame("requests.lookup", { operationId: "operation-1" })),
    ).resolves.toMatchObject({ data: { state: "completed", command: "sessions.send" } });
  });

  it("rejects writes without the specific capability before invoking a session service", async () => {
    const send = vi.fn(async () => ({ disposition: "started" }));
    const f = fixture(READ_SCOPES, { send });
    await expect(
      f.bridge.request(
        f.context(),
        frame("sessions.send", {
          operationId: "operation-1",
          sessionId: "allowed-session",
          text: "hello",
        }),
      ),
    ).rejects.toThrow("FORBIDDEN");
    expect(send).not.toHaveBeenCalled();
    expect(f.sessionReads()).toBe(0);
  });

  it("keeps a successful operation completed even if authorization is revoked before replying", async () => {
    const send = vi.fn(async () => {
      f.revoke();
      return { disposition: "started" };
    });
    const f = fixture([...READ_SCOPES, "sessions.send"], { send });
    await expect(
      f.bridge.request(
        f.context(),
        frame("sessions.send", {
          operationId: "operation-1",
          sessionId: "allowed-session",
          text: "hello",
        }),
      ),
    ).rejects.toThrow("DEVICE_REVOKED");
    expect(f.operations.lookup("phone-1", "operation-1")).toMatchObject({
      state: "completed",
      result: { disposition: "started" },
      errorCode: null,
    });
  });

  it("reports an uncertain result after a transport failure and does not resend the message", async () => {
    const send = vi.fn(async () => {
      throw new Error("private RPC transport details");
    });
    const f = fixture([...READ_SCOPES, "sessions.send"], { send });
    const request = frame("sessions.send", {
      operationId: "operation-1",
      sessionId: "allowed-session",
      text: "hello",
    });
    const response = await f.bridge.request(f.context(), request);
    expect(response).toMatchObject({ status: "failed", error: { code: "RESULT_UNCERTAIN" } });
    expect(JSON.stringify(response)).not.toContain("private");
    await f.bridge.request(f.context(), request);
    expect(send).toHaveBeenCalledTimes(1);
    await expect(
      f.bridge.request(f.context(), frame("requests.lookup", { operationId: "operation-1" })),
    ).resolves.toMatchObject({ data: { state: "uncertain", errorCode: "RESULT_UNCERTAIN" } });
  });

  it("isolates newly created session identities across devices using the same operation id", async () => {
    const create = vi.fn(async () => sessions[0]);
    const first = fixture([...READ_SCOPES, "sessions.create"], { create });
    const second = fixture([...READ_SCOPES, "sessions.create"], { create }, "phone-2");
    const request = frame("sessions.create", {
      operationId: "operation-1",
      projectId: "allowed",
      title: "New session",
    });
    await first.bridge.request(first.context(), request);
    await second.bridge.request(second.context(), request);
    expect(create.mock.calls).toEqual([
      ["allowed", "New session", JSON.stringify(["phone-1", "allowed", "operation-1"])],
      ["allowed", "New session", JSON.stringify(["phone-2", "allowed", "operation-1"])],
    ]);
  });

  it("filters interactions by desktop-owned project ids and strips internal project metadata", async () => {
    const interactions = vi.fn(async () => [
      {
        id: "allowed-interaction",
        sessionId: "allowed-session",
        projectId: "allowed",
        kind: "confirm" as const,
        title: "Continue?",
        description: "",
      },
      {
        id: "private-interaction",
        sessionId: "private-session",
        projectId: "private",
        kind: "confirm" as const,
        title: "Private",
        description: "",
      },
    ]);
    const f = fixture([...READ_SCOPES, "interactions.read"], { interactions });
    const response = await f.bridge.request(f.context(), frame("interactions.list"));
    expect(response).toMatchObject({ data: { interactions: [{ id: "allowed-interaction" }] } });
    expect(JSON.stringify(response)).not.toContain("private");
    expect(JSON.stringify(response)).not.toContain("projectId");
    expect(interactions).toHaveBeenCalledWith(["allowed"]);
  });
});
