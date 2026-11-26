import { describe, expect, it } from "vitest";
import {
	contentHasPlanMarker,
	filterPlanContextMessages,
	PLAN_CONTEXT_CUSTOM_TYPE,
	PLAN_MODE_CONTEXT,
	PLAN_MODE_MARKER,
} from "../prompts.ts";

describe("contentHasPlanMarker", () => {
	it("detects string and text-block content", () => {
		expect(contentHasPlanMarker(`${PLAN_MODE_MARKER} hi`)).toBe(true);
		expect(contentHasPlanMarker([{ type: "text", text: PLAN_MODE_MARKER }])).toBe(true);
		expect(contentHasPlanMarker("normal")).toBe(false);
		expect(contentHasPlanMarker([{ type: "image" }])).toBe(false);
		expect(contentHasPlanMarker(null)).toBe(false);
	});
});

describe("filterPlanContextMessages", () => {
	it("drops plan context custom messages and user markers", () => {
		const messages = [
			{ role: "assistant", content: "ok" },
			{ customType: PLAN_CONTEXT_CUSTOM_TYPE, content: PLAN_MODE_MARKER },
			{ role: "user", content: `${PLAN_MODE_MARKER} leaked` },
			{ role: "user", content: "real question" },
		];
		const filtered = filterPlanContextMessages(messages);
		expect(filtered).toEqual([
			{ role: "assistant", content: "ok" },
			{ role: "user", content: "real question" },
		]);
	});
});

describe("PLAN_MODE_CONTEXT", () => {
	it("documents Plan: section and [PLAN READY] contract", () => {
		expect(PLAN_MODE_CONTEXT).toContain("[PLAN READY]");
		expect(PLAN_MODE_CONTEXT).toContain("Plan:");
		expect(PLAN_MODE_CONTEXT).toContain("post-plan TUI");
	});
});
