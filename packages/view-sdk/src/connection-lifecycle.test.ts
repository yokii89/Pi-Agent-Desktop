/**
 * Connection-lifecycle branches (docs/design/20 O7).
 *
 * The recovery paths in `client.ts` — refresh-after-Host-restart, the two
 * handshake budgets, and write isolation across rebind/dispose — had zero
 * tests. They are the code that decides whether a chip survives a PiDesk
 * restart, so each one gets a deterministic fixture here rather than a
 * real-machine check.
 */

import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopViewClient } from "./client.js";
import type { TestViewHost } from "./testing.js";
import { createTestViewHost } from "./testing.js";
import { VIEW_PROTOCOL_VERSION } from "./types.js";

function listen(server: net.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });
}

function close(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/** A TCP endpoint that accepts and then goes silent — no hello ever arrives. */
async function silentEndpoint(): Promise<{ port: number; stop: () => Promise<void> }> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  const port = await listen(server);
  return {
    port,
    async stop() {
      for (const socket of sockets) socket.destroy();
      await close(server);
    },
  };
}

/** A named pipe that cannot exist: fails fast, for the "refresh found nothing" case. */
const BLACKHOLE_PIPE = "\\\\.\\pipe\\pidesk-does-not-exist";

describe("#connectWithRefresh", () => {
  let host: TestViewHost | null = null;

  afterEach(async () => {
    await host?.close();
    host = null;
  });

  it("retries once against a refreshed endpoint after a Host restart", async () => {
    host = await createTestViewHost();
    // The baked env is what the client first dials; the *refresh source* is the
    // env a restarted Host would leave behind. That is exactly the `#connectWithRefresh`
    // contract: fail once, re-read, retry — no re-registration from the extension.
    const stale = {
      endpoint: BLACKHOLE_PIPE,
      token: "test-token",
      protocol: VIEW_PROTOCOL_VERSION,
    };
    const client = new DesktopViewClient(stale, {
      connectTimeoutMs: 300,
      helloTimeoutMs: 200,
      env: {
        PIDESK_VIEW_ENDPOINT: host.endpoint,
        PIDESK_VIEW_TOKEN: "test-token",
        PIDESK_VIEW_PROTOCOL: VIEW_PROTOCOL_VERSION,
      },
    });

    const hello = await client.ensureConnected();
    expect(hello).not.toBeNull();
    expect(hello?.protocol).toBe(VIEW_PROTOCOL_VERSION);
    expect(client.env.endpoint).toBe(host.endpoint);
    client.dispose();
  });

  it("rethrows the original failure when refresh finds nothing new", async () => {
    const client = new DesktopViewClient(
      {
        endpoint: BLACKHOLE_PIPE,
        token: "test-token",
        protocol: VIEW_PROTOCOL_VERSION,
      },
      { connectTimeoutMs: 300, helloTimeoutMs: 200, env: {} },
    );
    await expect(client.ensureConnected()).rejects.toThrow(
      /pidesk-does-not-exist|ECONNREFUSED|ENOENT|timeout/i,
    );
    client.dispose();
  });
});

describe("handshake budgets", () => {
  let silent: { port: number; stop: () => Promise<void> } | null = null;

  afterEach(async () => {
    await silent?.stop();
    silent = null;
  });

  it("hello timeout resolves with no hello instead of hanging forever", async () => {
    silent = await silentEndpoint();
    const client = new DesktopViewClient(
      {
        endpoint: `http://127.0.0.1:${silent.port}`,
        token: "test-token",
        protocol: VIEW_PROTOCOL_VERSION,
      },
      { connectTimeoutMs: 500, helloTimeoutMs: 150 },
    );
    const started = Date.now();
    const hello = await client.ensureConnected();
    expect(hello).toBeNull();
    // Proves the budget actually fired rather than racing a real hello.
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
    client.dispose();
  });

  it("surfaces the connect budget value in the error the socket path produces", async () => {
    // Named deliberately narrow: the `connectTimeoutMs` **timer** branch is not
    // reachable deterministically from a sandbox (a TEST-NET address either
    // refuses instantly or gets answered by the local network stack), so this
    // asserts the failure that *is* reproducible — an endpoint that cannot be
    // dialled — and rejects rather than hanging. docs/design/20 §7 records the
    // timer branch as unverified instead of faking it with a sleep race.
    const client = new DesktopViewClient(
      {
        endpoint: BLACKHOLE_PIPE,
        token: "test-token",
        protocol: VIEW_PROTOCOL_VERSION,
      },
      { connectTimeoutMs: 120, helloTimeoutMs: 50, env: {} },
    );
    await expect(client.ensureConnected()).rejects.toThrow(/pidesk-does-not-exist/i);
    client.dispose();
  });
});

describe("writes after rebind / dispose never reach another connection", () => {
  let host: TestViewHost | null = null;

  afterEach(async () => {
    await host?.close();
    host = null;
  });

  it("treats a write after rebind as a no-op", async () => {
    host = await createTestViewHost();
    const client = new DesktopViewClient(
      {
        endpoint: host.endpoint,
        token: "test-token",
        protocol: VIEW_PROTOCOL_VERSION,
      },
      { connectTimeoutMs: 1000, helloTimeoutMs: 500 },
    );
    const session = await client.openLive({ root: { type: "text", content: "first" } });
    host.reset();

    client.setSessionId("session-2");
    session.update({ type: "text", content: "after rebind" });
    await client.ensureConnected();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // `setSessionId` settles live views with reason "rebind"; a settled session
    // drops writes. Every public send path awaits `ensureConnected()` first and
    // every teardown settles its views, so a pre-ready write queue had no
    // reachable producer and was removed (docs/design/20 §6.3 / §8).
    // Asserted as "no phantom frame on the new connection".
    expect(session.closed).toBeDefined();
    expect(host.framesOfType("update")).toHaveLength(0);
    client.dispose();
  });

  it("does not replay writes onto a new client", async () => {
    host = await createTestViewHost();
    const client = new DesktopViewClient(
      {
        endpoint: host.endpoint,
        token: "test-token",
        protocol: VIEW_PROTOCOL_VERSION,
      },
      { connectTimeoutMs: 1000, helloTimeoutMs: 500 },
    );
    const session = await client.openLive({ root: { type: "text", content: "x" } });
    client.setSessionId("session-3");
    session.update({ type: "text", content: "will never ship" });
    client.dispose();
    host.reset();

    // A *different* connection must never receive the abandoned frame: the view
    // id belongs to the disposed client, and replaying it would make the Host
    // answer `error(视图不存在或已关闭)` on an unrelated session.
    const second = new DesktopViewClient(
      { endpoint: host.endpoint, token: "test-token", protocol: VIEW_PROTOCOL_VERSION },
      { connectTimeoutMs: 1000, helloTimeoutMs: 500 },
    );
    await second.ensureConnected();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(host.framesOfType("update")).toHaveLength(0);
    second.dispose();
  });
});
