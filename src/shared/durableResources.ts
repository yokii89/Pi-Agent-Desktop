import { DURABLE_COMMAND_NAME, DURABLE_EXTENSION_LIMIT } from "./durableExtension";

export const DURABLE_RESOURCE_LIMIT = 256;
export const DURABLE_COMMAND_CATALOG_LIMIT = DURABLE_EXTENSION_LIMIT * 64 + DURABLE_RESOURCE_LIMIT;
export const DURABLE_RESOURCE_NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

/** Main resolves enabled resources; the runtime reads a bounded snapshot before resuming tasks. */
export interface DurableResourceSpec {
  kind: "skill" | "prompt";
  root: string;
  file: string;
  scope: "user" | "project";
}

export interface DurableResourceCommand {
  readonly name: string;
  readonly description: string;
  readonly source: "skill" | "prompt";
  readonly filePath: string;
  expand(args: string): string;
}

export type DurableResourceErrorCode = "invalid" | "load" | "duplicate" | "tooLarge";

/** Failure messages contain resource labels only, never file contents or user arguments. */
export function durableResourceError(code: DurableResourceErrorCode, name: string): Error {
  return new Error(`PIDESK_RESOURCE:${code}:${name.slice(0, 160)}`);
}

/** Validate paths on the private port; filesystem containment is checked again in the runtime. */
export function isDurableResourceSpec(value: unknown): value is DurableResourceSpec {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const isPath = (candidate: unknown) =>
    typeof candidate === "string" &&
    candidate.length > 0 &&
    candidate.length <= 32768 &&
    !candidate.includes("\0");
  return (
    (item.kind === "skill" || item.kind === "prompt") &&
    (item.scope === "user" || item.scope === "project") &&
    isPath(item.root) &&
    isPath(item.file)
  );
}

/** Command metadata is shared by native extensions, skills and prompt templates. */
export function isDurableCommandMetadata(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (typeof item.name !== "string" || typeof item.description !== "string") return false;
  if (item.description.length > 400) return false;
  if (item.source === "builtin") return item.name === "plan";
  if (item.source === "extension") return DURABLE_COMMAND_NAME.test(item.name);
  if (item.source !== "skill" && item.source !== "prompt") return false;
  const name = item.source === "skill" ? item.name.replace(/^skill:/, "") : item.name;
  return (
    (item.source !== "skill" || item.name.startsWith("skill:")) &&
    DURABLE_RESOURCE_NAME.test(name) &&
    typeof item.filePath === "string" &&
    item.filePath.length > 0 &&
    item.filePath.length <= 32768 &&
    !item.filePath.includes("\0")
  );
}
