import path from "node:path";
import type { EntryId, SubmissionId, UserInput } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { defaultBuiltinToolsConfig } from "../shared/builtinTools.js";
import { DURABLE_COMMAND_ENTRY, durableExtensionError } from "../shared/durableExtension.js";
import {
  DESKTOP_RETRY_ATTEMPTS,
  type DurableCommand,
  type RuntimeSessionUpdate,
} from "../shared/durableProtocol.js";
import type { NativeJob } from "../shared/nativeBuiltins.js";
import { BackgroundJobs, type ExecutionConfig } from "./builtins/jobs/manager.js";
import type { TelegramHost } from "./builtins/telegram.js";
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
  private preferredThinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  private builtinConfig = defaultBuiltinToolsConfig();
  private storageRoot?: string;
  private readonly hosts = new Map<string, HostedSession>();
  private readonly extensionHosts = new Map<string, SessionExtensionHost>();
  private readonly openingExtensionHosts = new Map<string, Promise<unknown>>();
  private readonly closingExtensionHosts = new Map<string, Promise<void>>();
  private readonly opening = new Map<string, Promise<{ conversationId: number }>>();
  private stopping = false;
  private jobs?: BackgroundJobs;
  private execution: ExecutionConfig = {
    shell: process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "/bin/bash",
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
  };

  constructor(
    private readonly publish: (update: RuntimeSessionUpdate) => void,
    private readonly telegram?: TelegramHost,
  ) {}

  async execute(command: DurableCommand): Promise<unknown> {
    if (command.op === "initialize") {
      if (this.service) throw new Error("Runtime already initialized.");
      if (command.model) {
        await this.catalog.configure(command.model);
        this.modelId = command.model.modelId;
        this.preferredThinking = command.model.preferredThinking;
      }
      this.builtinConfig = command.builtins ?? defaultBuiltinToolsConfig();
      this.storageRoot = command.storageRoot;
      if (command.execution) this.execution = command.execution;
      this.jobs = new BackgroundJobs(
        command.storageRoot,
        () => this.execution,
        (id, rows, completed, output) => this.jobsChanged(id, rows, completed, output),
      );
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
        (push) => this.publish({ type: "nativeState", ...push }),
        async (agent) => {
          if (agent.model?.provider === DESKTOP_PROVIDER)
            await this.catalog.ensure(agent.model.modelId);
        },
      );
      return null;
    }
    if (command.op === "openExtensionHost") {
      if (this.stopping || this.extensionHosts.has(command.hostId))
        throw durableExtensionError("closed", command.hostId);
      const host = new SessionExtensionHost(
        command.hostId,
        command.cwd,
        undefined,
        undefined,
        command.hostScope,
      );
      this.extensionHosts.set(command.hostId, host);
      const opening = host
        .load(command.extensions)
        .catch(async (error: unknown) => {
          await host.dispose();
          this.extensionHosts.delete(command.hostId);
          throw error;
        })
        .finally(() => this.openingExtensionHosts.delete(command.hostId));
      this.openingExtensionHosts.set(command.hostId, opening);
      await opening;
      return null;
    }
    if (command.op === "closeExtensionHost") {
      await this.closeExtensionHost(command.hostId);
      return null;
    }
    const service = this.service;
    if (!service) throw new Error("Runtime not initialized.");
    if (command.op === "models") return this.catalog.catalog();
    if (command.op === "modelPreference") {
      if (!this.catalog.models.getModel(DESKTOP_PROVIDER, command.modelId))
        throw new Error("Model is not in the desktop catalog.");
      this.modelId = command.modelId;
      this.preferredThinking = command.thinkingLevel;
      return null;
    }
    if (command.op === "model") {
      await this.catalog.configure(command.model);
      this.modelId = command.model.modelId;
      this.preferredThinking = command.model.preferredThinking;
      return null;
    }
    if (command.op === "executionShell") {
      this.execution = { ...this.execution, shell: command.shell };
      return null;
    }
    if (command.op === "builtins") {
      this.builtinConfig = command.config;
      return null;
    }
    const id = command.sessionId;
    switch (command.op) {
      case "readHistory":
        return readDurableEntries(this.storageRoot as string, id, command.before, command.limit);
      case "closeIdle": {
        const slot = this.hosts.get(id);
        if (!slot || slot.closing || slot.active || this.jobs?.hasRunning(id)) return false;
        const closed = await service.closeIdle(id);
        if (closed) await this.close(id);
        return closed;
      }
      case "commands":
        return [
          {
            name: "plan",
            description: "Built-in plan mode: /plan, /plan on, /plan off",
            source: "builtin",
          },
          ...this.requireHost(id).host.listCommands(),
        ];
      case "nativeState":
        return service.nativeState(id);
      case "nativeMode":
        await service.setNativeMode(id, command.mode);
        return null;
      case "answerQuestionnaire":
        return service.answerQuestionnaire(id, command.taskId, command.version, command.reply);
      case "answerPlan":
        return service.answerPlan(id, command.taskId, command.action);
      case "jobs":
        return this.jobs?.list(id) ?? [];
      case "inspectJob":
        return this.jobs?.inspect(id, command.job);
      case "stopJob":
        return this.jobs?.stop(id, command.job);
      case "open":
        return this.open(command);
      case "submit": {
        const slot = this.requireHost(id);
        slot.active++;
        try {
          if (/^\/plan(?:\s|$)/i.test(command.text.trim())) {
            await service.planCommand(id, command.requestId, command.text.trim());
            return { disposition: "handled" };
          }
          const text = await slot.host.expand(command.requestId, command.text);
          if (text === null) return { disposition: "handled" };
          if (!this.modelId)
            throw new Error("Configure a model in Settings → Models before sending.");
          if (slot.closing) throw durableExtensionError("closed", id);
          const content: UserInput = command.images?.length
            ? [...(text ? [{ type: "text" as const, text }] : []), ...command.images]
            : text;
          const result = await service.submit(id, {
            type: "input",
            requestId: command.requestId,
            content,
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
    const results = await Promise.allSettled([
      ...[...this.extensionHosts.keys()].map((id) => this.closeExtensionHost(id)),
      ...[...this.hosts.keys()].map((id) => this.close(id)),
    ]);
    const remaining = await Promise.allSettled([this.service?.dispose(), this.jobs?.dispose()]);
    const failed = [...results, ...remaining].find((item) => item.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }

  private closeExtensionHost(id: string): Promise<void> {
    const closing = this.closingExtensionHosts.get(id);
    if (closing) return closing;
    const host = this.extensionHosts.get(id);
    if (!host) return Promise.resolve();
    const operation = (async () => {
      await host.stop();
      await this.openingExtensionHosts.get(id)?.catch(() => undefined);
      // Failed factory cleanup retains the same instance for a later close retry.
      if (this.extensionHosts.get(id) !== host) return;
      await host.dispose();
      this.extensionHosts.delete(id);
    })().finally(() => this.closingExtensionHosts.delete(id));
    this.closingExtensionHosts.set(id, operation);
    return operation;
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
      const host = new SessionExtensionHost(
        id,
        path.resolve(command.cwd),
        () => this.builtinConfig,
        this.jobs ? { jobs: this.jobs, sessionId: id, telegram: this.telegram } : undefined,
      );
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
            ...(this.preferredThinking
              ? {
                  thinkingLevel: this.catalog.models.getModel(DESKTOP_PROVIDER, this.modelId ?? "")
                    ?.reasoning
                    ? this.preferredThinking
                    : "off",
                }
              : {}),
          },
        });
        this.jobs?.restore(id, await service.jobRows(id));
        await service.updateJobs(id, this.jobs?.list(id) ?? []);
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

  private async jobsChanged(
    id: string,
    rows: NativeJob[],
    completed?: NativeJob,
    output = "",
  ): Promise<void> {
    const slot = this.hosts.get(id);
    if (!slot?.ready || slot.closing || !this.service) return;
    await this.service.updateJobs(id, rows);
    if (completed) {
      const notice = `Background job ${completed.id} ${completed.status}${completed.exitCode === null ? "" : ` (exit ${completed.exitCode})`}: ${completed.label || completed.command}\n${output}`;
      await this.service.submit(id, {
        type: "input",
        requestId: `job-exit:${completed.id}`,
        content: notice,
        entry: { kind: "bash-job", data: notice },
        whenBusy: "followUp",
        onAbort: "keep",
      });
    }
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
