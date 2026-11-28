import type { ViewBashJob, ViewBashWorkspaceValue } from "../../../shared/view";
import type { FloatingWindowMemory } from "../../utils/floatingWindowGeometry";

export type BashJobState = "running" | "success" | "failed" | "killed" | "orphaned" | "exited";
export interface BashReading {
  top: number;
  follow: boolean;
  unread: number;
  cursor?: string;
  output?: string;
  query: string;
  wrap: boolean;
}
export interface BashWorkspaceMemory {
  readings: Map<string, BashReading>;
  tab: "output" | "details";
  window: FloatingWindowMemory;
}

/** Presentation state belongs to a live View, not a process or a disk preference. */
export function createBashWorkspaceMemory(): BashWorkspaceMemory {
  return { readings: new Map(), tab: "output", window: {} };
}

export function bashReading(memory: BashWorkspaceMemory, id: string): BashReading {
  const existing = memory.readings.get(id);
  if (existing) return existing;
  if (memory.readings.size >= 256) {
    const oldest = memory.readings.keys().next().value;
    if (oldest !== undefined) memory.readings.delete(oldest);
  }
  const reading: BashReading = { top: 0, follow: true, unread: 0, query: "", wrap: true };
  memory.readings.set(id, reading);
  return reading;
}

/** An unobserved exit code is not evidence of a failure. */
export function bashJobState(job: ViewBashJob): BashJobState {
  if (job.status !== "exited") return job.status;
  return job.exitCode === undefined ? "exited" : job.exitCode === 0 ? "success" : "failed";
}

export function bashDuration(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  return value >= 3600
    ? `${Math.floor(value / 3600)}h ${String(Math.floor((value % 3600) / 60)).padStart(2, "0")}m`
    : `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export function bashJobSeconds(job: ViewBashJob, now: number): number {
  const end = job.status === "running" ? now : (job.exitedAt ?? job.lastOutputAt);
  return Math.max(0, (end - job.startedAt) / 1000);
}

export function bashBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : bytes >= 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${bytes} B`;
}

/** A control value can be optimistic while its authoritative output is still in flight. */
export function bashControlValue(
  raw: unknown,
  fallback: ViewBashWorkspaceValue,
): ViewBashWorkspaceValue {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const value = raw as Record<string, unknown>;
  return {
    selectedId: typeof value.selectedId === "string" ? value.selectedId : undefined,
    query: typeof value.query === "string" ? value.query : fallback.query,
    filter:
      value.filter === "running" ||
      value.filter === "ended" ||
      value.filter === "orphaned" ||
      value.filter === "all"
        ? value.filter
        : fallback.filter,
    page:
      typeof value.page === "number" && Number.isSafeInteger(value.page) && value.page >= 0
        ? value.page
        : fallback.page,
  };
}

export interface BashLogLine {
  number: number;
  text: string;
}
export function bashLogLines(output: string, firstLine: number, query: string): BashLogLine[] {
  if (!output) return [];
  const needle = query.toLocaleLowerCase();
  return output
    .split("\n")
    .map((text, index) => ({ number: firstLine + index, text }))
    .filter((line) => !needle || line.text.toLocaleLowerCase().includes(needle));
}

/** Return text segments; command output never becomes HTML or regular-expression source. */
export function bashHighlights(text: string, query: string): { text: string; match: boolean }[] {
  if (!query) return [{ text, match: false }];
  const parts: { text: string; match: boolean }[] = [];
  const source = text.toLowerCase(),
    needle = query.toLowerCase();
  let from = 0,
    index = source.indexOf(needle);
  while (index >= 0) {
    if (index > from) parts.push({ text: text.slice(from, index), match: false });
    parts.push({ text: text.slice(index, index + query.length), match: true });
    from = index + query.length;
    index = source.indexOf(needle, from);
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false });
  return parts;
}

/** Cursor deltas count committed lines; pending fragments can change without advancing it. */
export function bashUnreadDelta(
  previousCursor: string | undefined,
  previousOutput: string | undefined,
  cursor: string,
  output: string,
): number {
  if (previousCursor === undefined || previousOutput === undefined) return 0;
  const previous = Number(previousCursor),
    current = Number(cursor);
  if (Number.isSafeInteger(previous) && Number.isSafeInteger(current) && current > previous)
    return current - previous;
  return output !== previousOutput ? 1 : 0;
}
