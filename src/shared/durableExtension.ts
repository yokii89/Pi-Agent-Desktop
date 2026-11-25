import type { Message } from "@earendil-works/pi-ai";
import type { EntryRecord, Extension } from "@earendil-works/pi-durable";

export const DURABLE_EXTENSION_API_VERSION = 1;
export const DURABLE_COMMAND_ENTRY = "pidesk.prompt-command";

/** Display the user's command while the saved model context keeps its expanded prompt. */
export function durableDisplayMessages(entry: EntryRecord): readonly Message[] {
  const input =
    entry.kind === DURABLE_COMMAND_ENTRY &&
    typeof entry.data === "object" &&
    entry.data !== null &&
    !Array.isArray(entry.data)
      ? entry.data.input
      : undefined;
  if (typeof input !== "string") return entry.model ?? [];
  return (entry.model ?? []).map((message) =>
    message.role === "user" ? { ...message, content: input } : message,
  );
}

export const DURABLE_EXTENSION_ID = /^[a-z][a-z0-9-]{0,63}$/;
export const DURABLE_COMMAND_NAME = /^[a-z][a-z0-9-]{0,63}:[a-z][a-z0-9-]{0,63}$/;
export const DURABLE_EXTENSION_LIMIT = 64;

export type DurableExtensionCapability = "agent" | "commands";

/** Resolved only by main; renderer requests cannot supply module paths. */
export interface DurableExtensionSpec {
  id: string;
  root: string;
  entry: string;
  scope: "user" | "project";
  capabilities: DurableExtensionCapability[];
}

/** Preview v1 context. Never use module globals or process.env to store session identity. */
export interface DurableExtensionContext {
  readonly id: string;
  readonly sessionId: string;
  readonly cwd: string;
  readonly scope: "user" | "project";
  readonly signal: AbortSignal;
}

/** Pure prompt expansion; external side effects belong in Durable tools/tasks. */
export interface DurablePromptCommand {
  readonly name: string;
  readonly description: string;
  expand(args: string): string | Promise<string>;
}

export interface DurableExtensionInstance {
  readonly agent?: Extension;
  readonly commands?: readonly DurablePromptCommand[];
  dispose?(): void | Promise<void>;
}

/** The entry's default export. Called once per open top-level session, also on recovery. */
export type DurableExtensionFactory = (
  context: DurableExtensionContext,
) => DurableExtensionInstance | Promise<DurableExtensionInstance>;

export type DurableExtensionErrorCode =
  | "invalid"
  | "load"
  | "capability"
  | "duplicate"
  | "closed"
  | "unknownCommand"
  | "commandFailed"
  | "disposeFailed";

/** Wire-safe failure: main localizes it without logging extension exceptions or input. */
export function durableExtensionError(code: DurableExtensionErrorCode, name: string): Error {
  return new Error(`PIDESK_EXTENSION:${code}:${name.slice(0, 160)}`);
}

/** Validate the private MessagePort DTO independently of filesystem access. */
export function isDurableExtensionSpec(value: unknown): value is DurableExtensionSpec {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const isPath = (candidate: unknown) =>
    typeof candidate === "string" &&
    candidate.length > 0 &&
    candidate.length <= 32768 &&
    !candidate.includes("\0");
  return (
    typeof item.id === "string" &&
    DURABLE_EXTENSION_ID.test(item.id) &&
    isPath(item.root) &&
    isPath(item.entry) &&
    (item.scope === "user" || item.scope === "project") &&
    Array.isArray(item.capabilities) &&
    item.capabilities.length > 0 &&
    item.capabilities.length <= 2 &&
    new Set(item.capabilities).size === item.capabilities.length &&
    item.capabilities.every((capability) => capability === "agent" || capability === "commands")
  );
}
