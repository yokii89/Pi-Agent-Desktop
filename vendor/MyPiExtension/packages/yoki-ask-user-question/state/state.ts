import type { QuestionAnswer, QuestionData } from "../tool/types.ts";
import type { WrappingSelectItem } from "../view/components/wrapping-select.ts";

/**
 * Canonical state for the questionnaire dialog. Single source of truth — both the
 * dispatcher (`routeKey`) and the view layer read this same shape.
 */
export interface QuestionnaireState {
	currentTab: number;
	optionIndex: number;
	inputMode: boolean;
	answers: ReadonlyMap<number, QuestionAnswer>;
	multiSelectChecked: ReadonlySet<number>;
	/**
	 * Unified per-question free-text draft, keyed by tab index — the ONE free-text channel
	 * of the merged design (former "Type something." custom answer + notes side-band).
	 * Interpretation is decided by selection state: saved alongside a selection it merges
	 * into that answer as `notes` (supplement); saved with no selection it commits a
	 * `kind: "custom"` answer. Empty Enter clears the entry (and strips `notes` from an
	 * existing answer) instead of committing.
	 */
	draftByTab: ReadonlyMap<number, string>;
	/** Focused row in the Submit-tab picker (0 = Submit, 1 = Cancel). Reset on tab switch. */
	submitChoiceIndex: number;
	/**
	 * Collapsed mode: the questionnaire shrinks to a single hint row so the agent transcript
	 * behind the bottom-anchored overlay becomes readable. Toggled by `Ctrl+]` from any state;
	 * while true, every keystroke except cancel is swallowed (see `routeKey`). The overlay
	 * stays focused so the expand key never falls through to an underlying overlay — that
	 * focus-restore property is the entire reason we render a collapsed row instead of
	 * calling `OverlayHandle.setHidden(true)`.
	 */
	collapsed: boolean;
	/**
	 * Cancel guard: true after the first Esc when the dialog holds user work
	 * (answers, drafts, or in-flight custom text). A second Esc then confirms the
	 * cancel; any other action disarms. When no work exists, Esc cancels directly.
	 */
	cancelArmed: boolean;
}

/**
 * Per-tick context the dispatcher needs alongside canonical state. Held separately
 * because `keybindings` / `inputBuffer` must never reach view setProps consumers.
 */
export interface QuestionnaireRuntime {
	keybindings: { matches(data: string, name: string): boolean };
	inputBuffer: string;
	questions: readonly QuestionData[];
	isMulti: boolean;
	currentItem: WrappingSelectItem | undefined;
	items: readonly WrappingSelectItem[];
	/**
	 * Key spec for the collapse/expand shortcut, e.g. `"ctrl+]"` or `"alt+o"`. Resolved
	 * from `AskUserQuestionConfig.collapseKey` (or the package default). When `"off"`,
	 * the collapse shortcut is disabled.
	 */
	collapseKey: string;
}
