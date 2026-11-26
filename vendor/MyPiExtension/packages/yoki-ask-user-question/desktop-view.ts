/**
 * Desktop (PiDesk) view path for ask_user_question.
 *
 * Uses the extension View protocol via @pidesk/view-sdk. When PiDesk injects
 * PIDESK_VIEW_* / PI_VIEW_* into the pi process, this module presents a
 * floating widget above the task composer (same family as the @-mention menu)
 * instead of the terminal TUI overlay or a modal.
 *
 * Multi-question dialogs render one `tabs` node: one tab per question plus a
 * final review tab (progress line and a per-question answer summary + jump-back
 * buttons). A single question keeps the flat card column (no tab bar). Host owns
 * local tab switching (click / ←→) and reports it back as a `tab:<id>` action;
 * when the Host is too old to send that, the visible tab is inferred from the
 * `q<i>` / `q<i>-custom` nodeId of whatever `change` arrives, since a hidden tab
 * panel cannot be interacted with. Auto-advance fires on a single-select
 * question's unanswered→answered transition while its free-text draft is still
 * empty (text alongside a selection is a supplement: stay and let the footer's
 * 下一题 move on), targeting the next unanswered question (or the review tab).
 * Tab switching is view state and never enters form values.
 *
 * The footer's primary button is the single advance affordance and reads as the
 * next action from the user's point of view: 下一题 (the first unanswered question
 * after the visible tab — same direction rule as auto-advance), 复核 when nothing
 * is left to fill, 提交 on the review tab and in single-question dialogs.
 *
 * Footer actions: 取消（两段式——已有作答/备注时先布防确认）/ 主按钮（随页签态变化）。
 * 复核页不再放页内提交与说明行：Host 把接管落点的首焦点给「面板内第一个可聚焦元素」，
 * footer 在 panel 之外拿不到它，所以复核页的收尾是鼠标动作（拍板于 2026-11-06，
 * 代价是把 05 号文档 G2 的键盘提交路径换成 footer 提交）。
 */

import {
	connectDesktopView,
	type DesktopViewClient,
	type LiveViewSession,
	type ViewAction,
	type ViewListOption,
	type ViewNode,
	type ViewResult,
	type ViewSpec,
	type ViewTab,
} from "@pidesk/view-sdk";
import type { QuestionAnswer, QuestionData, QuestionnaireResult, QuestionParams } from "./tool/types.ts";

const TABS_NODE_ID = "questionnaire-tabs";
const REVIEW_TAB_ID = "review";
const GOTO_ACTION_RE = /^goto:(review|[0-9]+)$/;
/** Host 本地切页（chip / ←→）的回报：actionId 走 `tab:<id>`，不新增协议字段。 */
const TAB_ACTION_RE = /^tab:(review|q[0-9]+)$/;

export interface DesktopViewDeps {
	connect?: typeof connectDesktopView;
}

function optionValue(questionIndex: number, optionIndex: number): string {
	return `opt:${questionIndex}:${optionIndex}`;
}

function customId(questionIndex: number): string {
	return `q${questionIndex}-custom`;
}

function listId(questionIndex: number): string {
	return `q${questionIndex}`;
}

function questionTabId(questionIndex: number): string {
	return `q${questionIndex}`;
}

function gotoQuestionAction(questionIndex: number): string {
	return `goto:${questionIndex}`;
}

function gotoReviewAction(): string {
	return `goto:${REVIEW_TAB_ID}`;
}

/**
 * 页签引用 → 跳转目标。三种写法都要认，因为它们来自两个不同的 id 空间：
 * `review`；`goto:` 族的裸下标（`goto:2`，扩展自己写的按钮 id）；
 * `tab:` 族的页签 id（`tab:q2`，Host 只认识 `ViewTab.id`，也就是 `questionTabId()` 的产物）。
 */
function parseTabRef(raw: string): { review: boolean; questionIndex: number } | null {
	if (raw === REVIEW_TAB_ID) return { review: true, questionIndex: -1 };
	const digits = raw.startsWith("q") ? raw.slice(1) : raw;
	if (/^[0-9]+$/.test(digits)) return { review: false, questionIndex: Number(digits) };
	return null;
}

/** "goto:<i>" / "goto:review" → 跳转目标；其它 actionId 返回 null。 */
function parseGotoAction(actionId: string): { review: boolean; questionIndex: number } | null {
	const m = GOTO_ACTION_RE.exec(actionId);
	return m ? parseTabRef(m[1]) : null;
}

/**
 * "tab:<i>" / "tab:review" → Host 本地切页（chip / ←→）的回报。
 * 切页本身不发事件是 view/v1 的既有语义，这条 action 只在 Host 侧补；老 Host 不发，
 * 扩展退回 `observeTabFromChange`（见 change 分支），所以两边都不需要 capability。
 */
function parseTabAction(actionId: string): { review: boolean; questionIndex: number } | null {
	const m = TAB_ACTION_RE.exec(actionId);
	return m ? parseTabRef(m[1]) : null;
}

/** 跳转目标 → 页签 id；题目下标越界时夹到合法范围，不让 Host 收到 `q7` 这种空页签。 */
function tabIdOf(ref: { review: boolean; questionIndex: number }, total: number): string {
	if (ref.review) return REVIEW_TAB_ID;
	return questionTabId(Math.min(Math.max(ref.questionIndex, 0), total - 1));
}

interface UiState {
	/** list values per question (option value keys or [] for multi) */
	selections: (string | string[])[];
	/**
	 * Unified free-text draft per question (merged "custom answer + supplement" input).
	 * Interpretation is decided at submit time by selection state: text alongside a
	 * selection becomes that answer's `notes`; text with no selection IS the answer.
	 */
	customTexts: string[];
	/** 激活页签：`q<i>` 或 "review"（仅多题 tabs 布局使用） */
	activeTab: string;
	/** 两段式取消：已布防时，下一次「取消」动作才真正关闭 */
	cancelArmed: boolean;
}

function initialState(params: QuestionParams): UiState {
	return {
		selections: params.questions.map((q) => (q.multiSelect ? [] : "")),
		customTexts: params.questions.map(() => ""),
		activeTab: questionTabId(0),
		cancelArmed: false,
	};
}

/** 该题是否已有答案：选项（含多选）或自定义文本任一非空。 */
function isQuestionAnswered(state: UiState, index: number): boolean {
	const selection = state.selections[index];
	if (Array.isArray(selection)) {
		if (selection.length > 0) return true;
	} else if (typeof selection === "string" && selection.length > 0) {
		return true;
	}
	return (state.customTexts[index] ?? "").trim().length > 0;
}

function nextUnansweredAfter(params: QuestionParams, state: UiState, index: number): number | null {
	for (let j = index + 1; j < params.questions.length; j++) {
		if (!isQuestionAnswered(state, j)) return j;
	}
	return null;
}

function hasAnyWork(params: QuestionParams, state: UiState): boolean {
	return params.questions.some((_, i) => isQuestionAnswered(state, i));
}

/** 单题卡片与 tabs 页签共用的内容节点（不含外壳）。推进动作在 footer，页签内不放按钮。 */
function buildQuestionChildren(question: QuestionData, index: number, state: UiState): ViewNode[] {
	const items: ViewListOption[] = question.options.map((o, oi) => ({
		value: optionValue(index, oi),
		label: o.label,
		description: o.description,
	}));
	const selection = state.selections[index];

	const listNode: ViewNode = {
		type: "list",
		id: listId(index),
		items,
		multiple: question.multiSelect === true,
		value: selection,
	};

	const customNode: ViewNode = {
		type: "input",
		id: customId(index),
		label: "自由输入（可选）",
		placeholder: "没有合适选项时直接输入答案；已选选项时作为补充说明返回",
		value: state.customTexts[index] ?? "",
	};

	const children: ViewNode[] = [
		{
			type: "text",
			content: question.question,
			// card 内用 body 而非 heading：heading 在紧凑浮层里层级过重
			variant: "body",
		},
		...(question.multiSelect
			? [{ type: "text" as const, content: "可多选", variant: "caption" as const, tone: "muted" as const }]
			: []),
	];

	children.push(listNode, customNode);

	// 推进控件只在 footer：页签内的 ghost 按钮与 footer 主按钮是同一个动作，两处并存
	// 会让用户分不清哪个是出路；页签内留下的都是「本题答案」相关的节点。
	return children;
}

/** 单题布局（1 个问题）：卡片纵向堆叠，无 tab 条、无复核页。 */
function buildQuestionNode(question: QuestionData, index: number, state: UiState): ViewNode {
	return {
		type: "card",
		title: question.header || `问题 ${index + 1}`,
		children: buildQuestionChildren(question, index, state),
	};
}

/**
 * 复核行主摘要：有选择 → 选项标签（补充文本另示为后缀）；无选择 → 自由输入文本即答案。
 */
function answerSummary(question: QuestionData, state: UiState, index: number): string {
	const selection = state.selections[index];
	if (Array.isArray(selection)) {
		const labels: string[] = [];
		for (const value of selection) {
			const parsed = parseOptionValue(value);
			const label = parsed ? question.options[parsed.optionIndex]?.label : undefined;
			if (typeof label === "string") labels.push(label);
		}
		if (labels.length > 0) return labels.join("、");
	} else if (typeof selection === "string" && selection.length > 0) {
		const parsed = parseOptionValue(selection);
		const label = parsed ? question.options[parsed.optionIndex]?.label : undefined;
		if (typeof label === "string") return label;
	}
	return (state.customTexts[index] ?? "").trim();
}

/** 该题是否已有选项类选择（单选值或多选数组非空）。 */
function hasSelection(state: UiState, index: number): boolean {
	const selection = state.selections[index];
	if (Array.isArray(selection)) return selection.length > 0;
	return typeof selection === "string" && selection.length > 0;
}

/**
 * 复核页：进度行 + 每题一行「题头：答案」+ 跳回按钮；未作答的走 warning 状态色。
 * 允许部分作答。状态词必须写在文案里、不能只靠颜色（docs/design/79 §3.2）：
 * `tone` 没有能力位，旧 Host 丢色后「未作答」仍然读得通。
 *
 * 这里不放提交按钮、也不放说明行：提交出口全仓只有 footer 主按钮一处。
 * 代价已知且已拍板——Host 的接管落点首焦点只看「面板内第一个可聚焦元素」，
 * footer 在 panel 之外，所以答完最后一题落到复核页时 Enter 会触发 q0 的「修改」
 * 而不是提交（05 号文档 G2 的解法随之作废）。要恢复键盘收尾，唯一有效做法是
 * 在 rows 之前重新放一个可聚焦的提交节点，纯排版挪动救不了。
 */
function buildReviewChildren(params: QuestionParams, state: UiState): ViewNode[] {
	const answered = params.questions.filter((_, i) => isQuestionAnswered(state, i)).length;
	const rows: ViewNode[] = params.questions.map((q, i) => {
		const header = q.header || `问题 ${i + 1}`;
		const summary = answerSummary(q, state, i);
		// 有选择 + 自由输入 = 选择答案的补充说明，追加在摘要后一并预览
		const custom = (state.customTexts[i] ?? "").trim();
		const supplement = hasSelection(state, i) && custom.length > 0 ? `（补充：${custom}）` : "";
		return {
			type: "row",
			gap: 8,
			children: [
				{
					type: "text",
					content: summary ? `${header}：${summary}${supplement}` : `${header}：未作答`,
					variant: "body",
					...(summary ? {} : { tone: "warning" as const }),
				},
				{ type: "button", id: gotoQuestionAction(i), label: "修改", variant: "ghost" },
			],
		};
	});
	return [
		{
			type: "text",
			content: `已答 ${answered} / ${params.questions.length}`,
			variant: "body",
		},
		...rows,
	];
}

function buildTree(params: QuestionParams, state: UiState): ViewNode {
	if (params.questions.length <= 1) {
		return {
			type: "column",
			gap: 16,
			children: params.questions.map((q, i) => buildQuestionNode(q, i, state)),
		};
	}

	// 多题：一题一页签 + 复核页；chip 状态 = 已答 ✓ / 未答空心点，复核页
	// 全答完 ✓、有缺 ⚠。所有页签的 children 始终在树里（值不因切页丢失）。
	const tabs: ViewTab[] = params.questions.map((q, i) => ({
		id: questionTabId(i),
		label: q.header || `问题 ${i + 1}`,
		...(isQuestionAnswered(state, i) ? { status: "answered" as const } : {}),
		children: buildQuestionChildren(q, i, state),
	}));
	tabs.push({
		id: REVIEW_TAB_ID,
		label: "复核",
		...(params.questions.every((_, i) => isQuestionAnswered(state, i))
			? { status: "answered" as const }
			: { status: "attention" as const }),
		children: buildReviewChildren(params, state),
	});
	return { type: "tabs", id: TABS_NODE_ID, tabs, activeTab: state.activeTab };
}

const SUBMIT_ACTION: ViewAction = { id: "submit", label: "提交", kind: "submit", variant: "primary" };

/**
 * footer 主按钮 = 「此刻的下一步」，也是全仓唯一的推进出口：
 * - 单题布局、复核页 → 提交；
 * - 题目页签且**后面**还有未答题 → 「下一题」跳下一个未答题（与自动前进同口径，不环绕，
 *   因此不会出现「当前题是唯一未答时点了不动」）；
 * - 题目页签且后面没有可补的题 → 「复核」，缺答信息由复核页的「未作答」行承担。
 *
 * 起点用 `state.activeTab`，而它已被「change 的 nodeId 反推」和 Host 的 `tab:` 回报
 * 校准过，所以按钮目标对齐的是画面上那一页，不是扩展自己那本旧账。
 */
function footerPrimaryAction(params: QuestionParams, state: UiState): ViewAction {
	const total = params.questions.length;
	if (total <= 1 || state.activeTab === REVIEW_TAB_ID) return SUBMIT_ACTION;
	const match = /^q([0-9]+)$/.exec(state.activeTab);
	if (!match) return SUBMIT_ACTION;
	const index = Number(match[1]);
	if (index >= total) return SUBMIT_ACTION;
	const next = nextUnansweredAfter(params, state, index);
	return next === null
		? { id: gotoReviewAction(), label: "复核", kind: "submit", variant: "primary" }
		: { id: gotoQuestionAction(next), label: "下一题", kind: "submit", variant: "primary" };
}

function buildActions(params: QuestionParams, state: UiState): ViewAction[] {
	return [
		{
			id: "cancel",
			label: state.cancelArmed ? "再按一次确认取消" : "取消",
			kind: "submit",
			variant: state.cancelArmed ? "danger" : "ghost",
		},
		footerPrimaryAction(params, state),
	];
}

function buildSpec(params: QuestionParams, state: UiState): ViewSpec {
	return {
		title: "回答问题",
		// 贴输入栏上方的浮层（对齐 @ 菜单）；Host 不支持 widget 时直接 error 而不是 modal，
		// 避免问卷被塞进居中模态、与「输入栏上方」的产品意图偏离。
		placement: "widget",
		placementRequired: true,
		placementHint: { side: "aboveEditor", floating: true },
		root: buildTree(params, state),
		actions: buildActions(params, state),
	};
}

function parseOptionValue(value: string): { questionIndex: number; optionIndex: number } | null {
	const m = /^opt:(\d+):(\d+)$/.exec(value);
	if (!m) return null;
	return { questionIndex: Number(m[1]), optionIndex: Number(m[2]) };
}

/** change 涉及的题号；不属于任何题控件时返回 null。 */
function questionIndexForNode(params: QuestionParams, nodeId: string): number | null {
	for (let i = 0; i < params.questions.length; i++) {
		if (nodeId === listId(i) || nodeId === customId(i)) return i;
	}
	return null;
}

/**
 * 写入一个题控件的值（选项列表 / 统一自由输入），返回命中的题号；非题控件返回 null。
 * 返回值同时是「用户此刻在哪一页」的证据：隐藏页签的面板 `display:none`，
 * 点不到也 Tab 不进去，所以 change 的 nodeId 自带题号就能校准 `activeTab`（档 1）。
 */
function applyChange(state: UiState, params: QuestionParams, nodeId: string, value: unknown): number | null {
	for (let i = 0; i < params.questions.length; i++) {
		if (nodeId === listId(i)) {
			if (params.questions[i].multiSelect) {
				const arr = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
				state.selections[i] = arr;
			} else {
				state.selections[i] = typeof value === "string" ? value : "";
			}
			return i;
		}
		if (nodeId === customId(i)) {
			state.customTexts[i] = typeof value === "string" ? value : "";
			return i;
		}
	}
	return null;
}

/** action 携带的表单快照 → 逐控件写入。Host 的 sendAction 会先 flush 未落盘的 change。 */
function adoptFormValues(state: UiState, params: QuestionParams, values: Record<string, unknown> | undefined): void {
	if (!values) return;
	for (const [nodeId, value] of Object.entries(values)) {
		applyChange(state, params, nodeId, value);
	}
}

/**
 * 统一自由输入的提交映射：有选择 → 选择答案 + `notes: 文本`（补充）；无选择 + 文本 →
 * custom 答案；两者皆无 → 整题跳过。（合并前 custom 文本无条件压过选择。）
 */
function buildAnswers(params: QuestionParams, values: Record<string, unknown>): QuestionAnswer[] {
	const answers: QuestionAnswer[] = [];
	for (let i = 0; i < params.questions.length; i++) {
		const q = params.questions[i];
		const customRaw = values[customId(i)];
		const draft = typeof customRaw === "string" ? customRaw.trim() : "";
		const supplement = draft.length > 0 ? draft : undefined;

		if (q.multiSelect) {
			const raw = values[listId(i)];
			const selectedValues = Array.isArray(raw)
				? raw.filter((v): v is string => typeof v === "string")
				: typeof raw === "string" && raw
					? [raw]
					: [];
			const selected: string[] = [];
			for (const v of selectedValues) {
				const parsed = parseOptionValue(v);
				if (parsed && q.options[parsed.optionIndex]) {
					selected.push(q.options[parsed.optionIndex].label);
				}
			}
			if (selected.length > 0) {
				answers.push({
					questionIndex: i,
					question: q.question,
					kind: "multi",
					answer: null,
					selected,
					...(supplement ? { notes: supplement } : {}),
				});
				continue;
			}
			if (draft.length > 0) {
				answers.push({
					questionIndex: i,
					question: q.question,
					kind: "custom",
					answer: draft,
				});
			}
			continue;
		}

		const raw = values[listId(i)];
		const selectedValue = typeof raw === "string" ? raw : "";
		const parsed = parseOptionValue(selectedValue);
		if (parsed && q.options[parsed.optionIndex]) {
			const option = q.options[parsed.optionIndex];
			answers.push({
				questionIndex: i,
				question: q.question,
				kind: "option",
				answer: option.label,
				...(supplement ? { notes: supplement } : {}),
			});
			continue;
		}
		if (draft.length > 0) {
			answers.push({
				questionIndex: i,
				question: q.question,
				kind: "custom",
				answer: draft,
			});
		}
	}
	return answers;
}

function resultFromValues(params: QuestionParams, result: ViewResult): QuestionnaireResult {
	if (result.action === "cancel") {
		return { answers: [], cancelled: true };
	}
	const answers = buildAnswers(params, result.values);
	if (answers.length === 0) {
		return { answers: [], cancelled: true };
	}
	return { answers, cancelled: false };
}

/**
 * Present the questionnaire on the desktop host.
 * Returns `null` when no desktop host is available (caller falls back to TUI).
 */
export async function presentQuestionnaireOnDesktop(
	params: QuestionParams,
	opts: { signal?: AbortSignal; deps?: DesktopViewDeps },
): Promise<QuestionnaireResult | null> {
	const connect = opts.deps?.connect ?? connectDesktopView;
	let client: DesktopViewClient | null = null;
	try {
		client = connect();
	} catch {
		return null;
	}
	if (!client) return null;

	try {
		const state = initialState(params);
		const result = await runDesktopSession(client, params, state, opts.signal);
		if (result === undefined) {
			// Host dismissed / force-closed — treat as cancel so the tool
			// envelope matches TUI Esc behaviour.
			return { answers: [], cancelled: true };
		}
		return result;
	} catch {
		// Socket / protocol / ViewHostError (placement rejected): fall through to TUI.
		return null;
	} finally {
		client.dispose();
	}
}

async function runDesktopSession(
	client: DesktopViewClient,
	params: QuestionParams,
	state: UiState,
	signal?: AbortSignal,
): Promise<QuestionnaireResult | undefined> {
	if (signal?.aborted) {
		return { answers: [], cancelled: true };
	}

	const spec = buildSpec(params, state);
	// Capture values from Host form store (authoritative at action time).
	const result = await client.open(spec, {
		signal,
		onEvent: (event, session: LiveViewSession) => {
			if (event.type === "change") {
				const index = questionIndexForNode(params, event.nodeId);
				const wasAnswered = index === null ? false : isQuestionAnswered(state, index);
				applyChange(state, params, event.nodeId, event.value);
				// 任何交互都解除取消布防（对齐 TUI：其它动作 disarm）。
				state.cancelArmed = false;
				// 页签观测（档 1）：Host 本地切页（chip / ←→）按 view/v1 语义不发事件，
				// 但落在某题控件上的 change 自带题号——它就是「画面上是哪一页」的证据。
				// 写在自动前进之前：前进的起点应当是用户真正在答的那一题，而不是扩展的旧账。
				if (index !== null) state.activeTab = questionTabId(index);
				// 自动前进：仅多题布局下单选题选项列表的「未答→已答」确认动作
				// （点击/Enter），且该题自由输入没有草稿——文本 + 选择 = 补充说明，
				// 对齐 TUI「补充中不前进」语义。wasAnswered 已隐含这条（纯文本草稿
				// 也算已答），显式写出是防御：isQuestionAnswered 语义若变，选中
				// 也不得拉走补充草稿。多选勾选、自定义输入、备注不触发；回改已答题
				// 也不触发（只前进一次，避免改答案被拉走）。
				if (
					index !== null &&
					event.nodeId === listId(index) &&
					params.questions.length > 1 &&
					!params.questions[index].multiSelect &&
					!wasAnswered &&
					isQuestionAnswered(state, index) &&
					(state.customTexts[index] ?? "").trim() === ""
				) {
					const next = nextUnansweredAfter(params, state, index);
					state.activeTab = next === null ? REVIEW_TAB_ID : questionTabId(next);
				}
				// Echo full tree so Client-side shadow state stays aligned with
				// Host form values (Host preserves live input on update).
				session.update(buildSpec(params, state));
				return;
			}
			if (event.type === "action") {
				if (event.actionId === "cancel") {
					if (hasAnyWork(params, state) && !state.cancelArmed) {
						// 第一段：仅布防，按钮换文案换色，不关闭
						state.cancelArmed = true;
						session.update(buildSpec(params, state));
						return;
					}
					session.close({ action: "cancel", values: {} });
					return;
				}
				if (event.actionId === "submit") {
					const values = { ...(event.values ?? {}) };
					// Prefer Host snapshot; fall back to last change events.
					for (let i = 0; i < params.questions.length; i++) {
						if (!(listId(i) in values)) values[listId(i)] = state.selections[i];
						if (!(customId(i) in values)) values[customId(i)] = state.customTexts[i];
					}
					session.close({ action: "submit", values });
					return;
				}
				const goto = parseGotoAction(event.actionId);
				if (goto) {
					// 复核页「修改」/ footer 主按钮「下一题」「复核」：显式接管激活页签
					state.cancelArmed = false;
					state.activeTab = tabIdOf(goto, params.questions.length);
					session.update(buildSpec(params, state));
					return;
				}
				const tab = parseTabAction(event.actionId);
				if (tab) {
					// Host 本地切页（chip / ←→）的回报（档 2）。actionId 走已有的 action 信封，
					// 协议字段零新增：Host 的 sendAction 不校验 id 是否声明在 spec.actions 里，
					// 且发 action 前会先 flush 未落盘的 change，所以 values 里是最新的表单。
					// 老 Host 不发这条 → 退回 change 分支的页签观测兜底。
					adoptFormValues(state, params, event.values);
					state.cancelArmed = false;
					state.activeTab = tabIdOf(tab, params.questions.length);
					session.update(buildSpec(params, state));
				}
			}
		},
	});

	if (!result) return undefined;
	return resultFromValues(params, result);
}

/** Test helper: expose tree builder without opening a socket. */
export function buildDesktopQuestionnaireSpec(params: QuestionParams): ViewSpec {
	return buildSpec(params, initialState(params));
}
