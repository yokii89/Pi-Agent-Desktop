import type {
  ViewBashJob,
  ViewBashJobMode,
  ViewBashJobStatus,
  ViewBashWorkspaceFilter,
  ViewNode,
} from "../../shared/view";
import { VIEW_LIMITS } from "../../shared/view";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isMode(value: unknown): value is ViewBashJobMode {
  return value === "finish" || value === "detach" || value === "long";
}

function isStatus(value: unknown): value is ViewBashJobStatus {
  return value === "running" || value === "exited" || value === "killed" || value === "orphaned";
}

function isFilter(value: unknown): value is ViewBashWorkspaceFilter {
  return value === "all" || value === "running" || value === "ended" || value === "orphaned";
}

function isNonnegativeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function finiteTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function identity(value: unknown, truncate: (value: string) => string): string | undefined {
  if (typeof value !== "string") return undefined;
  const id = truncate(value);
  return id.trim().length > 0 ? id : undefined;
}

function sanitizeJob(raw: unknown, truncate: (value: string) => string): ViewBashJob | undefined {
  const record = asRecord(raw);
  if (
    !record ||
    typeof record.command !== "string" ||
    typeof record.reason !== "string" ||
    typeof record.detached !== "boolean" ||
    !isMode(record.mode) ||
    !isStatus(record.status) ||
    !finiteTime(record.startedAt) ||
    !finiteTime(record.lastOutputAt) ||
    !isNonnegativeCount(record.outputBytes) ||
    !isNonnegativeCount(record.outputLines) ||
    (record.label !== undefined && typeof record.label !== "string") ||
    (record.pid !== undefined &&
      (typeof record.pid !== "number" || !Number.isSafeInteger(record.pid) || record.pid <= 0)) ||
    (record.exitedAt !== undefined && !finiteTime(record.exitedAt)) ||
    (record.exitCode !== undefined &&
      (typeof record.exitCode !== "number" || !Number.isSafeInteger(record.exitCode))) ||
    (record.killedBy !== undefined &&
      record.killedBy !== "timeout" &&
      record.killedBy !== "user" &&
      record.killedBy !== "model")
  ) {
    return undefined;
  }
  const id = identity(record.id, truncate);
  if (id === undefined) return undefined;

  const job: ViewBashJob = {
    id,
    command: truncate(record.command),
    mode: record.mode,
    status: record.status,
    reason: truncate(record.reason),
    startedAt: record.startedAt,
    lastOutputAt: record.lastOutputAt,
    detached: record.detached,
    outputBytes: record.outputBytes,
    outputLines: record.outputLines,
  };
  if (typeof record.label === "string") job.label = truncate(record.label);
  if (typeof record.pid === "number") job.pid = record.pid;
  if (typeof record.exitedAt === "number") job.exitedAt = record.exitedAt;
  for (const key of ["sourceToolCallId", "processIdentity", "logSessionId"] as const) {
    const value = identity(record[key], truncate);
    if (value !== undefined) job[key] = value;
  }
  if (finiteTime(record.processStartedAt) && record.processStartedAt > 0) {
    job.processStartedAt = record.processStartedAt;
  }
  if (
    record.processState === "alive" ||
    record.processState === "gone" ||
    record.processState === "unknown"
  ) {
    job.processState = record.processState;
  }
  if (typeof record.logAvailable === "boolean") job.logAvailable = record.logAvailable;
  // An orphan is a stale snapshot, not an observed exit. Never manufacture or
  // preserve an exit result for a process whose lifetime was not observed.
  if (record.status !== "orphaned" && typeof record.exitCode === "number") {
    job.exitCode = record.exitCode;
  }
  if (record.killedBy === "timeout" || record.killedBy === "user" || record.killedBy === "model") {
    job.killedBy = record.killedBy;
  }
  return job;
}

function count(record: Record<string, unknown> | null, key: string): number {
  const value = record?.[key];
  return isNonnegativeCount(value) ? value : 0;
}

/** Sanitize the Bash workspace snapshot; no command, path, or process action is executable here. */
export function sanitizeBashWorkspace(
  record: Record<string, unknown>,
  truncate: (value: string) => string,
): ViewNode {
  const id = identity(record.id, truncate);
  const rawValue = asRecord(record.value);
  if (
    id === undefined ||
    !Array.isArray(record.jobs) ||
    !rawValue ||
    typeof rawValue.query !== "string" ||
    !isFilter(rawValue.filter) ||
    !isNonnegativeCount(rawValue.page)
  ) {
    return { type: "unknown", originalType: "bash-workspace" };
  }

  const jobs: ViewBashJob[] = [];
  const jobIds = new Set<string>();
  for (const item of record.jobs.slice(0, VIEW_LIMITS.maxOptionItems)) {
    const job = sanitizeJob(item, truncate);
    if (!job || jobIds.has(job.id)) continue;
    jobIds.add(job.id);
    jobs.push(job);
  }

  const selectedId = identity(rawValue.selectedId, truncate);
  const rawCounts = asRecord(record.counts);
  const listedRunning = jobs.filter((job) => job.status === "running").length;
  const listedEnded = jobs.filter(
    (job) => job.status === "exited" || job.status === "killed",
  ).length;
  const listedOrphaned = jobs.filter((job) => job.status === "orphaned").length;
  const counts = {
    total: Math.max(count(rawCounts, "total"), jobs.length),
    running: Math.max(count(rawCounts, "running"), listedRunning),
    ended: Math.max(count(rawCounts, "ended"), listedEnded),
    orphaned: Math.max(count(rawCounts, "orphaned"), listedOrphaned),
  };
  counts.total = Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.max(counts.total, counts.running + counts.ended + counts.orphaned),
  );
  const matchedJobs = Math.min(count(asRecord(record), "matchedJobs"), counts.total);
  const pageCount = Math.max(
    1,
    Math.min(count(asRecord(record), "pageCount"), Math.max(1, matchedJobs)),
  );
  const value = {
    selectedId: selectedId !== undefined && jobIds.has(selectedId) ? selectedId : undefined,
    query: truncate(rawValue.query),
    filter: rawValue.filter,
    page: Math.min(rawValue.page, pageCount - 1),
  };

  const outputJobId = identity(record.outputJobId, truncate);
  const hasOutputOwner = outputJobId !== undefined && jobIds.has(outputJobId);
  const output = hasOutputOwner && typeof record.output === "string" ? truncate(record.output) : "";
  const cursor = hasOutputOwner && typeof record.cursor === "string" ? truncate(record.cursor) : "";
  const optionalId = (key: string): string | undefined => identity(record[key], truncate);

  return {
    type: "bash-workspace",
    id,
    jobs,
    value,
    counts,
    matchedJobs,
    pageCount,
    outputJobId: hasOutputOwner ? outputJobId : undefined,
    output,
    cursor,
    outputStartLine: Math.max(1, count(asRecord(record), "outputStartLine")),
    outputTruncated: record.outputTruncated === true,
    outputMore: record.outputMore === true,
    partial: record.partial === true,
    stopActionId: optionalId("stopActionId"),
    stoppingJobId: (() => {
      const candidate = optionalId("stoppingJobId");
      return candidate !== undefined && jobIds.has(candidate) ? candidate : undefined;
    })(),
    notice: typeof record.notice === "string" ? truncate(record.notice) : undefined,
  };
}
