import type { ProcDetailRow } from "../../../shared/ipc";
import type { SessionEntry, ToolAssistantBlock } from "../../stores/sessionTranscript";

export const SOURCE_OUTPUT_LIMIT = 20_000;

/** Unknown samples stay unknown instead of appearing to be a successful zero reading. */
export function formatRuntimeBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/** A first CPU sample has no elapsed window and must remain an em dash. */
export function formatRuntimeCpu(percent: number | null | undefined): string {
  return percent == null || !Number.isFinite(percent) || percent < 0 ? "—" : `${percent}%`;
}

/** Format a TCP address without making a claim about its application protocol. */
export function formatRuntimeEndpoint(address: string, port: number): string {
  const host = address.includes(":") ? `[${address}]` : address || "*";
  return `${host}:${port}`;
}

/** Keep ancestors before descendants even when the OS snapshot arrives out of order. */
export function runtimeProcessRows(
  root: ProcDetailRow | null,
  descendants: readonly ProcDetailRow[],
): { process: ProcDetailRow; depth: number }[] {
  const rows: { process: ProcDetailRow; depth: number }[] = [];
  const seen = new Set<number>();
  const children = new Map<number, ProcDetailRow[]>();
  for (const row of descendants) {
    const siblings = children.get(row.ppid) ?? [];
    siblings.push(row);
    children.set(row.ppid, siblings);
  }
  const visit = (first: ProcDetailRow, depth: number): void => {
    const stack = [{ process: first, depth }];
    while (stack.length > 0) {
      const next = stack.pop();
      if (!next || seen.has(next.process.pid)) continue;
      seen.add(next.process.pid);
      rows.push(next);
      const nested = children.get(next.process.pid) ?? [];
      for (let index = nested.length - 1; index >= 0; index -= 1) {
        stack.push({ process: nested[index], depth: next.depth + 1 });
      }
    }
  };
  if (root) visit(root, 0);
  const knownPids = new Set(descendants.map((row) => row.pid));
  for (const row of descendants) {
    if (!knownPids.has(row.ppid)) visit(row, root ? 1 : 0);
  }
  // A process can lose its parent between snapshots; cycles must not hide or hang rows.
  for (const row of descendants) visit(row, root ? 1 : 0);
  return rows;
}

/** Endpoint ownership can outlive the process row in a racing snapshot. */
export function runtimePortOwner(
  pid: number,
  root: ProcDetailRow | null,
  descendants: readonly ProcDetailRow[],
): string {
  const row = root?.pid === pid ? root : descendants.find((candidate) => candidate.pid === pid);
  return row?.name ? `${row.name} #${pid}` : `#${pid}`;
}

/** Resolve only the original call, never a nearby command with matching text. */
export function findSourceToolBlock(
  entries: readonly SessionEntry[],
  toolCallId: string | undefined,
): ToolAssistantBlock | null {
  if (!toolCallId) return null;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.kind !== "assistant") continue;
    const block = entry.blocks.find(
      (candidate) => candidate.kind === "tool" && candidate.toolCallId === toolCallId,
    );
    if (block?.kind === "tool") return block;
  }
  return null;
}

/** Only actual numeric timeout values (or numeric strings) represent seconds. */
export function readTimeoutSeconds(args: unknown): number | null {
  if (!args || typeof args !== "object" || !("timeout" in args)) return null;
  const value = args.timeout;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/** Preserve the original tool result semantics, including upstream output truncation. */
export function sourceToolData(block: ToolAssistantBlock) {
  const terminal = block.result?.kind === "terminal" ? block.result : null;
  const args = block.args;
  const command =
    args && typeof args === "object" && "command" in args && typeof args.command === "string"
      ? args.command
      : terminal?.command || block.subject;
  const output = terminal?.output ?? block.resultText ?? "";
  const capped = output.length > SOURCE_OUTPUT_LIMIT;
  return {
    command,
    timeout: readTimeoutSeconds(args),
    exitCode: terminal?.exitCode ?? null,
    pending: block.status === "pending" || block.status === "running",
    output: output.slice(0, SOURCE_OUTPUT_LIMIT),
    capped,
    truncated: terminal?.truncated === true,
  };
}

/** Bounded content chart coordinates; equal readings stay on a horizontal middle line. */
export function runtimeMemoryPoints(samples: readonly number[]): string {
  if (samples.length < 2) return "";
  const low = Math.min(...samples);
  const high = Math.max(...samples);
  return samples
    .map((sample, index) => {
      const x = (index / (samples.length - 1)) * 80;
      const y = high === low ? 12 : 22 - ((sample - low) / (high - low)) * 20;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
