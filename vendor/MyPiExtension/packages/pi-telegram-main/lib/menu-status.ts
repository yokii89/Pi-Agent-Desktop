/**
 * Telegram status menu UI helpers
 * Zones: telegram ui, status controls, menu composition
 * Owns status-menu payloads, status callback handling, and status-menu message rendering
 */

import {
	formatStatusButtonLabel,
	type TelegramMenuMessageRuntimeDeps,
	type TelegramMenuRenderPayload,
	type TelegramModelMenuState,
	type TelegramReplyMarkup,
} from "./menu-model.ts";
import { getCanonicalModelId, type MenuModel, type ThinkingLevel } from "./model.ts";
import { getTelegramSectionMainMenuRows, type TelegramSectionRegistry } from "./sections.ts";
import { UI_STATUS, UI_TOAST } from "./ui-copy.ts";

export interface TelegramStatusMenuCallbackDeps {
	updateModelMenuMessage: () => Promise<void>;
	updateThinkingMenuMessage: () => Promise<void>;
	updateSettingsMenuMessage?: () => Promise<void>;
	answerCallbackQuery: (callbackQueryId: string, text?: string) => Promise<void>;
	isVoiceReplyActive?: () => boolean;
}

export interface TelegramStatusMenuOpenDeps<TModel extends MenuModel = MenuModel> {
	isIdle: () => boolean;
	sendBusyMessage: () => Promise<void>;
	getModelMenuState: () => Promise<TelegramModelMenuState<TModel>>;
	buildStatusHtml: () => string;
	getActiveModel: () => TModel | undefined;
	getThinkingLevel: () => ThinkingLevel;
	getQueueItemCount?: () => number;
	sendStatusMenu: (
		state: TelegramModelMenuState<TModel>,
		statusHtml: string,
		activeModel: TModel | undefined,
		thinkingLevel: ThinkingLevel,
		queueItemCount: number,
	) => Promise<number | undefined>;
	storeModelMenuState: (state: TelegramModelMenuState<TModel>) => void;
}

function isTelegramStatusMenuCallbackAction(
	data: string | undefined,
	action: "model" | "thinking" | "settings",
): boolean {
	return data === `menu:${action}` || data === `status:${action}`;
}

function applyTelegramMenuRenderPayload(
	state: TelegramModelMenuState,
	payload: TelegramMenuRenderPayload,
): TelegramMenuRenderPayload {
	state.mode = payload.nextMode;
	return payload;
}

async function editTelegramMenuMessage(
	state: TelegramModelMenuState,
	payload: TelegramMenuRenderPayload,
	deps: TelegramMenuMessageRuntimeDeps,
): Promise<void> {
	const appliedPayload = applyTelegramMenuRenderPayload(state, payload);
	await deps.editInteractiveMessage(
		state.chatId,
		state.messageId,
		appliedPayload.text,
		appliedPayload.mode,
		appliedPayload.replyMarkup,
	);
}

function sendTelegramMenuMessage(
	state: TelegramModelMenuState,
	payload: TelegramMenuRenderPayload,
	deps: TelegramMenuMessageRuntimeDeps,
): Promise<number | undefined> {
	const appliedPayload = applyTelegramMenuRenderPayload(state, payload);
	return deps.sendInteractiveMessage(
		state.chatId,
		appliedPayload.text,
		appliedPayload.mode,
		appliedPayload.replyMarkup,
		state.threadId !== undefined ? { target: { chatId: state.chatId, threadId: state.threadId } } : undefined,
	);
}

export async function openTelegramStatusMenu<TModel extends MenuModel = MenuModel>(
	deps: TelegramStatusMenuOpenDeps<TModel>,
): Promise<void> {
	const state = await deps.getModelMenuState();
	const messageId = await deps.sendStatusMenu(
		state,
		deps.buildStatusHtml(),
		deps.getActiveModel(),
		deps.getThinkingLevel(),
		deps.getQueueItemCount?.() ?? 0,
	);
	if (messageId === undefined) return;
	state.messageId = messageId;
	state.mode = "status";
	deps.storeModelMenuState(state);
}

export async function handleTelegramStatusMenuCallbackAction(
	callbackQueryId: string,
	data: string | undefined,
	activeModel: MenuModel | undefined,
	deps: TelegramStatusMenuCallbackDeps,
): Promise<boolean> {
	if (isTelegramStatusMenuCallbackAction(data, "model")) {
		await deps.updateModelMenuMessage();
		await deps.answerCallbackQuery(callbackQueryId);
		return true;
	}
	if (isTelegramStatusMenuCallbackAction(data, "settings")) {
		if (!deps.updateSettingsMenuMessage) return false;
		await deps.updateSettingsMenuMessage();
		await deps.answerCallbackQuery(callbackQueryId);
		return true;
	}
	if (!isTelegramStatusMenuCallbackAction(data, "thinking")) return false;
	if (deps.isVoiceReplyActive?.()) {
		await deps.answerCallbackQuery(callbackQueryId, UI_TOAST.thinkingDisabledVoice);
		return true;
	}
	if (!activeModel?.reasoning) {
		await deps.answerCallbackQuery(callbackQueryId, UI_TOAST.thinkingUnavailable);
		return true;
	}
	await deps.updateThinkingMenuMessage();
	await deps.answerCallbackQuery(callbackQueryId);
	return true;
}

export function buildStatusReplyMarkup(
	activeModel: MenuModel | undefined,
	currentThinkingLevel: ThinkingLevel,
	queueItemCount = 0,
	sectionRegistry?: TelegramSectionRegistry,
	isVoiceReplyActive?: boolean,
): TelegramReplyMarkup {
	type StatusButton = { text: string; callback_data: string };
	const buttons: StatusButton[] = [
		{
			text: formatStatusButtonLabel(
				UI_STATUS.buttonModel,
				activeModel ? getCanonicalModelId(activeModel) : UI_STATUS.modelUnknown,
			),
			callback_data: "menu:model",
		},
	];
	if (activeModel?.reasoning && !isVoiceReplyActive) {
		buttons.push({
			text: formatStatusButtonLabel(UI_STATUS.buttonThinking, currentThinkingLevel),
			callback_data: "menu:thinking",
		});
	}
	buttons.push({
		text: queueItemCount === 0 ? UI_STATUS.buttonQueueEmpty : UI_STATUS.buttonQueueCount(queueItemCount),
		callback_data: "menu:queue",
	});
	if (sectionRegistry) {
		buttons.push(...getTelegramSectionMainMenuRows(sectionRegistry));
	}
	buttons.push({
		text: UI_STATUS.buttonSettings,
		callback_data: "menu:settings",
	});

	// Compact main-menu chrome: two buttons per row (last row may be a single button).
	const rows: StatusButton[][] = [];
	for (let index = 0; index < buttons.length; index += 2) {
		rows.push(buttons.slice(index, index + 2));
	}
	return { inline_keyboard: rows };
}

export function buildTelegramStatusMenuRenderPayload(
	statusText: string,
	activeModel: MenuModel | undefined,
	currentThinkingLevel: ThinkingLevel,
	queueItemCount = 0,
	sectionRegistry?: TelegramSectionRegistry,
	isVoiceReplyActive?: boolean,
): TelegramMenuRenderPayload {
	return {
		nextMode: "status",
		text: statusText,
		mode: "html",
		replyMarkup: buildStatusReplyMarkup(
			activeModel,
			currentThinkingLevel,
			queueItemCount,
			sectionRegistry,
			isVoiceReplyActive,
		),
	};
}

export async function updateTelegramStatusMessage(
	state: TelegramModelMenuState,
	statusText: string,
	activeModel: MenuModel | undefined,
	currentThinkingLevel: ThinkingLevel,
	deps: TelegramMenuMessageRuntimeDeps,
	queueItemCount = 0,
	sectionRegistry?: TelegramSectionRegistry,
	isVoiceReplyActive?: boolean,
): Promise<void> {
	await editTelegramMenuMessage(
		state,
		buildTelegramStatusMenuRenderPayload(
			statusText,
			activeModel,
			currentThinkingLevel,
			queueItemCount,
			sectionRegistry,
			isVoiceReplyActive,
		),
		deps,
	);
}

export function sendTelegramStatusMessage(
	state: TelegramModelMenuState,
	statusText: string,
	activeModel: MenuModel | undefined,
	currentThinkingLevel: ThinkingLevel,
	deps: TelegramMenuMessageRuntimeDeps,
	queueItemCount = 0,
	sectionRegistry?: TelegramSectionRegistry,
	isVoiceReplyActive?: boolean,
): Promise<number | undefined> {
	return sendTelegramMenuMessage(
		state,
		buildTelegramStatusMenuRenderPayload(
			statusText,
			activeModel,
			currentThinkingLevel,
			queueItemCount,
			sectionRegistry,
			isVoiceReplyActive,
		),
		deps,
	);
}
