import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createMockCtx, createMockPi } from "@yoki/yoki-test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import planExtension, { __resetPlanBridgeForTests, getPlanBridge } from "../index.ts";
import { PLAN_CONTEXT_CUSTOM_TYPE, PLAN_MODE_MARKER } from "../prompts.ts";

function loadExtension(activeTools: string[] = ["read", "bash", "edit", "write"]) {
	const entries: Array<{ type: string; customType?: string; data?: unknown }> = [];
	const { pi, captured } = createMockPi({
		appendEntry: vi.fn((customType: string, data?: unknown) => {
			entries.push({ type: "custom", customType, data });
		}),
		setModel: vi.fn(async () => true),
		setThinkingLevel: vi.fn(),
		getThinkingLevel: vi.fn(() => "medium" as const),
	});
	captured.activeTools = [...activeTools];
	planExtension(pi);

	const ctx = createMockCtx({ hasUI: true }) as ExtensionContext;
	(ctx.ui as { theme: { fg: (c: string, t: string) => string } }).theme = {
		fg: (_c, t) => t,
	};
	(ctx.sessionManager as unknown as { getEntries: ReturnType<typeof vi.fn> }).getEntries = vi.fn(() => entries);

	async function emit(event: string, payload: unknown = {}) {
		const handlers = captured.events.get(event) ?? [];
		const results = [];
		for (const h of handlers) {
			results.push(await h(payload, ctx));
		}
		return results;
	}

	return { pi, captured, ctx, entries, emit };
}

describe("yoki-plan extension", () => {
	beforeEach(() => {
		__resetPlanBridgeForTests();
	});

	afterEach(() => {
		__resetPlanBridgeForTests();
	});

	it("registers bridge, flag, and /plan command", () => {
		const { captured } = loadExtension();
		expect(getPlanBridge()?.isLoaded()).toBe(true);
		expect(captured.flags.has("plan")).toBe(true);
		expect(captured.commands.has("plan")).toBe(true);
	});

	it("/plan toggles tools and status", async () => {
		const { captured, ctx } = loadExtension();
		const cmd = captured.commands.get("plan")!;
		await cmd.handler?.("", ctx as never);
		expect(getPlanBridge()?.getMode()).toBe("plan");
		expect(captured.activeTools).not.toContain("edit");
		await cmd.handler?.("off", ctx as never);
		expect(getPlanBridge()?.getMode()).toBe("edit");
		expect(captured.activeTools).toContain("edit");
	});

	it("blocks write tools and unsafe bash in plan mode", async () => {
		const { emit, ctx, captured } = loadExtension();
		await captured.commands.get("plan")!.handler?.("on", ctx as never);

		const writeBlock = await emit("tool_call", { toolName: "edit", input: {} });
		expect(writeBlock[0]).toMatchObject({ block: true });

		const bashBlock = await emit("tool_call", {
			toolName: "bash",
			input: { command: "rm -rf /" },
		});
		expect(bashBlock[0]).toMatchObject({ block: true });

		const bashOk = await emit("tool_call", {
			toolName: "bash",
			input: { command: "ls -la" },
		});
		expect(bashOk[0]).toBeUndefined();
	});

	it("injects plan context only in plan mode", async () => {
		const { emit, ctx, captured } = loadExtension();
		const none = await emit("before_agent_start", {});
		expect(none[0]).toBeUndefined();

		await captured.commands.get("plan")!.handler?.("on", ctx as never);
		const inj = await emit("before_agent_start", {});
		expect(inj[0]).toMatchObject({
			message: {
				customType: PLAN_CONTEXT_CUSTOM_TYPE,
				display: false,
			},
		});
		expect(String((inj[0] as { message: { content: string } }).message.content)).toContain(PLAN_MODE_MARKER);
	});

	it("filters plan context messages in edit mode", async () => {
		const { emit } = loadExtension();
		const result = await emit("context", {
			messages: [
				{ role: "user", content: "hi" },
				{ customType: PLAN_CONTEXT_CUSTOM_TYPE, content: PLAN_MODE_MARKER },
			],
		});
		expect(result[0]).toEqual({
			messages: [{ role: "user", content: "hi" }],
		});
	});

	it("restores plan mode from session entry and --plan flag", async () => {
		const { emit, ctx, entries, captured } = loadExtension();
		entries.push({
			type: "custom",
			customType: "yoki-plan",
			data: { mode: "plan", toolsBeforePlan: ["read", "bash", "edit", "write"] },
		});
		await emit("session_start", {});
		expect(getPlanBridge()?.getMode()).toBe("plan");
		expect(captured.activeTools).not.toContain("write");

		// Flag forces plan even without entry
		__resetPlanBridgeForTests();
		const second = loadExtension();
		second.captured.flags.set("plan", true);
		// re-register after reset — loadExtension already registered
		// getFlag reads captured.flags
		(second.pi.getFlag as ReturnType<typeof vi.fn>).mockImplementation((name: string) =>
			second.captured.flags.get(name),
		);
		await second.emit("session_start", {});
		expect(getPlanBridge()?.getMode()).toBe("plan");
		void ctx;
	});

	it("registers agent_settled handler", () => {
		const { captured } = loadExtension();
		expect(captured.events.has("agent_settled")).toBe(true);
	});

	it("injects ready-marker contract in plan context", async () => {
		const { emit, ctx, captured } = loadExtension();
		await captured.commands.get("plan")!.handler?.("on", ctx as never);
		const inj = await emit("before_agent_start", {});
		const content = String((inj[0] as { message: { content: string } }).message.content);
		expect(content).toContain("[PLAN READY]");
		expect(content).toContain("Plan:");
	});
});
