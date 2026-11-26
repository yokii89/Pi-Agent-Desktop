import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import {
  AGENT_RUNTIME_PROTOCOL_VERSION,
  parseAgentRuntimeRequest,
} from "../shared/agentRuntimeProtocol.js";
import { boundedJson, DURABLE_RUNTIME_MESSAGE_MAX_BYTES } from "../shared/durableProtocol.js";
import type { TelegramHostRequest } from "../shared/telegram.js";
import { DesktopRuntime } from "./desktopRuntime.js";
import { runDurableSqliteSmokeTest } from "./sqliteSmokeTest.js";

interface RuntimePort {
  on(event: "message", listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
  start(): void;
  close(): void;
}

interface UtilityParentMessage {
  data: unknown;
  ports?: unknown[];
}

interface UtilityParentPort {
  on(event: "message", listener: (event: UtilityParentMessage) => void): void;
  postMessage(message: unknown): void;
}

type RuntimeProcess = NodeJS.Process & { parentPort?: UtilityParentPort };

const parentPort = (process as RuntimeProcess).parentPort;
if (!parentPort)
  throw new Error("Durable runtime must be launched as an Electron utility process.");

let channel: RuntimePort | null = null;
let runningSmokeTest = false;
let shuttingDown = false;
const hostRequests = new Map<
  string,
  { resolve: (value: string) => void; reject: (error: Error) => void; cleanup: () => void }
>();
function hostRequest(request: TelegramHostRequest, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted || !channel) {
      reject(new Error("Host operation cancelled."));
      return;
    }
    const id = randomUUID();
    const abort = () => {
      const pending = hostRequests.get(id);
      if (!pending) return;
      pending.cleanup();
      channel?.postMessage({ type: "host-cancel", id });
      reject(new Error("Host operation cancelled."));
    };
    const timer = setTimeout(abort, 120000);
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      hostRequests.delete(id);
    };
    hostRequests.set(id, { resolve, reject, cleanup });
    signal?.addEventListener("abort", abort, { once: true });
    channel?.postMessage({ type: "host-request", id, request });
  });
}
const runtime = new DesktopRuntime((update) => {
  // Strip optional undefined fields at the private JSON DTO boundary.
  const wire: unknown = JSON.parse(JSON.stringify({ type: "update", update }));
  if (!boundedJson(wire, DURABLE_RUNTIME_MESSAGE_MAX_BYTES)) {
    channel?.postMessage({
      type: "update",
      update: {
        type: "error",
        sessionId: update.sessionId,
        error: "Durable update exceeds the protocol limit.",
      },
    });
    return;
  }
  channel?.postMessage(wire);
}, hostRequest);
const active = new Set<Promise<void>>();

function sendError(id: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  channel?.postMessage({ type: "response", id, ok: false, error: message.slice(0, 2_000) });
}

async function handleRequest(value: unknown): Promise<void> {
  const port = channel;
  if (!port || shuttingDown) return;
  const request = parseAgentRuntimeRequest(value);
  if (!request) {
    port.postMessage({ type: "protocol-error", error: "Invalid runtime request." });
    return;
  }

  if (request.type === "host-response") {
    const pending = hostRequests.get(request.id);
    if (pending) {
      pending.cleanup();
      if (request.ok) pending.resolve(request.result);
      else pending.reject(new Error(request.error));
    }
    return;
  }
  if (request.type === "shutdown") {
    if (runningSmokeTest) {
      sendError(request.id, new Error("Runtime cannot stop while a smoke test is running."));
      return;
    }
    shuttingDown = true;
    try {
      await Promise.allSettled([...active]);
      await runtime.dispose();
    } catch (error) {
      shuttingDown = false;
      sendError(request.id, error);
      return;
    }
    port.postMessage({ type: "stopped", id: request.id });
    setTimeout(() => {
      port.close();
      process.exit(0);
    }, 10);
    return;
  }

  if (request.type === "command") {
    const operation = (async () => {
      try {
        const result = await runtime.execute(request.command);
        const wire: unknown = JSON.parse(
          JSON.stringify({ type: "response", id: request.id, ok: true, result: result ?? null }),
        );
        if (!boundedJson(wire, DURABLE_RUNTIME_MESSAGE_MAX_BYTES))
          throw new Error("Durable response exceeds the protocol limit.");
        port.postMessage(wire);
      } catch (error) {
        sendError(request.id, error);
      }
    })();
    active.add(operation);
    try {
      await operation;
    } finally {
      active.delete(operation);
    }
    return;
  }

  if (runningSmokeTest) {
    sendError(request.id, new Error("A Durable SQLite smoke test is already running."));
    return;
  }
  if (!path.isAbsolute(request.storageRoot)) {
    sendError(request.id, new Error("The smoke-test storage root must be absolute."));
    return;
  }

  runningSmokeTest = true;
  try {
    const result = await runDurableSqliteSmokeTest(request.storageRoot);
    port.postMessage({ type: "response", id: request.id, ok: true, result });
  } catch (error) {
    sendError(request.id, error);
  } finally {
    runningSmokeTest = false;
  }
}

parentPort.on("message", (event) => {
  const data = event.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return;
  const record = data as Record<string, unknown>;
  if (
    record.type !== "connect" ||
    record.protocolVersion !== AGENT_RUNTIME_PROTOCOL_VERSION ||
    !Array.isArray(event.ports) ||
    event.ports.length !== 1
  ) {
    return;
  }
  const transferredPort = event.ports[0];
  if (channel || typeof transferredPort !== "object" || transferredPort === null) return;

  channel = transferredPort as RuntimePort;
  channel.on("message", (messageEvent) => void handleRequest(messageEvent.data));
  channel.start();
  channel.postMessage({
    type: "ready",
    protocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION,
    nodeVersion: process.versions.node,
  });
});
