import { describe, expect, it } from "vitest";
import type { QuestionnaireAction } from "../state/key-router.ts";
import { reduce } from "../state/state-reducer.ts";
import type { QuestionAnswer, QuestionData } from "../tool/types.ts";
import {
	itemsRegular,
	itemsWithOther,
	makeApplyContext as makeCtx,
	makeQuestion,
	makeQuestionnaireState as makeState,
} from "./fixtures.ts";

describe("reduce — nav", () => {
	it("regular nav emits clear_input_buffer", () => {
		const r = reduce(makeState(), { kind: "nav", nextIndex: 1 }, makeCtx());
		expect(r.state.optionIndex).toBe(1);
		expect(r.state.inputMode).toBe(false);
		expect(r.effects).toEqual([{ kind: "clear_input_buffer" }]);
	});

	it("nav onto kind:'other' row with a saved draft restores the buffer from draftByTab", () => {
		const state = makeState({ draftByTab: new Map([[0, "saved draft"]]) });
		const ctx = makeCtx({ itemsByTab: [itemsWithOther] });
		const r = reduce(state, { kind: "nav", nextIndex: 2 }, ctx);
		expect(r.state.inputMode).toBe(true);
		expect(r.effects).toEqual([{ kind: "set_input_buffer", value: "saved draft" }]);
	});

	it("nav onto kind:'other' row with prior kind:'custom' answer restores the buffer", () => {
		const answers = new Map<number, QuestionAnswer>([
			[0, { questionIndex: 0, question: "Pick one", kind: "custom", answer: "Hello" }],
		]);
		const ctx = makeCtx({ itemsByTab: [itemsWithOther] });
		const r = reduce(makeState({ answers }), { kind: "nav", nextIndex: 2 }, ctx);
		expect(r.state.inputMode).toBe(true);
		expect(r.effects).toEqual([{ kind: "set_input_buffer", value: "Hello" }]);
	});

	it("nav onto kind:'other' row with no draft and no prior custom emits no input effect", () => {
		const ctx = makeCtx({ itemsByTab: [itemsWithOther] });
		const r = reduce(makeState(), { kind: "nav", nextIndex: 2 }, ctx);
		expect(r.state.inputMode).toBe(true);
		expect(r.effects).toEqual([]);
	});
});

describe("reduce — tab_switch", () => {
	it("emits clear_input_buffer and resets per-tab focus state", () => {
		const r = reduce(
			makeState(),
			{ kind: "tab_switch", nextTab: 1 },
			makeCtx({ questions: [makeQuestion(), makeQuestion()], itemsByTab: [itemsRegular, itemsRegular] }),
		);
		expect(r.state.currentTab).toBe(1);
		expect(r.state.optionIndex).toBe(0);
		expect(r.state.inputMode).toBe(false);
		expect(r.effects).toEqual([{ kind: "clear_input_buffer" }]);
	});
});

describe("reduce — confirm", () => {
	it("regular option emits done with the answer", () => {
		const action: QuestionnaireAction = {
			kind: "confirm",
			answer: { questionIndex: 0, question: "Pick one", kind: "option", answer: "A" },
		};
		const r = reduce(makeState(), action, makeCtx());
		expect(r.state.answers.get(0)?.answer).toBe("A");
		expect(r.effects).toEqual([{ kind: "done", result: { answers: [r.state.answers.get(0)!], cancelled: false } }]);
	});

	it("merges the saved draft from draftByTab into the confirmed answer as trimmed notes", () => {
		const action: QuestionnaireAction = {
			kind: "confirm",
			answer: { questionIndex: 0, question: "Pick one", kind: "option", answer: "A" },
		};
		const state = makeState({ draftByTab: new Map([[0, "  side note  "]]) });
		const r = reduce(state, action, makeCtx());
		expect(r.state.answers.get(0)?.notes).toBe("side note");
		// 草稿不删除：再次进入 other 行可继续编辑，重复合并幂等
		expect(r.state.draftByTab.get(0)).toBe("  side note  ");
	});

	it("autoAdvanceTab dispatches a tab_switch result instead of done", () => {
		const action: QuestionnaireAction = {
			kind: "confirm",
			answer: { questionIndex: 0, question: "Pick one", kind: "option", answer: "A" },
			autoAdvanceTab: 1,
		};
		const ctx = makeCtx({ questions: [makeQuestion(), makeQuestion()], itemsByTab: [itemsRegular, itemsRegular] });
		const r = reduce(makeState(), action, ctx);
		expect(r.state.currentTab).toBe(1);
		expect(r.effects).toEqual([{ kind: "clear_input_buffer" }]);
		expect(r.effects.some((e) => e.kind === "done")).toBe(false);
	});
});

describe("reduce — toggle", () => {
	it("toggles index 0 on then off and persists into answers", () => {
		const ctx = makeCtx({ questions: [makeQuestion({ multiSelect: true })] });
		const r1 = reduce(makeState(), { kind: "toggle", index: 0 }, ctx);
		expect(r1.state.multiSelectChecked.has(0)).toBe(true);
		expect(r1.state.answers.get(0)?.selected).toEqual(["A"]);
		const r2 = reduce(r1.state, { kind: "toggle", index: 0 }, ctx);
		expect(r2.state.multiSelectChecked.has(0)).toBe(false);
		expect(r2.state.answers.has(0)).toBe(false);
	});
});

describe("reduce — round-trip property [toggle, tab_switch, tab_switch_back] preserves multiSelectChecked (precedent f4fdd25)", () => {
	it("multiSelectChecked is reconstructed from answers on tab-back", () => {
		const questions = [makeQuestion({ multiSelect: true }), makeQuestion()];
		const ctx = makeCtx({ questions, itemsByTab: questions.map(() => itemsRegular) });

		let s = makeState();
		s = reduce(s, { kind: "toggle", index: 0 }, ctx).state;
		s = reduce(s, { kind: "toggle", index: 1 }, ctx).state;
		expect([...s.multiSelectChecked].sort()).toEqual([0, 1]);
		expect(s.answers.get(0)?.selected).toEqual(["A", "B"]);

		s = reduce(s, { kind: "tab_switch", nextTab: 1 }, ctx).state;
		expect([...s.multiSelectChecked]).toEqual([]);

		s = reduce(s, { kind: "tab_switch", nextTab: 0 }, ctx).state;
		expect([...s.multiSelectChecked].sort()).toEqual([0, 1]);
	});
});

describe("reduce — multi_confirm", () => {
	it("persists answer + multiSelectChecked from action.selected", () => {
		const ctx = makeCtx({ questions: [makeQuestion({ multiSelect: true })] });
		const r = reduce(makeState(), { kind: "multi_confirm", selected: ["A", "B"] }, ctx);
		expect(r.state.answers.get(0)?.selected).toEqual(["A", "B"]);
		expect([...r.state.multiSelectChecked].sort()).toEqual([0, 1]);
		expect(r.effects.some((e) => e.kind === "done")).toBe(true);
	});
});

describe("reduce — cancel/submit", () => {
	it("cancel emits done with cancelled: true", () => {
		const r = reduce(makeState(), { kind: "cancel" }, makeCtx());
		expect(r.effects).toEqual([{ kind: "done", result: { answers: [], cancelled: true } }]);
	});
	it("submit emits done with cancelled: false", () => {
		const r = reduce(makeState(), { kind: "submit" }, makeCtx());
		expect(r.effects).toEqual([{ kind: "done", result: { answers: [], cancelled: false } }]);
	});
});

describe("reduce — draft_commit (unified free-text)", () => {
	it("empty text clears the draft and strips notes from an existing answer", () => {
		const answers = new Map<number, QuestionAnswer>([
			[0, { questionIndex: 0, question: "Pick one", kind: "option", answer: "A", notes: "old note" }],
		]);
		const state = makeState({ answers, draftByTab: new Map([[0, "old note"]]) });
		const r = reduce(state, { kind: "draft_commit", text: "" }, makeCtx());
		expect(r.state.draftByTab.has(0)).toBe(false);
		expect(r.state.answers.get(0)?.notes).toBeUndefined();
		expect(r.effects).toEqual([]);
	});

	it("whitespace-only text clears the draft and strips notes too", () => {
		const answers = new Map<number, QuestionAnswer>([
			[0, { questionIndex: 0, question: "Pick one", kind: "option", answer: "A", notes: "old note" }],
		]);
		const state = makeState({ answers, draftByTab: new Map([[0, "old note"]]) });
		const r = reduce(state, { kind: "draft_commit", text: "   " }, makeCtx());
		expect(r.state.draftByTab.has(0)).toBe(false);
		expect(r.state.answers.get(0)?.notes).toBeUndefined();
	});

	it("text + existing option answer merges as trimmed notes (supplement), stays in inputMode", () => {
		const answers = new Map<number, QuestionAnswer>([
			[0, { questionIndex: 0, question: "Pick one", kind: "option", answer: "A" }],
		]);
		const state = makeState({ answers, inputMode: true, optionIndex: 2 });
		const r = reduce(state, { kind: "draft_commit", text: "  like A  " }, makeCtx());
		expect(r.state.draftByTab.get(0)).toBe("like A");
		expect(r.state.answers.get(0)).toMatchObject({ kind: "option", answer: "A", notes: "like A" });
		expect(r.state.inputMode).toBe(true);
		expect(r.effects).toEqual([]);
	});

	it("text + checked multi-select merges into the multi answer's notes", () => {
		const ctx = makeCtx({ questions: [makeQuestion({ multiSelect: true })] });
		const toggled = reduce(makeState(), { kind: "toggle", index: 0 }, ctx);
		const r = reduce(toggled.state, { kind: "draft_commit", text: "mostly A" }, ctx);
		expect(r.state.answers.get(0)).toMatchObject({ kind: "multi", selected: ["A"], notes: "mostly A" });
	});

	it("text + no selection commits a custom answer and finishes a single-question dialog", () => {
		const state = makeState({ inputMode: true, optionIndex: 2 });
		const r = reduce(state, { kind: "draft_commit", text: "  my own answer  " }, makeCtx());
		expect(r.state.draftByTab.get(0)).toBe("my own answer");
		expect(r.state.answers.get(0)).toMatchObject({ kind: "custom", answer: "my own answer" });
		expect(r.effects).toEqual([{ kind: "done", result: { answers: [r.state.answers.get(0)!], cancelled: false } }]);
	});

	it("text + no selection on a multi-question dialog commits custom and auto-advances", () => {
		const ctx = makeCtx({ questions: [makeQuestion(), makeQuestion()], itemsByTab: [itemsWithOther, itemsRegular] });
		const state = makeState({ inputMode: true, optionIndex: 2 });
		const r = reduce(state, { kind: "draft_commit", text: "typed", autoAdvanceTab: 1 }, ctx);
		expect(r.state.answers.get(0)).toMatchObject({ kind: "custom", answer: "typed" });
		expect(r.state.currentTab).toBe(1);
	});

	it("re-committing edited text replaces a prior custom answer", () => {
		const answers = new Map<number, QuestionAnswer>([
			[0, { questionIndex: 0, question: "Pick one", kind: "custom", answer: "first" }],
		]);
		const state = makeState({ answers, inputMode: true, optionIndex: 2 });
		const r = reduce(state, { kind: "draft_commit", text: "second" }, makeCtx());
		expect(r.state.answers.get(0)).toMatchObject({ kind: "custom", answer: "second" });
	});
});

describe("reduce — submit_nav / ignore", () => {
	it("submit_nav updates submitChoiceIndex with no effects", () => {
		const r = reduce(makeState(), { kind: "submit_nav", nextIndex: 1 }, makeCtx());
		expect(r.state.submitChoiceIndex).toBe(1);
		expect(r.effects).toEqual([]);
	});

	it("ignore is identity (state unchanged, no effects)", () => {
		const s = makeState({ optionIndex: 2 });
		const r = reduce(s, { kind: "ignore" }, makeCtx());
		expect(r.state).toEqual(s);
		expect(r.effects).toEqual([]);
	});
});

describe("confirmHandler — multi-select draft coexistence (merged free-text)", () => {
	const multiQ: QuestionData = {
		question: "areas?",
		header: "H",
		multiSelect: true,
		options: [
			{ label: "FE", description: "f" },
			{ label: "BE", description: "b" },
		],
	};

	it("custom confirm on a multi-select tab no longer clears checked rows (old mutual exclusivity removed)", () => {
		const state = makeState({
			currentTab: 0,
			multiSelectChecked: new Set([0, 1]),
		});
		const ctx = makeCtx({ questions: [multiQ] });
		const result = reduce(
			state,
			{ kind: "confirm", answer: { questionIndex: 0, question: "areas?", kind: "custom", answer: "custom-text" } },
			ctx,
		);
		expect(result.state.multiSelectChecked.size).toBe(2);
		expect(result.state.answers.get(0)?.kind).toBe("custom");
	});

	it("option confirm on a single-select tab leaves multiSelectChecked untouched (no spurious clear)", () => {
		const singleQ: QuestionData = { question: "pick?", header: "H", options: [{ label: "A", description: "a" }] };
		const state = makeState({ currentTab: 0, multiSelectChecked: new Set([0]) });
		const ctx = makeCtx({ questions: [singleQ] });
		const result = reduce(
			state,
			{ kind: "confirm", answer: { questionIndex: 0, question: "pick?", kind: "option", answer: "A" } },
			ctx,
		);
		expect(result.state.multiSelectChecked.size).toBe(1);
	});
});

describe("reduce — toggle_collapsed", () => {
	it("flips false → true and emits set_overlay_hidden(true) so the runtime hides the overlay", () => {
		const r = reduce(makeState(), { kind: "toggle_collapsed" }, makeCtx());
		expect(r.state.collapsed).toBe(true);
		expect(r.effects).toEqual([{ kind: "set_overlay_hidden", hidden: true }]);
	});

	it("flips true → false (expand round-trip) and emits set_overlay_hidden(false)", () => {
		const r = reduce(makeState({ collapsed: true }), { kind: "toggle_collapsed" }, makeCtx());
		expect(r.state.collapsed).toBe(false);
		expect(r.effects).toEqual([{ kind: "set_overlay_hidden", hidden: false }]);
	});

	it("preserves orthogonal fields — collapse is a pure render-mode flip, never touches answers/optionIndex/drafts", () => {
		// Regression guard: a future refactor that resets nav/drafts on collapse would silently
		// drop the user's mid-edit work. The collapse toggle must be additive only.
		const answers = new Map<QuestionAnswer["questionIndex"], QuestionAnswer>([
			[0, { questionIndex: 0, question: "Pick one", kind: "option", answer: "A" }],
		]);
		const s = makeState({ optionIndex: 1, draftByTab: new Map([[0, "in-flight"]]), answers });
		const r = reduce(s, { kind: "toggle_collapsed" }, makeCtx());
		expect(r.state.collapsed).toBe(true);
		expect(r.state.optionIndex).toBe(1);
		expect(r.state.draftByTab.get(0)).toBe("in-flight");
		expect(r.state.answers).toBe(answers);
		expect(r.effects).toEqual([{ kind: "set_overlay_hidden", hidden: true }]);
	});
});

describe("reduce — cancel guard", () => {
	it("arm_cancel sets cancelArmed and emits no effects", () => {
		const r = reduce(makeState(), { kind: "arm_cancel" }, makeCtx());
		expect(r.state.cancelArmed).toBe(true);
		expect(r.effects).toEqual([]);
	});

	it("cancel itself never disarms (final Esc commits)", () => {
		const r = reduce(makeState({ cancelArmed: true }), { kind: "cancel" }, makeCtx());
		expect(r.effects).toEqual([{ kind: "done", result: { answers: [], cancelled: true } }]);
	});

	it("any progress action disarms a pending cancel (nav)", () => {
		const s = makeState({ cancelArmed: true });
		const r = reduce(s, { kind: "nav", nextIndex: 1 }, makeCtx());
		expect(r.state.cancelArmed).toBe(false);
	});

	it("typing (ignore fast path) disarms a pending cancel", () => {
		const r = reduce(makeState({ cancelArmed: true }), { kind: "ignore" }, makeCtx());
		expect(r.state.cancelArmed).toBe(false);
		expect(r.effects).toEqual([]);
	});

	it("toggle disarms and keeps the toggle effect", () => {
		const r = reduce(makeState({ cancelArmed: true }), { kind: "toggle", index: 0 }, makeCtx());
		expect(r.state.cancelArmed).toBe(false);
		expect(r.state.multiSelectChecked.has(0)).toBe(true);
	});
});
