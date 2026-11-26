/**
 * Telegram host for yoki ask_user_question
 * Zones: telegram ui, extension interop
 * Presents structured questionnaires as Telegram inline keyboards during active
 * Telegram turns, resolving the tool Promise without enqueueing a new prompt.
 * Registers against the process-local yoki host registry (globalThis) so package
 * load order between pi-telegram and yoki-ask-user-question does not matter.
 */

import {
	deleteTelegramView,
	editTelegramView,
	sendTelegramView,
	type TelegramDeliveryHandle,
	type TelegramDeliveryView,
} from "./delivery.ts";
import { assertTelegramCallbackData, type TelegramInlineKeyboardMarkup } from "./keyboard.ts";
import { registerTelegramUpdateHandler } from "./updates.ts";

const YOKI_HOST_REGISTRY_KEY = "__yokiAskUserHostRegistry__";
const YOKI_HOST_REGISTRY_VERSION = 1;
const HOST_ID = "pi-telegram";
const HOST_PRIORITY = 100;
const CALLBACK_PREFIX = "asku:";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/** Minimal QuestionParams/Result shapes — keep free of yoki package imports. */
interface AskUserOption {
	label: string;
	description: string;
}

interface AskUserQuestion {
	question: string;
	header: string;
	options: AskUserOption[];
	multiSelect?: boolean;
}

interface AskUserParams {
	questions: AskUserQuestion[];
}

interface AskUserAnswer {
	questionIndex: number;
	question: string;
	kind: "option" | "custom" | "multi";
	answer: string | null;
	selected?: string[];
}

interface AskUserResult {
	answers: AskUserAnswer[];
	cancelled: boolean;
}

interface AskUserHostPresentOptions {
	toolCallId: string;
	signal?: AbortSignal;
	ctx: unknown;
}

interface AskUserHost {
	id: string;
	priority: number;
	canHandle: (ctx: unknown) => boolean | Promise<boolean>;
	present: (params: AskUserParams, opts: AskUserHostPresentOptions) => Promise<AskUserResult | null>;
}

interface YokiAskUserHostRegistry {
	readonly version: number;
	register: (host: AskUserHost) => () => void;
	list: () => readonly AskUserHost[];
	hasHosts: () => boolean;
}

export interface TelegramAskUserHostRuntime {
	answerCallbackQuery: (callbackQueryId: string, text?: string) => Promise<void>;
	/** Optional override for tests. */
	timeoutMs?: number;
}

interface PendingSession {
	id: string;
	params: AskUserParams;
	questionIndex: number;
	answers: AskUserAnswer[];
	multiChecked: Set<number>;
	waitingForCustomText: boolean;
	handle: TelegramDeliveryHandle | undefined;
	resolve: (result: AskUserResult | null) => void;
	settled: boolean;
	timeout: ReturnType<typeof setTimeout> | undefined;
	onAbort: (() => void) | undefined;
	signal: AbortSignal | undefined;
}

const sessions = new Map<string, PendingSession>();
let runtime: TelegramAskUserHostRuntime | undefined;
let unregisterHost: (() => void) | undefined;
let unregisterUpdateHandler: (() => void) | undefined;
let sessionSeq = 0;

function isValidYokiRegistry(candidate: unknown): candidate is YokiAskUserHostRegistry {
	if (!candidate || typeof candidate !== "object") return false;
	const reg = candidate as Partial<YokiAskUserHostRegistry>;
	return (
		reg.version === YOKI_HOST_REGISTRY_VERSION &&
		typeof reg.register === "function" &&
		typeof reg.list === "function" &&
		typeof reg.hasHosts === "function"
	);
}

function createYokiCompatibleRegistry(): YokiAskUserHostRegistry {
	const hosts = new Map<string, AskUserHost>();
	return {
		version: YOKI_HOST_REGISTRY_VERSION,
		register(host) {
			hosts.set(host.id, host);
			return () => {
				if (hosts.get(host.id) === host) hosts.delete(host.id);
			};
		},
		list() {
			return [...hosts.values()].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
		},
		hasHosts() {
			return hosts.size > 0;
		},
	};
}

function getOrCreateYokiRegistry(): YokiAskUserHostRegistry {
	const globals = globalThis as Record<string, unknown>;
	const existing = globals[YOKI_HOST_REGISTRY_KEY];
	if (isValidYokiRegistry(existing)) return existing;
	const registry = createYokiCompatibleRegistry();
	globals[YOKI_HOST_REGISTRY_KEY] = registry;
	return registry;
}

function nextSessionId(): string {
	sessionSeq = (sessionSeq + 1) % 1_000_000;
	return sessionSeq.toString(36);
}

function callbackData(sessionId: string, action: string, payload = ""): string {
	const data = payload
		? `${CALLBACK_PREFIX}${sessionId}:${action}:${payload}`
		: `${CALLBACK_PREFIX}${sessionId}:${action}`;
	return assertTelegramCallbackData(data, "ask-user callback_data");
}

function parseCallbackData(data: string): { sessionId: string; action: string; payload: string } | undefined {
	if (!data.startsWith(CALLBACK_PREFIX)) return undefined;
	const rest = data.slice(CALLBACK_PREFIX.length);
	const parts = rest.split(":");
	if (parts.length < 2) return undefined;
	const [sessionId, action, ...payloadParts] = parts;
	if (!sessionId || !action) return undefined;
	return {
		sessionId,
		action,
		payload: payloadParts.join(":"),
	};
}

function escapeHtml(text: string): string {
	return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function currentQuestion(session: PendingSession): AskUserQuestion {
	return session.params.questions[session.questionIndex]!;
}

function buildQuestionText(session: PendingSession): string {
	const total = session.params.questions.length;
	const q = currentQuestion(session);
	const progress = total > 1 ? ` (${session.questionIndex + 1}/${total})` : "";
	const lines = [`<b>❓ ${escapeHtml(q.header)}${progress}</b>`, "", escapeHtml(q.question), ""];
	for (let i = 0; i < q.options.length; i++) {
		const option = q.options[i]!;
		const checked = q.multiSelect && session.multiChecked.has(i) ? "🟢 " : "";
		lines.push(
			`${checked}<b>${i + 1}. ${escapeHtml(option.label)}</b> — ${escapeHtml(truncate(option.description, 120))}`,
		);
	}
	if (session.waitingForCustomText) {
		lines.push("", "<i>请输入自定义答案，或点 ❌ 取消。</i>");
	} else if (q.multiSelect) {
		lines.push("", "<i>可多选，选完后点 ✅ 确认。</i>");
	}
	return lines.join("\n");
}

function buildKeyboard(session: PendingSession): TelegramInlineKeyboardMarkup {
	const q = currentQuestion(session);
	if (session.waitingForCustomText) {
		return {
			inline_keyboard: [[{ text: "❌ 取消", callback_data: callbackData(session.id, "x") }]],
		};
	}

	const rows: TelegramInlineKeyboardMarkup["inline_keyboard"] = [];
	for (let i = 0; i < q.options.length; i++) {
		const option = q.options[i]!;
		if (q.multiSelect) {
			const mark = session.multiChecked.has(i) ? "🟢 " : "⚫️ ";
			rows.push([
				{
					text: truncate(`${mark}${option.label}`, 40),
					callback_data: callbackData(session.id, "tog", String(i)),
				},
			]);
		} else {
			rows.push([
				{
					text: truncate(option.label, 40),
					callback_data: callbackData(session.id, "opt", String(i)),
				},
			]);
		}
	}

	const actionRow: TelegramInlineKeyboardMarkup["inline_keyboard"][number] = [];
	if (q.multiSelect) {
		actionRow.push({
			text: "✅ 确认",
			callback_data: callbackData(session.id, "ok"),
		});
	}
	actionRow.push({
		text: "✏️ 自定义",
		callback_data: callbackData(session.id, "c"),
	});
	actionRow.push({
		text: "❌ 取消",
		callback_data: callbackData(session.id, "x"),
	});
	rows.push(actionRow);
	return { inline_keyboard: rows };
}

function buildView(session: PendingSession): TelegramDeliveryView {
	return {
		text: buildQuestionText(session),
		parseMode: "html",
		replyMarkup: buildKeyboard(session),
	};
}

async function refreshView(session: PendingSession): Promise<boolean> {
	const view = buildView(session);
	if (!session.handle) {
		const sent = await sendTelegramView(view, { scope: { kind: "active-turn" } });
		if (!sent.ok) return false;
		session.handle = sent.value;
		return true;
	}
	const edited = await editTelegramView(session.handle, view);
	if (edited.ok) {
		session.handle = edited.value;
		return true;
	}
	return false;
}

function settle(session: PendingSession, result: AskUserResult | null): void {
	if (session.settled) return;
	session.settled = true;
	if (session.timeout) clearTimeout(session.timeout);
	if (session.signal && session.onAbort) {
		session.signal.removeEventListener("abort", session.onAbort);
	}
	sessions.delete(session.id);
	session.resolve(result);
}

async function finalizeMessage(session: PendingSession, summaryHtml: string): Promise<void> {
	if (!session.handle) return;
	await editTelegramView(session.handle, {
		text: summaryHtml,
		parseMode: "html",
	});
}

function commitAnswer(session: PendingSession, answer: AskUserAnswer): void {
	session.answers.push(answer);
	session.multiChecked = new Set();
	session.waitingForCustomText = false;
	if (session.questionIndex + 1 >= session.params.questions.length) {
		void finalizeMessage(
			session,
			`<b>✅ 已回答</b>\n${session.answers
				.map((a) => {
					const value = a.kind === "multi" ? (a.selected ?? []).join(", ") : (a.answer ?? "");
					return `• ${escapeHtml(a.question)} → <b>${escapeHtml(value)}</b>`;
				})
				.join("\n")}`,
		).finally(() => {
			settle(session, { answers: session.answers, cancelled: false });
		});
		return;
	}
	session.questionIndex += 1;
	void refreshView(session).then((ok) => {
		if (!ok) cancelSession(session, "abort");
	});
}

function cancelSession(session: PendingSession, reason: "cancel" | "timeout" | "abort"): void {
	const label = reason === "timeout" ? "⏱️ 已超时" : reason === "abort" ? "⏹️ 已中止" : "❌ 已取消";
	void finalizeMessage(session, `<b>${label}</b>`).finally(() => {
		settle(session, { answers: session.answers, cancelled: true });
	});
}

async function presentTelegramQuestionnaire(
	params: AskUserParams,
	opts: AskUserHostPresentOptions,
): Promise<AskUserResult | null> {
	if (!Array.isArray(params?.questions) || params.questions.length === 0) {
		return null;
	}

	// Probe active-turn delivery by sending the first view. If there is no
	// Telegram-owned turn (or runtime is unbound), fall through to TUI/RPC.
	const sessionId = nextSessionId();

	return await new Promise<AskUserResult | null>((resolve) => {
		const session: PendingSession = {
			id: sessionId,
			params,
			questionIndex: 0,
			answers: [],
			multiChecked: new Set(),
			waitingForCustomText: false,
			handle: undefined,
			resolve,
			settled: false,
			timeout: undefined,
			onAbort: undefined,
			signal: opts.signal,
		};
		sessions.set(sessionId, session);

		const timeoutMs = runtime?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		session.timeout = setTimeout(() => {
			cancelSession(session, "timeout");
		}, timeoutMs);

		if (opts.signal) {
			const onAbort = () => cancelSession(session, "abort");
			session.onAbort = onAbort;
			if (opts.signal.aborted) {
				cancelSession(session, "abort");
				return;
			}
			opts.signal.addEventListener("abort", onAbort, { once: true });
		}

		void (async () => {
			const ok = await refreshView(session);
			if (!ok) {
				// Not a Telegram turn / delivery unavailable — try next host (TUI).
				settle(session, null);
			}
		})();
	});
}

function getCallbackQuery(update: unknown):
	| {
			id?: string;
			data?: string;
			from?: { id?: number };
			message?: {
				message_id?: number;
				chat?: { id?: number };
				text?: string;
			};
	  }
	| undefined {
	if (!update || typeof update !== "object") return undefined;
	const query = (update as { callback_query?: unknown }).callback_query;
	if (!query || typeof query !== "object") return undefined;
	return query as {
		id?: string;
		data?: string;
		from?: { id?: number };
		message?: {
			message_id?: number;
			chat?: { id?: number };
			text?: string;
		};
	};
}

function getPlainMessage(update: unknown):
	| {
			text?: string;
			chat?: { id?: number };
			from?: { id?: number };
			message_id?: number;
	  }
	| undefined {
	if (!update || typeof update !== "object") return undefined;
	const message = (update as { message?: unknown }).message;
	if (!message || typeof message !== "object") return undefined;
	return message as {
		text?: string;
		chat?: { id?: number };
		from?: { id?: number };
		message_id?: number;
	};
}

async function handleCallbackUpdate(update: unknown): Promise<"consume" | "pass"> {
	const query = getCallbackQuery(update);
	if (!query?.data) return "pass";
	const parsed = parseCallbackData(query.data);
	if (!parsed) return "pass";

	const session = sessions.get(parsed.sessionId);
	if (!session || session.settled) {
		if (query.id && runtime) {
			await runtime.answerCallbackQuery(query.id, "问卷已结束");
		}
		return "consume";
	}

	if (query.id && runtime) {
		await runtime.answerCallbackQuery(query.id);
	}

	const q = currentQuestion(session);

	if (parsed.action === "x") {
		cancelSession(session, "cancel");
		return "consume";
	}

	if (parsed.action === "c") {
		session.waitingForCustomText = true;
		await refreshView(session);
		return "consume";
	}

	if (parsed.action === "tog" && q.multiSelect) {
		const index = Number.parseInt(parsed.payload, 10);
		if (Number.isInteger(index) && index >= 0 && index < q.options.length) {
			if (session.multiChecked.has(index)) session.multiChecked.delete(index);
			else session.multiChecked.add(index);
			await refreshView(session);
		}
		return "consume";
	}

	if (parsed.action === "ok" && q.multiSelect) {
		const selected = [...session.multiChecked].sort((a, b) => a - b).map((i) => q.options[i]!.label);
		if (selected.length === 0) {
			// Keep waiting — nothing selected yet.
			await refreshView(session);
			return "consume";
		}
		commitAnswer(session, {
			questionIndex: session.questionIndex,
			question: q.question,
			kind: "multi",
			answer: null,
			selected,
		});
		return "consume";
	}

	if (parsed.action === "opt" && !q.multiSelect) {
		const index = Number.parseInt(parsed.payload, 10);
		if (!Number.isInteger(index) || index < 0 || index >= q.options.length) {
			return "consume";
		}
		const option = q.options[index]!;
		commitAnswer(session, {
			questionIndex: session.questionIndex,
			question: q.question,
			kind: "option",
			answer: option.label,
		});
		return "consume";
	}

	return "consume";
}

async function handleTextUpdate(update: unknown): Promise<"consume" | "pass"> {
	const message = getPlainMessage(update);
	if (!message?.text || typeof message.chat?.id !== "number") return "pass";
	// Only consume plain text while a session is waiting for custom input on the
	// same chat as the questionnaire message.
	for (const session of sessions.values()) {
		if (!session.waitingForCustomText || session.settled) continue;
		if (!session.handle) continue;
		if (session.handle.target.chatId !== message.chat.id) continue;
		if (
			session.handle.target.threadId !== undefined &&
			// Threaded Mode: plain messages may not always carry thread id on the
			// typed shape we read; when the handle is thread-scoped require match
			// only if the update exposes message_thread_id.
			typeof (message as { message_thread_id?: number }).message_thread_id === "number" &&
			(message as { message_thread_id?: number }).message_thread_id !== session.handle.target.threadId
		) {
			continue;
		}

		const text = message.text.trim();
		if (!text) return "consume";
		const q = currentQuestion(session);
		commitAnswer(session, {
			questionIndex: session.questionIndex,
			question: q.question,
			kind: "custom",
			answer: text,
		});
		return "consume";
	}
	return "pass";
}

function createHost(): AskUserHost {
	return {
		id: HOST_ID,
		priority: HOST_PRIORITY,
		// Cheap gate: always eligible; present() returns null when active-turn
		// delivery is unavailable so TUI/RPC remains the fallback.
		canHandle: () => runtime !== undefined,
		present: presentTelegramQuestionnaire,
	};
}

/**
 * Bind Telegram transport ports used by the ask-user host (answerCallbackQuery).
 * Call whenever the bridge runtime is live.
 */
export function bindTelegramAskUserHostRuntime(next: TelegramAskUserHostRuntime): () => void {
	runtime = next;
	return () => {
		if (runtime === next) runtime = undefined;
	};
}

/**
 * Register the Telegram host against the yoki registry and install the update
 * interceptor. Safe to call multiple times; returns a disposer.
 */
export function startTelegramAskUserHost(): () => void {
	if (!unregisterHost) {
		unregisterHost = getOrCreateYokiRegistry().register(createHost());
	}
	if (!unregisterUpdateHandler) {
		unregisterUpdateHandler = registerTelegramUpdateHandler(async (update) => {
			if (getCallbackQuery(update)) return handleCallbackUpdate(update);
			if (getPlainMessage(update)) return handleTextUpdate(update);
			return "pass";
		});
	}

	return () => {
		const open = [...sessions.values()];
		for (const session of open) {
			const handle = session.handle;
			settle(session, { answers: session.answers, cancelled: true });
			if (handle) void deleteTelegramView(handle);
		}
		unregisterHost?.();
		unregisterHost = undefined;
		unregisterUpdateHandler?.();
		unregisterUpdateHandler = undefined;
	};
}

/** @internal test helpers */
export const _askUserHostTest = {
	parseCallbackData,
	callbackData,
	buildView,
	CALLBACK_PREFIX,
	HOST_ID,
	sessions,
	settle,
	presentTelegramQuestionnaire,
	handleCallbackUpdate,
	handleTextUpdate,
	reset() {
		for (const session of [...sessions.values()]) {
			settle(session, null);
		}
		sessions.clear();
		runtime = undefined;
		unregisterHost?.();
		unregisterHost = undefined;
		unregisterUpdateHandler?.();
		unregisterUpdateHandler = undefined;
		sessionSeq = 0;
		delete (globalThis as Record<string, unknown>)[YOKI_HOST_REGISTRY_KEY];
	},
};
