import { describe, expect, it } from "vitest";
import {
	cleanStepText,
	extractPlanSteps,
	hasPlanReady,
	parseReadyPlan,
	planFingerprint,
	topicSlugFromSteps,
} from "../extract.ts";

const samplePlan = `
Some analysis...

Plan:
1. Read the existing mode controller
2. Add post-plan TUI wiring
3. Write unit tests

[PLAN READY]
`;

describe("hasPlanReady", () => {
	it("matches case-insensitively", () => {
		expect(hasPlanReady("done [PLAN READY]")).toBe(true);
		expect(hasPlanReady("done [plan ready]")).toBe(true);
		expect(hasPlanReady("done [Plan Ready]")).toBe(true);
		expect(hasPlanReady("still exploring")).toBe(false);
	});
});

describe("extractPlanSteps", () => {
	it("parses numbered steps under Plan:", () => {
		const steps = extractPlanSteps(samplePlan);
		expect(steps).toHaveLength(3);
		expect(steps[0]).toEqual({ step: 1, text: "Read the existing mode controller" });
		expect(steps[2]?.text).toBe("Write unit tests");
	});

	it("accepts 1) style and bold header", () => {
		const msg = `**Plan:**\n1) First step here\n2) Second step here\n`;
		const steps = extractPlanSteps(msg);
		expect(steps.map((s) => s.text)).toEqual(["First step here", "Second step here"]);
	});

	it("returns empty without Plan: section", () => {
		expect(extractPlanSteps("1. orphan step\n[PLAN READY]")).toEqual([]);
	});

	it("stops before ready marker", () => {
		const msg = `Plan:\n1. Only this step\n\n[PLAN READY]\n2. Not a step\n`;
		expect(extractPlanSteps(msg)).toHaveLength(1);
	});
});

describe("cleanStepText", () => {
	it("strips bold/code and collapses space", () => {
		expect(cleanStepText("  **Bold** and `code`  ")).toBe("Bold and code");
	});
});

describe("planFingerprint", () => {
	it("is stable for same steps and differs when steps change", () => {
		const a = extractPlanSteps(samplePlan);
		const b = extractPlanSteps(samplePlan);
		expect(planFingerprint(a)).toBe(planFingerprint(b));
		expect(planFingerprint(a).length).toBe(64);

		const changed = extractPlanSteps(`Plan:\n1. Different step\n`);
		expect(planFingerprint(changed)).not.toBe(planFingerprint(a));
	});

	it("normalizes case and whitespace", () => {
		const f1 = planFingerprint([{ step: 1, text: "Read  Files" }]);
		const f2 = planFingerprint([{ step: 1, text: "read files" }]);
		expect(f1).toBe(f2);
	});

	it("returns empty for no steps", () => {
		expect(planFingerprint([])).toBe("");
	});
});

describe("parseReadyPlan", () => {
	it("requires both ready marker and steps", () => {
		expect(parseReadyPlan(samplePlan)).toMatchObject({
			steps: expect.any(Array),
			fingerprint: expect.any(String),
		});
		expect(parseReadyPlan("Plan:\n1. Step only\n")).toBeUndefined();
		expect(parseReadyPlan("[PLAN READY]\nno plan section")).toBeUndefined();
	});
});

describe("topicSlugFromSteps", () => {
	it("slugifies first step", () => {
		expect(topicSlugFromSteps([{ step: 1, text: "Read the Mode!" }])).toBe("read-the-mode");
	});
});
