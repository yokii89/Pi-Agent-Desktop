/**
 * Runtime hardening regressions (SDK review round).
 *
 * These tests reproduce host-restart / cancellation defects in
 * `DesktopViewClient` before the corresponding fixes:
 * - #2 a socket that drops mid-line must not poison the next handshake
 * - #5 an already-aborted signal must be a distinguishable cancellation,
 *   not the "client disposed" error
 * - #9 `openLive` must not leak its abort listener once the session settles
 */
import net from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DesktopViewClient, VIEW_PROTOCOL_VERSION, ViewHostError } from "./index.js";
import type { ViewEnvelope } from "./types.js";

function writeLine(socket: net.Socket, envelope: Omit<ViewEnvelope, "v">): void {
  socket.write(`${JSON.stringify({ v: VIEW_PROTOCOL_VERSION, ...envelope })}\n`);
}

let server: net.Server | null = null;
let port = 0;
let connections = 0;

/** Stub host: sends hello; on the first connection also emits a truncated line, then drops. */
function startStubHost(): Promise<void> {
  return new Promise((resolve) => {
    server = net.createServer((socket) => {
      connections += 1;
      const mine = connections;
      let authed = false;
      let buffer = "";
      socket.on("error", () => {
        // client side teardown
      });
      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        let nl = buffer.indexOf("\n");
        while (nl !== -1) {
          const line = buffer.slice(0, nl).replace(/\r$/, "");
          buffer = buffer.slice(nl + 1);
          nl = buffer.indexOf("\n");
          if (!line || authed) continue;
          authed = true;
          writeLine(socket, {
            id: "",
            type: "hello",
            payload: {
              protocol: VIEW_PROTOCOL_VERSION,
              placements: ["modal", "panel"],
              capabilities: ["view-table"],
            },
          });
          if (mine === 1) {
            // Truncated envelope: no trailing LF, then the pipe dies.
            socket.write('{"v":"view/v1","id":"stale","type":"ev');
            socket.destroy();
          }
        }
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server?.address();
      port = typeof addr === "object" && addr ? addr.port : 0;
      resolve();
    });
  });
}

beforeAll(async () => {
  await startStubHost();
});

afterAll(async () => {
  server?.closeAllConnections?.();
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = null;
});

const liveClients: DesktopViewClient[] = [];

afterEach(() => {
  connections = 0;
  for (const client of liveClients.splice(0)) {
    try {
      client.dispose();
    } catch {
      // already disposed
    }
  }
});

function makeClient(): DesktopViewClient {
  const client = new DesktopViewClient(
    { endpoint: `http://127.0.0.1:${port}`, token: "test-token", protocol: VIEW_PROTOCOL_VERSION },
    { helloTimeoutMs: 300, connectTimeoutMs: 1000 },
  );
  liveClients.push(client);
  return client;
}

/** Client without a live socket: `ensureConnected` is stubbed, so no I/O happens. */
function makeOfflineClient(): DesktopViewClient {
  const client = new DesktopViewClient({
    endpoint: "http://127.0.0.1:1",
    token: "t",
    protocol: VIEW_PROTOCOL_VERSION,
  });
  vi.spyOn(client, "ensureConnected").mockResolvedValue(null);
  liveClients.push(client);
  return client;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("#2 reconnect after a mid-line socket drop", () => {
  it("keeps hello/capabilities on the next connection", async () => {
    connections = 0;
    const client = makeClient();
    const hello1 = await client.ensureConnected();
    expect(hello1?.capabilities).toContain("view-table");

    // Socket died mid-line → client must observe the drop.
    await waitFor(() => client.hello === null);

    const hello2 = await client.ensureConnected();
    expect(hello2).not.toBeNull();
    expect(hello2?.capabilities).toContain("view-table");
    client.dispose();
  });
});

describe("#5 pre-aborted signal semantics", () => {
  it("openLive rejects with ViewHostError(closedReason=abort)", async () => {
    const client = makeOfflineClient();
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.openLive({ root: { type: "text", content: "x" } }, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "ViewHostError", code: "closed", closedReason: "abort" });
    client.dispose();
  });

  it("open() still treats a pre-aborted signal as a soft cancel", async () => {
    const client = makeOfflineClient();
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.open({ root: { type: "text", content: "x" } }, { signal: controller.signal }),
    ).resolves.toBeNull();
    client.dispose();
  });
});

describe("#9 abort listener cleanup", () => {
  it("openLive removes its abort listener once the session closes", async () => {
    const client = makeOfflineClient();
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener");

    const session = await client.openLive(
      { root: { type: "text", content: "x" } },
      { signal: controller.signal },
    );
    session.close();

    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
    client.dispose();
  });

  it("ViewHostError stays the SDK error type", () => {
    expect(new ViewHostError("x", { code: "internal" })).toBeInstanceOf(Error);
  });
});
