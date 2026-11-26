/**
 * Telegram queue menu UI helpers
 * Zones: telegram ui, queue controls, menu composition
 * Owns queue-menu rendering, queue item callbacks, and queue-menu runtime adapters while core queue mechanics stay in queue
 */

import type { TelegramInlineKeyboardMarkup } from "./keyboard.ts";
import type { TelegramModelMenuState } from "./menu.ts";
import type { MenuModel } from "./model.ts";
import * as Queue from "./queue.ts";
import { UI_NAV, UI_QUEUE, UI_TOAST } from "./ui-copy.ts";

// --- Queue Menu ---

const QUEUE_ITEM_PROMPT_HTML_LIMIT = 3600;
const QUEUE_ITEM_PROMPT_TRUNCATION_SUFFIX = "\n… [truncated]";
const EMPTY_QUEUE_REFRESH_TITLES = UI_QUEUE.emptyRefreshTitles;
type TelegramQueueMenuReplyMarkup = TelegramInlineKeyboardMarkup;
interface TelegramQueueMenuItem {
	chatId: number;
	replyToMessageId: number;
	queuePosition: number;
	isPriority: boolean;
	priorityEmoji?: string;
	hasAttachments: boolean;
	statusSummary: string;
	promptText: string;
}

function toTelegramQueueMenuItems<Context>(
	items: readonly Queue.TelegramQueueItem<Context>[],
): TelegramQueueMenuItem[] {
	return items.map((item, index) => {
		return {
			chatId: item.chatId,
			replyToMessageId: item.replyToMessageId,
			queuePosition: index + 1,
			isPriority: item.queueLane === "priority",
			priorityEmoji: item.kind === "prompt" ? item.priorityEmoji : undefined,
			hasAttachments: item.kind === "prompt" && item.queuedAttachments.length > 0,
			statusSummary: item.statusSummary,
			promptText: Queue.resolveTelegramQueueItemText(item),
		};
	});
}

function buildTelegramQueueMenuReplyMarkup(
	items: readonly TelegramQueueMenuItem[],
	emptyRefreshIndex = 0,
): TelegramQueueMenuReplyMarkup {
	const backRow = [{ text: UI_NAV.mainMenu, callback_data: "menu:back" }];
	const nextEmptyRefreshIndex = (emptyRefreshIndex + 1) % EMPTY_QUEUE_REFRESH_TITLES.length;
	const refreshData = items.length === 0 ? `queue:refresh:${nextEmptyRefreshIndex}` : "queue:refresh";
	const refreshRow = [{ text: UI_QUEUE.refresh, callback_data: refreshData }];
	if (items.length === 0) return { inline_keyboard: [backRow, refreshRow] };
	const rows = items.map((item, index) => {
		const prefix = item.isPriority ? `${item.priorityEmoji ?? "⚡"} ` : item.hasAttachments ? "📎 " : "";
		const label = `${index + 1}. ${prefix}${item.statusSummary}`;
		return [
			{
				text: label,
				callback_data: `queue:pick:${item.chatId}:${item.replyToMessageId}`,
			},
		];
	});
	return { inline_keyboard: [backRow, refreshRow, ...rows] };
}

function findTelegramQueueItem<Context>(
	items: readonly Queue.TelegramQueueItem<Context>[],
	chatId: number,
	replyToMessageId: number,
): Queue.TelegramQueueItem<Context> | undefined {
	return items.find((item) => {
		return item.chatId === chatId && item.replyToMessageId === replyToMessageId;
	});
}

function findTelegramQueueMenuItem(
	items: readonly TelegramQueueMenuItem[],
	chatId: number,
	replyToMessageId: number,
): TelegramQueueMenuItem | undefined {
	return items.find((item) => {
		return item.chatId === chatId && item.replyToMessageId === replyToMessageId;
	});
}

function escapeTelegramQueueMenuHtmlChar(char: string): string {
	if (char === "&") return "&amp;";
	if (char === "<") return "&lt;";
	if (char === ">") return "&gt;";
	return char;
}

function escapeTelegramQueueMenuHtml(text: string): string {
	return Array.from(text).map(escapeTelegramQueueMenuHtmlChar).join("");
}

function escapeTelegramQueueMenuHtmlPreview(text: string): string {
	const suffix = escapeTelegramQueueMenuHtml(QUEUE_ITEM_PROMPT_TRUNCATION_SUFFIX);
	let escaped = "";
	let truncated = false;
	for (const char of text) {
		const next = escapeTelegramQueueMenuHtmlChar(char);
		if (escaped.length + next.length + suffix.length > QUEUE_ITEM_PROMPT_HTML_LIMIT) {
			truncated = true;
			break;
		}
		escaped += next;
	}
	return truncated ? escaped + suffix : escaped;
}

function getTelegramQueueMenuItemText(item: TelegramQueueMenuItem): string {
	const badge = item.isPriority ? ` ${item.priorityEmoji ?? "⚡"}` : "";
	const heading = `<b>${item.queuePosition}.</b>${badge}`;
	const preview = `<pre>${escapeTelegramQueueMenuHtmlPreview(item.promptText)}</pre>`;
	return `${heading}\n${preview}`;
}

function buildTelegramQueueItemSubmenuReplyMarkup(
	chatId: number,
	replyToMessageId: number,
	isPriority: boolean,
): TelegramQueueMenuReplyMarkup {
	return {
		inline_keyboard: [
			[{ text: UI_NAV.back, callback_data: "queue:list" }],
			[
				{
					text: isPriority ? UI_QUEUE.priorityOn : UI_QUEUE.priorityOff,
					callback_data: `queue:prio-set:${chatId}:${replyToMessageId}:priority`,
				},
				{
					text: isPriority ? UI_QUEUE.normalOff : UI_QUEUE.normalOn,
					callback_data: `queue:prio-set:${chatId}:${replyToMessageId}:normal`,
				},
			],
			[
				{
					text: UI_QUEUE.delete,
					callback_data: `queue:delete:${chatId}:${replyToMessageId}`,
				},
			],
		],
	};
}

function buildTelegramQueueDeleteConfirmationReplyMarkup(
	chatId: number,
	replyToMessageId: number,
): TelegramQueueMenuReplyMarkup {
	return {
		inline_keyboard: [
			[
				{
					text: UI_QUEUE.confirmDelete,
					callback_data: `queue:confirm-delete:${chatId}:${replyToMessageId}`,
				},
				{
					text: UI_QUEUE.confirmNo,
					callback_data: `queue:keep:${chatId}:${replyToMessageId}`,
				},
			],
		],
	};
}
interface TelegramQueueMenuCallbackDeps<Context = unknown> {
	getQueuedItems: () => TelegramQueueMenuItem[];
	findItem: (chatId: number, replyToMessageId: number) => TelegramQueueMenuItem | undefined;
	togglePriority: (chatId: number, replyToMessageId: number) => boolean;
	setPriority: (chatId: number, replyToMessageId: number, enabled: boolean) => boolean;
	cancelItem: (chatId: number, replyToMessageId: number, ctx: Context) => boolean;
	updateQueueMessage: (
		chatId: number,
		messageId: number,
		text: string,
		replyMarkup: TelegramQueueMenuReplyMarkup,
	) => Promise<number | undefined>;
	answerCallbackQuery: (callbackQueryId: string, text?: string) => Promise<void>;
	updateStatus: (ctx: Context) => void;
}

async function handleTelegramQueueMenuCallback<Context>(
	callbackQueryId: string,
	data: string,
	replyChatId: number,
	replyMessageId: number,
	ctx: Context,
	deps: TelegramQueueMenuCallbackDeps<Context>,
): Promise<boolean> {
	if (!data.startsWith("queue:")) return false;
	if (data === "queue:noop") {
		await deps.answerCallbackQuery(callbackQueryId);
		return true;
	}
	if (data === "queue:list") {
		await updateTelegramQueueMenuList(callbackQueryId, replyChatId, replyMessageId, deps);
		return true;
	}
	const refreshMatch = data.match(/^queue:refresh(?::(\d+))?$/);
	if (refreshMatch) {
		await updateTelegramQueueMenuList(
			callbackQueryId,
			replyChatId,
			replyMessageId,
			deps,
			undefined,
			refreshMatch[1] === undefined ? 0 : Number(refreshMatch[1]),
		);
		return true;
	}
	const pickMatch = data.match(/^queue:pick:(\d+):(\d+)$/);
	if (pickMatch) {
		await handleTelegramQueueMenuPick(
			callbackQueryId,
			replyChatId,
			replyMessageId,
			Number(pickMatch[1]),
			Number(pickMatch[2]),
			deps,
		);
		return true;
	}
	const prioSetMatch = data.match(/^queue:prio-set:(\d+):(\d+):(priority|normal)$/);
	if (prioSetMatch) {
		await handleTelegramQueueMenuPrioritySet(
			callbackQueryId,
			replyChatId,
			replyMessageId,
			Number(prioSetMatch[1]),
			Number(prioSetMatch[2]),
			prioSetMatch[3] === "priority",
			ctx,
			deps,
		);
		return true;
	}
	const prioMatch = data.match(/^queue:prio:(\d+):(\d+)$/);
	if (prioMatch) {
		await handleTelegramQueueMenuPriority(
			callbackQueryId,
			replyChatId,
			replyMessageId,
			Number(prioMatch[1]),
			Number(prioMatch[2]),
			ctx,
			deps,
		);
		return true;
	}
	const deleteMatch = data.match(/^queue:(?:delete|cancel):(\d+):(\d+)$/);
	if (deleteMatch) {
		await handleTelegramQueueMenuDeleteRequest(
			callbackQueryId,
			replyChatId,
			replyMessageId,
			Number(deleteMatch[1]),
			Number(deleteMatch[2]),
			deps,
		);
		return true;
	}
	const keepMatch = data.match(/^queue:keep:(\d+):(\d+)$/);
	if (keepMatch) {
		await handleTelegramQueueMenuKeep(
			callbackQueryId,
			replyChatId,
			replyMessageId,
			Number(keepMatch[1]),
			Number(keepMatch[2]),
			deps,
		);
		return true;
	}
	const confirmDeleteMatch = data.match(/^queue:confirm-delete:(\d+):(\d+)$/);
	if (confirmDeleteMatch) {
		await handleTelegramQueueMenuConfirmDelete(
			callbackQueryId,
			replyChatId,
			replyMessageId,
			Number(confirmDeleteMatch[1]),
			Number(confirmDeleteMatch[2]),
			ctx,
			deps,
		);
		return true;
	}
	return false;
}

function getTelegramQueueMenuListText(items: readonly TelegramQueueMenuItem[], emptyRefreshIndex?: number): string {
	if (items.length > 0) return UI_QUEUE.title;
	if (emptyRefreshIndex === undefined) return UI_QUEUE.empty;
	return EMPTY_QUEUE_REFRESH_TITLES[emptyRefreshIndex % EMPTY_QUEUE_REFRESH_TITLES.length];
}

async function updateTelegramQueueMenuList<Context>(
	callbackQueryId: string,
	replyChatId: number,
	replyMessageId: number,
	deps: TelegramQueueMenuCallbackDeps<Context>,
	notice?: string,
	emptyRefreshIndex?: number,
): Promise<void> {
	const items = deps.getQueuedItems();
	await deps.updateQueueMessage(
		replyChatId,
		replyMessageId,
		getTelegramQueueMenuListText(items, emptyRefreshIndex),
		buildTelegramQueueMenuReplyMarkup(items, emptyRefreshIndex),
	);
	await deps.answerCallbackQuery(callbackQueryId, notice);
}

async function refreshStaleTelegramQueueMenuItem<Context>(
	callbackQueryId: string,
	replyChatId: number,
	replyMessageId: number,
	deps: TelegramQueueMenuCallbackDeps<Context>,
): Promise<void> {
	await updateTelegramQueueMenuList(callbackQueryId, replyChatId, replyMessageId, deps, "Item no longer in queue.");
}

async function handleTelegramQueueMenuPick<Context>(
	callbackQueryId: string,
	replyChatId: number,
	replyMessageId: number,
	chatId: number,
	msgId: number,
	deps: TelegramQueueMenuCallbackDeps<Context>,
): Promise<void> {
	const item = deps.findItem(chatId, msgId);
	if (!item) {
		return refreshStaleTelegramQueueMenuItem(callbackQueryId, replyChatId, replyMessageId, deps);
	}
	await deps.updateQueueMessage(
		replyChatId,
		replyMessageId,
		getTelegramQueueMenuItemText(item),
		buildTelegramQueueItemSubmenuReplyMarkup(chatId, msgId, item.isPriority),
	);
	await deps.answerCallbackQuery(callbackQueryId);
}

async function handleTelegramQueueMenuPriority<Context>(
	callbackQueryId: string,
	replyChatId: number,
	replyMessageId: number,
	chatId: number,
	msgId: number,
	ctx: Context,
	deps: TelegramQueueMenuCallbackDeps<Context>,
): Promise<void> {
	const item = deps.findItem(chatId, msgId);
	if (!item) {
		return refreshStaleTelegramQueueMenuItem(callbackQueryId, replyChatId, replyMessageId, deps);
	}
	await updateTelegramQueueMenuPriority(
		callbackQueryId,
		replyChatId,
		replyMessageId,
		chatId,
		msgId,
		!item.isPriority,
		ctx,
		deps,
	);
}

async function handleTelegramQueueMenuPrioritySet<Context>(
	callbackQueryId: string,
	replyChatId: number,
	replyMessageId: number,
	chatId: number,
	msgId: number,
	enabled: boolean,
	ctx: Context,
	deps: TelegramQueueMenuCallbackDeps<Context>,
): Promise<void> {
	const item = deps.findItem(chatId, msgId);
	if (!item) {
		return refreshStaleTelegramQueueMenuItem(callbackQueryId, replyChatId, replyMessageId, deps);
	}
	await updateTelegramQueueMenuPriority(
		callbackQueryId,
		replyChatId,
		replyMessageId,
		chatId,
		msgId,
		enabled,
		ctx,
		deps,
	);
}

async function updateTelegramQueueMenuPriority<Context>(
	callbackQueryId: string,
	replyChatId: number,
	replyMessageId: number,
	chatId: number,
	msgId: number,
	enabled: boolean,
	ctx: Context,
	deps: TelegramQueueMenuCallbackDeps<Context>,
): Promise<void> {
	deps.setPriority(chatId, msgId, enabled);
	deps.updateStatus(ctx);
	const updated = deps.findItem(chatId, msgId);
	if (!updated) {
		return refreshStaleTelegramQueueMenuItem(callbackQueryId, replyChatId, replyMessageId, deps);
	}
	await deps.updateQueueMessage(
		replyChatId,
		replyMessageId,
		getTelegramQueueMenuItemText(updated),
		buildTelegramQueueItemSubmenuReplyMarkup(chatId, msgId, updated.isPriority),
	);
	await deps.answerCallbackQuery(callbackQueryId, updated.isPriority ? UI_TOAST.prioritized : UI_TOAST.normalPriority);
}

async function handleTelegramQueueMenuDeleteRequest<Context>(
	callbackQueryId: string,
	replyChatId: number,
	replyMessageId: number,
	chatId: number,
	msgId: number,
	deps: TelegramQueueMenuCallbackDeps<Context>,
): Promise<void> {
	const item = deps.findItem(chatId, msgId);
	if (!item) {
		return refreshStaleTelegramQueueMenuItem(callbackQueryId, replyChatId, replyMessageId, deps);
	}
	await deps.updateQueueMessage(
		replyChatId,
		replyMessageId,
		UI_QUEUE.deleteQuestion,
		buildTelegramQueueDeleteConfirmationReplyMarkup(chatId, msgId),
	);
	await deps.answerCallbackQuery(callbackQueryId);
}

async function handleTelegramQueueMenuKeep<Context>(
	callbackQueryId: string,
	replyChatId: number,
	replyMessageId: number,
	chatId: number,
	msgId: number,
	deps: TelegramQueueMenuCallbackDeps<Context>,
): Promise<void> {
	const item = deps.findItem(chatId, msgId);
	if (!item) {
		return refreshStaleTelegramQueueMenuItem(callbackQueryId, replyChatId, replyMessageId, deps);
	}
	await deps.updateQueueMessage(
		replyChatId,
		replyMessageId,
		getTelegramQueueMenuItemText(item),
		buildTelegramQueueItemSubmenuReplyMarkup(chatId, msgId, item.isPriority),
	);
	await deps.answerCallbackQuery(callbackQueryId, UI_TOAST.keptInQueue);
}

async function handleTelegramQueueMenuConfirmDelete<Context>(
	callbackQueryId: string,
	replyChatId: number,
	replyMessageId: number,
	chatId: number,
	msgId: number,
	ctx: Context,
	deps: TelegramQueueMenuCallbackDeps<Context>,
): Promise<void> {
	const removed = deps.cancelItem(chatId, msgId, ctx);
	deps.updateStatus(ctx);
	await updateTelegramQueueMenuList(
		callbackQueryId,
		replyChatId,
		replyMessageId,
		deps,
		removed ? UI_TOAST.deletedFromQueue : UI_TOAST.itemNotFound,
	);
}

interface TelegramQueueMenuCallbackQuery {
	id: string;
	data?: string;
	message?: { chat?: { id?: number }; message_id?: number };
}
interface TelegramQueueMenuRuntime<Context> {
	openQueueMenu: (chatId: number, replyToMessageId: number, ctx: Context) => Promise<void>;
	handleCallbackQuery: (query: TelegramQueueMenuCallbackQuery, ctx: Context) => Promise<boolean>;
}
export function createTelegramQueueMenuRuntime<Context, TModel extends MenuModel = MenuModel>(deps: {
	telegramQueueStore: Queue.TelegramQueueStateStore<Context>;
	queueMutationRuntime: Queue.TelegramQueueMutationController<Context>;
	sendInteractiveMessage: (
		chatId: number,
		text: string,
		mode: "html",
		replyMarkup: TelegramQueueMenuReplyMarkup,
	) => Promise<number | undefined>;
	editInteractiveMessage: (
		chatId: number,
		messageId: number,
		text: string,
		mode: "html",
		replyMarkup: TelegramQueueMenuReplyMarkup,
	) => Promise<void>;
	answerCallbackQuery: (callbackQueryId: string, text?: string) => Promise<void>;
	getModelMenuState: (chatId: number, ctx: Context) => Promise<TelegramModelMenuState<TModel>>;
	getStoredModelMenuState: (
		messageId: number | undefined,
		chatId?: number,
	) => TelegramModelMenuState<TModel> | undefined;
	storeModelMenuState: (state: TelegramModelMenuState<TModel>) => void;
	updateStatusMessage: (state: TelegramModelMenuState<TModel>, ctx: Context) => Promise<void>;
	updateStatus: (ctx: Context) => void;
}): TelegramQueueMenuRuntime<Context> {
	const sendQueueMenuMessage = createQueueMenuSendMessageAdapter(deps.sendInteractiveMessage);
	const editQueueMenuMessage = createQueueMenuEditMessageAdapter(deps.editInteractiveMessage);
	return {
		openQueueMenu: createOpenQueueMenu<Context, TModel>({
			getQueuedItems: deps.telegramQueueStore.getQueuedItems,
			getModelMenuState: deps.getModelMenuState,
			storeModelMenuState: deps.storeModelMenuState,
			sendInteractiveMessage: sendQueueMenuMessage,
		}),
		handleCallbackQuery: createQueueMenuCallbackHandler<Context, TModel>({
			telegramQueueStore: deps.telegramQueueStore,
			queueMutationRuntime: deps.queueMutationRuntime,
			editInteractiveMessage: editQueueMenuMessage,
			getStoredModelMenuState: deps.getStoredModelMenuState,
			updateStatusMessage: deps.updateStatusMessage,
			answerCallbackQuery: deps.answerCallbackQuery,
			updateStatus: deps.updateStatus,
		}),
	};
}

function createOpenQueueMenu<Context, TModel extends MenuModel = MenuModel>(deps: {
	getQueuedItems: () => Queue.TelegramQueueItem<Context>[];
	getModelMenuState: (chatId: number, ctx: Context) => Promise<TelegramModelMenuState<TModel>>;
	storeModelMenuState: (state: TelegramModelMenuState<TModel>) => void;
	sendInteractiveMessage: (
		chatId: number,
		replyToMessageId: number,
		text: string,
		replyMarkup: TelegramQueueMenuReplyMarkup,
	) => Promise<number | undefined>;
}) {
	return async (chatId: number, replyToMessageId: number, ctx: Context): Promise<void> => {
		const state = await deps.getModelMenuState(chatId, ctx);
		const menuItems = toTelegramQueueMenuItems(deps.getQueuedItems());
		const text = getTelegramQueueMenuListText(menuItems);
		const messageId = await deps.sendInteractiveMessage(
			chatId,
			replyToMessageId,
			text,
			buildTelegramQueueMenuReplyMarkup(menuItems),
		);
		if (messageId === undefined) return;
		state.messageId = messageId;
		state.mode = "queue";
		deps.storeModelMenuState(state);
	};
}

function createQueueMenuCallbackHandler<Context, TModel extends MenuModel = MenuModel>(deps: {
	telegramQueueStore: Queue.TelegramQueueStateStore<Context>;
	queueMutationRuntime: Queue.TelegramQueueMutationController<Context>;
	editInteractiveMessage: (
		chatId: number,
		messageId: number,
		text: string,
		replyMarkup: TelegramQueueMenuReplyMarkup,
	) => Promise<number | undefined>;
	getStoredModelMenuState: (
		messageId: number | undefined,
		chatId?: number,
	) => TelegramModelMenuState<TModel> | undefined;
	updateStatusMessage: (state: TelegramModelMenuState<TModel>, ctx: Context) => Promise<void>;
	answerCallbackQuery: (callbackQueryId: string, text?: string) => Promise<void>;
	updateStatus: (ctx: Context) => void;
}) {
	return async (query: TelegramQueueMenuCallbackQuery, ctx: Context): Promise<boolean> => {
		const data = query.data;
		const chatId = query.message?.chat?.id;
		const messageId = query.message?.message_id;
		if (!data || typeof chatId !== "number" || typeof messageId !== "number") return false;
		if (data === "menu:queue" || data === "status:queue") {
			const state = deps.getStoredModelMenuState(messageId, chatId);
			if (!state) {
				await deps.answerCallbackQuery(query.id, UI_TOAST.interactiveExpired);
				return true;
			}
			const menuItems = toTelegramQueueMenuItems(deps.telegramQueueStore.getQueuedItems());
			await deps.editInteractiveMessage(
				chatId,
				messageId,
				getTelegramQueueMenuListText(menuItems),
				buildTelegramQueueMenuReplyMarkup(menuItems),
			);
			state.mode = "queue";
			await deps.answerCallbackQuery(query.id);
			return true;
		}
		if (!data.startsWith("queue:")) return false;
		const getQueueSnapshot = () => {
			return deps.telegramQueueStore.getQueuedItems();
		};
		const toMenuItems = () => {
			return toTelegramQueueMenuItems(getQueueSnapshot());
		};
		const findItem = (cId: number, rId: number) => {
			return findTelegramQueueMenuItem(toMenuItems(), cId, rId);
		};
		return handleTelegramQueueMenuCallback(query.id, data, chatId, messageId, ctx, {
			getQueuedItems: toMenuItems,
			findItem,
			togglePriority: (cId, rId) => {
				return toggleQueuedTelegramPromptPriority(cId, rId, ctx, {
					getQueueSnapshot,
					queueMutationRuntime: deps.queueMutationRuntime,
				});
			},
			setPriority: (cId, rId, enabled) => {
				return setQueuedTelegramPromptPriority(cId, rId, enabled, ctx, {
					getQueueSnapshot,
					queueMutationRuntime: deps.queueMutationRuntime,
				});
			},
			cancelItem: (cId, rId, c) => {
				return cancelQueuedTelegramItem(cId, rId, c, {
					getQueueSnapshot,
					queueMutationRuntime: deps.queueMutationRuntime,
				});
			},
			updateQueueMessage: deps.editInteractiveMessage,
			answerCallbackQuery: deps.answerCallbackQuery,
			updateStatus: deps.updateStatus,
		});
	};
}

function toggleQueuedTelegramPromptPriority<Context>(
	chatId: number,
	replyToMessageId: number,
	ctx: Context,
	deps: {
		getQueueSnapshot: () => Queue.TelegramQueueItem<Context>[];
		queueMutationRuntime: Queue.TelegramQueueMutationController<Context>;
	},
): boolean {
	const item = findTelegramQueueItem(deps.getQueueSnapshot(), chatId, replyToMessageId);
	if (!item) return false;
	if (item.queueLane === "priority") {
		deps.queueMutationRuntime.clearPriorityByMessageId(replyToMessageId, ctx);
	} else {
		deps.queueMutationRuntime.prioritizeByMessageId(replyToMessageId, ctx);
	}
	return true;
}

function setQueuedTelegramPromptPriority<Context>(
	chatId: number,
	replyToMessageId: number,
	enabled: boolean,
	ctx: Context,
	deps: {
		getQueueSnapshot: () => Queue.TelegramQueueItem<Context>[];
		queueMutationRuntime: Queue.TelegramQueueMutationController<Context>;
	},
): boolean {
	const item = findTelegramQueueItem(deps.getQueueSnapshot(), chatId, replyToMessageId);
	if (!item) return false;
	if (enabled) {
		deps.queueMutationRuntime.prioritizeByMessageId(replyToMessageId, ctx);
	} else {
		deps.queueMutationRuntime.clearPriorityByMessageId(replyToMessageId, ctx);
	}
	return true;
}

function cancelQueuedTelegramItem<Context>(
	chatId: number,
	replyToMessageId: number,
	ctx: Context,
	deps: {
		getQueueSnapshot: () => Queue.TelegramQueueItem<Context>[];
		queueMutationRuntime: Queue.TelegramQueueMutationController<Context>;
	},
): boolean {
	const item = findTelegramQueueItem(deps.getQueueSnapshot(), chatId, replyToMessageId);
	if (!item) return false;
	return deps.queueMutationRuntime.removeByMessageIds([item.replyToMessageId], ctx) > 0;
}

function createQueueMenuSendMessageAdapter(
	sendInteractiveMessage: (
		chatId: number,
		text: string,
		mode: "html",
		replyMarkup: TelegramQueueMenuReplyMarkup,
	) => Promise<number | undefined>,
) {
	return (
		chatId: number,
		_replyToMessageId: number,
		text: string,
		replyMarkup: TelegramQueueMenuReplyMarkup,
	): Promise<number | undefined> => {
		return sendInteractiveMessage(chatId, text, "html", replyMarkup);
	};
}

function createQueueMenuEditMessageAdapter(
	editInteractiveMessage: (
		chatId: number,
		messageId: number,
		text: string,
		mode: "html",
		replyMarkup: TelegramQueueMenuReplyMarkup,
	) => Promise<void>,
) {
	return (
		chatId: number,
		messageId: number,
		text: string,
		replyMarkup: TelegramQueueMenuReplyMarkup,
	): Promise<number | undefined> => {
		return editInteractiveMessage(chatId, messageId, text, "html", replyMarkup).then(() => {
			return undefined as number | undefined;
		});
	};
}
