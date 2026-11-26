import {
	type AssistantMessage,
	type AssistantMessageEvent,
	type AssistantMessageEventStream,
	createAssistantMessageEventStream,
	type Usage,
} from "@earendil-works/pi-ai";
import type { ProviderStreamSimple } from "../retryStream.ts";

function zeroUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

export function assistantMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "qoder-api",
		provider: "qoder-cn",
		model: "Qwen3.8-Flash",
		usage: zeroUsage(),
		stopReason: "stop",
		timestamp: Date.now(),
		...overrides,
	};
}

/** The stream arguments Pi hands a provider; the wrapper forwards them untouched. */
export const streamArgs = [
	{ id: "Qwen3.8-Flash", api: "qoder-api", provider: "qoder-cn" },
	{ messages: [] },
	undefined,
] as unknown as Parameters<ProviderStreamSimple>;

/** The rejection this extension exists for: announced, then queued behind ~30s of wait. */
export const QUEUED_ERROR =
	"Qoder model is busy: request queued (10605 CALL_COUNT_LIMIT (premium), 4 ahead, ~30s wait, rate limit, retry-after-ms=30000)";

/**
 * The same rejection for a queue that is minutes deep: one blind wait for the announced
 * 205s would spend almost the whole run budget on a single estimate.
 */
export const LONG_QUEUED_ERROR =
	"Qoder model is busy: request queued (10605 CALL_COUNT_LIMIT (p3), 15254 ahead, ~205s wait, rate limit, retry-after-ms=205000)";

/** A provider answer that failed before the model produced anything. */
export function rejectedStream(
	errorMessage: string,
	reason: "error" | "aborted" = "error",
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	// Providers report the failure on the same message they announced at `start`.
	const output = assistantMessage({ stopReason: reason, errorMessage });
	stream.push({ type: "start", partial: output });
	stream.push({ type: "error", reason, error: output });
	return stream;
}

/** A provider answer that streamed text and finished. */
export function textStream(text = "hello"): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	const partial = assistantMessage({ content: [{ type: "text", text }] });
	stream.push({ type: "start", partial });
	stream.push({ type: "text_start", contentIndex: 0, partial });
	stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial });
	stream.push({ type: "text_end", contentIndex: 0, content: text, partial });
	stream.push({ type: "done", reason: "stop", message: partial });
	return stream;
}

/** A provider answer that failed after content was already on the wire. */
export function failedAfterTextStream(errorMessage: string): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	const output = assistantMessage({ content: [{ type: "text", text: "half" }], stopReason: "error", errorMessage });
	stream.push({ type: "start", partial: output });
	stream.push({ type: "text_start", contentIndex: 0, partial: output });
	stream.push({ type: "text_delta", contentIndex: 0, delta: "half", partial: output });
	stream.push({ type: "error", reason: "error", error: output });
	return stream;
}

/** Every event a stream forwards, then its final message. */
export async function collect(
	stream: AssistantMessageEventStream,
): Promise<{ events: AssistantMessageEvent[]; message: AssistantMessage }> {
	const events: AssistantMessageEvent[] = [];
	for await (const event of stream) events.push(event);
	return { events, message: await stream.result() };
}

export function eventTypes(events: AssistantMessageEvent[]): string[] {
	return events.map((event) => event.type);
}
