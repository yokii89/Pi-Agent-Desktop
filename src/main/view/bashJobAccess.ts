import { join } from "node:path";
import type { BashJobRuntime } from "../../shared/bashWorkspace";
import type { ManagedProcess, ProcDetail } from "../../shared/ipc";
import type { ViewBashJob } from "../../shared/view";
import { isPidReuse } from "../proc/processKill";
import { isDescendantOf, type ProcessSnapshot } from "../proc/processWatch";

export interface BashJobContext {
  sessionId: string;
  job: ViewBashJob;
}

export interface BashJobAccessPorts {
  resolve(viewId: string, jobId: string): BashJobContext;
  snapshot(): Promise<ProcessSnapshot | null>;
  sessionPid(sessionId: string): number | null;
  processes(sessionId: string): readonly ManagedProcess[];
  detail(proc: ManagedProcess): Promise<ProcDetail>;
  agentDir(): string;
  openLog(path: string, logsRoot: string): Promise<void>;
}

function sameOwner(left: BashJobContext, right: BashJobContext): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.job.pid === right.job.pid &&
    left.job.startedAt === right.job.startedAt &&
    left.job.processStartedAt === right.job.processStartedAt &&
    left.job.logSessionId === right.job.logSessionId
  );
}

/** A View supplies identifiers only; the Host derives paths within the dedicated log directory. */
export function savedBashLogPath(agentDir: string, job: ViewBashJob): string {
  const safeSegment = /^[A-Za-z0-9_-]{1,128}$/;
  if (
    !job.logAvailable ||
    !job.logSessionId ||
    !safeSegment.test(job.logSessionId) ||
    !safeSegment.test(job.id)
  ) {
    throw new Error("Saved job log is unavailable");
  }
  return join(agentDir, "bash-jobs", "logs", job.logSessionId, `${job.id}.log`);
}

/**
 * Supplement an extension job with Host diagnostics. PID/path parameters are deliberately
 * absent: every operation re-resolves a job in its current authenticated workspace.
 */
export class BashJobAccess {
  constructor(private readonly ports: BashJobAccessPorts) {}

  async inspect(viewId: string, jobId: string): Promise<BashJobRuntime> {
    const context = this.ports.resolve(viewId, jobId);
    const { job, sessionId } = context;
    if (!job.pid || !Number.isSafeInteger(job.pid) || job.pid <= 0) {
      throw new Error("Job has no process identity");
    }
    const snapshot = await this.ports.snapshot();
    this.assertCurrent(viewId, jobId, context);
    if (!snapshot) throw new Error("Process information is unavailable");
    const row = snapshot.get(job.pid);
    if (!row) return this.ended();
    if (
      job.processStartedAt !== undefined &&
      (!row.startedAt || Math.abs(row.startedAt - job.processStartedAt) > 1)
    ) {
      throw new Error("Job process identity has changed");
    }
    // Legacy jobs have no exact OS creation time; never inspect a clearly older PID occupant.
    if (!job.processStartedAt && row.startedAt && row.startedAt < job.startedAt - 2000) {
      throw new Error("Job process identity has changed");
    }
    const rootPid = this.ports.sessionPid(sessionId);
    const descendant = rootPid !== null && isDescendantOf(snapshot, job.pid, rootPid);
    const adopted = this.ports.processes(sessionId).some((proc) => {
      const actual = snapshot.get(proc.pid);
      if (!actual || isPidReuse(proc, actual)) return false;
      return (
        proc.pid === job.pid ||
        isDescendantOf(snapshot, proc.pid, job.pid as number) ||
        isDescendantOf(snapshot, job.pid as number, proc.pid)
      );
    });
    if (!descendant && !adopted) throw new Error("Process does not belong to this session");
    const proc: ManagedProcess = {
      id: `view:${viewId}:${jobId}`,
      sessionId,
      pid: row.pid,
      ppid: row.ppid,
      commandLine: row.commandLine,
      name: row.name,
      startedAt: row.startedAt,
      registeredAt: job.startedAt,
      sourceToolCallId: job.sourceToolCallId,
      origin: "job",
      status: "alive",
    };
    const detail = await this.ports.detail(proc);
    this.assertCurrent(viewId, jobId, context);
    return {
      ...detail,
      root: detail.alive
        ? {
            ...row,
            workingSet: row.workingSet ?? 0,
            cpuPercent: null,
          }
        : null,
    };
  }

  async openLog(viewId: string, jobId: string): Promise<void> {
    const context = this.ports.resolve(viewId, jobId);
    const agentDir = this.ports.agentDir();
    const path = savedBashLogPath(agentDir, context.job);
    this.assertCurrent(viewId, jobId, context);
    await this.ports.openLog(path, join(agentDir, "bash-jobs", "logs"));
  }

  private assertCurrent(viewId: string, jobId: string, expected: BashJobContext): void {
    if (!sameOwner(expected, this.ports.resolve(viewId, jobId))) {
      throw new Error("Job workspace has changed");
    }
  }

  private ended(): BashJobRuntime {
    return {
      at: Date.now(),
      alive: false,
      root: null,
      descendants: [],
      ports: [],
      memoryBytes: 0,
      processCount: 0,
      portsReadable: true,
      cpuPercent: null,
    };
  }
}
