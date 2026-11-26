import { basename } from "node:path";
import type {
	BeforeAgentStartEvent,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { DEFAULT_HEARTBEAT_MS, getBlockingTools, getHeartbeatMs, isEnabled, setEnabled } from "./config.ts";
import {
	buildIdlePromptPayload,
	buildPromptSubmitPayload,
	buildQuestionAskedPayload,
	buildSessionStartPayload,
	buildStopPayload,
	buildToolCompletePayload,
	lastAssistantText,
	serializePayload,
	type WarpPayload,
} from "./payload.ts";
import { detectWarpEnvironment } from "./protocol.ts";
import { buildStatusReport, formatUnavailableNotice, readStatus } from "./status.ts";
import { startSpinner, stopSpinner } from "./title-spinner.ts";
import { AGENT_TITLE, writeOSC777 } from "./warp-notify.ts";

// Backwards-compatible surface: the transport lives in its own module since
// 1.21, but existing bridge imports from the package root keep working.
export { createWorkflowQuestionTransport, type WorkflowQuestionTransport } from "./workflow-transport.ts";

// ---------------------------------------------------------------------------
// Module-level timer state — __resetState() clears for test isolation
// ---------------------------------------------------------------------------

interface PendingBlockingCall {
	readonly toolName: string;
	readonly input?: Record<string, unknown>;
}

let pendingQuery = "";
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
let heartbeatMs = DEFAULT_HEARTBEAT_MS;
// Outstanding blocking-tool calls keyed by toolCallId. Populated on `tool_call`,
// drained on `tool_execution_end`. An ESC/abort during a blocking tool never
// fires `tool_execution_end`, so entries linger here until `agent_end` drains
// them — that drain is what clears Warp's stale "Blocked" badge.
const pendingBlockingCalls = new Map<string, PendingBlockingCall>();

export function __resetState(): void {
	pendingQuery = "";
	if (idleTimer !== undefined) {
		clearTimeout(idleTimer);
		idleTimer = undefined;
	}
	if (heartbeatInterval !== undefined) {
		clearInterval(heartbeatInterval);
		heartbeatInterval = undefined;
	}
	heartbeatMs = DEFAULT_HEARTBEAT_MS;
	pendingBlockingCalls.clear();
}

function emit(payload: WarpPayload): void {
	// The enabled master switch is read fresh per emission so /warp-notify
	// on|off takes effect without restarting the session.
	if (!isEnabled()) return;
	writeOSC777(AGENT_TITLE, serializePayload(payload));
}

function cancelIdleTimer(): void {
	if (idleTimer !== undefined) {
		clearTimeout(idleTimer);
		idleTimer = undefined;
	}
}

function startIdleTimer(ctx: ExtensionContext, branch: SessionEntry[]): void {
	cancelIdleTimer();
	idleTimer = setTimeout(() => {
		idleTimer = undefined;
		const summary = lastAssistantText(branch);
		emit(buildIdlePromptPayload(ctx, summary));
	}, 300);
	if (typeof (idleTimer as ReturnType<typeof setTimeout>).unref === "function") {
		(idleTimer as ReturnType<typeof setTimeout>).unref();
	}
}

function startHeartbeat(ctx: ExtensionContext, ms: number): void {
	stopHeartbeat();
	if (ms <= 0) return; // disabled
	heartbeatInterval = setInterval(() => {
		emit(buildPromptSubmitPayload(ctx, pendingQuery));
	}, ms);
	if (typeof heartbeatInterval.unref === "function") {
		heartbeatInterval.unref();
	}
}

function stopHeartbeat(): void {
	if (heartbeatInterval !== undefined) {
		clearInterval(heartbeatInterval);
		heartbeatInterval = undefined;
	}
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
	return typeof input === "object" && input !== null ? (input as Record<string, unknown>) : undefined;
}

function promptTextFromEvent(event: BeforeAgentStartEvent): string {
	// Pi 1.2+ also fires this hook for extension-triggered custom runs.
	if (event.messageType !== "custom") return event.prompt ?? "";
	const { content } = event.message;
	if (typeof content === "string") return content;
	return content
		.map((block) => (block.type === "text" ? block.text : ""))
		.filter((text) => text.length > 0)
		.join("\n");
}

function captureBlockingCall(toolCallId: string, toolName: string, input: unknown): void {
	pendingBlockingCalls.set(toolCallId, { toolName, input: asRecord(input) });
}

function consumeBlockingCall(toolCallId: string): PendingBlockingCall | undefined {
	const call = pendingBlockingCalls.get(toolCallId);
	pendingBlockingCalls.delete(toolCallId);
	return call;
}

function readBranch(ctx: ExtensionContext): SessionEntry[] {
	return ctx.sessionManager.getBranch() as SessionEntry[];
}

// Mirror Pi's startup tab title `<mascot> - <repo>`. We only own the first
// character (the spinner glyph during animation); push/pop restores Pi's
// mascot verbatim on stop.
function titleSuffix(ctx: ExtensionContext): string {
	return ` - ${basename(ctx.cwd)}`;
}

// ---------------------------------------------------------------------------
// /warp-notify command — diagnostics + live on/off toggle
// ---------------------------------------------------------------------------

async function commandHandler(args: string, ctx: ExtensionCommandContext): Promise<void> {
	if (!ctx.hasUI) return;
	const arg = args.trim().toLowerCase();
	if (arg === "on" || arg === "off") {
		const enabling = arg === "on";
		const saved = setEnabled(enabling);
		if (saved) {
			ctx.ui.notify(
				enabling ? "yoki-warp-notify: notifications enabled" : "yoki-warp-notify: notifications disabled",
				enabling ? "info" : "warning",
			);
		} else {
			ctx.ui.notify(`yoki-warp-notify: could not write the config file — edit it directly instead`, "error");
		}
		return;
	}
	ctx.ui.notify(buildStatusReport(), "info");
}

export default function (pi: ExtensionAPI): void {
	// Diagnostics register in EVERY terminal — /warp-notify is the user's
	// answer to "nothing happened", so it must exist wherever Pi runs.
	pi.registerCommand("warp-notify", {
		description: "Warp notification status; /warp-notify on|off toggles notifications",
		handler: commandHandler,
	});

	const warp = detectWarpEnvironment();
	if (!warp.isWarp) return;

	if (!warp.supportsStructured) {
		// Warp detected but this build cannot render structured notifications
		// (too old, or a known-broken build). Silent-by-design would leave the
		// trial user stuck on "nothing happened" — surface ONE startup notice
		// pointing at /warp-notify, then stay out of the way.
		pi.on("session_start", async (event, ctx) => {
			if (event.reason !== "startup" || !ctx.hasUI) return;
			ctx.ui.notify(formatUnavailableNotice(readStatus()), "warning");
		});
		return;
	}

	const blockingTools = getBlockingTools();
	heartbeatMs = getHeartbeatMs();

	pi.on("session_start", async (event, ctx) => {
		if (event.reason !== "startup") return;
		emit(buildSessionStartPayload(ctx));
	});

	pi.on("before_agent_start", async (event) => {
		pendingQuery = promptTextFromEvent(event);
	});

	pi.on("agent_start", async (_event, ctx) => {
		emit(buildSessionStartPayload(ctx)); // Item 2: defensive re-announce
		emit(buildPromptSubmitPayload(ctx, pendingQuery));
		if (isEnabled()) {
			startSpinner(titleSuffix(ctx));
			startHeartbeat(ctx, heartbeatMs); // Item 4: heartbeat
		}
		cancelIdleTimer(); // Item 3: cancel pending idle from previous turn
	});

	pi.on("agent_end", async (_event, ctx) => {
		// ESC/abort during a blocking tool never fires `tool_execution_end`, so the
		// "Blocked" badge would stay stale. Drain any outstanding blocking calls
		// (emit `tool_complete` for each) to unblock before announcing the stop.
		for (const [, call] of pendingBlockingCalls) {
			emit(buildToolCompletePayload(ctx, call.toolName, call.input));
		}
		pendingBlockingCalls.clear();
		emit(buildStopPayload(ctx, readBranch(ctx)));
		stopSpinner();
		stopHeartbeat(); // Item 4: stop heartbeat
		startIdleTimer(ctx, readBranch(ctx)); // Item 3: schedule idle_prompt after 300ms
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!blockingTools.has(event.toolName)) return;
		captureBlockingCall(event.toolCallId, event.toolName, event.input); // Item 6: capture input
		emit(buildQuestionAskedPayload(ctx));
		stopSpinner();
		stopHeartbeat(); // Item 4: pause heartbeat
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		if (!blockingTools.has(event.toolName)) return;
		const pending = consumeBlockingCall(event.toolCallId); // Item 6: consume input
		emit(buildToolCompletePayload(ctx, event.toolName, pending?.input));
		if (isEnabled()) {
			startSpinner(titleSuffix(ctx));
			startHeartbeat(ctx, heartbeatMs); // Item 4: resume heartbeat
		}
	});

	pi.on("session_shutdown", async () => {
		cancelIdleTimer();
		stopHeartbeat();
		pendingQuery = "";
		pendingBlockingCalls.clear();
		stopSpinner();
	});
}
