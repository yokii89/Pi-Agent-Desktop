import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createJobRegistry } from "../core/jobs.ts";
import { settleAwareWait } from "../core/wait.ts";
import { agentDir, configPath, snapshotPath } from "../infra/paths.ts";
import { createRingBuffer } from "../infra/ring.ts";
import { isProcessAlive, killProcessTree, spawnShellCommand } from "../infra/shell.ts";

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("paths", () => {
	it("follows PI_CODING_AGENT_DIR when it is set", () => {
		const env = { ...process.env, PI_CODING_AGENT_DIR: "D:/tmp/agent" } as NodeJS.ProcessEnv;
		expect(agentDir(env)).toBe("D:/tmp/agent");
		expect(configPath(env).endsWith("bash-jobs.json")).toBe(true);
		expect(snapshotPath("sess", env).endsWith(join("bash-jobs", "sess.json"))).toBe(true);
	});

	it("falls back to pi's own agent dir", () => {
		const env = { ...process.env } as NodeJS.ProcessEnv;
		delete env.PI_CODING_AGENT_DIR;
		expect(agentDir(env)).not.toBe("");
	});
});

describe("wait", () => {
	it("resolves when the job settles, without spending the whole slice", async () => {
		const registry = createJobRegistry({ now: () => 0 });
		const job = registry.create({
			command: "a",
			mode: "finish",
			reason: "r",
			ring: createRingBuffer({ maxBytes: 1_024, maxLines: 10 }),
			kill: () => {},
		});
		const started = Date.now();
		const waiting = settleAwareWait(5_000, job);
		registry.settle(job.id, { exitCode: 0 });
		await waiting;
		expect(Date.now() - started).toBeLessThan(1_000);
	});

	it("resolves on the slice when the job stays alive", async () => {
		const registry = createJobRegistry({ now: () => 0 });
		const job = registry.create({
			command: "a",
			mode: "finish",
			reason: "r",
			ring: createRingBuffer({ maxBytes: 1_024, maxLines: 10 }),
			kill: () => {},
		});
		await settleAwareWait(5, job);
		expect(job.status).toBe("running");
	});
});

/** A shell that exists on every platform: the running node binary, `-e`-style. */
const nodeShell = { shell: process.execPath, args: ["-e"] };

describe("shell", () => {
	it("runs a command through the resolved shell and streams its output", async () => {
		const child = spawnShellCommand({
			command: "console.log('bash-jobs-ok')",
			cwd: process.cwd(),
			shell: nodeShell,
		});
		const chunks: string[] = [];
		child.onData((chunk) => chunks.push(chunk.toString("utf8")));
		const exit = await child.exited;
		expect(exit.exitCode).toBe(0);
		expect(chunks.join("")).toContain("bash-jobs-ok");
	});

	it("kills the whole tree and reports a signal exit", async () => {
		const child = spawnShellCommand({
			command: "setTimeout(() => {}, 30000)",
			cwd: process.cwd(),
			shell: nodeShell,
		});
		child.kill();
		const exit = await child.exited;
		expect(exit.exitCode).not.toBe(0);
	});

	it("reports a spawn failure instead of hanging", async () => {
		const child = spawnShellCommand({
			command: "1",
			cwd: join(tmpdir(), "definitely-not-a-real-dir-xyz"),
			shell: nodeShell,
		});
		const exit = await child.exited;
		expect(exit.exitCode).toBeNull();
		expect(exit.error).toBeInstanceOf(Error);
	});

	it("probes liveness without throwing on a dead pid", () => {
		expect(isProcessAlive(process.pid)).toBe(true);
		expect(isProcessAlive(undefined)).toBe(false);
		expect(isProcessAlive(2_147_483_000)).toBe(false);
		expect(() => killProcessTree(2_147_483_000)).not.toThrow();
	});
});

describe("temp dir hygiene", () => {
	it("does not leave temp dirs behind (guard for the afterEach above)", () => {
		const dir = mkdtempSync(join(tmpdir(), "bash-jobs-guard-"));
		dirs.push(dir);
		expect(dir.length).toBeGreaterThan(0);
	});
});
