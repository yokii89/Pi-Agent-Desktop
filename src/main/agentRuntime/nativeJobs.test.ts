import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackgroundJobs, type ExecutionConfig } from "../../agentRuntime/builtins/jobs/manager";
import type { NativeJob } from "../../shared/nativeBuiltins";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "pidesk-native-jobs-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const execution: ExecutionConfig = {
    shell: process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "/bin/bash",
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
  };
  const changes: { id: string; rows: NativeJob[]; completed?: NativeJob }[] = [];
  const jobs = new BackgroundJobs(
    directory,
    () => execution,
    async (id, rows, completed) => {
      changes.push({ id, rows, completed });
    },
    { softMs: 800, longMs: 2000, idleMs: 3000 },
  );
  cleanups.push(async () => {
    for (const job of jobs.list("first"))
      if (job.status === "running") await jobs.stop("first", job.id);
    await jobs.dispose();
  });
  return { directory, jobs, changes };
}
const hasBash = process.platform !== "win32" || existsSync("C:\\Program Files\\Git\\bin\\bash.exe");
describe.skipIf(!hasBash)("native background processes", () => {
  it("finishes short long-mode commands without a job or completion wake", async () => {
    const f = await fixture();
    const result = await f.jobs.run("first", f.directory, 1, "short", {
      command: "printf 'quick\\n'",
      mode: "long",
    });
    expect(result.job.status).toBe("exited");
    expect(result.output).toContain("quick");
    expect(f.jobs.list("first")).toEqual([]);
    expect(f.changes).toEqual([]);
  });
  it("yields without killing, keeps cursor output and rejects cross-session stops", async () => {
    const f = await fixture();
    const result = await f.jobs.run("first", f.directory, 1, "yield", {
      command: "printf 'one\\n'; sleep 2; printf 'two\\n'",
      mode: "finish",
    });
    expect(result.job.status).toBe("running");
    expect(result.output).toContain("one");
    await expect(f.jobs.stop("second", result.job.id)).rejects.toThrow("Unknown job");
    await vi.waitFor(() => expect(f.jobs.list("first")[0].status).toBe("exited"), {
      timeout: 5000,
    });
    const tail = await f.jobs.inspect("first", result.job.id, result.cursor);
    expect(tail.output).toContain("two");
    expect(tail.output).not.toContain("one");
    expect(f.changes.filter((change) => change.completed)).toHaveLength(1);
  });
  it("stops through the captured handle and marks restored PIDs as read-only", async () => {
    const f = await fixture();
    const result = await f.jobs.run("first", f.directory, 1, "stop", {
      command: "sleep 30",
      mode: "detach",
      timeout: 0.01,
    });
    expect(result.job.status).toBe("running");
    expect((await f.jobs.stop("first", result.job.id)).job.status).toBe("stopped");
    const restored = { ...result.job, id: "J-restore", pid: process.pid };
    f.jobs.restore("first", [restored]);
    expect(f.jobs.list("first").find((job) => job.id === restored.id)?.status).toBe("orphaned");
    await expect(f.jobs.stop("first", restored.id)).rejects.toThrow("read-only");
  });
  it("wakes an inspection on partial output and filters the retained log before taking a tail", async () => {
    const f = await fixture();
    const result = await f.jobs.run("first", f.directory, 1, "partial", {
      command: "sleep 1; printf 'PARTIAL'; sleep 2",
      mode: "detach",
    });
    const next = await f.jobs.inspect("first", result.job.id, result.cursor, 80, 10000);
    expect(next.output).toContain("PARTIAL");
    expect(next.job.status).toBe("running");
    const finished = await f.jobs.run("first", f.directory, 2, "filter", {
      command: "printf 'ERROR here\\n'; for i in {1..100}; do printf 'normal\\n'; done",
      mode: "detach",
    });
    await vi.waitFor(
      () =>
        expect(f.jobs.list("first").find((job) => job.id === finished.job.id)?.status).toBe(
          "exited",
        ),
      { timeout: 5000 },
    );
    expect((await f.jobs.inspect("first", finished.job.id, undefined, 1, 0, "error")).output).toBe(
      "ERROR here",
    );
  });
  it("restores line cursors from the full bounded log and refuses stop authority in another manager", async () => {
    const f = await fixture();
    const result = await f.jobs.run("first", f.directory, 1, "restore", {
      command:
        "for i in {1..5000}; do printf 'line-%s padding padding padding padding padding padding padding padding\\n' $i; done; sleep 2; printf 'FINAL\\n'",
      mode: "detach",
    });
    await vi.waitFor(
      async () =>
        expect((await f.jobs.inspect("first", result.job.id)).output).toContain("line-5000"),
      { timeout: 5000 },
    );
    const cursor = (await f.jobs.inspect("first", result.job.id)).cursor;
    await vi.waitFor(() => expect(f.jobs.list("first")[0].status).toBe("exited"), {
      timeout: 5000,
    });
    const rows = f.jobs.list("first");
    const restored = new BackgroundJobs(
      f.directory,
      () => {
        throw new Error("A restored job must never request a shell.");
      },
      async () => {},
    );
    cleanups.push(() => restored.dispose());
    restored.restore("first", [{ ...rows[0], status: "running", pid: process.pid }]);
    const output = await restored.inspect("first", result.job.id, cursor);
    expect(output.output).toBe("FINAL");
    expect(output.lost).toBe(false);
    expect(output.job.status).toBe("orphaned");
    expect(await readFile(output.job.logPath, "utf8")).toContain("line-1 padding");
    await expect(restored.stop("first", result.job.id)).rejects.toThrow("read-only");
    await expect(restored.inspect("second", result.job.id)).rejects.toThrow("Unknown job");
    expect((await restored.inspect("first", result.job.id, "9999999999")).lost).toBe(true);
  });
  it("does not kill a yielded command when a blocking timeout elapses afterwards", async () => {
    const f = await fixture();
    const result = await f.jobs.run("first", f.directory, 1, "budget", {
      command: "sleep 2; printf 'SURVIVED\\n'",
      mode: "finish",
      timeout: 1.2,
    });
    expect(result.job.status).toBe("running");
    await vi.waitFor(() => expect(f.jobs.list("first")[0].status).toBe("exited"), {
      timeout: 5000,
    });
    expect((await f.jobs.inspect("first", result.job.id)).output).toContain("SURVIVED");
    expect(f.changes.filter((change) => change.completed)).toHaveLength(1);
  });
  it("uses explicit blocking timeout as the kill boundary and cleans up aborted inspections", async () => {
    const f = await fixture();
    const result = await f.jobs.run("first", f.directory, 1, "timeout", {
      command: "sleep 30",
      timeout: 0.02,
    });
    expect(result.job.status).toBe("timed-out");
    const background = await f.jobs.run("first", f.directory, 1, "inspect", {
      command: "sleep 30",
      mode: "detach",
    });
    const controller = new AbortController();
    const wait = f.jobs.inspect(
      "first",
      background.job.id,
      undefined,
      80,
      120000,
      undefined,
      controller.signal,
    );
    controller.abort();
    await expect(wait).rejects.toThrow("cancelled");
    expect(f.jobs.list("first").find((job) => job.id === background.job.id)?.status).toBe(
      "running",
    );
  });
});
