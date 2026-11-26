import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createMockCtx, createMockPi } from "@yoki/yoki-test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { planFingerprint } from "../extract.ts";
import { createPlanModeController } from "../mode.ts";
import {
	executePlanInNewSessionCommand,
	getLastAssistantText,
	handlePostPlanSettled,
	POST_PLAN_OPTIONS,
	POST_PLAN_SELECT_TITLE,
} from "../post-plan.ts";

const tmpDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
	vi.clearAllMocks();
});

function assistantEntry(text: string) {
	return {
		type: "message" as const,
		id: "m1",
		parentId: null,
		timestamp: new Date().toISOString(),
		message: {
			role: "assistant" as const,
			content: [{ type: "text" as const, text }],
		},
	};
}

const readyMessage = `Analysis done.

Plan:
1. Add extract helpers
2. Wire agent_settled

[PLAN READY]
`;

async function setup(
	opts: { selectResult?: string | undefined; newSession?: ReturnType<typeof vi.fn>; branchText?: string } = {},
) {
	const cwd = await mkdtemp(join(tmpdir(), "yoki-plan-post-"));
	tmpDirs.push(cwd);

	const { pi, captured } = createMockPi({
		appendEntry: vi.fn(),
		sendMessage: vi.fn(),
	});
	captured.activeTools = ["read", "bash", "edit", "write"];
	const controller = createPlanModeController(pi);

	const branch = [assistantEntry(opts.branchText ?? readyMessage)];
	const ctx = createMockCtx({
		hasUI: true,
		cwd,
		ui: {
			select: vi.fn(async () => opts.selectResult),
			notify: vi.fn(),
			setStatus: vi.fn(),
			setEditorText: vi.fn(),
			theme: { fg: (_c: string, t: string) => t },
		} as never,
	}) as ExtensionContext;

	(ctx.sessionManager as unknown as { getBranch: ReturnType<typeof vi.fn> }).getBranch = vi.fn(() => branch);
	(ctx.sessionManager as unknown as { getSessionFile: ReturnType<typeof vi.fn> }).getSessionFile = vi.fn(
		() => "/tmp/parent-session.jsonl",
	);

	if (opts.newSession) {
		(ctx as unknown as { newSession: typeof opts.newSession }).newSession = opts.newSession;
	}

	controller.enterPlan(ctx);
	return { pi, captured, controller, ctx, cwd };
}

describe("getLastAssistantText", () => {
	it("reads text from last assistant branch entry", async () => {
		const { ctx } = await setup({ branchText: "hello plan" });
		expect(getLastAssistantText(ctx)).toBe("hello plan");
	});
});

describe("handlePostPlanSettled", () => {
	it("no-ops without ready marker", async () => {
		const { pi, controller, ctx } = await setup({
			branchText: "Plan:\n1. Step\n",
			selectResult: POST_PLAN_OPTIONS[0],
		});
		await handlePostPlanSettled(pi, controller, ctx);
		expect(ctx.ui.select).not.toHaveBeenCalled();
	});

	it("no-ops without steps", async () => {
		const { pi, controller, ctx } = await setup({
			branchText: "Done.\n\n[PLAN READY]\n",
		});
		await handlePostPlanSettled(pi, controller, ctx);
		expect(ctx.ui.select).not.toHaveBeenCalled();
	});

	it("shows select when ready + steps", async () => {
		const { pi, controller, ctx } = await setup({
			selectResult: POST_PLAN_OPTIONS[2],
		});
		await handlePostPlanSettled(pi, controller, ctx);
		expect(ctx.ui.select).toHaveBeenCalledWith(POST_PLAN_SELECT_TITLE, [...POST_PLAN_OPTIONS]);
	});

	it("option 1: writes plan, leaves plan mode, triggers execute", async () => {
		const { pi, captured, controller, ctx, cwd } = await setup({
			selectResult: POST_PLAN_OPTIONS[0],
		});
		await handlePostPlanSettled(pi, controller, ctx);

		expect(controller.getMode()).toBe("edit");
		expect(captured.activeTools).toContain("edit");
		expect(pi.sendMessage).toHaveBeenCalled();
		const sendCalls = (pi.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
		const trigger = sendCalls.find((c) => c[1]?.triggerTurn === true);
		expect(trigger).toBeDefined();
		expect(controller.getLastPlanPath()).toMatch(/\.pi\/yoki\/artifacts\/plans\//);

		const files = await readdir(join(cwd, ".pi", "yoki", "artifacts", "plans"));
		expect(files.length).toBe(1);
	});

	it("option 3: no file write, stays plan, sets fingerprint", async () => {
		const { pi, controller, ctx, cwd } = await setup({
			selectResult: POST_PLAN_OPTIONS[2],
		});
		await handlePostPlanSettled(pi, controller, ctx);

		expect(controller.getMode()).toBe("plan");
		expect(controller.getLastPlanFingerprint()).toBeTruthy();
		expect(controller.getLastPlanPath()).toBeUndefined();

		// Dedup: second settle with same plan does not re-select
		await handlePostPlanSettled(pi, controller, ctx);
		expect(ctx.ui.select).toHaveBeenCalledTimes(1);

		// No plans dir spam
		await expect(readdir(join(cwd, ".pi", "yoki", "artifacts", "plans"))).rejects.toThrow();
	});

	it("Esc (undefined choice) behaves like explore", async () => {
		const { pi, controller, ctx } = await setup({ selectResult: undefined });
		await handlePostPlanSettled(pi, controller, ctx);
		expect(controller.getMode()).toBe("plan");
		expect(controller.getLastPlanFingerprint()).toBeTruthy();
		expect(controller.getLastPlanPath()).toBeUndefined();
	});

	it("option 4: writes plan, stays plan", async () => {
		const { pi, controller, ctx, cwd } = await setup({
			selectResult: POST_PLAN_OPTIONS[3],
		});
		await handlePostPlanSettled(pi, controller, ctx);

		expect(controller.getMode()).toBe("plan");
		expect(controller.getLastPlanPath()).toMatch(/artifacts\/plans\//);
		const files = await readdir(join(cwd, ".pi", "yoki", "artifacts", "plans"));
		expect(files.length).toBe(1);
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Plan saved"), "info");
	});

	it("option 2: calls newSession with path strings only when available", async () => {
		type NewSessionOpts = {
			parentSession?: string;
			setup?: (sm: { appendMessage: (msg: unknown) => void }) => Promise<void>;
			withSession?: (ctx: { sendUserMessage: (content: string) => Promise<void> }) => Promise<void>;
		};
		const newSession = vi.fn(async (opts: NewSessionOpts) => {
			const appended: unknown[] = [];
			const sm = {
				appendMessage: (msg: unknown) => {
					appended.push(msg);
				},
			};
			await opts.setup?.(sm);
			const seed = appended[0] as { content: Array<{ text: string }> };
			// Plain data only — path strings in seed
			expect(seed.content[0]?.text).toMatch(/\.pi\/yoki\/artifacts\/plans\//);
			expect(opts.parentSession).toBe("/tmp/parent-session.jsonl");

			const sent: string[] = [];
			await opts.withSession?.({
				sendUserMessage: async (content: string) => {
					sent.push(content);
				},
			});
			expect(sent[0]).toContain("Execute the exploration plan");
			return { cancelled: false };
		});

		const { pi, controller, ctx } = await setup({
			selectResult: POST_PLAN_OPTIONS[1],
			newSession,
		});
		await handlePostPlanSettled(pi, controller, ctx);

		expect(newSession).toHaveBeenCalledTimes(1);
		expect(controller.getLastPlanPath()).toBeTruthy();
	});

	it("option 2 without newSession stashes pending and prefills /plan new", async () => {
		const { pi, controller, ctx } = await setup({
			selectResult: POST_PLAN_OPTIONS[1],
		});

		await handlePostPlanSettled(pi, controller, ctx);

		// Stay plan; do NOT same-session execute
		expect(controller.getMode()).toBe("plan");
		expect(pi.sendMessage).not.toHaveBeenCalled();
		expect(controller.getPendingNewSession()?.planPath).toMatch(/artifacts\/plans\//);
		expect(ctx.ui.setEditorText).toHaveBeenCalledWith("/plan new");
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("/plan new"), "info");
	});

	it("/plan new command runs newSession with pending kickoff", async () => {
		const { pi, controller, ctx } = await setup({
			selectResult: POST_PLAN_OPTIONS[1],
		});
		await handlePostPlanSettled(pi, controller, ctx);
		expect(controller.getPendingNewSession()).toBeTruthy();

		const newSession = vi.fn(
			async (opts: {
				setup?: (sm: { appendMessage: (msg: unknown) => void }) => Promise<void>;
				withSession?: (c: { sendUserMessage: (t: string) => Promise<void> }) => Promise<void>;
			}) => {
				const sm = { appendMessage: vi.fn() };
				await opts.setup?.(sm);
				const sent: string[] = [];
				await opts.withSession?.({
					sendUserMessage: async (t: string) => {
						sent.push(t);
					},
				});
				expect(sent[0]).toContain("Execute the exploration plan");
				return { cancelled: false };
			},
		);

		const cmdCtx = {
			...ctx,
			newSession,
		} as unknown as Parameters<typeof executePlanInNewSessionCommand>[1];

		await executePlanInNewSessionCommand(controller, cmdCtx);

		expect(newSession).toHaveBeenCalledTimes(1);
		expect(controller.getPendingNewSession()).toBeUndefined();
	});

	it("fingerprint dedup uses step content", async () => {
		const steps = [
			{ step: 1, text: "Add extract helpers" },
			{ step: 2, text: "Wire agent_settled" },
		];
		const fp = planFingerprint(steps);
		const { pi, controller, ctx } = await setup({ selectResult: POST_PLAN_OPTIONS[2] });
		await handlePostPlanSettled(pi, controller, ctx);
		expect(controller.getLastPlanFingerprint()).toBe(fp);
	});
});
