import { accessModeManifestEntry } from "@pidesk/view-sdk";
import { describe, expect, it, vi } from "vitest";
import {
	asColumn,
	asRow,
	buildPostPlanSpecForTest,
	createPlanModeSupervisor,
	PLAN_MODE,
	planModeDetailFor,
	postPlanChoiceFromValue,
	presentPostPlanOnDesktop,
	readContributionKey,
	registerPlanModeOnDesktop,
} from "../desktop-view.ts";
import pkg from "../package.json";
import { POST_PLAN_OPTIONS } from "../post-plan.ts";

const STEPS = [
	{ step: 1, text: "Add extract helpers" },
	{ step: 2, text: "Wire agent_settled" },
];

describe("post-plan desktop spec", () => {
	it("builds widget above editor with four action buttons", () => {
		const spec = buildPostPlanSpecForTest(STEPS);
		expect(spec.placement).toBe("widget");
		expect(spec.placementHint).toEqual({ side: "aboveEditor" });
		expect(spec.actions).toBeUndefined();

		const root = asColumn(spec.root);
		const caption = root.children.find((c) => c.type === "text");
		if (caption?.type !== "text") throw new Error("caption");
		expect(caption.content).toContain("2 steps");

		const row = root.children.find((c) => c.type === "row");
		if (!row) throw new Error("row");
		const buttons = asRow(row).children;
		expect(buttons).toHaveLength(4);
		for (const b of buttons) {
			if (b.type !== "button") throw new Error("button");
		}
		expect(buttons.map((b) => (b.type === "button" ? b.id : ""))).toEqual(["opt:0", "opt:1", "opt:2", "opt:3"]);
		expect(buttons[0]).toMatchObject({ type: "button", variant: "primary" });
	});

	it("maps values back to option labels", () => {
		expect(postPlanChoiceFromValue("opt:0")).toBe(POST_PLAN_OPTIONS[0]);
		expect(postPlanChoiceFromValue("opt:3")).toBe(POST_PLAN_OPTIONS[3]);
		expect(postPlanChoiceFromValue("nope")).toBeUndefined();
	});

	it("returns null without desktop host", async () => {
		const result = await presentPostPlanOnDesktop(STEPS, { deps: { connect: () => null } });
		expect(result).toBeNull();
	});

	it("button action closes with that choice", async () => {
		const client = {
			open: vi.fn(async (_spec, handlers?: { onEvent?: (e: unknown, s: unknown) => void }) => {
				const close = vi.fn();
				handlers?.onEvent?.({ type: "action", actionId: "opt:0" }, { close });
				expect(close).toHaveBeenCalledWith({ action: "confirm", values: { choice: "opt:0" } });
				return { action: "confirm", values: { choice: "opt:0" } };
			}),
			dispose: vi.fn(),
		};
		const result = await presentPostPlanOnDesktop(STEPS, {
			deps: { connect: () => client as never },
		});
		expect(result).toBe(POST_PLAN_OPTIONS[0]);
	});

	it("dismiss yields undefined", async () => {
		const dismissClient = {
			open: vi.fn(async () => null),
			dispose: vi.fn(),
		};
		expect(
			await presentPostPlanOnDesktop(STEPS, { deps: { connect: () => dismissClient as never } }),
		).toBeUndefined();
	});
});

describe("plan-mode desktop registration", () => {
	function fakeRegister() {
		const handle = {
			viewId: "view-1",
			session: { close: vi.fn(), closed: new Promise(() => {}) },
			setActive: vi.fn(),
		};
		const register = vi.fn(async (_client: unknown, _options: unknown) => handle);
		return { register, handle };
	}

	it("descriptor is the package.json manifest entry (one source, no drift)", () => {
		expect(pkg.pidesk.contributes.accessModes).toHaveLength(1);
		expect(pkg.pidesk.contributes.accessModes).toContainEqual(accessModeManifestEntry(PLAN_MODE));
		expect(PLAN_MODE.id).toBe("yoki-plan");
	});

	it("reads contribution key from host env map", () => {
		const prev = process.env.PIDESK_VIEW_CONTRIBUTION_KEYS;
		try {
			delete process.env.PIDESK_VIEW_CONTRIBUTION_KEYS;
			expect(readContributionKey("yoki-plan")).toBeUndefined();
			process.env.PIDESK_VIEW_CONTRIBUTION_KEYS = JSON.stringify({
				"yoki-plan": "ck:user:user:npm:@yoki/yoki-plan:access-mode:yoki-plan",
			});
			expect(readContributionKey("yoki-plan")).toBe("ck:user:user:npm:@yoki/yoki-plan:access-mode:yoki-plan");
			expect(readContributionKey("other")).toBeUndefined();
			process.env.PIDESK_VIEW_CONTRIBUTION_KEYS = "not-json";
			expect(readContributionKey("yoki-plan")).toBeUndefined();
		} finally {
			if (prev === undefined) delete process.env.PIDESK_VIEW_CONTRIBUTION_KEYS;
			else process.env.PIDESK_VIEW_CONTRIBUTION_KEYS = prev;
		}
	});

	it("passes explicit contributionKey into register options", async () => {
		const client = { dispose: vi.fn() };
		const { register } = fakeRegister();
		const key = "ck:user:user:npm:@yoki/yoki-plan:access-mode:yoki-plan";
		await registerPlanModeOnDesktop({
			connect: () => client as never,
			register: register as never,
			contributionKey: key,
		});
		const options = register.mock.calls[0][1] as { contributionKey?: string };
		expect(options.contributionKey).toBe(key);
	});

	it("returns null without desktop host", async () => {
		expect(await registerPlanModeOnDesktop({ connect: () => null })).toBeNull();
		expect(
			await registerPlanModeOnDesktop({
				connect: () => {
					throw new Error("no pipe");
				},
			}),
		).toBeNull();
	});

	it("returns null and disposes when the host lacks the slot", async () => {
		const client2 = { dispose: vi.fn() };
		const mode2 = await registerPlanModeOnDesktop({
			connect: () => client2 as never,
			register: (async () => null) as never,
		});
		expect(mode2).toBeNull();
		expect(client2.dispose).toHaveBeenCalled();
	});

	it("registers yoki-plan metadata and routes activation actions", async () => {
		const client = { dispose: vi.fn() };
		const { register } = fakeRegister();
		const onAction = vi.fn();
		const mode = await registerPlanModeOnDesktop({
			connect: () => client as never,
			register: register as never,
			onAction,
		});
		expect(mode).not.toBeNull();

		const options = register.mock.calls[0][1] as {
			id: string;
			title: string;
			description: string;
			icon: string;
			accent: string;
			onEvent: (event: { type: string; actionId?: string }) => void;
		};
		expect(options).toMatchObject({
			id: "yoki-plan",
			title: "计划模式",
			icon: "clipboard",
			accent: "warning",
		});
		expect(options.description).toContain("只读");

		options.onEvent({ type: "action", actionId: "mode:activate" });
		expect(onAction).toHaveBeenLastCalledWith("activate");
		options.onEvent({ type: "action", actionId: "mode:deactivate" });
		expect(onAction).toHaveBeenLastCalledWith("deactivate");
		options.onEvent({ type: "action", actionId: "other" });
		expect(onAction).toHaveBeenCalledTimes(2);
		options.onEvent({ type: "change" });
		expect(onAction).toHaveBeenCalledTimes(2);
	});

	it("sync pushes controller state and dispose tears down own client", async () => {
		const client = { dispose: vi.fn() };
		const { register, handle } = fakeRegister();
		const mode = await registerPlanModeOnDesktop({
			connect: () => client as never,
			register: register as never,
		});
		mode?.sync("plan");
		expect(handle.setActive).toHaveBeenLastCalledWith(true, "只读：edit/write 已禁用");
		mode?.sync("edit");
		expect(handle.setActive).toHaveBeenLastCalledWith(false, undefined);
		mode?.dispose();
		expect(handle.session.close).toHaveBeenCalled();
		// dispose 延迟销毁自建连接（让 close 信封先落盘）
		await new Promise((r) => setTimeout(r, 40));
		expect(client.dispose).toHaveBeenCalled();
	});

	it("injected client is owned by the caller: failures and dispose keep it alive", async () => {
		const injected = { dispose: vi.fn() };

		const failed = await registerPlanModeOnDesktop({
			client: injected as never,
			register: (async () => null) as never,
		});
		expect(failed).toBeNull();
		expect(injected.dispose).not.toHaveBeenCalled();

		const { register, handle } = fakeRegister();
		const mode = await registerPlanModeOnDesktop({
			client: injected as never,
			register: register as never,
		});
		mode?.dispose();
		expect(handle.session.close).toHaveBeenCalled();
		await new Promise((r) => setTimeout(r, 40));
		expect(injected.dispose).not.toHaveBeenCalled();
	});
});

describe("createPlanModeSupervisor (SDK lifecycle)", () => {
	function fakeSession() {
		let resolveClosed!: (p: { reason?: string } | null) => void;
		const closed = new Promise<{ reason?: string } | null>((resolve) => {
			resolveClosed = resolve;
		});
		const session = {
			id: "view-1",
			close: vi.fn(),
			closed,
		};
		return { session, resolveClosed };
	}

	it("pushes controller truth on register and routes host actions", async () => {
		const { session } = fakeSession();
		const setActive = vi.fn();
		let lastOptions: { onEvent?: (e: { type: string; actionId?: string }) => void } | undefined;
		const tryRegister = vi.fn(
			async (_client, options: { onEvent?: (e: { type: string; actionId?: string }) => void }) => {
				lastOptions = options;
				return {
					ok: true as const,
					handle: { viewId: "view-1", session, setActive },
				};
			},
		);

		const onAction = vi.fn();
		const sup = createPlanModeSupervisor({
			client: { dispose: vi.fn() } as never,
			getMode: () => "plan",
			onAction,
			tryRegister: tryRegister as never,
		});

		await sup.ensure();
		expect(setActive).toHaveBeenCalledWith(true, planModeDetailFor("plan"));
		expect(tryRegister).toHaveBeenCalledWith(expect.anything(), expect.objectContaining(PLAN_MODE));

		lastOptions?.onEvent?.({ type: "action", actionId: "mode:activate" });
		lastOptions?.onEvent?.({ type: "action", actionId: "mode:deactivate" });
		expect(onAction).toHaveBeenNthCalledWith(1, "activate");
		expect(onAction).toHaveBeenNthCalledWith(2, "deactivate");
	});

	it("maps planModeDetailFor from controller mode", () => {
		expect(planModeDetailFor("plan")).toContain("只读");
		expect(planModeDetailFor("edit")).toBeUndefined();
	});
});
