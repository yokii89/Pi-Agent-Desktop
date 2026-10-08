/**
 * Test harness for `@pidesk/view-sdk` consumers (docs/design/20 O5/O6).
 *
 * **Repo-internal only** — not in `package.json` `exports` and not published
 * (`docs/design/20` §6.3): `createTestViewHost` imports Host protocol helpers
 * from `src/main/view/viewHostProtocol`, and shipping it would either fork that
 * decision logic into the SDK or invert the dependency. This package's own
 * tests import it as `./testing.js`; extension repos use their own stubs until
 * the subpath ships. 准则 §6 forbids test-only entry points from becoming a
 * consumer contract — the previous arrangement leaked `__resetSlotLeasesForTests`
 * and friends through `index.ts`.
 *
 * `createTestViewHost` replaces the hand-written protocol stub extensions used
 * to each fork. The old stub in this package's own integration test drifted
 * from the real Host in three ways at once (no `capabilities`, no `sanitizeTree`,
 * a re-typed placement table), which is how four consumer failures survived
 * three commits. This one derives every decision from the real Host helpers, so
 * a fork cannot silently diverge again.
 */

import net from "node:net";
import {
  buildOpenedPayload,
  resolvePanelId,
  resolvePlacement,
  sanitizeTree,
} from "../../../src/main/view/viewHostProtocol";
import {
  IMPLEMENTED_VIEW_PLACEMENTS,
  SLOTTED_VIEW_PLACEMENTS,
  VIEW_HOST_CAPABILITIES,
  VIEW_LIMITS,
} from "../../../src/shared/view";
import { __resetProcessViewClientForTests } from "./processClient.js";
import { __resetSlotLeasesForTests } from "./slot.js";
import type { ViewEnvelope } from "./types.js";
import { VIEW_PROTOCOL_VERSION } from "./types.js";

export { __resetProcessViewClientForTests, __resetSlotLeasesForTests };

export interface TestViewHostFrame {
  v?: string;
  id?: string;
  type?: string;
  payload?: unknown;
  token?: string;
  sessionId?: string;
  role?: string;
}

export interface CreateTestViewHostOptions {
  /** Auth token the client must present. Default `"test-token"`. */
  token?: string;
  /**
   * Advertise a pre-P3 hello: no `access-mode` slot, no `capabilities`, no
   * `limits`. Exercises the "old Host / new SDK" half of 准则 §13.1.
   */
  legacy?: boolean;
  /** Reject auth with a socket teardown instead of an error frame. Default false. */
  rejectAuth?: boolean;
}

export interface TestViewHost {
  /** TCP endpoint to hand to `connectDesktopView` / `new DesktopViewClient`. */
  readonly endpoint: string;
  readonly token: string;
  /** Every inbound frame after auth, in arrival order. */
  readonly frames: TestViewHostFrame[];
  /** Frames of one type only, e.g. `host.framesOfType("open")`. */
  framesOfType(type: string): TestViewHostFrame[];
  /** Forget recorded frames without touching live connections. */
  reset(): void;
  /** Reply as the Host would after an `open` (used to drive ack timing in tests). */
  sendTo(id: string, type: ViewEnvelope["type"], payload: unknown): void;
  close(): Promise<void>;
}

/**
 * Start a loopback View Host that speaks the real protocol decisions.
 * Caller owns `close()`; an unclosed host keeps an ephemeral port bound.
 */
export async function createTestViewHost(
  options: CreateTestViewHostOptions = {},
): Promise<TestViewHost> {
  const token = options.token ?? "test-token";
  const frames: TestViewHostFrame[] = [];
  const sockets = new Set<net.Socket>();

  const server = net.createServer((socket) => {
    sockets.add(socket);
    // A client that vanishes mid-frame makes the accepted side emit ECONNRESET;
    // with no listener that surfaces as an uncaught exception and fails the
    // suite even though every assertion passed.
    socket.on("error", () => {
      // teardown path
    });
    socket.on("close", () => sockets.delete(socket));
    let authed = false;
    let buffer = "";

    const write = (envelope: Omit<ViewEnvelope, "v">): void => {
      socket.write(`${JSON.stringify({ v: VIEW_PROTOCOL_VERSION, ...envelope })}\n`);
    };

    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let nl = buffer.indexOf("\n");
      while (nl !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        handle(line);
        nl = buffer.indexOf("\n");
      }
    });

    const handle = (line: string): void => {
      if (!line) return;
      let parsed: TestViewHostFrame;
      try {
        parsed = JSON.parse(line) as TestViewHostFrame;
      } catch {
        return;
      }

      if (!authed) {
        if (parsed.token !== token || options.rejectAuth) {
          socket.destroy();
          return;
        }
        authed = true;
        write({
          id: "",
          type: "hello",
          payload: options.legacy
            ? { protocol: VIEW_PROTOCOL_VERSION, placements: ["modal", "widget", "panel"] }
            : {
                protocol: VIEW_PROTOCOL_VERSION,
                placements: [...IMPLEMENTED_VIEW_PLACEMENTS],
                capabilities: [...VIEW_HOST_CAPABILITIES],
                limits: VIEW_LIMITS,
              },
        });
        return;
      }

      frames.push(parsed);
      if (parsed.type !== "open" || typeof parsed.id !== "string") return;

      const payload = (parsed.payload ?? {}) as {
        placement?: unknown;
        placementRequired?: unknown;
        placementHint?: { panelId?: string; headerSide?: unknown };
        root?: unknown;
      };
      const decided = resolvePlacement(payload.placement, payload.placementRequired);
      if (!decided.ok) {
        write({
          id: parsed.id,
          type: "error",
          payload: { message: decided.message, code: "placement" },
        });
        write({ id: parsed.id, type: "closed", payload: { reason: "placement" } });
        return;
      }
      const sanitized = sanitizeTree(payload.root);
      if ("error" in sanitized) {
        write({
          id: parsed.id,
          type: "error",
          payload: { message: sanitized.error, code: "limit" },
        });
        write({ id: parsed.id, type: "closed", payload: { reason: "limit" } });
        return;
      }
      const panelId = SLOTTED_VIEW_PLACEMENTS.has(decided.placement)
        ? resolvePanelId(parsed.id, payload.placementHint?.panelId)
        : undefined;
      write({
        id: parsed.id,
        type: "opened",
        payload: buildOpenedPayload(decided.placement, panelId, payload.placementHint?.headerSide),
      });
    };
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    endpoint: `http://127.0.0.1:${port}`,
    token,
    frames,
    framesOfType: (type) => frames.filter((frame) => frame.type === type),
    reset: () => frames.splice(0),
    sendTo: (id, type, payload) => {
      for (const socket of sockets) {
        socket.write(`${JSON.stringify({ v: VIEW_PROTOCOL_VERSION, id, type, payload })}\n`);
      }
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
