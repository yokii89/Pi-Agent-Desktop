/**
 * yoki-warp-notify — Workflow-question transport.
 *
 * A run-keyed OSC emitter for the yoki-core workflow-question-warp-bridge.
 * session_id is the workflow runId (Warp's logical session for a
 * parked-question badge), NOT the launcher session. Extracted from index.ts
 * so the extension entry stays lifecycle-only; the bridge imports this
 * module directly.
 *
 * Each method is gated per-call on Warp support and the user `enabled`
 * config, so the bridge can call unconditionally outside Warp.
 */

import { isEnabled } from "./config.ts";
import {
	buildWorkflowQuestionAskedPayload,
	buildWorkflowQuestionCompletePayload,
	buildWorkflowSessionStartPayload,
	serializePayload,
	type WarpPayload,
} from "./payload.ts";
import { detectWarpEnvironment } from "./protocol.ts";
import { AGENT_TITLE, writeOSC777 } from "./warp-notify.ts";

export interface WorkflowQuestionTransport {
	/** A workflow run parked its FIRST outstanding question (0→≥1): emit
	 *  `session_start` (defensive) then `question_asked`. No-op outside Warp. */
	asked(runId: string): void;
	/** A workflow run's LAST outstanding question cleared (≥1→0): emit
	 *  `tool_complete`. No-op outside Warp. */
	resolved(runId: string): void;
}

function emit(payload: WarpPayload): void {
	if (!isEnabled()) return;
	writeOSC777(AGENT_TITLE, serializePayload(payload));
}

export function createWorkflowQuestionTransport(cwd: string): WorkflowQuestionTransport {
	return {
		asked(runId: string): void {
			if (!detectWarpEnvironment().supportsStructured) return;
			emit(buildWorkflowSessionStartPayload(runId, cwd));
			emit(buildWorkflowQuestionAskedPayload(runId, cwd));
		},
		resolved(runId: string): void {
			if (!detectWarpEnvironment().supportsStructured) return;
			emit(buildWorkflowQuestionCompletePayload(runId, cwd));
		},
	};
}
