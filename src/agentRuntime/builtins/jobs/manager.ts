import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, fstatSync, mkdirSync, openSync, readSync, writeSync } from "node:fs";
import path from "node:path";
import type {
  NativeExecutionConfig,
  NativeJob,
  NativeJobOutput,
} from "../../../shared/nativeBuiltins.js";
import { classifyCommand } from "./classify.js";
import { createRingBuffer, type RingBuffer, tailWithinBytes } from "./ring.js";

export type ExecutionConfig = NativeExecutionConfig;
export type JobPolicy = { softMs: number; longMs: number; idleMs: number };
const DEFAULT_POLICY: JobPolicy = { softMs: 600000, longMs: 180000, idleMs: 420000 };
const LOG_LIMIT = 8 * 1024 * 1024;
const RING_BYTES = 262144;
type OwnedJob = {
  sessionId: string;
  row: NativeJob;
  child?: ChildProcess;
  ring: RingBuffer;
  done: Promise<void>;
  finish: () => void;
  background: boolean;
  lastOutput: number;
  listeners: Set<() => void>;
  bytes: number;
  fd?: number;
  output?: (chunk: Buffer) => void;
  revision: number;
  termination?: "stopped" | "timed-out";
};

/** Captured ChildProcess handles are the only kill authority. Restored PIDs are observation-only. */
export class BackgroundJobs {
  private readonly jobs = new Map<string, OwnedJob>();
  private readonly writes = new Map<string, Promise<void>>();
  private disposed = false;
  constructor(
    private readonly storageRoot: string,
    private readonly execution: () => ExecutionConfig,
    private readonly changed: (
      sessionId: string,
      rows: NativeJob[],
      completed?: NativeJob,
      output?: string,
    ) => Promise<void>,
    private readonly policy: JobPolicy = DEFAULT_POLICY,
  ) {}

  restore(sessionId: string, rows: readonly NativeJob[]): void {
    for (const row of rows) {
      if (this.jobs.has(row.id)) continue;
      const ring = createRingBuffer({ maxBytes: RING_BYTES, maxLines: 4000 });
      const logPath = path.join(this.storageRoot, sessionId, "jobs", `${row.id}.log`);
      let truncated = row.truncated;
      let fd: number | undefined;
      try {
        fd = openSync(logPath, "r");
        const size = fstatSync(fd).size;
        // Rebuild line sequence numbers from the bounded log so pre-restart cursors stay meaningful.
        const buffer = Buffer.alloc(Math.min(size, LOG_LIMIT));
        let offset = 0;
        while (offset < buffer.length) {
          const bytes = readSync(fd, buffer, offset, buffer.length - offset, offset);
          if (bytes === 0) break;
          offset += bytes;
        }
        ring.append(buffer.subarray(0, offset));
        truncated ||= size >= LOG_LIMIT;
      } catch {
        truncated = true;
      } finally {
        if (fd !== undefined) closeSync(fd);
      }
      this.jobs.set(row.id, {
        sessionId,
        row: {
          ...row,
          logPath,
          truncated,
          status: row.status === "running" ? "orphaned" : row.status,
        },
        ring,
        done: Promise.resolve(),
        finish: () => {},
        background: true,
        lastOutput: Date.now(),
        listeners: new Set(),
        bytes: 0,
        revision: 0,
      });
    }
  }
  list(sessionId: string): NativeJob[] {
    return [...this.jobs.values()]
      .filter((job) => job.sessionId === sessionId && job.background)
      .map((job) => ({ ...job.row }));
  }
  hasRunning(sessionId: string): boolean {
    return [...this.jobs.values()].some((job) => job.sessionId === sessionId && !!job.child);
  }
  private owned(sessionId: string, id: string): OwnedJob {
    const job = this.jobs.get(id);
    if (!job || job.sessionId !== sessionId) throw new Error("Unknown job in this session.");
    return job;
  }
  async run(
    sessionId: string,
    cwd: string,
    taskId: number,
    callId: string,
    input: { command: string; mode?: NativeJob["mode"]; label?: string; timeout?: number },
    signal?: AbortSignal,
    output?: (chunk: Buffer) => void,
  ): Promise<NativeJobOutput> {
    if (this.disposed) throw new Error("Background job manager is closed.");
    if (
      [...this.jobs.values()].filter((job) => job.sessionId === sessionId && job.child).length >= 32
    )
      throw new Error("This session already has 32 running jobs.");
    signal?.throwIfAborted();
    const mode =
      input.mode ?? (input.timeout === undefined ? classifyCommand(input.command).mode : "finish");
    const id = `J-${randomUUID()}`;
    const directory = path.join(this.storageRoot, sessionId, "jobs");
    mkdirSync(directory, { recursive: true });
    const logPath = path.join(directory, `${id}.log`);
    const execution = this.execution();
    const fd = openSync(logPath, "wx");
    let child: ChildProcess;
    try {
      child = spawn(execution.shell, ["--noprofile", "--norc", "-c", input.command], {
        cwd,
        env: execution.env,
        detached: process.platform !== "win32",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      closeSync(fd);
      throw error;
    }
    let finish = () => {};
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const job: OwnedJob = {
      sessionId,
      row: {
        id,
        taskId,
        callId,
        command: input.command,
        label: input.label ?? "",
        mode,
        status: "running",
        pid: child.pid ?? null,
        startedAt: Date.now(),
        endedAt: null,
        exitCode: null,
        logPath,
        truncated: false,
      },
      child,
      ring: createRingBuffer({ maxBytes: RING_BYTES, maxLines: 4000 }),
      done,
      finish,
      background: false,
      lastOutput: Date.now(),
      listeners: new Set(),
      bytes: 0,
      fd,
      output,
      revision: 0,
    };
    this.jobs.set(id, job);
    const receive = (chunk: Buffer) => {
      job.lastOutput = Date.now();
      job.revision++;
      job.ring.append(chunk);
      if (job.fd !== undefined) {
        try {
          const bytes = Math.min(chunk.length, LOG_LIMIT - job.bytes);
          let offset = 0;
          while (offset < bytes) offset += writeSync(job.fd, chunk, offset, bytes - offset);
          job.bytes += bytes;
          if (bytes < chunk.length) job.row.truncated = true;
        } catch {
          job.row.truncated = true;
          closeSync(job.fd);
          job.fd = undefined;
        }
      }
      job.output?.(chunk);
      for (const notify of job.listeners) notify();
    };
    child.stdout?.on("data", receive);
    child.stderr?.on("data", receive);
    let ended = false;
    let exitTimer: ReturnType<typeof setTimeout> | undefined;
    const end = (exitCode: number | null, error?: Error) => {
      if (ended || this.disposed) return;
      ended = true;
      if (exitTimer) clearTimeout(exitTimer);
      if (error) receive(Buffer.from(`\n${error.message}\n`));
      job.row.exitCode = exitCode;
      job.row.endedAt = Date.now();
      job.row.status = job.termination ?? "exited";
      job.output = undefined;
      job.child = undefined;
      child.stdout?.destroy();
      child.stderr?.destroy();
      if (job.fd !== undefined) {
        closeSync(job.fd);
        job.fd = undefined;
      }
      job.finish();
      for (const notify of job.listeners) notify();
      if (job.background) void this.persist(sessionId, job).catch(() => {});
    };
    child.once("error", (error) => end(null, error));
    // A daemon can inherit the pipes after its shell exits. Never wait forever for close.
    child.once("exit", (code) => {
      exitTimer = setTimeout(() => end(code), 100);
    });
    child.once("close", (code) => end(code));
    const abort = () => {
      if (!ended) {
        job.termination = "stopped";
        this.kill(job);
      }
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const timeout =
      mode !== "detach" && input.timeout !== undefined
        ? setTimeout(() => {
            if (!ended) {
              job.termination = "timed-out";
              this.kill(job);
            }
          }, input.timeout * 1000)
        : undefined;
    const releaseBlocking = () => {
      if (timeout) clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    };
    try {
      if (mode !== "detach") {
        await new Promise<void>((resolve) => {
          const timer = setInterval(() => {
            if (
              ended ||
              Date.now() - job.row.startedAt >=
                (mode === "long" ? this.policy.longMs : this.policy.softMs) ||
              Date.now() - job.lastOutput >= this.policy.idleMs
            ) {
              clearInterval(timer);
              resolve();
            }
          }, 30);
          void done.then(() => {
            clearInterval(timer);
            resolve();
          });
        });
      }
      // A timeout/abort already requested a kill; keep blocking until its captured child confirms exit.
      if (!ended && job.termination) await this.waitForExit(job);
      // Timeout and the foreground abort belong only to the blocking span, including when persistence is slow.
      releaseBlocking();
      if (!ended) {
        job.background = true;
        job.output = undefined;
        await this.persist(sessionId);
      }
      return this.read(job, undefined, 2000);
    } finally {
      releaseBlocking();
      if (!job.background && ended) this.jobs.delete(id);
    }
  }
  async inspect(
    sessionId: string,
    id: string,
    cursor?: string,
    tailLines = 80,
    waitMs = 0,
    grep?: string,
    signal?: AbortSignal,
  ): Promise<NativeJobOutput> {
    const job = this.owned(sessionId, id);
    if (waitMs > 0 && job.child) {
      const before = job.revision;
      const unread = cursor === undefined ? false : job.ring.since(cursor).lines.length > 0;
      if (!unread)
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            clearTimeout(timer);
            job.listeners.delete(changed);
            signal?.removeEventListener("abort", abort);
          };
          const changed = () => {
            if (job.revision !== before || !job.child) {
              cleanup();
              resolve();
            }
          };
          const abort = () => {
            cleanup();
            reject(new Error("Job inspection cancelled."));
          };
          const timer = setTimeout(
            () => {
              cleanup();
              resolve();
            },
            Math.min(waitMs, 120000),
          );
          job.listeners.add(changed);
          signal?.addEventListener("abort", abort, { once: true });
          if (signal?.aborted) abort();
        });
    }
    return this.read(job, cursor, tailLines, grep);
  }
  async stop(sessionId: string, id: string, graceful = false): Promise<NativeJobOutput> {
    const job = this.owned(sessionId, id);
    if (job.row.status === "orphaned")
      throw new Error("Restored jobs are read-only; their old PID cannot authorize a stop.");
    if (job.child) {
      job.termination = "stopped";
      this.kill(job, graceful);
      await this.waitForExit(job);
      if (job.child) throw new Error("Could not confirm that the job stopped.");
      await this.persist(sessionId);
    }
    return this.read(job);
  }
  /** Session closure retains handles. Application shutdown releases output observers and leaves receipts as orphans. */
  async dispose(): Promise<void> {
    this.disposed = true;
    await Promise.allSettled([...this.writes.values()]);
    for (const job of this.jobs.values()) {
      job.output = undefined;
      job.child?.unref();
      job.child?.stdout?.destroy();
      job.child?.stderr?.destroy();
      if (job.fd !== undefined) {
        closeSync(job.fd);
        job.fd = undefined;
      }
    }
  }
  private waitForExit(job: OwnedJob): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5000);
      void job.done.then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  private kill(job: OwnedJob, graceful = false): void {
    const child = job.child;
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === "win32") {
      const killer = spawn(
        path.join(this.execution().env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
        ["/F", "/T", "/PID", String(child.pid)],
        { stdio: "ignore", windowsHide: true },
      );
      killer.once("error", () => {});
    } else {
      try {
        process.kill(-child.pid, graceful ? "SIGTERM" : "SIGKILL");
      } catch {
        /* The captured child may already be exiting. */
      }
      if (graceful)
        setTimeout(() => {
          if (job.child === child) this.kill(job);
        }, 2000).unref();
    }
  }
  private read(job: OwnedJob, cursor?: string, tailLines = 80, grep?: string): NativeJobOutput {
    const snapshot = job.ring.since(cursor);
    const matches = grep
      ? snapshot.lines.filter((line) => line.toLowerCase().includes(grep.toLowerCase()))
      : snapshot.lines;
    const lines = matches.slice(-Math.max(1, Math.min(1000, tailLines)));
    const joined = lines.join("\n");
    const output = tailWithinBytes(joined, 51200);
    return {
      job: { ...job.row },
      output,
      cursor: snapshot.cursor,
      lost:
        snapshot.lost ||
        job.row.truncated ||
        (!grep && matches.length > lines.length) ||
        output !== joined ||
        (cursor === undefined && job.ring.stats().truncated),
    };
  }
  private persist(sessionId: string, completed?: OwnedJob): Promise<void> {
    const previous = this.writes.get(sessionId) ?? Promise.resolve();
    const receipt = completed ? { ...completed.row } : undefined;
    const output = completed?.ring.tailWithin(80, 16000);
    const write = previous
      .catch(() => {})
      .then(() => this.changed(sessionId, this.list(sessionId), receipt, output));
    this.writes.set(sessionId, write);
    void write
      .finally(() => {
        if (this.writes.get(sessionId) === write) this.writes.delete(sessionId);
      })
      .catch(() => {});
    return write;
  }
}
