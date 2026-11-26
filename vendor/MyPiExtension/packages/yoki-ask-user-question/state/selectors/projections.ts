import { MULTI_SUBMIT_LABEL, type MultiSelectViewProps } from "../../view/components/multi-select-view.ts";
import type { OptionListViewProps } from "../../view/components/option-list-view.ts";
import type { SubmitPickerProps } from "../../view/components/submit-picker.ts";
import type { TabBarProps } from "../../view/components/tab-bar.ts";
import type { DialogProps } from "../../view/dialog-builder.ts";
import { LABELS_BY_KIND } from "../row-intent.ts";
import type { GlobalSelector, PerTabSelector } from "./contract.ts";
import { selectConfirmedIndicator } from "./derivations.ts";

export const selectMultiSelectProps: PerTabSelector<MultiSelectViewProps> = (state, ctx) => {
	const question = ctx.questions[ctx.i];
	if (!question) {
		return {
			rows: [],
			other: {
				active: false,
				inputMode: false,
				inputBuffer: ctx.inputBuffer,
				inputCursorOffset: ctx.inputCursorOffset,
			},
			nextActive: false,
			nextLabel: LABELS_BY_KIND.next,
		};
	}
	const focused = ctx.activeView === "options";
	const rows: { checked: boolean; active: boolean }[] = [];
	for (let i = 0; i < question.options.length; i++) {
		rows.push({
			checked: state.multiSelectChecked.has(i),
			active: focused && i === state.optionIndex,
		});
	}
	const otherActive = focused && state.optionIndex === question.options.length;
	const nextActive = focused && state.optionIndex === question.options.length + 1;
	const isLastQuestion = ctx.i === ctx.questions.length - 1;
	const nextLabel = isLastQuestion ? MULTI_SUBMIT_LABEL : LABELS_BY_KIND.next;
	return {
		rows,
		other: {
			active: otherActive,
			inputMode: state.inputMode,
			inputBuffer: ctx.inputBuffer,
			inputCursorOffset: ctx.inputCursorOffset,
		},
		nextActive,
		nextLabel,
	};
};

export const selectOptionListProps: PerTabSelector<OptionListViewProps> = (state, ctx) => {
	const items = ctx.itemsByTab[ctx.i] ?? [];
	const focused = ctx.activeView === "options";
	const confirmed = selectConfirmedIndicator(ctx.questions, state.currentTab, state.answers, items);
	const draft = state.draftByTab.get(ctx.i);
	return {
		selectedIndex: state.optionIndex,
		focused,
		inputBuffer: ctx.inputBuffer,
		inputCursorOffset: ctx.inputCursorOffset,
		...(confirmed ? { confirmed } : {}),
		...(draft ? { draft } : {}),
	};
};

export const selectSubmitPickerProps: GlobalSelector<SubmitPickerProps> = (state, ctx) => {
	const focused = ctx.activeView === "submit";
	return {
		rows: [
			{ active: focused && state.submitChoiceIndex === 0 },
			{ active: focused && state.submitChoiceIndex === 1 },
		],
	};
};

export const selectTabBarProps: GlobalSelector<TabBarProps> = (state, ctx) => {
	const tabs = ctx.questions.map((q, i) => ({
		label: q.header && q.header.length > 0 ? q.header : `Q${i + 1}`,
		answered: state.answers.has(i),
		active: i === state.currentTab,
	}));
	return {
		tabs,
		submit: {
			active: state.currentTab === ctx.questions.length,
			allAnswered: state.answers.size === ctx.questions.length && ctx.questions.length > 0,
		},
	};
};

export const selectDialogProps: GlobalSelector<DialogProps> = (state) => ({
	state,
});
