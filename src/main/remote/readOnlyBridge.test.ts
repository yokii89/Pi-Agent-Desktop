import { describe, expect, it } from "vitest";
import { type Grant, LIMITS, READ_SCOPES, type RoutingContext } from "../../shared/remote";
import {
  ReadOnlyBridge,
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
function fixture() {
  let current: Grant | null = baseGrant();
  let time = now;
  let sessionReads = 0;
  let historyReads = 0;
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
    },
    "process-epoch",
    () => time,
  );
  return {
    bridge,
    context,
    revoke: () => {
      current = { ...baseGrant(), state: "revoked", grantVersion: 2 };
    },
    expire: (ms: number) => {
      time += ms;
    },
    sessionReads: () => sessionReads,
    historyReads: () => historyReads,
  };
}

describe("desktop read-only authority and project isolation", () => {
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
    expect(emitted).toHaveLength(1);
    await f.bridge.tick((_context, event) => emitted.push(event));
    expect(emitted).toHaveLength(1);
    f.revoke();
    await f.bridge.tick((_context, event) => emitted.push(event));
    expect(emitted).toHaveLength(1);
    expect(f.bridge.isViewing("allowed-session")).toBe(false);
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
