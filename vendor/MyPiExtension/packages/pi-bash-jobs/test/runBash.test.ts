import { readFileSync, rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createJobRegistry } from "../core/jobs.ts";
import type { ShellChild, ShellExit } from "../infra/shell.ts";
import { type RunBashDeps, runBash } from "../run/runBash.ts";
import { type BashJobsConfig, DEFAULT_CONFIG } from "../state/config.ts";

/** A child process whose output and exit the test drives by hand. */
function fakeChild() {
	const listeners: ((chunk: Buffer) => void)[] = [];
	let resolve!: (exit: ShellExit) => void;
	const exited = new Promise<ShellExit>((done) => {
		resolve = done;
	});
	const state = { killed: false, killCalls: 0 };
	const child: ShellChild = {
		pid: 4242,
		exited,
		onData(listener) {
			listeners.push(listener);
		},
		kill() {
			state.killed = true;
			state.killCalls++;
			// A real tree kill is observed as an exit shortly after.
			resolve({ exitCode: null });
		},
	};
	return {
		child,
		state,
		emit(text: string) {
			for (const listener of listeners) listener(Buffer.from(text, "utf8"));
		},
		exit(exitCode: number | null) {
			resolve({ exitCode });
		},
	};
}

interface HarnessOptions {
	config?: Partial<BashJobsConfig>;
	/** Clock value at which the process exits on its own. */
	exitAtMs?: number;
	exitCode?: number;
}

function harness(options: HarnessOptions = {}) {
	const config: BashJobsConfig = { ...DEFAULT_CONFIG, ...options.config };
	const registry = createJobRegistry({ now: () => clock });
	const fake = fakeChild();
	let clock = 0;
	let exited = false;
	const deps: RunBashDeps = {
		config,
		registry,
		now: () => clock,
		spawn: () => fake.child,
		waitTick: async (ms) => {
			clock += ms;
			if (!exited && options.exitAtMs !== undefined && clock >= options.exitAtMs) {
				exited = true;
				fake.exit(options.exitCode ?? 0);
				// Let the registry observe the exit the same way the real promise does.
				await Promise.resolve();
				await Promise.resolve();
			}
		},
	};
	return {
		deps,
		registry,
		fake,
		get clock() {
			return clock;
		},
		advance(ms: number) {
			clock += ms;
		},
	};
}

const context = { cwd: "/work" };

describe("runBash — finish", () => {
	it("returns the output and exit code of a normal command", async () => {
		const h = harness({ exitAtMs: 1_000 });
		const running = runBash(h.deps, { command: "ls" }, context);
		h.fake.emit("hello\nworld\n");
		const result = await running;
		expect(result.content[0]?.text).toBe("hello\nworld");
		expect(result.isError).toBe(false);
		expect(result.structuredContent).toMatchObject({ exit_code: 0, status: "exited", job_id: "J-1" });
		expect(h.registry.get("J-1")?.status).toBe("exited");
	});

	it("marks a non-zero exit as an error, like pi's bash", async () => {
		const h = harness({ exitAtMs: 1_000, exitCode: 2 });
		const running = runBash(h.deps, { command: "false" }, context);
		h.fake.emit("boom\n");
		const result = await running;
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("Command exited with code 2");
	});

	it("streams output through onUpdate instead of only at the end", async () => {
		const h = harness({ exitAtMs: 5_000 });
		const updates: string[] = [];
		const running = runBash(
			h.deps,
			{ command: "ls" },
			{ ...context, onUpdate: (u) => updates.push(u.content[0]?.text ?? "") },
		);
		// Past the throttle window, so each append flushes immediately.
		h.advance(500);
		h.fake.emit("first\n");
		h.advance(500);
		h.fake.emit("second\n");
		await running;
		expect(updates).toContain("first");
		expect(updates).toContain("first\nsecond");
	});

	it("reports a spawn failure instead of throwing out of execute", async () => {
		const h = harness();
		const result = await runBash(
			{
				...h.deps,
				spawn: () => {
					throw new Error("no bash found");
				},
			},
			{ command: "ls" },
			context,
		);
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("no bash found");
	});

	it("reports an asynchronous spawn failure the same way, and leaves no phantom job", async () => {
		// Node reports a bad cwd or a missing executable on a later tick, so the try/catch around
		// spawn() never sees it. It must not escape as a raw ENOENT either.
		const h = harness();
		const failing: ShellChild = {
			pid: undefined,
			exited: Promise.resolve({ exitCode: null, error: new Error("spawn bash ENOENT") }),
			onData() {},
			kill() {},
		};
		const result = await runBash({ ...h.deps, spawn: () => failing }, { command: "ls" }, context);
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toBe("Failed to start command: spawn bash ENOENT");
		expect(h.registry.list()).toHaveLength(0);
	});

	it("trims what the model reads, and keeps the rest in a file", async () => {
		const h = harness({ exitAtMs: 1_000, config: { resultMaxBytes: 64, resultMaxLines: 3 } });
		let spill: { jobId: string; text: string } | undefined;
		const running = runBash(
			{
				...h.deps,
				writeFullOutput: (jobId, text) => {
					spill = { jobId, text };
					return "/tmp/full-output.log";
				},
			},
			{ command: "noisy" },
			context,
		);
		const lines = Array.from({ length: 10 }, (_, index) => `line ${index}`);
		h.fake.emit(`${lines.join("\n")}\n`);
		const result = await running;
		const body = result.content[0]?.text ?? "";
		expect(body.startsWith("line 7")).toBe(true);
		expect(body).not.toContain("line 0");
		expect(body).toContain("Output trimmed to the last 3 lines");
		expect(body).toContain("/tmp/full-output.log");
		expect(result.structuredContent).toMatchObject({
			output: "line 7\nline 8\nline 9",
			truncated: true,
			full_output_path: "/tmp/full-output.log",
			exit_code: 0,
		});
		expect(spill?.jobId).toBe("J-1");
		expect(spill?.text).toContain("line 0");
		expect(spill?.text).toContain("line 9");
	});

	it("writes the complete output to a temp file when nothing is injected", async () => {
		const h = harness({ exitAtMs: 1_000, config: { resultMaxBytes: 64, resultMaxLines: 2 } });
		const running = runBash(h.deps, { command: "noisy" }, context);
		h.fake.emit(["a", "b", "c", "d"].map((line) => `${line}\n`).join(""));
		const result = await running;
		const path = result.structuredContent?.full_output_path;
		expect(path).toBeTruthy();
		try {
			expect(readFileSync(path as string, "utf8")).toBe("a\nb\nc\nd");
		} finally {
			rmSync(path as string, { force: true });
		}
	});

	it("cuts on a line boundary when the byte cap is what trims", async () => {
		const h = harness({ exitAtMs: 1_000, config: { resultMaxBytes: 20, resultMaxLines: 1_000 } });
		const running = runBash(h.deps, { command: "wide" }, context);
		h.fake.emit(`${"A".repeat(50)}\nshort\n`);
		const result = await running;
		expect(result.content[0]?.text.startsWith("short")).toBe(true);
		expect(result.structuredContent?.output).toBe("short");
	});
});

describe("runBash — yielding instead of killing", () => {
	it("counts output without newlines as activity, so it is never called 'silent'", async () => {
		// A progress line with neither `\n` nor `\r` never commits, but bytes are arriving: the idle
		// notice and the idle-detach must not fire on it.
		const h = harness({ config: { idleWarnSec: 120, idleDetachSec: 180, finishSoftBudgetSec: 600 } });
		const notices: number[] = [];
		let ticks = 0;
		const result = await runBash(
			{
				...h.deps,
				waitTick: async (ms) => {
					ticks++;
					h.advance(ms);
					if (ticks % 30 === 0) h.fake.emit("progress");
				},
			},
			{ command: "node progress.js" },
			{ ...context, onIdleNotice: (_job, idleSec) => notices.push(idleSec) },
		);
		expect(notices).toEqual([]);
		expect(result.content[0]?.text).toContain("soft budget reached");
	});

	it("yields when a blocking call goes silent (the hung-pipe path), without killing", async () => {
		const h = harness({ config: { idleWarnSec: 120, idleDetachSec: 180 } });
		const notices: number[] = [];
		const result = await runBash(
			h.deps,
			{ command: "node hang.js" },
			{ ...context, onIdleNotice: (_job, idleSec) => notices.push(idleSec) },
		);
		expect(notices).toEqual([120]);
		expect(result.content[0]?.text).toContain("moved to the background");
		expect(result.content[0]?.text).toContain("nothing was killed");
		expect(result.structuredContent).toMatchObject({ status: "detached", job_id: "J-1" });
		expect(h.fake.state.killed).toBe(false);
		const job = h.registry.get("J-1");
		expect(job?.status).toBe("running");
		expect(job?.detached).toBe(true);
	});

	it("yields at the soft budget even while output keeps flowing", async () => {
		const h = harness({ config: { finishSoftBudgetSec: 300, idleDetachSec: 10_000 } });
		const running = runBash(h.deps, { command: "node build.js" }, context);
		h.fake.emit("still working\n");
		const result = await running;
		expect(h.clock).toBeGreaterThanOrEqual(300_000);
		expect(result.content[0]?.text).toContain("soft budget reached");
		expect(h.fake.state.killed).toBe(false);
	});

	it("an explicit timeout still kills, with pi's own wording", async () => {
		const h = harness();
		const running = runBash(h.deps, { command: "sleep 10", timeout: 2 }, context);
		await expect(running).rejects.toThrow("Command timed out after 2 seconds");
		expect(h.fake.state.killed).toBe(true);
		expect(h.registry.get("J-1")?.killedBy).toBe("timeout");
	});

	it("explicitTimeoutKills=false turns the timeout into another yield", async () => {
		const h = harness({ config: { explicitTimeoutKills: false } });
		const result = await runBash(h.deps, { command: "sleep 10", timeout: 2 }, context);
		expect(result.content[0]?.text).toContain("explicitTimeoutKills");
		expect(h.fake.state.killed).toBe(false);
	});

	it("aborting kills the tree and reports it as an abort, not a timeout", async () => {
		const h = harness();
		const controller = new AbortController();
		controller.abort();
		await expect(
			runBash(h.deps, { command: "sleep 100" }, { ...context, signal: controller.signal }),
		).rejects.toThrow("Command aborted");
		expect(h.fake.state.killed).toBe(true);
		expect(h.registry.get("J-1")?.killedBy).toBe("user");
	});

	it("reports a stop as a stop, not as the shell's incidental exit code", async () => {
		// bash_job_stop (or a session shutdown) kills a call that is still blocking. The shell then
		// exits 1, which used to come back as "Command exited with code 1" — the model reads that as
		// "your command failed".
		const h = harness();
		const running = runBash(h.deps, { command: "sleep 100" }, context);
		h.registry.kill("J-1", "model");
		const result = await running;
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("Command stopped (killed by model)");
		expect(result.content[0]?.text).not.toContain("Command exited with code");
		expect(result.structuredContent?.status).toBe("killed");
	});
});

describe("runBash — mode selection", () => {
	it("returns immediately for a dev server and never kills it", async () => {
		const h = harness();
		const result = await runBash(h.deps, { command: "pnpm dev" }, context);
		expect(h.clock).toBe(0);
		expect(result.content[0]?.text).toContain("started in the background (mode=detach)");
		expect(h.fake.state.killed).toBe(false);
		expect(h.registry.get("J-1")?.status).toBe("running");
	});

	it("a long command that finishes inside its grace window is an ordinary result", async () => {
		// The regression this guards: `pnpm typecheck` classified as `long` used to return eagerly,
		// file a job, and wake the model with "Bash job J-1 finished" 20 seconds later.
		const h = harness({ exitAtMs: 15_000 });
		const running = runBash(h.deps, { command: "curl -o big.tar https://x" }, context);
		h.fake.emit("100%\n");
		const result = await running;
		expect(result.content[0]?.text).toBe("100%");
		expect(result.structuredContent).toMatchObject({ status: "exited", exit_code: 0 });
		expect(h.registry.get("J-1")?.detached).toBe(false);
	});

	it("a long command that outlives the grace window becomes a background job", async () => {
		const h = harness({ config: { longGraceSec: 20 } });
		const result = await runBash(h.deps, { command: "curl -o big.tar https://x" }, context);
		expect(h.clock).toBeGreaterThanOrEqual(20_000);
		expect(result.content[0]?.text).toContain("moved to the background after");
		expect(result.content[0]?.text).toContain("Mode: long");
		expect(result.structuredContent).toMatchObject({ status: "detached" });
		expect(h.registry.get("J-1")?.detached).toBe(true);
		expect(h.fake.state.killed).toBe(false);
	});

	it("longGraceSec=0 keeps the old immediate return for long calls", async () => {
		const h = harness({ config: { longGraceSec: 0 } });
		const result = await runBash(h.deps, { command: "curl -o big.tar https://x" }, context);
		expect(h.clock).toBe(0);
		expect(result.content[0]?.text).toContain("moved to the background after 0s");
		expect(result.structuredContent).toMatchObject({ status: "detached" });
	});

	it("mode=detach never waits for the grace window", async () => {
		const h = harness();
		const result = await runBash(h.deps, { command: "pnpm dev", mode: "detach" }, context);
		expect(h.clock).toBe(0);
		expect(result.content[0]?.text).toContain("started in the background (mode=detach)");
	});

	it("an aborted long call inside the grace window is still an abort, not a detach", async () => {
		const h = harness();
		const controller = new AbortController();
		const running = runBash(
			h.deps,
			{ command: "curl -o big.tar https://x" },
			{ ...context, signal: controller.signal },
		);
		h.advance(1_000);
		controller.abort();
		await expect(running).rejects.toThrow("Command aborted");
		expect(h.fake.state.killed).toBe(true);
	});

	it("an explicit mode beats the classifier", async () => {
		const h = harness();
		const result = await runBash(h.deps, { command: "pnpm dev", mode: "finish" }, context);
		expect(h.clock).toBeGreaterThan(0);
		expect(result.content[0]?.text).toContain("moved to the background");
	});

	it("says out loud that a timeout is ignored when an explicit mode=detach is given", async () => {
		const h = harness();
		const receipt = await runBash(h.deps, { command: "pnpm dev", mode: "detach", timeout: 30 }, context);
		expect(receipt.content[0]?.text).toContain("timeout=30s you passed is ignored");
		expect(h.fake.state.killed).toBe(false);
	});

	it("a bare timeout on a server-looking command means finish + hard limit", async () => {
		const h = harness();
		const running = runBash(h.deps, { command: "pnpm dev", timeout: 1 }, context);
		await expect(running).rejects.toThrow("Command timed out after 1 seconds");
		expect(h.fake.state.killed).toBe(true);
	});

	it("labels a job for the receipts", async () => {
		const h = harness();
		await runBash(h.deps, { command: "pnpm dev", label: "dev server" }, context);
		expect(h.registry.get("J-1")?.label).toBe("dev server");
	});
});
