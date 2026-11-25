import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRegistry, type Extension, type Registry } from "@earendil-works/pi-durable";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import {
  DURABLE_COMMAND_NAME,
  DURABLE_EXTENSION_LIMIT,
  type DurableExtensionFactory,
  type DurableExtensionInstance,
  type DurableExtensionSpec,
  type DurablePromptCommand,
  durableExtensionError,
  isDurableExtensionSpec,
} from "../../shared/durableExtension.js";

/** One registry and factory instance set per top-level session. Module imports may be cached. */
export class SessionExtensionHost {
  readonly registry: Registry = createRegistry();
  private readonly controller = new AbortController();
  private readonly instances: { id: string; instance: DurableExtensionInstance }[] = [];
  private readonly commands = new Map<string, DurablePromptCommand>();
  private readonly inputs = new Map<string, { text: string; result: Promise<string> }>();
  private readonly pending = new Set<Promise<string>>();
  private accepting = true;

  private loaded = false;

  constructor(
    readonly sessionId: string,
    readonly cwd: string,
  ) {
    this.registry.install(CodingTools);
  }

  /** Install all required definitions before the Harness resumes saved tasks. */
  async load(specs: readonly DurableExtensionSpec[]): Promise<void> {
    if (this.loaded || !this.accepting) throw durableExtensionError("closed", this.sessionId);
    this.loaded = true;
    if (specs.length > DURABLE_EXTENSION_LIMIT) throw durableExtensionError("invalid", "limit");
    const ids = new Set<string>();
    for (const spec of specs) {
      if (!isDurableExtensionSpec(spec)) throw durableExtensionError("invalid", "manifest");
      if (ids.has(spec.id) || this.registry.snapshot().extension(spec.id))
        throw durableExtensionError("duplicate", spec.id);
      ids.add(spec.id);
      try {
        await this.install(spec);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("PIDESK_EXTENSION:")) throw error;
        throw durableExtensionError("invalid", spec.id);
      }
    }
  }

  /** JSON-only command metadata, consumed by the existing composer completion UI. */
  listCommands(): { name: string; description: string; source: "extension" }[] {
    if (!this.accepting) throw durableExtensionError("closed", this.sessionId);
    return [...this.commands.values()].map(({ name, description }) => ({
      name,
      description,
      source: "extension",
    }));
  }

  /** Concurrent retry of the same admission shares expansion; never retain failed expansions. */
  expand(requestId: string, text: string): Promise<string> {
    if (!this.accepting) return Promise.reject(durableExtensionError("closed", this.sessionId));
    const previous = this.inputs.get(requestId);
    if (previous) {
      return previous.text === text
        ? previous.result
        : Promise.reject(durableExtensionError("invalid", "requestId"));
    }
    const match = /^\/([a-z][a-z0-9_:-]*)(?:\s+([\s\S]*))?$/i.exec(text.trim());
    if (!match) return Promise.resolve(text);
    const command = this.commands.get(match[1]);
    if (!command) return Promise.reject(durableExtensionError("unknownCommand", match[1]));
    const result = Promise.resolve().then(async () => {
      let expanded: unknown;
      try {
        expanded = await command.expand(match[2] ?? "");
      } catch {
        throw durableExtensionError("commandFailed", command.name);
      }
      if (
        typeof expanded !== "string" ||
        !expanded.trim() ||
        expanded.length > 256000 ||
        expanded.includes("\0")
      ) {
        throw durableExtensionError("commandFailed", command.name);
      }
      if (!this.accepting) throw durableExtensionError("closed", this.sessionId);
      return expanded;
    });
    this.inputs.set(requestId, { text, result });
    this.pending.add(result);
    void result.then(
      () => this.finish(requestId, result, false),
      () => this.finish(requestId, result, true),
    );
    return result;
  }

  /** Stop command admissions before closing the Harness; retained tool definitions stay installed. */
  async stop(): Promise<void> {
    this.accepting = false;
    this.controller.abort();
    await Promise.allSettled([...this.pending]);
  }

  /** Release only after Harness.close(). Successful cleanup is never repeated on retry. */
  async dispose(): Promise<void> {
    await this.stop();
    let failed: string | undefined;
    for (let index = this.instances.length - 1; index >= 0; index--) {
      const { id, instance } = this.instances[index];
      try {
        if (typeof instance.dispose === "function") await instance.dispose();
        this.instances.splice(index, 1);
      } catch {
        failed ??= id;
      }
    }
    if (failed) throw durableExtensionError("disposeFailed", failed);
    this.inputs.clear();
    this.commands.clear();
  }

  private finish(requestId: string, result: Promise<string>, failed: boolean): void {
    this.pending.delete(result);
    if (failed) this.inputs.delete(requestId);
    // Bound successful admission retries without evicting an expansion still in flight.
    if (this.inputs.size > 256) {
      for (const [key, input] of this.inputs) {
        if (!this.pending.has(input.result)) this.inputs.delete(key);
        if (this.inputs.size <= 256) break;
      }
    }
  }

  private async install(spec: DurableExtensionSpec): Promise<void> {
    let factory: DurableExtensionFactory;
    try {
      if (!path.isAbsolute(spec.root) || !path.isAbsolute(spec.entry)) throw new Error();
      const [root, entry] = await Promise.all([realpath(spec.root), realpath(spec.entry)]);
      const relative = path.relative(root, entry);
      if (
        !relative ||
        relative.startsWith(`..${path.sep}`) ||
        relative === ".." ||
        path.isAbsolute(relative) ||
        !/\.(?:mjs|js)$/.test(entry) ||
        !(await stat(entry)).isFile()
      )
        throw new Error();
      const module: unknown = await import(/* @vite-ignore */ pathToFileURL(entry).href);
      if (
        typeof module !== "object" ||
        module === null ||
        !("default" in module) ||
        typeof module.default !== "function"
      )
        throw new Error();
      factory = module.default as DurableExtensionFactory;
    } catch {
      throw durableExtensionError("load", spec.id);
    }
    let instance: DurableExtensionInstance;
    try {
      instance = await factory(
        Object.freeze({
          id: spec.id,
          sessionId: this.sessionId,
          cwd: this.cwd,
          scope: spec.scope,
          signal: this.controller.signal,
        }),
      );
    } catch {
      throw durableExtensionError("load", spec.id);
    }
    if (!instance || typeof instance !== "object" || Array.isArray(instance))
      throw durableExtensionError("invalid", spec.id);
    this.instances.push({ id: spec.id, instance });
    if (
      Object.keys(instance).some((key) => !["agent", "commands", "dispose"].includes(key)) ||
      (instance.dispose !== undefined && typeof instance.dispose !== "function")
    )
      throw durableExtensionError("invalid", spec.id);
    if (
      (instance.agent && !spec.capabilities.includes("agent")) ||
      (instance.commands && !spec.capabilities.includes("commands"))
    )
      throw durableExtensionError("capability", spec.id);
    if (instance.agent) {
      this.validateAgent(spec.id, instance.agent);
      this.registry.install(instance.agent);
    }
    if (
      instance.commands !== undefined &&
      (!Array.isArray(instance.commands) || instance.commands.length > 64)
    )
      throw durableExtensionError("invalid", spec.id);
    for (const command of instance.commands ?? []) {
      if (
        !command ||
        typeof command.name !== "string" ||
        !DURABLE_COMMAND_NAME.test(command.name) ||
        !command.name.startsWith(`${spec.id}:`) ||
        typeof command.description !== "string" ||
        command.description.length > 400 ||
        typeof command.expand !== "function"
      )
        throw durableExtensionError("invalid", spec.id);
      if (this.commands.has(command.name)) throw durableExtensionError("duplicate", command.name);
      this.commands.set(command.name, command);
    }
  }

  private validateAgent(id: string, agent: Extension): void {
    if (
      agent.name !== id ||
      agent.tools?.some((tool) => !tool.name.startsWith(`${id}__`)) ||
      agent.tasks?.some((task) => !task.definition.name.startsWith(`${id}__`))
    )
      throw durableExtensionError("invalid", id);
  }
}
