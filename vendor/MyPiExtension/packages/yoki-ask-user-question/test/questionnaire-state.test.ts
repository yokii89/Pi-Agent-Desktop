import { describe, expect, it } from "vitest";
import { selectActiveTabIndex, selectConfirmedIndicator } from "../state/selectors/derivations.ts";
import { selectActiveView } from "../state/selectors/focus.ts";
import type { QuestionAnswer, QuestionData } from "../tool/types.ts";
import type { WrappingSelectItem } from "../view/components/wrapping-select.ts";

function q(over: Partial<QuestionData> = {}): QuestionData {
	return {
		question: over.question ?? "Pick one",
		header: over.header ?? "H",
		options: over.options ?? [
			{ label: "A", description: "a" },
			{ label: "B", description: "b" },
		],
		multiSelect: over.multiSelect,
	};
}

const itemsRegular: WrappingSelectItem[] = [
	{ kind: "option", label: "A" },
	{ kind: "option", label: "B" },
];
const itemsWithOther: WrappingSelectItem[] = [
	{ kind: "option", label: "A" },
	{ kind: "option", label: "B" },
	{ kind: "other", label: "Type something." },
];

describe("selectConfirmedIndicator", () => {
	it("returns undefined when the question is multiSelect", () => {
		const answers = new Map<number, QuestionAnswer>([
			[0, { questionIndex: 0, question: "q", kind: "option", answer: "A" }],
		]);
		expect(selectConfirmedIndicator([q({ multiSelect: true })], 0, answers, itemsRegular)).toBeUndefined();
	});

	it("returns undefined when there is no prior answer for the tab", () => {
		expect(selectConfirmedIndicator([q()], 0, new Map(), itemsRegular)).toBeUndefined();
	});

	it("returns the kind:'other' index + labelOverride when the prior answer was kind:'custom'", () => {
		const answers = new Map<number, QuestionAnswer>([
			[0, { questionIndex: 0, question: "q", kind: "custom", answer: "Hello" }],
		]);
		expect(selectConfirmedIndicator([q()], 0, answers, itemsWithOther)).toEqual({ index: 2, labelOverride: "Hello" });
	});

	it("returns undefined when kind:'custom' but the items array has no kind:'other' row", () => {
		const answers = new Map<number, QuestionAnswer>([
			[0, { questionIndex: 0, question: "q", kind: "custom", answer: "Hello" }],
		]);
		expect(selectConfirmedIndicator([q()], 0, answers, itemsRegular)).toBeUndefined();
	});

	it("returns the matching index for a regular label answer", () => {
		const answers = new Map<number, QuestionAnswer>([
			[0, { questionIndex: 0, question: "q", kind: "option", answer: "B" }],
		]);
		expect(selectConfirmedIndicator([q()], 0, answers, itemsRegular)).toEqual({ index: 1 });
	});

	it("returns undefined when the prior label matches no row (defensive)", () => {
		const answers = new Map<number, QuestionAnswer>([
			[0, { questionIndex: 0, question: "q", kind: "option", answer: "ZZ" }],
		]);
		expect(selectConfirmedIndicator([q()], 0, answers, itemsRegular)).toBeUndefined();
	});
});

describe("selectActiveTabIndex", () => {
	it("returns currentTab when within range", () => {
		expect(selectActiveTabIndex(1, 3)).toBe(1);
	});
	it("clamps to the last question index when on the Submit tab", () => {
		expect(selectActiveTabIndex(3, 3)).toBe(2);
	});
	it("returns 0 when totalQuestions is 0 (defensive)", () => {
		expect(selectActiveTabIndex(0, 0)).toBe(0);
	});
});

describe("selectActiveView", () => {
	it("returns 'submit' when currentTab equals totalQuestions", () => {
		expect(selectActiveView({ currentTab: 2 }, 2)).toBe("submit");
	});
	it("returns 'options' as the default", () => {
		expect(selectActiveView({ currentTab: 0 }, 2)).toBe("options");
	});
});

describe("selectConfirmedIndicator — kind matrix", () => {
	const items: WrappingSelectItem[] = [
		{ kind: "option", label: "A" },
		{ kind: "other", label: "Type something." },
	];
	const questions = [q({ options: [{ label: "A", description: "a" }] })];

	it("returns the kind:'other' index + labelOverride when prior was kind:'custom'", () => {
		const answers = new Map<number, QuestionAnswer>([
			[0, { questionIndex: 0, question: "q", kind: "custom", answer: "Hello" }],
		]);
		expect(selectConfirmedIndicator(questions, 0, answers, items)).toEqual({ index: 1, labelOverride: "Hello" });
	});
});
