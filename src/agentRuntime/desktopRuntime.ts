import { readFile } from "node:fs/promises";
import path from "node:path";
import type { EntryId, SubmissionId } from "@earendil-works/pi-durable";
import { createRegistry } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import {
  DESKTOP_RETRY_ATTEMPTS,
  type DurableCommand,
  type RuntimeSessionUpdate,
} from "../shared/durableProtocol.js";
import { DESKTOP_PROVIDER, desktopModels } from "./desktopModels.js";
import { readDurableEntries } from "./durableHistory.js";
import { DurableSessions } from "./durableSessions.js";

/** Production dispatcher, shared by the private MessagePort and protocol integration tests. */
export class DesktopRuntime {
  private service?: DurableSessions;
  private readonly catalog = desktopModels();
  private modelId?: string;
  private storageRoot?: string;

  constructor(private readonly publish: (update: RuntimeSessionUpdate) => void) {}

  async execute(command: DurableCommand): Promise<unknown> {
    if (command.op === "initialize") {
      if (this.service) throw new Error("Runtime already initialized.");
      if (command.model) {
        this.catalog.configure(command.model);
        this.modelId = command.model.modelId;
      }
      this.storageRoot = command.storageRoot;
      const registry = createRegistry();
      registry.install(CodingTools);
      this.service = new DurableSessions(
        command.storageRoot,
        () => ({
          models: this.catalog.models,
          registry,
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
      case "closeIdle":
        return service.closeIdle(id);
      case "open": {
        const instructions = command.create ? await projectInstructions(command.cwd) : undefined;
        return service.open({
          sessionId: id,
          cwd: command.cwd,
          create: command.create,
          agent: {
            ...(this.modelId
              ? { model: { provider: DESKTOP_PROVIDER, modelId: this.modelId } }
              : {}),
            ...(instructions ? { instructions } : {}),
          },
        });
      }
      case "submit": {
        const result = await service.submit(id, {
          type: "input",
          requestId: command.requestId,
          content: command.text,
          whenBusy: command.mode,
        });
        const submission = await service.submission(id, result.submissionId as SubmissionId);
        return { ...result, disposition: submission?.status === "queued" ? "queued" : "started" };
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
        await service.close(id);
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
    await this.service?.dispose();
  }
}

async function projectInstructions(cwd: string): Promise<string> {
  const directories: string[] = [];
  let directory = path.resolve(cwd);
  for (;;) {
    directories.unshift(directory);
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  const sections: string[] = [];
  let size = 0;
  for (const root of directories) {
    const file = path.join(root, "AGENTS.md");
    try {
      const text = await readFile(file, "utf8");
      size += Buffer.byteLength(text);
      if (size > 128 * 1024) throw new Error("Project instructions exceed 128 KiB.");
      sections.push(`${file}\n${text}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return sections.join("\n\n");
}
