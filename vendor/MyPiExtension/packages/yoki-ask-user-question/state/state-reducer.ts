import type { QuestionAnswer, QuestionData, QuestionnaireResult } from "../tool/types.ts";
import type { WrappingSelectItem } from "../view/components/wrapping-select.ts";
import type { QuestionnaireAction } from "./key-router.ts";
import { ROW_INTENT_META } from "./row-intent.ts";
import type { QuestionnaireState } from "./state.ts";

/** Session-lifetime constants. No live-component reads — peripheral values live on canonical state. */
export interface ApplyContext {
	questions: readonly QuestionData[];
	itemsByTab: ReadonlyArray<readonly WrappingSelectItem[]>;
}

/**
 * Declarative side-effects emitted by `reduce`. The runtime executes them after
 * committing the new state, then asks the props-adapter to re-project. Closed set —
 * adding an effect requires updating both the union AND the runtime's `runEffect` switch
 * (compiler-enforced exhaustive). No string-keyed escape hatch.
 */
export type Effect =
	| { kind: "set_input_buffer"; value: string }
	| { kind: "clear_input_buffer" }
	/**
	 * Tell the session to hide or show its underlying overlay. Emitted by the
	 * `toggle_collapsed` action so the runtime can call `OverlayHandle.setHidden(...)`,
	 * which lets other overlay-aware consumers (e.g. `pi-station`) see the questionnaire
	 * as truly hidden and resume normal chat scroll while the user reads the transcript
	 * behind the modal.
	 */
	| { kind: "set_overlay_hidden"; hidden: boolean }
	| { kind: "done"; result: QuestionnaireResult };

export interface ApplyResult {
	state: QuestionnaireState;
	effects: readonly Effect[];
}

function orderedAnswers(state: QuestionnaireState, questions: readonly QuestionData[]): QuestionAnswer[] {
	const out: QuestionAnswer[] = [];
	for (let i = 0; i < questions.length; i++) {
		const a = state.answers.get(i);
		if (a) out.push(a);
	}
	return out;
}

function syncMultiSelectFromAnswers(
	answers: ReadonlyMap<number, QuestionAnswer>,
	questions: readonly QuestionData[],
	tab: number,
): ReadonlySet<number> {
	const q = questions[tab];
	if (!q?.multiSelect) return new Set();
	const saved = answers.get(tab);
	const labels = saved?.selected ?? [];
	const indices = new Set<number>();
	for (let i = 0; i < q.options.length; i++) {
		if (labels.includes(q.options[i]!.label)) indices.add(i);
	}
	return indices;
}

function persistMultiSelectAnswer(state: QuestionnaireState, ctx: ApplyContext): ReadonlyMap<number, QuestionAnswer> {
	const q = ctx.questions[state.currentTab];
	if (!q?.multiSelect) return state.answers;
	const selected: string[] = [];
	for (let i = 0; i < q.options.length; i++) {
		if (state.multiSelectChecked.has(i)) selected.push(q.options[i]!.label);
	}
	const out = new Map(state.answers);
	if (selected.length === 0) {
		out.delete(state.currentTab);
		return out;
	}
	const draft = state.draftByTab.get(state.currentTab);
	out.set(state.currentTab, {
		questionIndex: state.currentTab,
		question: q.question,
		kind: "multi",
		answer: null,
		selected,
		...(draft && draft.trim().length > 0 ? { notes: draft.trim() } : {}),
	});
	return out;
}

function switchTabResult(state: QuestionnaireState, nextTab: number, ctx: ApplyContext): ApplyResult {
	const transitioned: QuestionnaireState = {
		...state,
		currentTab: nextTab,
		optionIndex: 0,
		inputMode: false,
		submitChoiceIndex: 0,
		multiSelectChecked: syncMultiSelectFromAnswers(state.answers, ctx.questions, nextTab),
	};
	// Fresh buffer per tab — re-entering the "Type something." row rehydrates from
	// `draftByTab` via `navHandler`. Also fixes the historical leak where uncommitted
	// text survived a Tab switch into the next tab's row.
	return {
		state: transitioned,
		effects: [{ kind: "clear_input_buffer" }],
	};
}

function doneFor(state: QuestionnaireState, ctx: ApplyContext, cancelled: boolean): ApplyResult {
	const result: QuestionnaireResult = { answers: orderedAnswers(state, ctx.questions), cancelled };
	return { state, effects: [{ kind: "done", result }] };
}

/**
 * Per-kind handler signature: action payload narrows to the matching union member
 * via `Extract`, so handlers consume fully-typed actions without `as` casts.
 */
type Handler<K extends QuestionnaireAction["kind"]> = (
	state: QuestionnaireState,
	action: Extract<QuestionnaireAction, { kind: K }>,
	ctx: ApplyContext,
) => ApplyResult;

const navHandler: Handler<"nav"> = (state, action, ctx) => {
	const items = ctx.itemsByTab[state.currentTab] ?? [];
	const item = items[action.nextIndex];
	const inputMode = item ? ROW_INTENT_META[item.kind].activatesInputMode : false;
	const next = { ...state, optionIndex: action.nextIndex, inputMode };
	if (!inputMode) {
		return { state: next, effects: [{ kind: "clear_input_buffer" }] };
	}
	// Re-entering the "Type something." row rehydrates the buffer from the saved draft
	// first; a committed custom answer (no draft) rehydrates its text so the user can
	// edit and re-commit.
	const draft = state.draftByTab.get(state.currentTab);
	if (draft !== undefined) {
		return { state: next, effects: [{ kind: "set_input_buffer", value: draft }] };
	}
	const prior = state.answers.get(state.currentTab);
	if (prior?.kind === "custom" && typeof prior.answer === "string") {
		return { state: next, effects: [{ kind: "set_input_buffer", value: prior.answer }] };
	}
	return { state: next, effects: [] };
};

const tabSwitchHandler: Handler<"tab_switch"> = (state, action, ctx) => switchTabResult(state, action.nextTab, ctx);

const confirmHandler: Handler<"confirm"> = (state, action, ctx) => {
	// Unified draft merge: text saved on the "Type something." row before confirming an
	// option travels with the answer as its supplement. The draft is NOT deleted — it
	// rehydrates on row re-entry and re-merging is idempotent.
	const draft = state.draftByTab.get(action.answer.questionIndex);
	const trimmed = draft?.trim();
	const answer = trimmed && trimmed.length > 0 ? { ...action.answer, notes: trimmed } : action.answer;
	const answers = new Map(state.answers);
	answers.set(answer.questionIndex, answer);
	const next: QuestionnaireState = { ...state, answers };
	if (action.autoAdvanceTab !== undefined) return switchTabResult(next, action.autoAdvanceTab, ctx);
	return doneFor(next, ctx, false);
};

const toggleHandler: Handler<"toggle"> = (state, action, ctx) => {
	const checked = new Set(state.multiSelectChecked);
	if (checked.has(action.index)) checked.delete(action.index);
	else checked.add(action.index);
	const intermediate: QuestionnaireState = { ...state, multiSelectChecked: checked };
	const answers = persistMultiSelectAnswer(intermediate, ctx);
	return { state: { ...intermediate, answers }, effects: [] };
};

const multiConfirmHandler: Handler<"multi_confirm"> = (state, action, ctx) => {
	const q = ctx.questions[state.currentTab];
	if (!q) return { state, effects: [] };
	const draft = state.draftByTab.get(state.currentTab)?.trim();
	const answers = new Map(state.answers);
	answers.set(state.currentTab, {
		questionIndex: state.currentTab,
		question: q.question,
		kind: "multi",
		answer: null,
		selected: action.selected,
		...(draft && draft.length > 0 ? { notes: draft } : {}),
	});
	const synced: QuestionnaireState = {
		...state,
		answers,
		multiSelectChecked: syncMultiSelectFromAnswers(answers, ctx.questions, state.currentTab),
	};
	if (action.autoAdvanceTab !== undefined) return switchTabResult(synced, action.autoAdvanceTab, ctx);
	return doneFor(synced, ctx, false);
};

/**
 * Enter on the focused "Type something." row (inputMode) — the ONE free-text commit of
 * the merged design. The reducer decides by selection state:
 * - empty text → clear: drop the draft entry and strip `notes` from an existing answer
 *   (previously the empty commit produced a `"(no input)"` custom answer — intentionally
 *   dropped; an empty field now means "no free text").
 * - text + selection present → save the draft and merge it into the answer's `notes`
 *   (supplement). Stays in inputMode so the user can keep editing.
 * - text + no selection → save the draft and commit a `kind: "custom"` answer
 *   (single-question dialogs finish, multi-question dialogs auto-advance).
 * Saving BEFORE a later selection makes the supplement order-independent: the option /
 * multi confirm handlers merge the same draft entry.
 */
const draftCommitHandler: Handler<"draft_commit"> = (state, action, ctx) => {
	const trimmed = action.text.trim();
	const tab = state.currentTab;
	const draft = new Map(state.draftByTab);
	const answers = new Map(state.answers);
	if (trimmed.length === 0) {
		draft.delete(tab);
		const prev = answers.get(tab);
		if (prev?.notes) {
			const stripped = { ...prev };
			delete (stripped as { notes?: string }).notes;
			answers.set(tab, stripped);
		}
		return { state: { ...state, draftByTab: draft, answers }, effects: [] };
	}
	draft.set(tab, trimmed);
	const q = ctx.questions[tab];
	const existing = answers.get(tab);
	const hasSelection =
		existing?.kind === "option" ||
		existing?.kind === "multi" ||
		(q?.multiSelect === true && state.multiSelectChecked.size > 0);
	if (existing && hasSelection) {
		answers.set(tab, { ...existing, notes: trimmed });
		return { state: { ...state, draftByTab: draft, answers }, effects: [] };
	}
	const answer: QuestionAnswer = {
		questionIndex: tab,
		question: q.question,
		kind: "custom",
		answer: trimmed,
	};
	answers.set(tab, answer);
	const next: QuestionnaireState = { ...state, draftByTab: draft, answers };
	if (action.autoAdvanceTab !== undefined) return switchTabResult(next, action.autoAdvanceTab, ctx);
	return doneFor(next, ctx, false);
};

const cancelHandler: Handler<"cancel"> = (s, _a, c) => doneFor(s, c, true);
const submitHandler: Handler<"submit"> = (s, _a, c) => doneFor(s, c, false);
const submitNavHandler: Handler<"submit_nav"> = (s, a, _c) => ({
	state: { ...s, submitChoiceIndex: a.nextIndex },
	effects: [],
});
const toggleCollapsedHandler: Handler<"toggle_collapsed"> = (s, _a, _c) => ({
	state: { ...s, collapsed: !s.collapsed },
	effects: [{ kind: "set_overlay_hidden", hidden: !s.collapsed }],
});
const armCancelHandler: Handler<"arm_cancel"> = (s, _a, _c) => ({
	state: { ...s, cancelArmed: true },
	effects: [],
});
const ignoreHandler: Handler<"ignore"> = (s, _a, _c) => ({ state: s, effects: [] });

/**
 * Compile-time-exhaustive dispatch table. `{ [K in Kind]: Handler<K> }` requires
 * an entry per union member — adding a new `QuestionnaireAction` variant fails to
 * compile here until a handler is registered, mirroring the `Record<RowKind, …>`
 * pattern used by `ROW_INTENT_META`.
 */
const HANDLERS: { [K in QuestionnaireAction["kind"]]: Handler<K> } = {
	nav: navHandler,
	tab_switch: tabSwitchHandler,
	confirm: confirmHandler,
	toggle: toggleHandler,
	multi_confirm: multiConfirmHandler,
	cancel: cancelHandler,
	draft_commit: draftCommitHandler,
	submit: submitHandler,
	submit_nav: submitNavHandler,
	toggle_collapsed: toggleCollapsedHandler,
	arm_cancel: armCancelHandler,
	ignore: ignoreHandler,
};

/**
 * Pure reducer: (state, action, ctx) → (state, Effect[]). Mirrors `yoki-todo`'s `applyTaskMutation`.
 * Delegates to `HANDLERS` — per-kind handlers above are pure, named, and individually testable.
 * `ignore` is also handled outside the reducer by `handleIgnoreInline` in the runtime fast path.
 *
 * Cancel-guard disarm: any action other than `cancel` / `arm_cancel` itself counts as
 * "the user kept working", so a pending armed cancel clears. `ignore` disarms too — it is
 * reached via the session fast path only under `inputMode` (typing), which is exactly the
 * work the guard protects.
 */
export function reduce(state: QuestionnaireState, action: QuestionnaireAction, ctx: ApplyContext): ApplyResult {
	const handler = HANDLERS[action.kind] as Handler<typeof action.kind>;
	const result = handler(state, action as never, ctx);
	if (state.cancelArmed && action.kind !== "cancel" && action.kind !== "arm_cancel" && result.state.cancelArmed) {
		return { ...result, state: { ...result.state, cancelArmed: false } };
	}
	return result;
}
