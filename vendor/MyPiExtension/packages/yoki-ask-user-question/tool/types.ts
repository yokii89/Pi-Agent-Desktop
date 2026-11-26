import { type Static, Type } from "typebox";
import { LABELS_BY_KIND, ROW_INTENT_META } from "../state/row-intent.ts";

export const MAX_QUESTIONS = 4;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
export const MAX_HEADER_LENGTH = 16;
export const MAX_LABEL_LENGTH = 60;

/**
 * 三条运行期哨兵行的用户可见标签，按各自的 `WrappingSelectItem.kind` 判别字段建键。
 * 标签取自 `ROW_INTENT_META`，经 `LABELS_BY_KIND` 转出（见 `row-intent.ts`）——单一
 * 事实源。新增哨兵需要同时扩展 `WrappingSelectItem` 联合类型并在 `ROW_INTENT_META`
 * 里补一项；这两步做完，这张表会自动跟着扩展。
 */
export const SENTINEL_LABELS = LABELS_BY_KIND;

export type SentinelKind = keyof typeof SENTINEL_LABELS;
export type SentinelLabel = (typeof SENTINEL_LABELS)[SentinelKind];

/**
 * Pi 内部哨兵所占用的保留标签——只要作者写的 option label 命中其中任意一个，就会触发
 * `reserved_label` 运行期拦截。三项里有两项来自 `ROW_INTENT_META`（即真的有运行期 kind
 * 的那两个）；`"Other"` 只为与 CC 对齐而保留（模型在 CC 里被训练成倾向于给出 "Other"），
 * 这里拒绝它，好让运行期哨兵成为唯一事实源，它本身没有对应的运行期 kind。
 *
 * 无条件保留——multiSelect 问题同样拒绝这些标签，尽管那里并不会追加运行期哨兵。
 *
 * 数组顺序由 `types.test.ts:292` 锁定——请保留这个显式的
 * `["Other", other, next]` 字面量，好让使用 `RESERVED_LABELS[i]` 下标或 `Set`
 * 成员判断的消费方行为不变。
 */
export const RESERVED_LABELS = ["Other", ROW_INTENT_META.other.label, ROW_INTENT_META.next.label] as const;
export type ReservedLabel = (typeof RESERVED_LABELS)[number];

export const OptionSchema = Type.Object({
	label: Type.String({
		maxLength: MAX_LABEL_LENGTH,
		description: `MAX ${MAX_LABEL_LENGTH} CHARACTERS — hard limit, requests over the limit are rejected. The display text for this option that the user will see and select. Should be concise (1-5 words) and clearly describe the choice.`,
	}),
	description: Type.String({
		description:
			"Explanation of what this option means or what will happen if chosen. Useful for providing context about trade-offs or implications.",
	}),
});

export const QuestionSchema = Type.Object({
	question: Type.String({
		description:
			'The complete question to ask the user. Should be clear, specific, and end with a question mark. Example: "Which library should we use for date formatting?" If multiSelect is true, phrase it accordingly, e.g. "Which features do you want to enable?"',
	}),
	header: Type.String({
		maxLength: MAX_HEADER_LENGTH,
		description: `MAX ${MAX_HEADER_LENGTH} CHARACTERS — hard limit, requests over the limit are rejected. Very short chip/tag shown next to the question. Examples: "Auth method", "Library", "Approach".`,
	}),
	options: Type.Array(OptionSchema, {
		minItems: MIN_OPTIONS,
		maxItems: MAX_OPTIONS,
		description:
			"The available choices for this question. Must have 2-4 options. Each option should be a distinct, mutually exclusive choice (unless multiSelect is enabled). The 'Type something.' row is appended automatically — do NOT author it.",
	}),
	multiSelect: Type.Optional(
		Type.Boolean({
			default: false,
			description:
				"Set to true to allow the user to select multiple options instead of just one. Use when choices are not mutually exclusive.",
		}),
	),
});

export const QuestionsSchema = Type.Array(QuestionSchema, {
	minItems: 1,
	maxItems: MAX_QUESTIONS,
	description: "Questions to ask the user (1-4 questions)",
});

export const QuestionParamsSchema = Type.Object({
	questions: QuestionsSchema,
});

export type OptionData = Static<typeof OptionSchema>;
export type QuestionData = Static<typeof QuestionSchema>;
export type QuestionParams = Static<typeof QuestionParamsSchema>;

/**
 * 回答意图的可判别联合。`kind` 是唯一判别字段——1.0.3 之前的布尔标记已全部移除
 * （见 `banned-flags.test.ts`）。词表尽量与行侧的 `WrappingSelectItem.kind` 对齐；
 * `multi` 是多选专属变体，行侧没有对应项。
 *
 * 各变体语义：
 * - `option`：用户选中了作者定义的某个选项，`answer` 是该选项的 label；自由输入文本
 *   作为补充落在 `notes`。
 * - `custom`：用户未选任何选项、通过 "Type something." 行输入自由文本，`answer` 是
 *   输入内容（空输入不再产生 custom 答案）。
 * - `multi`：用户提交了多选结果，`selected` 携带选中的 label 列表，`answer` 为 null；
 *   自由输入文本同样作为补充落在 `notes`。
 */
export interface QuestionAnswer {
	questionIndex: number;
	question: string;
	kind: "option" | "custom" | "multi";
	answer: string | null;
	selected?: string[];
	notes?: string;
}

export type QuestionnaireError =
	| "no_ui"
	| "no_custom_ui"
	| "no_questions"
	| "empty_options"
	| "too_many_questions"
	| "duplicate_question"
	| "duplicate_option_label"
	| "reserved_label"
	| "session_load_failed"
	| "stale_module_cache";

export interface QuestionnaireResult {
	answers: QuestionAnswer[];
	cancelled: boolean;
	error?: QuestionnaireError;
}

export function isQuestionnaireResult(value: unknown): value is QuestionnaireResult {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	return Array.isArray(v.answers) && typeof v.cancelled === "boolean";
}
