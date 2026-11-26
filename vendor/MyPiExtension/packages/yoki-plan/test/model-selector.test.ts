import type { Api, Model } from "@earendil-works/pi-ai";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
	applySelectorKey,
	clampForModel,
	createInitialSelectorState,
	cycleThinkingLevel,
	formatThinkingStrip,
	type ModelListItem,
	moveSelection,
	renderLines,
	type ThinkingLevel,
} from "../model-selector.ts";

function makeModel(
	provider: string,
	id: string,
	opts: { reasoning?: boolean; thinkingLevelMap?: Record<string, string | null> } = {},
): Model<Api> {
	return {
		id,
		name: id,
		provider,
		api: "openai-completions" as Api,
		reasoning: opts.reasoning ?? true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
		thinkingLevelMap: opts.thinkingLevelMap,
	} as Model<Api>;
}

const reasoningModel = makeModel("openai", "gpt-think", {
	reasoning: true,
	// default maps: all levels except null blocks
});
const noReasoning = makeModel("openai", "gpt-fast", { reasoning: false });

function items(): ModelListItem[] {
	return [
		{ provider: "openai", id: "gpt-think", model: reasoningModel },
		{ provider: "openai", id: "gpt-fast", model: noReasoning },
		{ provider: "anthropic", id: "claude", model: makeModel("anthropic", "claude") },
	];
}

describe("cycleThinkingLevel", () => {
	it("wraps among supported levels", () => {
		const levels: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];
		// For a generic reasoning model without thinkingLevelMap nulls, all standard levels apply
		// except xhigh which needs an explicit map entry.
		const next = cycleThinkingLevel(reasoningModel, "high", 1);
		expect(levels).toContain(next);
		const prev = cycleThinkingLevel(reasoningModel, "off", -1);
		expect(prev).toBe("high"); // wraps to last non-xhigh if xhigh unsupported
	});

	it("returns off for missing model or non-reasoning", () => {
		expect(cycleThinkingLevel(undefined, "high", 1)).toBe("off");
		expect(cycleThinkingLevel(noReasoning, "high", 1)).toBe("off");
	});
});

describe("clampForModel", () => {
	it("clamps non-reasoning to off", () => {
		expect(clampForModel(noReasoning, "high")).toBe("off");
		expect(clampForModel(undefined, "medium")).toBe("off");
	});
});

describe("moveSelection", () => {
	it("wraps at ends", () => {
		expect(moveSelection(0, 3, -1)).toBe(2);
		expect(moveSelection(2, 3, 1)).toBe(0);
		expect(moveSelection(0, 0, 1)).toBe(0);
	});
});

describe("createInitialSelectorState", () => {
	it("selects current model and clamps thinking", () => {
		const state = createInitialSelectorState(items(), noReasoning, "high");
		expect(state.models[state.selectedIndex]?.id).toBe("gpt-fast");
		expect(state.thinkingLevel).toBe("off");
	});
});

describe("applySelectorKey", () => {
	it("moves selection with up/down and cycles thinking with left/right", () => {
		let state = createInitialSelectorState(items(), reasoningModel, "medium");
		// down
		state = applySelectorKey(state, "\x1b[B").state; // down
		// left/right on current
		const left = applySelectorKey(state, "\x1b[D"); // left
		const right = applySelectorKey(left.state, "\x1b[C"); // right
		expect(right.state.thinkingLevel).toBeDefined();
	});

	it("confirm and cancel", () => {
		const state = createInitialSelectorState(items(), reasoningModel, "medium");
		expect(applySelectorKey(state, "\r").action).toBe("confirm");
		expect(applySelectorKey(state, "\x1b").action).toBe("cancel");
	});

	it("ignores printable characters", () => {
		const state = createInitialSelectorState(items(), undefined, "off");
		const next = applySelectorKey(state, "c");
		expect(next.action).toBe("none");
		expect(next.state).toEqual(state);
		expect(next.state.models.length).toBe(3);
	});
});

describe("formatThinkingStrip", () => {
	it("returns no-reasoning strip for non-reasoning models", () => {
		const strip = formatThinkingStrip(noReasoning, "high");
		expect(strip).toEqual({ hasReasoning: false, current: "off", levels: ["off"] });
	});

	it("returns supported levels with clamped current for reasoning models", () => {
		const strip = formatThinkingStrip(reasoningModel, "medium");
		expect(strip.hasReasoning).toBe(true);
		expect(strip.current).toBe("medium");
		expect(strip.levels).toContain("medium");
		expect(strip.levels.length).toBeGreaterThan(1);
	});
});

describe("renderLines layout", () => {
	const theme = {
		fg: (_color: string, text: string) => text,
	} as unknown as Theme;

	it("shows thinking once, omits provider badges, and marks current model", () => {
		const state = createInitialSelectorState(items(), reasoningModel, "medium");
		const lines = renderLines(state, theme, reasoningModel);
		const joined = lines.join("\n");

		expect(joined).toContain("↑↓ model · ←→ thinking");
		expect(joined).toContain("❯ gpt-think ✓");
		expect(joined).toContain("  gpt-fast");
		expect(joined).toContain("  claude");

		// Thinking appears once as a dedicated control, not on every model row.
		const thinkingRows = lines.filter((l) => l.startsWith("thinking"));
		expect(thinkingRows).toHaveLength(1);
		expect(thinkingRows[0]).toContain("[medium]");
		expect(thinkingRows[0]).toContain("◀");
		expect(thinkingRows[0]).toContain("▶");

		// No provider source badges.
		expect(joined).not.toMatch(/\[openai\]/);
		expect(joined).not.toMatch(/\[anthropic\]/);
		// No per-row · level suffixes.
		expect(joined).not.toMatch(/gpt-think.*·/);
	});

	it("shows no-reasoning hint when selected model cannot think", () => {
		let state = createInitialSelectorState(items(), reasoningModel, "medium");
		state = applySelectorKey(state, "\x1b[B").state; // down → gpt-fast
		const lines = renderLines(state, theme, reasoningModel);
		const thinking = lines.find((l) => l.startsWith("thinking"));
		expect(thinking).toContain("no reasoning");
	});
});
