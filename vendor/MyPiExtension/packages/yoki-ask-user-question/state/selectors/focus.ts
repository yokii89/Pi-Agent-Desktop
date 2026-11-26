import type { ActiveView } from "../../view/stateful-view.ts";

/**
 * Discriminated focus selector — single source of truth for "which view owns
 * focus this tick?" Priority order matches the dispatcher cascade
 * (`key-router.ts`).
 *
 * Priority: submit > options.
 */
export function selectActiveView(state: { currentTab: number }, totalQuestions: number): ActiveView {
	if (state.currentTab === totalQuestions) return "submit";
	return "options";
}
