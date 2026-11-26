import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { createJobRegistry } from "../core/jobs.ts";
import { createRingBuffer } from "../infra/ring.ts";
import type { ShellChild, ShellExit } from "../infra/shell.ts";
import { DEFAULT_CONFIG } from "../state/config.ts";
import { createBashJobsTool } from "../tools/bashTool.ts";
import { createInspectTool } from "../tools/inspectTool.ts";
import { createStopTool } from "../tools/stopTool.ts";

const limits = { maxBytes: 4_096, maxLines: 100 };

function fakeChild() {
	let resolve!: (exit: ShellExit) => void;
	const exited = new Promise<ShellExit>((done) => {
		resolve = done;
	});
	const listeners: ((chunk: Buffer) => void)[] = [];
	return {
		child: {
			pid: 77,
			exited,
			onData: (listener: (chunk: Buffer) => void) => listeners.push(listener),
			kill: () => resolve({ exitCode: null }),
		} satisfies ShellChild,
		emit: (text: string) => {
			for (const listener of listeners) listener(Buffer.from(text, "utf8"));
		},
		exit: (exitCode: number | null) => resolve({ exitCode }),
	};
}

/** Tool results carry TextContent | ImageContent; these tools only ever emit text. */
function textOf(result: { content: readonly unknown[] }): string {
	const first = result.content[0] as { text?: unknown } | undefined;
	return typeof first?.text === "string" ? first.text : "";
}

function fakeContext(notices: string[] = []): ExtensionToolContext {
	return {
		cwd: "/work",
		model: { provider: "newapi", id: "gpt-5" },
		thinkingLevel: "high",
		sessionManager: {
			getSessionId: () => "sess-1",
			getSessionFile: () => "/sessions/sess-1.jsonl",
		},
		ui: {
			notify: (message: string) => notices.push(message),
		},
	} as unknown as ExtensionToolContext;
}

describe("bash tool definition", () => {
	it("declares the three modes and keeps pi's tool name", () => {
		const registry = createJobRegistry();
		const tool = createBashJobsTool({ config: DEFAULT_CONFIG, registry });
		expect(tool.name).toBe("bash");
		const properties = (tool.parameters as { properties: Record<string, unknown> }).properties;
		expect(Object.keys(properties)).toEqual(expect.arrayContaining(["command", "timeout", "mode", "label"]));
		expect(tool.promptSnippet).toContain("background");
		expect(tool.promptGuidelines?.length).toBeGreaterThan(0);
		expect(tool.description).toContain("`detach`");
		expect(tool.description).toContain("never killed");
	});

	it("runs a command and re-exposes the PI_* session environment", async () => {
		const registry = createJobRegistry({ now: () => 0 });
		const fake = fakeChild();
		let seenEnv: NodeJS.ProcessEnv | undefined;
		const tool = createBashJobsTool({
			config: { ...DEFAULT_CONFIG, finishSoftBudgetSec: 5, idleDetachSec: 5, idleWarnSec: 5 },
			registry,
			now: () => 0,
			spawn: (request) => {
				seenEnv = request.env;
				return fake.child;
			},
		});
		const running = tool.execute("call-1", { command: "echo hi" }, undefined, undefined, fakeContext());
		fake.emit("hi\n");
		fake.exit(0);
		const result = await running;
		expect(result.content[0]).toMatchObject({ type: "text", text: "hi" });
		expect(seenEnv?.PI_SESSION_ID).toBe("sess-1");
		expect(seenEnv?.PI_SESSION_FILE).toBe("/sessions/sess-1.jsonl");
		expect(seenEnv?.PI_PROVIDER).toBe("newapi");
		expect(seenEnv?.PI_MODEL).toBe("gpt-5");
		expect(seenEnv?.PI_REASONING_LEVEL).toBe("high");
	});

	it("notifies the UI once when a blocking call goes quiet", async () => {
		let clock = 0;
		const registry = createJobRegistry({ now: () => clock });
		const fake = fakeChild();
		const notices: string[] = [];
		const tool = createBashJobsTool({
			config: { ...DEFAULT_CONFIG, idleWarnSec: 1, idleDetachSec: 2 },
			registry,
			now: () => clock,
			spawn: () => fake.child,
			waitTick: async (ms: number) => {
				clock += ms;
			},
		});
		// Never exits: the wait loop has to advance a real clock to reach the idle thresholds.
		const running = tool.execute("call-2", { command: "sleep 100" }, undefined, undefined, fakeContext(notices));
		const result = await running;
		expect(textOf(result)).toContain("moved to the background");
		expect(notices.length).toBe(1);
		expect(notices[0]).toContain("silent for");
	});
});

describe("inspect tool definition", () => {
	it("reads a job and returns JSON-safe structured content", async () => {
		const registry = createJobRegistry({ now: () => 0 });
		const ring = createRingBuffer(limits);
		registry.create({ command: "pnpm dev", mode: "detach", reason: "vite", ring, kill: () => {} });
		ring.append("ready\n");
		const tool = createInspectTool({ registry, config: DEFAULT_CONFIG, now: () => 0 });
		const result = await tool.execute("call-1", { job: "J-1" }, undefined, undefined, fakeContext());
		expect(textOf(result)).toContain("ready");
		expect(result.structuredContent).toMatchObject({ jobs: [{ id: "J-1", status: "running" }] });
		expect(JSON.parse(JSON.stringify(result.structuredContent))).toEqual(result.structuredContent);
	});

	it("marks an unknown job as an error result", async () => {
		const registry = createJobRegistry();
		const tool = createInspectTool({ registry, config: DEFAULT_CONFIG });
		const result = await tool.execute("call-2", { job: "J-9" }, undefined, undefined, fakeContext());
		expect(result.isError).toBe(true);
	});
});

describe("stop tool definition", () => {
	it("kills the job and suppresses the wake that the stop itself would trigger", async () => {
		const registry = createJobRegistry({ now: () => 0 });
		const suppressed: string[] = [];
		registry.create({
			command: "pnpm dev",
			mode: "detach",
			reason: "vite",
			pid: 5,
			ring: createRingBuffer(limits),
			kill: () => registry.settle("J-1", { exitCode: null, killedBy: "model" }),
		});
		const tool = createStopTool({ registry, onModelStopped: (id) => suppressed.push(id) });
		const result = await tool.execute("call-1", { job: "J-1" }, undefined, undefined, fakeContext());
		expect(textOf(result)).toContain("Stopped job J-1");
		expect(suppressed).toEqual(["J-1"]);
	});
});
