/**
 * yoki-ask-user-question — Pi extension. Registers the `ask_user_question`
 * tool: a structured option selector with a free-text "Other" fallback.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAskUserQuestionTool } from "./ask-user-question.ts";
import { registerAskUserQuestionReconciler } from "./reconcile.ts";

export {
	ASK_USER_PROMPT_EVENT,
	type AskUserPromptEventPayload,
	type AskUserPromptOption,
	type AskUserPromptQuestion,
} from "./events.ts";

export {
	ASK_USER_HOST_REGISTRY_KEY,
	ASK_USER_HOST_REGISTRY_VERSION,
	type AskUserHost,
	type AskUserHostPresentOptions,
	type AskUserHostRegistry,
	hasAskUserHosts,
	listAskUserHosts,
	presentViaAskUserHosts,
	registerAskUserHost,
} from "./host.ts";

export default function (pi: ExtensionAPI) {
	registerAskUserQuestionTool(pi);
	registerAskUserQuestionReconciler(pi);
}
