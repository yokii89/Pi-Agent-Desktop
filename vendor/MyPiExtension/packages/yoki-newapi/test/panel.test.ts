/**
 * Unit tests for panel pure logic (args parsing, status rows, menu/picker
 * state machines, rendering). No TUI or network involved.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
	applyPanelKey,
	applyPickerKey,
	buildMenuItems,
	buildStatusRows,
	createPickerState,
	filterPickerItems,
	formatCacheAge,
	formatStatusPlain,
	maskKey,
	parseNewApiArgs,
	renderPickerList,
	renderStatusLines,
	type NewApiStatusInfo,
	type PanelActionId,
	type PickerState,
} from "../panel.ts";

const theme = { fg: (_color: string, text: string) => text } as unknown as Theme;

const configuredInfo: NewApiStatusInfo = {
	configured: true,
	endpoint: "https://api.example.com",
	api: "openai-completions",
	source: "auth.json",
	keyMask: "****abcd",
	modelCount: 42,
	cacheAge: "3h ago",
	current: "newapi/gpt-5.2",
	thinking: "high",
};

describe("parseNewApiArgs", () => {
	it("maps empty/whitespace args to panel", () => {
		expect(parseNewApiArgs("")).toBe("panel");
		expect(parseNewApiArgs("   ")).toBe("panel");
		expect(parseNewApiArgs("menu")).toBe("panel");
	});

	it("resolves aliases case-insensitively", () => {
		expect(parseNewApiArgs("Status")).toBe("status");
		expect(parseNewApiArgs("switch")).toBe("model");
		expect(parseNewApiArgs("ping")).toBe("test");
		expect(parseNewApiArgs("reset")).toBe("clear");
		expect(parseNewApiArgs("import")).toBe("login");
	});

	it("maps unknown args to usage", () => {
		expect(parseNewApiArgs("bogus")).toBe("usage");
	});
});

describe("maskKey", () => {
	it("keeps only trailing 4 chars", () => {
		expect(maskKey("sk-1234567890abcd")).toBe("****abcd");
		expect(maskKey("abc")).toBe("****");
	});
});

describe("formatCacheAge", () => {
	it("formats buckets", () => {
		const now = 1_000_000_000_000;
		expect(formatCacheAge(now - 30_000, now)).toBe("just now");
		expect(formatCacheAge(now - 5 * 60_000, now)).toBe("5m ago");
		expect(formatCacheAge(now - 3 * 3_600_000, now)).toBe("3h ago");
		expect(formatCacheAge(now - 2 * 86_400_000, now)).toBe("2d ago");
	});
});

describe("buildStatusRows", () => {
	it("warns when unconfigured", () => {
		const rows = buildStatusRows({
			configured: false,
			api: "openai-completions",
			source: "none",
			modelCount: 0,
		});
		expect(rows.find((r) => r.label === "endpoint")?.tone).toBe("warning");
		expect(rows.find((r) => r.label === "models")?.value).toBe("no cache");
		expect(rows.find((r) => r.label === "current")?.value).toBe("—");
	});

	it("includes cache age, current model, thinking, and last error", () => {
		const rows = buildStatusRows({ ...configuredInfo, lastError: "HTTP 401" });
		expect(rows.find((r) => r.label === "models")?.value).toBe("42 cached · 3h ago");
		expect(rows.find((r) => r.label === "current")?.value).toBe("newapi/gpt-5.2 · thinking high");
		expect(rows.find((r) => r.label === "error")?.value).toContain("HTTP 401");
	});
});

describe("formatStatusPlain", () => {
	it("uses glyphs and stays plain (no SGR)", () => {
		const lines = formatStatusPlain(configuredInfo);
		expect(lines[0]).toContain("✓ New API");
		expect(lines[0]).toContain("https://api.example.com");
		expect(lines.join("\n")).not.toMatch(/\x1b\[/);
	});

	it("flags unconfigured with warning glyph", () => {
		const lines = formatStatusPlain({
			configured: false,
			api: "openai-completions",
			source: "none",
			modelCount: 0,
		});
		expect(lines[0]).toContain("⚠ New API");
	});
});

describe("buildMenuItems", () => {
	it("puts login first when unconfigured", () => {
		const items = buildMenuItems({ ...configuredInfo, configured: false });
		expect(items[0]).toBe("login");
	});

	it("leads with model switch when configured", () => {
		const items = buildMenuItems(configuredInfo);
		expect(items[0]).toBe("model");
		expect(items).toContain("close");
	});
});

describe("applyPanelKey", () => {
	const items: PanelActionId[] = ["model", "refresh", "close"];

	it("moves up/down with wrap", () => {
		const s = { items, selectedIndex: 0 };
		expect(applyPanelKey(s, "\x1b[A").state.selectedIndex).toBe(2);
		expect(applyPanelKey({ ...s, selectedIndex: 2 }, "\x1b[B").state.selectedIndex).toBe(0);
	});

	it("confirms on enter and cancels on escape", () => {
		const s = { items, selectedIndex: 1 };
		expect(applyPanelKey(s, "\r").action).toBe("confirm");
		expect(applyPanelKey(s, "\x1b").action).toBe("cancel");
	});

	it("ignores plain text", () => {
		expect(applyPanelKey({ items, selectedIndex: 0 }, "x").action).toBe("none");
	});
});

const pickerItems = [
	{ id: "gpt-5.2", name: "GPT-5.2" },
	{ id: "claude-sonnet-4", name: "Claude Sonnet 4" },
	{ id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
];

describe("filterPickerItems", () => {
	it("matches id and name case-insensitively", () => {
		expect(filterPickerItems(pickerItems, "claude").map((m) => m.id)).toEqual(["claude-sonnet-4"]);
		expect(filterPickerItems(pickerItems, "GPT").map((m) => m.id)).toEqual(["gpt-5.2"]);
		expect(filterPickerItems(pickerItems, "  sonnet ").map((m) => m.id)).toEqual(["claude-sonnet-4"]);
	});

	it("returns everything for empty query", () => {
		expect(filterPickerItems(pickerItems, "")).toHaveLength(3);
	});
});

describe("applyPickerKey", () => {
	function type(state: PickerState, text: string): PickerState {
		let current = state;
		for (const ch of text) {
			current = applyPickerKey(current, ch).state;
		}
		return current;
	}

	it("filters as you type and resets selection", () => {
		let state = createPickerState(pickerItems);
		state = type(state, "gemini");
		expect(state.visible.map((m) => m.id)).toEqual(["gemini-2.5-pro"]);
		expect(state.selected).toBe(0);
	});

	it("backspace pops the query and restores matches", () => {
		let state = type(createPickerState(pickerItems), "gpt");
		state = applyPickerKey(state, "\x7f").state;
		expect(state.query).toBe("gp");
		expect(state.visible.map((m) => m.id)).toEqual(["gpt-5.2"]);
	});

	it("backspace on empty query is a no-op", () => {
		const state = createPickerState(pickerItems);
		expect(applyPickerKey(state, "\x7f").state.query).toBe("");
	});

	it("enter confirms only when a model is visible", () => {
		const empty = type(createPickerState(pickerItems), "zzz");
		expect(applyPickerKey(empty, "\r").action).toBe("none");
		const nonEmpty = createPickerState(pickerItems);
		expect(applyPickerKey(nonEmpty, "\r").action).toBe("confirm");
	});

	it("escape cancels; arrows wrap", () => {
		const state = createPickerState(pickerItems);
		expect(applyPickerKey(state, "\x1b").action).toBe("cancel");
		expect(applyPickerKey({ ...state, selected: 0 }, "\x1b[A").state.selected).toBe(2);
	});
});

describe("renderPickerList", () => {
	it("marks current model and shows pointer on selection", () => {
		const state = { ...createPickerState(pickerItems, "claude-sonnet-4"), selected: 2 };
		const joined = renderPickerList(state, theme, 60).join("\n");
		expect(joined).toContain("❯ gemini-2.5-pro");
		expect(joined).toContain("✓");
	});

	it("shows empty-state message when nothing matches", () => {
		const state = { ...createPickerState(pickerItems), query: "zzz", visible: [], selected: 0 };
		const joined = renderPickerList(state, theme, 60).join("\n");
		expect(joined).toContain("no models match");
	});

	it("shows scroll counter when list is windowed", () => {
		const many = Array.from({ length: 30 }, (_, i) => ({ id: `model-${i}`, name: `model-${i}` }));
		const state = { ...createPickerState(many), selected: 15 };
		const joined = renderPickerList(state, theme, 60).join("\n");
		expect(joined).toContain("16/30");
	});
});

describe("renderStatusLines", () => {
	it("renders section label and rows", () => {
		const lines = renderStatusLines(configuredInfo, theme, 60);
		expect(lines[0]).toContain("─── New API");
		expect(lines.join("\n")).toContain("endpoint");
		expect(lines.join("\n")).toContain("https://api.example.com · openai-completions");
	});
});
