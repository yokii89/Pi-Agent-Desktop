/**
 * Operator-controlled local spawn of a visible Pi instance for Telegram.
 * Zones: telegram
 *
 * Deliberate product exception: Telegram may trigger a fixed whitelist script
 * that opens a visible local terminal and auto-connects as a new instance.
 * This is not arbitrary remote shell, not headless process creation, and not
 * same-thread session /new.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { UI_COMMANDS, UI_TOAST } from "./ui-copy.ts";

export const TELEGRAM_SPAWN_CALLBACK_CONFIRM = "spawn:confirm";
export const TELEGRAM_SPAWN_CALLBACK_CANCEL = "spawn:cancel";
export const TELEGRAM_SPAWN_MIN_INTERVAL_MS = 30_000;

export interface TelegramSpawnReplyMarkup {
	inline_keyboard: { text: string; callback_data: string }[][];
}

export interface TelegramSpawnGateInput {
	isThreadedModeAvailable: boolean;
	nowMs: number;
	lastSpawnAtMs?: number;
	minIntervalMs?: number;
}

export type TelegramSpawnGateResult = { ok: true } | { ok: false; message: string };

export interface TelegramSpawnScriptResolveInput {
	packageRoot?: string;
	platform?: NodeJS.Platform;
}

export interface TelegramSpawnScriptPlan {
	command: string;
	args: string[];
	scriptPath: string;
}

export interface TelegramSpawnRunInput {
	cwd: string;
	packageRoot?: string;
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
	spawnProcess?: typeof spawn;
}

export interface TelegramSpawnRunResult {
	ok: boolean;
	message: string;
	code?: number | null;
}

export interface TelegramSpawnRateLimitState {
	lastSpawnAtMs?: number;
}

export function getTelegramSpawnPackageRoot(moduleUrl: string = import.meta.url): string {
	return join(dirname(fileURLToPath(moduleUrl)), "..");
}

export function resolveTelegramSpawnScriptPath(input: TelegramSpawnScriptResolveInput = {}): string {
	const packageRoot = input.packageRoot ?? getTelegramSpawnPackageRoot();
	const platform = input.platform ?? process.platform;
	const scriptName = platform === "win32" ? "pi-telegram-spawn.ps1" : "pi-telegram-spawn.sh";
	return join(packageRoot, "scripts", scriptName);
}

export function buildTelegramSpawnScriptPlan(
	cwd: string,
	input: TelegramSpawnScriptResolveInput = {},
): TelegramSpawnScriptPlan {
	const scriptPath = resolveTelegramSpawnScriptPath(input);
	const platform = input.platform ?? process.platform;
	if (platform === "win32") {
		return {
			command: "powershell.exe",
			args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-Cwd", cwd],
			scriptPath,
		};
	}
	return {
		command: "bash",
		args: [scriptPath, "--cwd", cwd],
		scriptPath,
	};
}

export function evaluateTelegramSpawnGate(input: TelegramSpawnGateInput): TelegramSpawnGateResult {
	if (!input.isThreadedModeAvailable) {
		return {
			ok: false,
			message: UI_COMMANDS.spawnRequiresThreadedMode,
		};
	}
	const minIntervalMs = input.minIntervalMs ?? TELEGRAM_SPAWN_MIN_INTERVAL_MS;
	const lastSpawnAtMs = input.lastSpawnAtMs;
	if (typeof lastSpawnAtMs === "number" && input.nowMs - lastSpawnAtMs < minIntervalMs) {
		const waitSec = Math.ceil((minIntervalMs - (input.nowMs - lastSpawnAtMs)) / 1000);
		return {
			ok: false,
			message: UI_COMMANDS.spawnRateLimited(waitSec),
		};
	}
	return { ok: true };
}

export function buildTelegramSpawnConfirmationReplyMarkup(): TelegramSpawnReplyMarkup {
	return {
		inline_keyboard: [
			[
				{
					text: UI_COMMANDS.spawnYes,
					callback_data: TELEGRAM_SPAWN_CALLBACK_CONFIRM,
				},
				{
					text: UI_COMMANDS.spawnNo,
					callback_data: TELEGRAM_SPAWN_CALLBACK_CANCEL,
				},
			],
		],
	};
}

export function getTelegramSpawnConfirmationHtml(): string {
	return UI_COMMANDS.spawnQuestion;
}

export async function runTelegramSpawnScript(input: TelegramSpawnRunInput): Promise<TelegramSpawnRunResult> {
	const cwd = input.cwd.trim();
	if (!cwd) {
		return { ok: false, message: UI_COMMANDS.spawnFailed("missing cwd") };
	}
	if (!existsSync(cwd)) {
		return {
			ok: false,
			message: UI_COMMANDS.spawnFailed(`cwd does not exist: ${cwd}`),
		};
	}
	const plan = buildTelegramSpawnScriptPlan(cwd, {
		packageRoot: input.packageRoot,
		platform: input.platform,
	});
	if (!existsSync(plan.scriptPath)) {
		return {
			ok: false,
			message: UI_COMMANDS.spawnFailed(`script missing: ${plan.scriptPath}`),
		};
	}

	const spawnProcess = input.spawnProcess ?? spawn;
	return await new Promise<TelegramSpawnRunResult>((resolve) => {
		const child = spawnProcess(plan.command, plan.args, {
			cwd,
			env: input.env ?? process.env,
			windowsHide: false,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (chunk: Buffer | string) => {
			stdout += String(chunk);
		});
		child.stderr?.on("data", (chunk: Buffer | string) => {
			stderr += String(chunk);
		});
		child.on("error", (error) => {
			resolve({
				ok: false,
				message: UI_COMMANDS.spawnFailed(error instanceof Error ? error.message : String(error)),
			});
		});
		child.on("close", (code) => {
			if (code === 0) {
				resolve({
					ok: true,
					code,
					message: UI_COMMANDS.spawnStarted,
				});
				return;
			}
			const detail = stderr.trim() || stdout.trim() || `exit code ${code ?? "unknown"}`;
			resolve({
				ok: false,
				code,
				message: UI_COMMANDS.spawnFailed(detail.slice(0, 500)),
			});
		});
	});
}

export function createTelegramSpawnRateLimitState(): TelegramSpawnRateLimitState {
	return {};
}

export function markTelegramSpawnAttempt(state: TelegramSpawnRateLimitState, nowMs: number): void {
	state.lastSpawnAtMs = nowMs;
}

export interface TelegramSpawnConfirmationDeps {
	sendInteractiveMessage: (
		chatId: number,
		text: string,
		parseMode: "html" | "plain",
		replyMarkup: TelegramSpawnReplyMarkup,
		options?: { target?: { chatId: number; threadId?: number } },
	) => Promise<unknown>;
}

export async function openTelegramSpawnConfirmation(
	target: { chatId: number; threadId?: number; replyToMessageId?: number },
	deps: TelegramSpawnConfirmationDeps,
): Promise<void> {
	await deps.sendInteractiveMessage(
		target.chatId,
		getTelegramSpawnConfirmationHtml(),
		"html",
		buildTelegramSpawnConfirmationReplyMarkup(),
		target.threadId !== undefined ? { target: { chatId: target.chatId, threadId: target.threadId } } : undefined,
	);
}

export interface TelegramSpawnConfirmationCallbackQuery {
	id: string;
	data?: string;
	message?: {
		chat?: { id?: number };
		message_id?: number;
		message_thread_id?: number;
	};
}

export interface TelegramSpawnConfirmationCallbackDeps {
	answerCallbackQuery: (id: string, text?: string) => Promise<unknown>;
	editInteractiveMessage: (
		chatId: number,
		messageId: number,
		text: string,
		parseMode: "html" | "plain",
		replyMarkup: TelegramSpawnReplyMarkup,
	) => Promise<unknown>;
	runSpawn: () => Promise<TelegramSpawnRunResult>;
	recordRuntimeEvent?: (category: string, error: unknown, details?: Record<string, unknown>) => void;
}

export async function handleTelegramSpawnConfirmationCallback(
	query: TelegramSpawnConfirmationCallbackQuery,
	deps: TelegramSpawnConfirmationCallbackDeps,
): Promise<boolean> {
	if (query.data !== TELEGRAM_SPAWN_CALLBACK_CONFIRM && query.data !== TELEGRAM_SPAWN_CALLBACK_CANCEL) {
		return false;
	}
	const callbackMessage = query.message;
	const chatId = callbackMessage?.chat?.id;
	const messageId = callbackMessage?.message_id;
	if (typeof chatId !== "number" || typeof messageId !== "number") {
		await deps.answerCallbackQuery(query.id, UI_TOAST.interactiveExpired);
		return true;
	}
	if (query.data === TELEGRAM_SPAWN_CALLBACK_CANCEL) {
		await deps.editInteractiveMessage(chatId, messageId, UI_COMMANDS.spawnCancelled, "plain", {
			inline_keyboard: [],
		});
		await deps.answerCallbackQuery(query.id);
		return true;
	}
	await deps.editInteractiveMessage(chatId, messageId, UI_COMMANDS.spawnRunning, "plain", { inline_keyboard: [] });
	await deps.answerCallbackQuery(query.id);
	try {
		const result = await deps.runSpawn();
		await deps.editInteractiveMessage(chatId, messageId, result.message, "plain", { inline_keyboard: [] });
		if (!result.ok) {
			deps.recordRuntimeEvent?.("spawn", result.message, {
				phase: "spawn-failed",
			});
		} else {
			deps.recordRuntimeEvent?.("spawn", result.message, {
				phase: "spawn-started",
			});
		}
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		deps.recordRuntimeEvent?.("spawn", error, { phase: "spawn-error" });
		await deps.editInteractiveMessage(chatId, messageId, UI_COMMANDS.spawnFailed(detail), "plain", {
			inline_keyboard: [],
		});
	}
	return true;
}

export interface TelegramSpawnCommandDeps {
	isThreadedModeAvailable: () => boolean;
	getCwd: () => string;
	getNowMs?: () => number;
	rateLimitState: TelegramSpawnRateLimitState;
	sendTextReply: (text: string) => Promise<void>;
	sendInteractiveMessage?: TelegramSpawnConfirmationDeps["sendInteractiveMessage"];
	target: { chatId: number; threadId?: number };
	recordRuntimeEvent?: (category: string, error: unknown, details?: Record<string, unknown>) => void;
	runSpawn?: () => Promise<TelegramSpawnRunResult>;
}

export async function handleTelegramSpawnCommand(deps: TelegramSpawnCommandDeps): Promise<void> {
	const nowMs = deps.getNowMs?.() ?? Date.now();
	const gate = evaluateTelegramSpawnGate({
		isThreadedModeAvailable: deps.isThreadedModeAvailable(),
		nowMs,
		lastSpawnAtMs: deps.rateLimitState.lastSpawnAtMs,
	});
	if (!gate.ok) {
		await deps.sendTextReply(gate.message);
		return;
	}
	if (deps.sendInteractiveMessage) {
		await openTelegramSpawnConfirmation(deps.target, {
			sendInteractiveMessage: deps.sendInteractiveMessage,
		});
		return;
	}
	// Fallback without interactive buttons: run immediately after gate.
	markTelegramSpawnAttempt(deps.rateLimitState, nowMs);
	const run =
		deps.runSpawn ??
		(() =>
			runTelegramSpawnScript({
				cwd: deps.getCwd(),
			}));
	const result = await run();
	await deps.sendTextReply(result.message);
	deps.recordRuntimeEvent?.("spawn", result.message, { phase: result.ok ? "spawn-started" : "spawn-failed" });
}

export async function confirmAndRunTelegramSpawn(deps: {
	isThreadedModeAvailable: () => boolean;
	getCwd: () => string;
	getNowMs?: () => number;
	rateLimitState: TelegramSpawnRateLimitState;
	runSpawn?: () => Promise<TelegramSpawnRunResult>;
	recordRuntimeEvent?: (category: string, error: unknown, details?: Record<string, unknown>) => void;
}): Promise<TelegramSpawnRunResult> {
	const nowMs = deps.getNowMs?.() ?? Date.now();
	const gate = evaluateTelegramSpawnGate({
		isThreadedModeAvailable: deps.isThreadedModeAvailable(),
		nowMs,
		lastSpawnAtMs: deps.rateLimitState.lastSpawnAtMs,
	});
	if (!gate.ok) {
		return { ok: false, message: gate.message };
	}
	markTelegramSpawnAttempt(deps.rateLimitState, nowMs);
	const run =
		deps.runSpawn ??
		(() =>
			runTelegramSpawnScript({
				cwd: deps.getCwd(),
			}));
	const result = await run();
	deps.recordRuntimeEvent?.("spawn", result.message, { phase: result.ok ? "spawn-started" : "spawn-failed" });
	return result;
}
