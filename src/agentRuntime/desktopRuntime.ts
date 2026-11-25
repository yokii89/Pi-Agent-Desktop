import path from "node:path";
import type { EntryId, SubmissionId } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { DURABLE_COMMAND_ENTRY, durableExtensionError } from "../shared/durableExtension.js";
import {
  DESKTOP_RETRY_ATTEMPTS,
  type DurableCommand,
  type RuntimeSessionUpdate,
} from "../shared/durableProtocol.js";
import { DESKTOP_PROVIDER, desktopModels } from "./desktopModels.js";
import { readDurableEntries } from "./durableHistory.js";
import { DurableSessions } from "./durableSessions.js";
import { SessionExtensionHost } from "./extensions/sessionExtensionHost.js";
import { loadSessionResources } from "./resources/sessionResources.js";

interface HostedSession {
  host: SessionExtensionHost;
  active: number;
  ready: boolean;
  closing?: Promise<void>;
}

/** Production dispatcher, shared by the private MessagePort and protocol integration tests. */
export class DesktopRuntime {
  private service?: DurableSessions;
  private readonly catalog = desktopModels();
  private modelId?: string;
  private storageRoot?: string;
  private readonly hosts = new Map<string, HostedSession>();
  private readonly opening = new Map<string, Promise<{ conversationId: number }>>();
  private stopping = false;

  constructor(private readonly publish: (update: RuntimeSessionUpdate) => void) {}

  async execute(command: DurableCommand): Promise<unknown> {
    if (command.op === "initialize") {
      if (this.service) throw new Error("Runtime already initialized.");
      if (command.model) {
        this.catalog.configure(command.model);
        this.modelId = command.model.modelId;
      }
      this.storageRoot = command.storageRoot;
      this.service = new DurableSessions(
        command.storageRoot,
        (sessionId) => ({
          models: this.catalog.models,
          registry: this.requireHost(sessionId, true).host.registry,
          settings: {
            retry: { enabled: true, maxRetries: DESKTOP_RETRY_ATTEMPTS - 1, baseDelayMs: 1000 },
          },
          env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? process.cwd() }),
        }),
        this.publish,
      );
      return null;
    }
    const service = this.service;
    if (!service) throw new Error("Runtime not initialized.");
    if (command.op === "model") {
      this.catalog.configure(command.model);
      this.modelId = command.model.modelId;
      return null;
    }
    const id = command.sessionId;
    switch (command.op) {
      case "readHistory":
        return readDurableEntries(this.storageRoot as string, id, command.before, command.limit);
      case "closeIdle": {
        const slot = this.hosts.get(id);
        if (!slot || slot.closing || slot.active) return false;
        const closed = await service.closeIdle(id);
        if (closed) await this.close(id);
        return closed;
      }
      case "commands":
        return this.requireHost(id).host.listCommands();
      case "open":
        return this.open(command);
      case "submit": {
        const slot = this.requireHost(id);
        slot.active++;
        try {
          const text = await slot.host.expand(command.requestId, command.text);
          if (slot.closing) throw durableExtensionError("closed", id);
          const result = await service.submit(id, {
            type: "input",
            requestId: command.requestId,
            content: text,
            ...(text === command.text
              ? {}
              : { entry: { kind: DURABLE_COMMAND_ENTRY, data: { input: command.text } } }),
            whenBusy: command.mode,
          });
          const submission = await service.submission(id, result.submissionId as SubmissionId);
          return { ...result, disposition: submission?.status === "queued" ? "queued" : "started" };
        } finally {
          slot.active--;
        }
      }
      case "continue":
        return service.submit(id, { type: "continue", requestId: command.requestId });
      case "write":
        return service.submit(id, {
          type: "write",
          requestId: command.requestId,
          entry: { kind: command.kind, data: command.data },
        });
      case "withdraw":
        return service.withdraw(id, command.submissionId as SubmissionId);
      case "abort":
        await service.abort(id);
        return null;
      case "close":
        await this.close(id);
        return null;
      case "snapshot": {
        const view = await service.snapshot(id);
        this.publish({ type: "snapshot", sessionId: id, view });
        return null;
      }
      case "configure": {
        if (command.modelId && !this.catalog.models.getModel(DESKTOP_PROVIDER, command.modelId))
          throw new Error("Model is not in the desktop catalog.");
        await service.configure(id, {
          ...(command.modelId
            ? { model: { provider: DESKTOP_PROVIDER, modelId: command.modelId } }
            : {}),
          ...(command.thinkingLevel ? { thinkingLevel: command.thinkingLevel } : {}),
        });
        return null;
      }
      case "compact":
        return service.compact(id, command.instructions);
      case "history":
        return service.entries(id, command.before as EntryId | undefined, command.limit);
    }
  }

  async dispose(): Promise<void> {
    this.stopping = true;
    await Promise.allSettled([...this.opening.values()]);
    const results = await Promise.allSettled([...this.hosts.keys()].map((id) => this.close(id)));
    await this.service?.dispose();
    const failed = results.find((item) => item.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }

  private requireHost(id: string, opening = false): HostedSession {
    const slot = this.hosts.get(id);
    if (!slot || slot.closing || (!opening && !slot.ready))
      throw durableExtensionError("closed", id);
    return slot;
  }

  private open(
    command: Extract<DurableCommand, { op: "open" }>,
  ): Promise<{ conversationId: number }> {
    const id = command.sessionId;
    const service = this.service;
    if (!service) return Promise.reject(durableExtensionError("closed", id));
    if (this.stopping) return Promise.reject(durableExtensionError("closed", id));
    const pending = this.opening.get(id);
    if (pending) {
      if (this.hosts.get(id)?.host.cwd !== path.resolve(command.cwd))
        return Promise.reject(durableExtensionError("invalid", id));
      return pending;
    }
    const existing = this.hosts.get(id);
    if (existing) {
      this.requireHost(id);
      if (existing.host.cwd !== path.resolve(command.cwd))
        return Promise.reject(durableExtensionError("invalid", id));
      return service.open(command);
    }
    const operation = (async () => {
      const host = new SessionExtensionHost(id, path.resolve(command.cwd));
      const slot: HostedSession = { host, active: 0, ready: false };
      this.hosts.set(id, slot);
      try {
        const resources = await loadSessionResources(command.cwd, command.resources ?? []);
        host.installResources(resources.commands);
        await host.load(command.extensions ?? []);
        const result = await service.open({
          ...command,
          instructions: resources.instructions,
          agent: {
            ...(this.modelId
              ? { model: { provider: DESKTOP_PROVIDER, modelId: this.modelId } }
              : {}),
          },
        });
        slot.ready = true;
        return result;
      } catch (error) {
        await host.dispose();
        this.hosts.delete(id);
        throw error;
      }
    })().finally(() => {
      this.opening.delete(id);
    });
    this.opening.set(id, operation);
    return operation;
  }

  private async close(id: string): Promise<void> {
    const pending = this.opening.get(id);
    if (pending) await pending.catch(() => undefined);
    const slot = this.hosts.get(id);
    if (!slot) return;
    if (slot.closing) return slot.closing;
    slot.ready = false;
    const operation = (async () => {
      await slot.host.stop();
      await this.service?.close(id);
      await slot.host.dispose();
      this.hosts.delete(id);
    })().finally(() => {
      slot.closing = undefined;
    });
    slot.closing = operation;
    return operation;
  }
}
