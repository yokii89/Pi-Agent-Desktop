import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { app, MessageChannelMain, utilityProcess } from "electron";
import {
  AGENT_RUNTIME_PROTOCOL_VERSION,
  type AgentRuntimeRequest,
  parseAgentRuntimeMessage,
} from "../../shared/agentRuntimeProtocol";

const READY_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 120_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;
const PROCESS_EXIT_TIMEOUT_MS = 1_000;

interface RuntimeReady {
  nodeVersion: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function supportsDurableNodeVersion(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)\./.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 22 || (major === 22 && minor >= 19);
}

class AgentRuntimeManager {
  private child: Electron.UtilityProcess | null = null;
  private port: Electron.MessagePortMain | null = null;
  private starting: Promise<RuntimeReady> | null = null;
  private ready: RuntimeReady | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private resolveStartup: ((ready: RuntimeReady) => void) | null = null;
  private rejectStartup: ((error: Error) => void) | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private smokeTest: Promise<{ conversationId: number; reply: string }> | null = null;
  private closing = false;

  start(): Promise<RuntimeReady> {
    if (this.closing) return Promise.reject(new Error("Durable runtime is closing."));
    if (this.child && this.port && this.ready && !this.starting) {
      return Promise.resolve(this.ready);
    }
    if (this.starting) return this.starting;

    const starting = this.launch().finally(() => {
      if (this.starting === starting) this.starting = null;
    });
    this.starting = starting;
    return starting;
  }

  async runSqliteSmokeTest(): Promise<{ conversationId: number; reply: string }> {
    if (this.closing) throw new Error("Durable runtime is closing.");
    if (this.smokeTest) return this.smokeTest;
    const smokeTest = this.performSqliteSmokeTest().finally(() => {
      if (this.smokeTest === smokeTest) this.smokeTest = null;
    });
    this.smokeTest = smokeTest;
    return smokeTest;
  }

  async dispose(): Promise<void> {
    const child = this.child;
    if (!child) {
      this.closing = true;
      return;
    }
    if (this.starting) await this.starting.catch(() => undefined);
    this.closing = true;
    if (this.child !== child) return;

    try {
      await Promise.race([
        this.smokeTest?.catch(() => undefined) ?? Promise.resolve(),
        new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
      ]);
      if (this.child !== child) return;
      await Promise.race([
        this.sendRequest({ id: randomUUID(), type: "shutdown" }, SHUTDOWN_TIMEOUT_MS),
        new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
      ]);
    } catch {
      // The process is still explicitly terminated below; shutdown errors must not block application exit.
    }

    if (this.child !== child) return;
    const exited = new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
    });
    child.kill();
    await Promise.race([
      exited,
      new Promise<void>((resolve) => setTimeout(resolve, PROCESS_EXIT_TIMEOUT_MS)),
    ]);
    if (this.child === child) this.reset(child, new Error("Durable runtime stopped."));
  }

  private async performSqliteSmokeTest(): Promise<{ conversationId: number; reply: string }> {
    const directory = await mkdtemp(path.join(tmpdir(), "pidesk-durable-smoke-"));
    try {
      const value = await this.sendRequest(
        {
          id: randomUUID(),
          type: "smoke-test",
          databasePath: path.join(directory, "session.sqlite"),
        },
        REQUEST_TIMEOUT_MS,
      );
      if (
        typeof value !== "object" ||
        value === null ||
        typeof (value as { conversationId?: unknown }).conversationId !== "number" ||
        typeof (value as { reply?: unknown }).reply !== "string"
      ) {
        throw new Error("Durable runtime returned an invalid smoke-test result.");
      }
      return value as { conversationId: number; reply: string };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private launch(): Promise<RuntimeReady> {
    return new Promise<RuntimeReady>((resolve, reject) => {
      const entryPath = path.join(
        app.getAppPath(),
        "dist",
        "agentRuntime",
        "agentRuntime",
        "index.js",
      );
      const child = utilityProcess.fork(entryPath, [], {
        cwd: app.getPath("userData"),
        env: {},
        serviceName: "PiDesk Durable Agent Runtime",
        stdio: ["ignore", "ignore", "pipe"],
      });
      const { port1, port2 } = new MessageChannelMain();
      this.child = child;
      this.port = port1;
      this.resolveStartup = resolve;
      this.rejectStartup = reject;

      this.startupTimer = setTimeout(() => {
        this.reset(child, new Error("Timed out waiting for the Durable runtime to start."));
      }, READY_TIMEOUT_MS);

      port1.on("message", (event) => this.handleMessage(child, event.data));
      port1.start();
      let startupError = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        startupError = `${startupError}${chunk.toString("utf8")}`.slice(-2_000);
      });
      child.on("exit", (code) => {
        if (this.child === child) {
          this.reset(
            child,
            new Error(`Durable utility process exited (${code}). ${startupError.trim()}`),
          );
        }
      });

      try {
        child.postMessage({ type: "connect", protocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION }, [
          port2,
        ]);
      } catch (error) {
        this.reset(
          child,
          new Error(`Could not connect to the Durable utility process: ${errorMessage(error)}`),
        );
      }
    });
  }

  private handleMessage(child: Electron.UtilityProcess, value: unknown): void {
    if (this.child !== child) return;
    const message = parseAgentRuntimeMessage(value);
    if (!message) {
      this.reset(child, new Error("Durable utility process sent an invalid protocol message."));
      return;
    }

    if (message.type === "ready") {
      if (message.protocolVersion !== AGENT_RUNTIME_PROTOCOL_VERSION) {
        this.reset(child, new Error("Durable utility process protocol version mismatch."));
        return;
      }
      if (!supportsDurableNodeVersion(message.nodeVersion)) {
        this.reset(
          child,
          new Error(
            `Durable requires Node 22.19 or newer; the utility process provides ${message.nodeVersion}.`,
          ),
        );
        return;
      }
      if (this.startupTimer) clearTimeout(this.startupTimer);
      this.startupTimer = null;
      const ready = { nodeVersion: message.nodeVersion };
      this.ready = ready;
      this.resolveStartup?.(ready);
      this.resolveStartup = null;
      this.rejectStartup = null;
      return;
    }

    if (message.type === "protocol-error") {
      this.reset(child, new Error(message.error));
      return;
    }

    if (message.type === "response" || message.type === "stopped") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.type === "stopped") {
        pending.resolve(undefined);
      } else if (message.ok) {
        pending.resolve(message.result);
      } else {
        pending.reject(new Error(message.error));
      }
    }
  }

  private async sendRequest(request: AgentRuntimeRequest, timeoutMs: number): Promise<unknown> {
    if (request.type !== "shutdown" || this.starting) await this.start();
    const child = this.child;
    const port = this.port;
    if (!child || !port || (this.closing && request.type !== "shutdown")) {
      throw new Error("Durable runtime is unavailable.");
    }

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id);
        reject(new Error("Timed out waiting for a Durable runtime response."));
      }, timeoutMs);
      this.pending.set(request.id, { resolve, reject, timer });
      try {
        port.postMessage(request);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(request.id);
        reject(new Error(`Could not send a Durable runtime request: ${errorMessage(error)}`));
      }
    });
  }

  private reset(child: Electron.UtilityProcess, error: Error): void {
    if (this.child !== child) return;
    this.child = null;
    this.ready = null;
    this.port?.close();
    this.port = null;
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.startupTimer = null;
    this.rejectStartup?.(error);
    this.resolveStartup = null;
    this.rejectStartup = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    child.kill();
  }
}

const manager = new AgentRuntimeManager();

/** Start the isolated runtime after Electron is ready. The legacy session engine remains active during migration. */
export function startAgentRuntime(): Promise<RuntimeReady> {
  return manager.start();
}

/** Run a local faux-model + SQLite reopen check without using application session data or network access. */
export function runAgentRuntimeSqliteSmokeTest(): Promise<{
  conversationId: number;
  reply: string;
}> {
  return manager.runSqliteSmokeTest();
}

/** Gracefully close the isolated runtime before Electron exits. */
export function disposeAgentRuntime(): Promise<void> {
  return manager.dispose();
}
