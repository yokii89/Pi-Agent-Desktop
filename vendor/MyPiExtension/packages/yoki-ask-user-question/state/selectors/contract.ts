import type { QuestionData } from "../../tool/types.ts";
import type { WrappingSelectItem } from "../../view/components/wrapping-select.ts";
import type { ActiveView } from "../../view/stateful-view.ts";
import type { TabComponents } from "../../view/tab-components.ts";
import type { QuestionnaireState } from "../state.ts";

export interface BindingContext {
	readonly questions: readonly QuestionData[];
	readonly itemsByTab: ReadonlyArray<readonly WrappingSelectItem[]>;
	readonly totalQuestions: number;
	readonly activeView: ActiveView;
	readonly inputBuffer: string;
	readonly inputCursorOffset: number | undefined;
}

export interface PerTabBindingContext extends BindingContext {
	readonly tab: TabComponents;
	readonly i: number;
}

export type GlobalSelector<P> = (state: QuestionnaireState, ctx: BindingContext) => P;
export type PerTabSelector<P> = (state: QuestionnaireState, ctx: PerTabBindingContext) => P;
