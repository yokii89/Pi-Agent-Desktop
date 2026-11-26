import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createMockCtx, createMockPi } from "@yoki/yoki-test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPlanModeController, type PlanModeControllerHooks } from "../mode.ts";

function setup(active: string[] = ["read", "bash", "edit", "write"], hooks?: PlanModeControllerHooks) {
	const entries: Array<{ customType: string; data: unknown }> = [];
	const { pi, captured } = createMockPi({
		appendEntry: vi.fn((customType: string, data?: unknown) => {
			entries.push({ customType, data });
		}),
	});
	captured.activeTools = [...active];
	const controller = createPlanModeController(pi, hooks);
	const ctx = createMockCtx({ hasUI: true }) as ExtensionContext;
	// theme for setStatus chip
	(ctx.ui as { theme: { fg: (c: string, t: string) => string } }).theme = {
		fg: (_c, t) => t,
	};
	return { pi, captured, controller, ctx, entries };
}

describe("createPlanModeController", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("defaults to edit", () => {
		const { controller } = setup();
		expect(controller.getMode()).toBe("edit");
	});

	it("enterPlan disables write tools and snapshots", () => {
		const { controller, ctx, captured, entries } = setup();
		expect(controller.enterPlan(ctx)).toBe(true);
		expect(controller.getMode()).toBe("plan");
		expect(captured.activeTools).not.toContain("edit");
		expect(captured.activeTools).not.toContain("write");
		expect(captured.activeTools).toContain("read");
		expect(controller.getToolsBeforePlan()).toEqual(["read", "bash", "edit", "write"]);
		expect(entries.at(-1)?.customType).toBe("yoki-plan");
		expect(ctx.ui.setStatus).toHaveBeenCalled();
	});

	it("enterEdit restores tools from snapshot", () => {
		const { controller, ctx, captured } = setup();
		controller.enterPlan(ctx);
		expect(controller.enterEdit(ctx)).toBe(true);
		expect(controller.getMode()).toBe("edit");
		expect(captured.activeTools).toEqual(["read", "bash", "edit", "write"]);
		expect(controller.getToolsBeforePlan()).toBeUndefined();
	});

	it("toggle refuses when not idle", () => {
		const { controller, ctx } = setup();
		(ctx.isIdle as ReturnType<typeof vi.fn>).mockReturnValue(false);
		const mode = controller.toggle(ctx);
		expect(mode).toBe("edit");
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("busy"), "warning");
	});

	it("toggle switches when idle", () => {
		const { controller, ctx } = setup();
		expect(controller.toggle(ctx)).toBe("plan");
		expect(controller.toggle(ctx)).toBe("edit");
	});

	it("setMode with on/off is idempotent", () => {
		const { controller, ctx } = setup();
		controller.setMode(ctx, "plan");
		controller.setMode(ctx, "plan");
		expect(controller.getMode()).toBe("plan");
		controller.setMode(ctx, "edit");
		expect(controller.getMode()).toBe("edit");
	});

	it("restore plan re-applies tool gates", () => {
		const { controller, ctx, captured } = setup();
		controller.restore(ctx, {
			mode: "plan",
			toolsBeforePlan: ["read", "bash", "edit", "write", "extra"],
		});
		expect(controller.getMode()).toBe("plan");
		expect(captured.activeTools).not.toContain("edit");
		expect(captured.activeTools).toContain("extra");
	});

	it("persists last plan fingerprint and path", () => {
		const { controller, entries } = setup();
		controller.setLastPlanFingerprint("abc");
		expect(controller.getLastPlanFingerprint()).toBe("abc");
		controller.setLastPlan("def", ".pi/yoki/artifacts/plans/x.md");
		expect(controller.getLastPlanFingerprint()).toBe("def");
		expect(controller.getLastPlanPath()).toBe(".pi/yoki/artifacts/plans/x.md");
		const last = entries.at(-1)?.data as {
			lastPlanFingerprint?: string;
			lastPlanPath?: string;
		};
		expect(last.lastPlanFingerprint).toBe("def");
		expect(last.lastPlanPath).toBe(".pi/yoki/artifacts/plans/x.md");
	});

	it("restore reloads fingerprint and path", () => {
		const { controller, ctx } = setup();
		controller.restore(ctx, {
			mode: "plan",
			lastPlanFingerprint: "fp1",
			lastPlanPath: "plans/a.md",
		});
		expect(controller.getLastPlanFingerprint()).toBe("fp1");
		expect(controller.getLastPlanPath()).toBe("plans/a.md");
	});

	it("onModeChange fires on transitions but not idempotent setMode", () => {
		const onModeChange = vi.fn();
		const { controller, ctx } = setup(["read", "bash", "edit", "write"], { onModeChange });
		controller.enterPlan(ctx);
		expect(onModeChange).toHaveBeenLastCalledWith("plan");
		controller.enterEdit(ctx);
		expect(onModeChange).toHaveBeenLastCalledWith("edit");
		const calls = onModeChange.mock.calls.length;
		controller.setMode(ctx, "edit");
		expect(onModeChange.mock.calls.length).toBe(calls);
		controller.restore(ctx, { mode: "plan" });
		expect(onModeChange).toHaveBeenLastCalledWith("plan");
	});
});
