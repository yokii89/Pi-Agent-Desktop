import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import bashJobsExtension from "../index.ts";
import { buildSnapshot, saveSnapshot } from "../state/persist.ts";
import type { JobRecord } from "../types.ts";

const dirs: string[] = [];
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

function agentDirWith(config?: unknown): string {
	const dir = mkdtempSync(join(tmpdir(), "bash-jobs-session-"));
	dirs.push(dir);
	process.env.PI_CODING_AGENT_DIR = dir;
	if (config !== undefined) writeFileSync(join(dir, "bash-jobs.json"), JSON.stringify(config), "utf8");
	return dir;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
});

interface FakePi {
	pi: ExtensionAPI;
	tools: { name: string }[];
	commands: { name: string; options: { handler: (args: string, ctx: ExtensionContext) => Promise<void> } }[];
	sent: {
		message: { customType?: string; content?: unknown };
		options?: { deliverAs?: string; triggerTurn?: boolean };
	}[];
	emit(event: string, payload: unknown, ctx?: ExtensionContext): void;
}

function fakePi(): FakePi {
	const handlers = new Map<string, ((payload: unknown, ctx?: ExtensionContext) => void)[]>();
	const tools: { name: string }[] = [];
	const commands: FakePi["commands"] = [];
	const sent: FakePi["sent"] = [];
	const pi = {
		on(event: string, handler: (payload: unknown, ctx?: ExtensionContext) => void) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
			return () => {};
		},
		registerTool(tool: { name: string }) {
			tools.push(tool);
		},
		registerCommand(name: string, options: unknown) {
			commands.push({ name, options: options as FakePi["commands"][number]["options"] });
		},
		sendMessage(message: unknown, options: unknown) {
			sent.push({ message: message as never, options: options as never });
		},
	} as unknown as ExtensionAPI;
	return {
		pi,
		tools,
		commands,
		sent,
		emit(event, payload, ctx) {
			for (const handler of handlers.get(event) ?? []) handler(payload, ctx);
		},
	};
}

function fakeContext(notices: string[], sessionId: string): ExtensionContext {
	return {
		cwd: "/work",
		ui: { notify: (message: string) => notices.push(message) },
		sessionManager: { getSessionId: () => sessionId, getSessionFile: () => `/sessions/${sessionId}.jsonl` },
	} as unknown as ExtensionContext;
}

function snapshotFor(sessionId: string, record: Partial<JobRecord>): void {
	const full: JobRecord = {
		id: "J-4",
		command: "pnpm dev",
		mode: "detach",
		status: "running",
		reason: "vite",
		startedAt: Date.now() - 60_000,
		lastOutputAt: Date.now(),
		detached: true,
		outputBytes: 12,
		outputLines: 1,
		...record,
	};
	saveSnapshot(buildSnapshot(sessionId, [{ record: full, tail: "ready on 5173" }], Date.now()));
}

describe("extension wiring", () => {
	it("registers the three tools and keeps pi's bash name", () => {
		agentDirWith();
		const fake = fakePi();
		bashJobsExtension(fake.pi);
		expect(fake.tools.map((tool) => tool.name).sort()).toEqual([
			"bash",
			"bash_job_stop",
			"tool_execution_inspect_output",
		]);
		expect(fake.commands.map((command) => command.name)).toEqual(["bash-jobs"]);
	});

	it("leaves built-in bash alone when replaceBuiltinBash is false", () => {
		agentDirWith({ replaceBuiltinBash: false });
		const fake = fakePi();
		bashJobsExtension(fake.pi);
		expect(fake.tools.map((tool) => tool.name)).not.toContain("bash");
		// The two job tools stay registered: the escape valve is about bash, not about losing inspect.
		expect(fake.tools.map((tool) => tool.name)).toContain("tool_execution_inspect_output");
	});
});

describe("session lifecycle", () => {
	it("restores a previous run's jobs as orphaned and says how many are still alive", () => {
		agentDirWith();
		const sessionId = "sess-restore";
		snapshotFor(sessionId, { pid: process.pid });
		const fake = fakePi();
		bashJobsExtension(fake.pi);
		const notices: string[] = [];
		fake.emit("session_start", { type: "session_start", reason: "resume" }, fakeContext(notices, sessionId));
		expect(notices.join("\n")).toContain("restored from a previous run as orphaned");
		expect(notices.join("\n")).toContain("still have a live process");
	});

	it("writes a snapshot on shutdown so a restart has something to restore", () => {
		const dir = agentDirWith();
		const fake = fakePi();
		bashJobsExtension(fake.pi);
		const ctx = fakeContext([], "sess-write");
		fake.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
		fake.emit("session_shutdown", { type: "session_shutdown", reason: "quit" }, ctx);
		expect(existsSync(join(dir, "bash-jobs", "sess-write.json"))).toBe(true);
	});

	it("keeps jobs and the wake queue usable across a session switch", async () => {
		agentDirWith();
		const fake = fakePi();
		bashJobsExtension(fake.pi);
		// Two starts in a row: the second must not leave the extension with a disposed queue or an
		// empty job list (a `/new` must not silently drop ownership of a running server).
		fake.emit("session_start", { type: "session_start", reason: "startup" }, fakeContext([], "sess-a"));
		fake.emit("session_shutdown", { type: "session_shutdown", reason: "new" }, fakeContext([], "sess-a"));
		fake.emit("session_start", { type: "session_start", reason: "new" }, fakeContext([], "sess-b"));
		const notices: string[] = [];
		const tool = fake.tools.find((candidate) => candidate.name === "tool_execution_inspect_output") as
			| {
					execute: (
						id: string,
						params: unknown,
						signal: undefined,
						update: undefined,
						ctx: unknown,
					) => Promise<unknown>;
			  }
			| undefined;
		expect(tool).toBeDefined();
		const result = (await tool?.execute("call-1", {}, undefined, undefined, fakeContext(notices, "sess-b"))) as {
			content: { text?: string }[];
		};
		expect(result.content[0]?.text).toContain("No bash jobs in this session.");
	});

	it("keepOnSessionEnd=false snapshots the kill it issued, not a stale 'running'", async () => {
		const dir = agentDirWith({ keepOnSessionEnd: false });
		const fake = fakePi();
		bashJobsExtension(fake.pi);
		const sessionId = "sess-kill";
		const notices: string[] = [];
		const ctx = {
			cwd: process.cwd(),
			ui: { notify: (message: string) => notices.push(message) },
			sessionManager: { getSessionId: () => sessionId, getSessionFile: () => `/sessions/${sessionId}.jsonl` },
		} as unknown as ExtensionContext;
		fake.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
		const bash = fake.tools.find((candidate) => candidate.name === "bash") as
			| {
					execute: (
						id: string,
						params: unknown,
						signal: undefined,
						update: undefined,
						ctx: unknown,
					) => Promise<{ content: { text?: string }[] }>;
			  }
			| undefined;
		expect(bash).toBeDefined();
		const started = await bash?.execute("call-1", { command: "sleep 30", mode: "detach" }, undefined, undefined, ctx);
		expect(started?.content[0]?.text).toContain("started in the background");
		fake.emit("session_shutdown", { type: "session_shutdown", reason: "quit" }, ctx);
		const file = join(dir, "bash-jobs", `${sessionId}.json`);
		expect(existsSync(file)).toBe(true);
		const snapshot = JSON.parse(readFileSync(file, "utf8")) as {
			jobs: { record: { status: string; killedBy?: string } }[];
		};
		// The kill is issued before the snapshot, so the next run does not restore a dead process as an
		// orphan (and cannot mistake a reused pid for a live one).
		expect(snapshot.jobs[0]?.record).toMatchObject({ status: "killed", killedBy: "user" });
	});

	it("lists jobs through the /bash-jobs command", async () => {
		agentDirWith();
		const fake = fakePi();
		bashJobsExtension(fake.pi);
		const notices: string[] = [];
		const ctx = fakeContext(notices, "sess-cmd");
		fake.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
		const command = fake.commands.find((candidate) => candidate.name === "bash-jobs");
		expect(command).toBeDefined();
		await command?.options.handler("", ctx);
		expect(notices.join("\n")).toContain("No bash jobs in this session.");
	});
});
