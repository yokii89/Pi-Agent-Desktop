/**
 * Regression tests for Telegram menu helpers
 * Covers inline model/status/thinking menu state, callbacks, and transport payloads
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
	applyTelegramModelPageSelection,
	applyTelegramModelScopeSelection,
	buildModelMenuReplyMarkup,
	buildModelPageMenuReplyMarkup,
	buildStatusReplyMarkup,
	buildTelegramModelCallbackPlan,
	buildTelegramModelMenuRenderPayload,
	buildTelegramModelMenuState,
	buildTelegramModelMenuStateRuntime,
	buildTelegramModelPageMenuRenderPayload,
	buildTelegramStatusMenuRenderPayload,
	buildTelegramThinkingMenuRenderPayload,
	buildThinkingMenuReplyMarkup,
	buildThinkingMenuText,
	createTelegramMenuActionRuntime,
	createTelegramMenuActionRuntimeWithStateBuilder,
	createTelegramMenuCallbackHandler,
	createTelegramMenuCallbackHandlerForContext,
	createTelegramModelMenuRuntime,
	createTelegramModelMenuStateBuilder,
	formatScopedModelButtonText,
	getModelMenuItems,
	getStoredTelegramModelMenuState,
	getTelegramModelMenuPage,
	getTelegramModelSelection,
	handleStoredTelegramMenuCallback,
	handleTelegramMenuCallbackEntry,
	handleTelegramMenuCallbackRuntime,
	handleTelegramModelMenuCallbackAction,
	handleTelegramStatusMenuCallbackAction,
	handleTelegramThinkingMenuCallbackAction,
	MODEL_MENU_TITLE,
	MODEL_PAGE_MENU_TITLE,
	openTelegramModelMenu,
	openTelegramStatusMenu,
	parseTelegramMenuCallbackAction,
	resolveCachedTelegramModelMenuInputs,
	sendTelegramModelMenuMessage,
	sendTelegramStatusMessage,
	storeTelegramModelMenuState,
	TELEGRAM_MODEL_PAGE_SIZE,
	type TelegramModelMenuState,
	updateTelegramModelMenuMessage,
	updateTelegramStatusMessage,
	updateTelegramThinkingMenuMessage,
} from "../lib/menu.ts";
import { createTelegramQueueMenuRuntime } from "../lib/menu-queue.ts";
import {
	buildProactivePushSettingsReplyMarkup,
	buildProactivePushSettingsText,
	buildTelegramSettingsMenuReplyMarkup,
	buildTimeInjectionModeSettingsReplyMarkup,
	buildTimeInjectionModeSettingsText,
	buildVoiceReplyModeSettingsReplyMarkup,
	buildVoiceReplyModeSettingsText,
	createTelegramSettingsMenuRuntime,
} from "../lib/menu-settings.ts";
import type { MenuModel } from "../lib/model.ts";
import type { TelegramQueueItem } from "../lib/queue.ts";
import { createTelegramExtensionSectionRegistry } from "../lib/sections.ts";

function createMenuState<TModel extends MenuModel = MenuModel>(
	messageId: number,
	overrides: Partial<TelegramModelMenuState<TModel>> = {},
): TelegramModelMenuState<TModel> {
	return {
		chatId: 1,
		messageId,
		page: 0,
		scope: "scoped",
		scopedModels: [],
		allModels: [],
		scopedModelPatterns: [],
		canMutateScope: true,
		mode: "model",
		...overrides,
	};
}

function createMenuModel(provider: string, id: string, reasoning?: boolean): MenuModel {
	return reasoning === undefined ? { provider, id } : { provider, id, reasoning };
}

test("Menu helpers store, refresh, prune, and bound model menu state", () => {
	const menus = new Map();
	storeTelegramModelMenuState(menus, createMenuState(1), {
		maxAgeMs: 100,
		maxStoredMenus: 2,
		now: 1000,
	});
	storeTelegramModelMenuState(menus, createMenuState(2), {
		maxAgeMs: 100,
		maxStoredMenus: 2,
		now: 1010,
	});
	assert.equal(
		getStoredTelegramModelMenuState(menus, 1, {
			maxAgeMs: 100,
			maxStoredMenus: 2,
			now: 1020,
		})?.messageId,
		1,
	);
	storeTelegramModelMenuState(menus, createMenuState(3), {
		maxAgeMs: 100,
		maxStoredMenus: 2,
		now: 1030,
	});
	assert.equal(menus.has("1:2"), false);
	assert.equal(menus.has("1:1"), true);
	assert.equal(menus.has("1:3"), true);
	assert.equal(
		getStoredTelegramModelMenuState(menus, 1, {
			maxAgeMs: 10,
			maxStoredMenus: 2,
			now: 1050,
		}),
		undefined,
	);
});

test("Menu helpers scope stored model menu state by chat and message", () => {
	const menus = new Map();
	storeTelegramModelMenuState(
		menus,
		{ ...createMenuState(1), chatId: 10, note: "chat-10" },
		{ maxAgeMs: 100, maxStoredMenus: 5, now: 1000 },
	);
	storeTelegramModelMenuState(
		menus,
		{ ...createMenuState(1), chatId: 20, note: "chat-20" },
		{ maxAgeMs: 100, maxStoredMenus: 5, now: 1000 },
	);

	assert.equal(
		getStoredTelegramModelMenuState(menus, 1, { maxAgeMs: 100, maxStoredMenus: 5, now: 1010 }, 20)?.note,
		"chat-20",
	);
	assert.equal(
		getStoredTelegramModelMenuState(menus, 1, { maxAgeMs: 100, maxStoredMenus: 5, now: 1010 }, 10)?.note,
		"chat-10",
	);
});

test("Menu helpers resolve and reuse cached model menu inputs", async () => {
	const model = { provider: "test", id: "alpha" };
	let reloadCount = 0;
	const resolved = await resolveCachedTelegramModelMenuInputs(undefined, {
		cacheTtlMs: 100,
		now: 1000,
		reloadSettings: async () => {
			reloadCount += 1;
		},
		refreshAvailableModels: () => [model],
		getConfiguredScopedModelPatterns: () => ["configured"],
		getCliScopedModelPatterns: () => ["cli"],
	});
	assert.deepEqual(resolved, {
		expiresAt: 1100,
		availableModels: [model],
		configuredScopedModelPatterns: ["cli"],
		cliScopedModelPatterns: ["cli"],
	});
	assert.equal(reloadCount, 1);
	assert.equal(
		await resolveCachedTelegramModelMenuInputs(resolved, {
			cacheTtlMs: 100,
			now: 1099,
			reloadSettings: async () => {
				reloadCount += 1;
			},
			refreshAvailableModels: () => [],
			getConfiguredScopedModelPatterns: () => [],
			getCliScopedModelPatterns: () => undefined,
		}),
		resolved,
	);
	assert.equal(reloadCount, 1);
});

test("Menu runtime controller owns stored state and cached inputs", async () => {
	let reloadCount = 0;
	let refreshCount = 0;
	const model = createMenuModel("openai", "gpt-5");
	const runtime = createTelegramModelMenuRuntime({
		maxAgeMs: 100,
		maxStoredMenus: 2,
	});
	runtime.storeState(createMenuState(11));
	assert.equal(runtime.getState(11)?.messageId, 11);
	const firstState = await runtime.buildState({
		chatId: 42,
		activeModel: model,
		ctx: {
			modelRegistry: {
				refresh: () => {
					refreshCount += 1;
				},
				getAvailable: () => [model],
			},
		},
		reloadSettings: async () => {
			reloadCount += 1;
		},
		getConfiguredScopedModelPatterns: () => ["openai/gpt-5"],
	});
	const secondState = await runtime.buildState({
		chatId: 42,
		activeModel: model,
		ctx: {
			modelRegistry: {
				refresh: () => {
					refreshCount += 1;
				},
				getAvailable: () => [model],
			},
		},
		reloadSettings: async () => {
			reloadCount += 1;
		},
		getConfiguredScopedModelPatterns: () => ["openai/gpt-5"],
	});
	assert.equal(firstState.chatId, 42);
	assert.equal(secondState.chatId, 42);
	assert.equal(reloadCount, 1);
	assert.equal(refreshCount, 1);
	runtime.clearCachedInputs();
	assert.equal(runtime.getState(11)?.messageId, 11);
	runtime.clear();
	assert.equal(runtime.getState(11), undefined);
});

test("Menu state builder wires runtime to settings and model-registry ports", async () => {
	let createdForCwd = "";
	let reloadCount = 0;
	let refreshCount = 0;
	const model = createMenuModel("openai", "gpt-5");
	const runtime = createTelegramModelMenuRuntime<typeof model>();
	const getModelMenuState = createTelegramModelMenuStateBuilder({
		runtime,
		createSettingsManager: (cwd) => {
			createdForCwd = cwd;
			return {
				reload: async () => {
					reloadCount += 1;
				},
				getEnabledModels: () => ["openai/gpt-5"],
			};
		},
		getActiveModel: () => model,
	});
	const state = await getModelMenuState(42, {
		cwd: "/tmp/project",
		modelRegistry: {
			refresh: () => {
				refreshCount += 1;
			},
			getAvailable: () => [model],
		},
	});
	assert.equal(createdForCwd, "/tmp/project");
	assert.equal(reloadCount, 1);
	assert.equal(refreshCount, 1);
	assert.equal(state.chatId, 42);
	assert.deepEqual(
		state.scopedModels.map((entry) => entry.model.id),
		["gpt-5"],
	);
});

test("Menu runtime builds menu state from settings and model-registry ports", async () => {
	let reloadCount = 0;
	let refreshCount = 0;
	const model = createMenuModel("openai", "gpt-5");
	const result = await buildTelegramModelMenuStateRuntime({
		chatId: 42,
		activeModel: model,
		cachedInputs: undefined,
		cacheTtlMs: 5_000,
		ctx: {
			modelRegistry: {
				refresh: () => {
					refreshCount += 1;
				},
				getAvailable: () => [model],
			},
		},
		reloadSettings: async () => {
			reloadCount += 1;
		},
		getConfiguredScopedModelPatterns: () => ["configured"],
		getCliScopedModelPatterns: () => ["openai/gpt-5"],
	});
	assert.equal(reloadCount, 1);
	assert.equal(refreshCount, 1);
	assert.equal(result.state.chatId, 42);
	assert.deepEqual(
		result.state.allModels.map((entry) => entry.model.id),
		["gpt-5"],
	);
	assert.deepEqual(result.cachedInputs.availableModels, [model]);
});

test("Menu helpers expose UI constants", () => {
	assert.equal(MODEL_MENU_TITLE, "<b>模型</b>");
	assert.equal(MODEL_PAGE_MENU_TITLE, "<b>选择页码</b>");
	assert.equal(TELEGRAM_MODEL_PAGE_SIZE, 6);
});

test("Menu helpers build model menu state and parse callback actions", () => {
	const modelA = createMenuModel("openai", "gpt-5", true);
	const modelB = createMenuModel("anthropic", "claude-3", false);
	const state = buildTelegramModelMenuState({
		chatId: 1,
		activeModel: modelA,
		availableModels: [modelA, modelB],
		configuredScopedModelPatterns: ["missing-model"],
		cliScopedModelPatterns: ["missing-model"],
	});
	assert.equal(state.chatId, 1);
	assert.equal(state.scope, "all");
	assert.match(state.note ?? "", /没有与当前鉴权匹配的 CLI 限定模型/);
	assert.deepEqual(parseTelegramMenuCallbackAction("menu:model"), {
		kind: "status",
		action: "model",
	});
	assert.deepEqual(parseTelegramMenuCallbackAction("status:model"), {
		kind: "status",
		action: "model",
	});
	assert.deepEqual(parseTelegramMenuCallbackAction("menu:queue"), {
		kind: "status",
		action: "queue",
	});
	assert.deepEqual(parseTelegramMenuCallbackAction("status:queue"), {
		kind: "status",
		action: "queue",
	});
	assert.deepEqual(parseTelegramMenuCallbackAction("thinking:set:high"), {
		kind: "thinking:set",
		level: "high",
	});
	assert.deepEqual(parseTelegramMenuCallbackAction("model:pick:2"), {
		kind: "model",
		action: "pick",
		value: "2",
	});
	assert.deepEqual(parseTelegramMenuCallbackAction("model:pages"), {
		kind: "model",
		action: "pages",
		value: undefined,
	});
	assert.deepEqual(parseTelegramMenuCallbackAction("unknown"), {
		kind: "ignore",
	});
});

test("Menu helpers apply menu mutations and resolve model selections", () => {
	const modelA = createMenuModel("openai", "gpt-5", true);
	const state = createMenuState(2, {
		scope: "all",
		scopedModels: [{ model: modelA, thinkingLevel: "high" }],
		allModels: [{ model: modelA }],
		mode: "status",
	});
	assert.equal(applyTelegramModelScopeSelection(state, "scoped"), "changed");
	assert.equal(state.scope, "scoped");
	assert.equal(applyTelegramModelScopeSelection(state, "scoped"), "unchanged");
	assert.equal(applyTelegramModelScopeSelection(state, "bad"), "invalid");
	assert.equal(applyTelegramModelPageSelection(state, "2"), "changed");
	assert.equal(state.page, 2);
	assert.equal(applyTelegramModelPageSelection(state, "2"), "unchanged");
	assert.equal(applyTelegramModelPageSelection(state, "bad"), "invalid");
	assert.deepEqual(getTelegramModelSelection(state, "bad"), {
		kind: "invalid",
	});
	assert.deepEqual(getTelegramModelSelection(state, "9"), { kind: "missing" });
	assert.equal(getTelegramModelSelection(state, "0").kind, "selected");
});

test("Menu helpers omit pagination controls for one-page unscoped model lists", () => {
	const modelA = createMenuModel("openai", "gpt-5");
	const modelB = createMenuModel("openai", "gpt-5-mini");
	const state = createMenuState<MenuModel>(2, {
		scope: "all",
		scopedModels: [],
		allModels: [{ model: modelA }, { model: modelB }],
	});
	const markup = buildModelMenuReplyMarkup(state, modelA, 6);
	assert.deepEqual(
		markup.inline_keyboard.map((row) => row.map((button) => button.callback_data)),
		[["menu:back"], ["model:open:0"], ["model:open:1"]],
	);
});

test("Menu helpers derive normalized menu pages without mutating state", () => {
	const modelA = createMenuModel("openai", "gpt-5");
	const modelB = createMenuModel("anthropic", "claude-3");
	const state = createMenuState<MenuModel>(2, {
		page: 99,
		scope: "all",
		allModels: [{ model: modelA }, { model: modelB }],
	});
	const menuPage = getTelegramModelMenuPage(state, 1);
	assert.equal(menuPage.page, 1);
	assert.equal(menuPage.pageCount, 2);
	assert.equal(menuPage.start, 1);
	assert.deepEqual(menuPage.items, [{ model: modelB }]);
	assert.equal(state.page, 99);
	const markup = buildModelMenuReplyMarkup(state, modelA, 1);
	assert.equal(markup.inline_keyboard[0]?.[0]?.text, "‹ 主菜单");
	assert.equal(markup.inline_keyboard[0]?.[0]?.callback_data, "menu:back");
	assert.equal(markup.inline_keyboard[1]?.[1]?.text, "2/2");
	assert.equal(markup.inline_keyboard[1]?.[1]?.callback_data, "model:pages");
	assert.equal(state.page, 99);
});

test("Menu helpers build model page selector markup and payloads", () => {
	const models = Array.from({ length: 31 }, (_unused, index) => createMenuModel("test", `model-${index + 1}`));
	const state = createMenuState<MenuModel>(2, {
		page: 1,
		scope: "all",
		allModels: models.map((model) => ({ model })),
		mode: "model-pages",
	});
	const markup = buildModelPageMenuReplyMarkup(state, TELEGRAM_MODEL_PAGE_SIZE);
	const payload = buildTelegramModelPageMenuRenderPayload(state);
	assert.equal(markup.inline_keyboard[0]?.[0]?.text, "‹ 返回");
	assert.equal(markup.inline_keyboard[0]?.[0]?.callback_data, "model:pages:back");
	assert.deepEqual(
		markup.inline_keyboard[1]?.map((button) => button.text),
		["1", "✓ 2", "3", "4"],
	);
	assert.deepEqual(
		markup.inline_keyboard[2]?.map((button) => button.text),
		["5", "6"],
	);
	assert.equal(payload.nextMode, "model-pages");
	assert.equal(payload.text, "<b>选择页码</b>");
	assert.equal(payload.mode, "html");
});

test("Menu helpers build model callback plans for paging, page menu, selection, and restart modes", () => {
	const modelA = createMenuModel("openai", "gpt-5", true);
	const modelB = createMenuModel("anthropic", "claude-3", false);
	const state = createMenuState<MenuModel>(2, {
		scope: "all",
		scopedModels: [{ model: modelA, thinkingLevel: "high" }],
		allModels: [{ model: modelA }, { model: modelB }],
	});
	assert.deepEqual(
		buildTelegramModelCallbackPlan({
			data: "model:pages",
			state,
			activeModel: modelA,
			currentThinkingLevel: "medium",
			isIdle: true,
			canRestartBusyRun: false,
			hasActiveToolExecutions: false,
		}),
		{ kind: "update-menu" },
	);
	assert.equal(state.mode, "model-pages");
	assert.deepEqual(
		buildTelegramModelCallbackPlan({
			data: "model:pages:back",
			state,
			activeModel: modelA,
			currentThinkingLevel: "medium",
			isIdle: true,
			canRestartBusyRun: false,
			hasActiveToolExecutions: false,
		}),
		{ kind: "update-menu" },
	);
	assert.equal(state.mode, "model");
	assert.deepEqual(
		buildTelegramModelCallbackPlan({
			data: "model:open:1",
			state,
			activeModel: modelA,
			currentThinkingLevel: "medium",
			isIdle: true,
			canRestartBusyRun: false,
			hasActiveToolExecutions: false,
		}),
		{ kind: "update-menu" },
	);
	assert.equal(state.mode, "model-detail");
	assert.equal(state.selectedModelIndex, 1);
	assert.equal(state.selectedModelKey, "anthropic/claude-3");
	assert.deepEqual(
		buildTelegramModelCallbackPlan({
			data: "model:scope-toggle",
			state,
			activeModel: modelA,
			currentThinkingLevel: "medium",
			isIdle: true,
			canRestartBusyRun: false,
			hasActiveToolExecutions: false,
		}),
		{
			kind: "persist-scope",
			patterns: ["anthropic/claude-3"],
			text: "已加入限定模型",
		},
	);
	assert.deepEqual(
		buildTelegramModelCallbackPlan({
			data: "model:page:1",
			state,
			activeModel: modelA,
			currentThinkingLevel: "medium",
			isIdle: true,
			canRestartBusyRun: false,
			hasActiveToolExecutions: false,
		}),
		{ kind: "update-menu" },
	);
	assert.deepEqual(
		buildTelegramModelCallbackPlan({
			data: "model:pick:0",
			state,
			activeModel: modelA,
			currentThinkingLevel: "medium",
			isIdle: true,
			canRestartBusyRun: false,
			hasActiveToolExecutions: false,
		}),
		{
			kind: "refresh-status",
			selection: state.allModels[0],
			callbackText: "模型  gpt-5",
			shouldApplyThinkingLevel: false,
		},
	);
	assert.deepEqual(
		buildTelegramModelCallbackPlan({
			data: "model:pick:1",
			state,
			activeModel: modelA,
			currentThinkingLevel: "medium",
			isIdle: false,
			canRestartBusyRun: true,
			hasActiveToolExecutions: true,
		}),
		{
			kind: "switch-model",
			selection: state.allModels[1],
			mode: "restart-after-tool",
			callbackText: "已切换到 claude-3。当前工具结束后将重启…",
		},
	);
	assert.deepEqual(
		buildTelegramModelCallbackPlan({
			data: "model:pick:1",
			state,
			activeModel: modelA,
			currentThinkingLevel: "medium",
			isIdle: false,
			canRestartBusyRun: false,
			hasActiveToolExecutions: false,
		}),
		{ kind: "answer", text: "Pi 正忙。请先发送 /abort、/next 或 /stop。" },
	);
});

test("Menu helpers keep model detail selection stable after scope changes", () => {
	const modelA = createMenuModel("openai", "gpt-5");
	const modelB = createMenuModel("anthropic", "claude-3");
	const state = createMenuState<MenuModel>(2, {
		scope: "scoped",
		scopedModels: [{ model: modelA }, { model: modelB, thinkingLevel: "high" }],
		allModels: [{ model: modelA }, { model: modelB }],
		scopedModelPatterns: ["openai/gpt-5", "anthropic/claude-3:high"],
	});
	assert.deepEqual(
		buildTelegramModelCallbackPlan({
			data: "model:open:1",
			state,
			activeModel: modelA,
			currentThinkingLevel: "medium",
			isIdle: true,
			canRestartBusyRun: false,
			hasActiveToolExecutions: false,
		}),
		{ kind: "update-menu" },
	);
	assert.deepEqual(
		buildTelegramModelCallbackPlan({
			data: "model:pick-selected",
			state,
			activeModel: modelA,
			currentThinkingLevel: "medium",
			isIdle: true,
			canRestartBusyRun: false,
			hasActiveToolExecutions: false,
		}),
		{
			kind: "switch-model",
			selection: state.scopedModels[1],
			mode: "idle",
			callbackText: "已切换到 claude-3",
		},
	);
	assert.deepEqual(
		buildTelegramModelCallbackPlan({
			data: "model:scope-toggle",
			state,
			activeModel: modelA,
			currentThinkingLevel: "medium",
			isIdle: true,
			canRestartBusyRun: false,
			hasActiveToolExecutions: false,
		}),
		{
			kind: "persist-scope",
			patterns: ["openai/gpt-5"],
			text: "已移出限定模型",
		},
	);
	assert.deepEqual(
		buildTelegramModelCallbackPlan({
			data: "model:pick-selected",
			state,
			activeModel: modelA,
			currentThinkingLevel: "medium",
			isIdle: true,
			canRestartBusyRun: false,
			hasActiveToolExecutions: false,
		}),
		{
			kind: "switch-model",
			selection: state.allModels[1],
			mode: "idle",
			callbackText: "已切换到 claude-3",
		},
	);
});

test("Menu helpers expand wildcard scope patterns when disabling one matched model", () => {
	const modelA = createMenuModel("openai", "gpt-5");
	const modelB = createMenuModel("openai", "gpt-4");
	const modelC = createMenuModel("anthropic", "claude-3");
	const state = createMenuState<MenuModel>(2, {
		scope: "scoped",
		scopedModels: [
			{ model: modelA, thinkingLevel: "high" },
			{ model: modelB, thinkingLevel: "high" },
			{ model: modelC },
		],
		allModels: [{ model: modelA }, { model: modelB }, { model: modelC }],
		scopedModelPatterns: ["openai/*:high", "anthropic/claude-3", "future/model"],
		selectedModelKey: "openai/gpt-5",
		mode: "model-detail",
	});
	assert.deepEqual(
		buildTelegramModelCallbackPlan({
			data: "model:scope-disable",
			state,
			activeModel: modelA,
			currentThinkingLevel: "medium",
			isIdle: true,
			canRestartBusyRun: false,
			hasActiveToolExecutions: false,
		}),
		{
			kind: "persist-scope",
			patterns: ["openai/gpt-4:high", "anthropic/claude-3", "future/model"],
			text: "已移出限定模型",
		},
	);
	assert.equal(
		state.scopedModels.some((entry) => entry.model === modelA),
		false,
	);
});

test("Menu helpers apply scoped thinking from active model detail", () => {
	const model = createMenuModel("openai", "gpt-5");
	const state = createMenuState<MenuModel>(2, {
		scope: "scoped",
		scopedModels: [{ model, thinkingLevel: "high" }],
		allModels: [{ model }],
		selectedModelIndex: 0,
		selectedModelKey: "openai/gpt-5",
		mode: "model-detail",
	});
	assert.deepEqual(
		buildTelegramModelCallbackPlan({
			data: "model:pick-selected",
			state,
			activeModel: model,
			currentThinkingLevel: "medium",
			isIdle: true,
			canRestartBusyRun: false,
			hasActiveToolExecutions: false,
		}),
		{
			kind: "refresh-status",
			selection: state.scopedModels[0],
			callbackText: "模型  gpt-5",
			shouldApplyThinkingLevel: true,
		},
	);
	assert.equal(state.mode, "model");
});

test("Menu helpers send active detail selection back to model list page", () => {
	const models = Array.from({ length: 8 }, (_value, index) => createMenuModel("openai", `model-${index}`));
	const activeModel = models[7]!;
	const state = createMenuState<MenuModel>(2, {
		scope: "all",
		scopedModels: [],
		allModels: models.map((model) => ({ model })),
		selectedModelKey: "openai/model-7",
		mode: "model-detail",
	});
	assert.deepEqual(
		buildTelegramModelCallbackPlan({
			data: "model:pick-selected",
			state,
			activeModel,
			currentThinkingLevel: "medium",
			isIdle: true,
			canRestartBusyRun: false,
			hasActiveToolExecutions: false,
		}),
		{
			kind: "refresh-status",
			selection: state.allModels[7],
			callbackText: "模型  model-7",
			shouldApplyThinkingLevel: false,
		},
	);
	assert.equal(state.mode, "model");
	assert.equal(state.page, 1);
});

test("Menu helpers open status and model menus through runtime ports", async () => {
	const events: string[] = [];
	const model = { provider: "test", id: "alpha", reasoning: true };
	const statusState = createMenuState(0);
	await openTelegramStatusMenu({
		isIdle: () => true,
		sendBusyMessage: async () => {
			events.push("unexpected:busy-status");
		},
		getModelMenuState: async () => statusState,
		buildStatusHtml: () => "status-html",
		getActiveModel: () => model,
		getThinkingLevel: () => "medium",
		sendStatusMenu: async (state, html, activeModel, level) => {
			events.push(`status:${state.chatId}:${html}:${activeModel?.id}:${level}`);
			return 11;
		},
		storeModelMenuState: (state) => {
			events.push(`store:${state.messageId}:${state.mode}`);
		},
	});
	const modelState = createMenuState(0);
	modelState.allModels = [{ model }];
	await openTelegramModelMenu({
		isIdle: () => false,
		canOfferInFlightModelSwitch: () => true,
		sendBusyMessage: async () => {
			events.push("unexpected:busy-model");
		},
		sendNoModelsMessage: async () => {
			events.push("unexpected:no-models");
		},
		getModelMenuState: async () => modelState,
		getActiveModel: () => model,
		sendModelMenu: async (state, activeModel) => {
			events.push(`model:${state.chatId}:${activeModel?.id}`);
			return 12;
		},
		storeModelMenuState: (state) => {
			events.push(`store:${state.messageId}:${state.mode}`);
		},
	});
	assert.deepEqual(events, [
		"status:1:status-html:alpha:medium",
		"store:11:status",
		"model:1:alpha",
		"store:12:model",
	]);
});

test("Menu helpers report model-menu busy and no-model paths", async () => {
	const events: string[] = [];
	await openTelegramStatusMenu({
		isIdle: () => false,
		sendBusyMessage: async () => {
			events.push("unexpected:busy-status");
		},
		getModelMenuState: async () => createMenuState(0),
		buildStatusHtml: () => "status",
		getActiveModel: () => undefined,
		getThinkingLevel: () => "off",
		sendStatusMenu: async () => {
			events.push("status");
			return 1;
		},
		storeModelMenuState: () => {
			events.push("store-status");
		},
	});
	await openTelegramModelMenu({
		isIdle: () => true,
		canOfferInFlightModelSwitch: () => false,
		sendBusyMessage: async () => {
			events.push("unexpected:busy-model");
		},
		sendNoModelsMessage: async () => {
			events.push("no-models");
		},
		getModelMenuState: async () => createMenuState(0),
		getActiveModel: () => undefined,
		sendModelMenu: async () => 1,
		storeModelMenuState: () => {},
	});
	await openTelegramModelMenu({
		isIdle: () => false,
		canOfferInFlightModelSwitch: () => false,
		sendBusyMessage: async () => {
			events.push("busy-model");
		},
		sendNoModelsMessage: async () => {
			events.push("unexpected:no-models");
		},
		getModelMenuState: async () => createMenuState(0),
		getActiveModel: () => undefined,
		sendModelMenu: async () => 1,
		storeModelMenuState: () => {},
	});
	assert.deepEqual(events, ["status", "store-status", "no-models", "busy-model"]);
});

test("Menu helpers route callback entry states before action handlers", async () => {
	const events: string[] = [];
	await handleTelegramMenuCallbackEntry("callback-1", undefined, undefined, {
		handleStatusAction: async () => false,
		handleThinkingAction: async () => false,
		handleModelAction: async () => false,
		answerCallbackQuery: async (_id, text) => {
			events.push(`answer:${text ?? ""}`);
		},
	});
	await handleTelegramMenuCallbackEntry("callback-2", "menu:model", undefined, {
		handleStatusAction: async () => false,
		handleThinkingAction: async () => false,
		handleModelAction: async () => false,
		answerCallbackQuery: async (_id, text) => {
			events.push(`answer:${text ?? ""}`);
		},
	});
	await handleTelegramMenuCallbackEntry(
		"callback-3",
		"menu:model",
		{
			chatId: 1,
			messageId: 2,
			page: 0,
			scope: "all",
			scopedModels: [],
			allModels: [],
			mode: "status",
		},
		{
			handleStatusAction: async () => {
				events.push("status");
				return true;
			},
			handleThinkingAction: async () => false,
			handleModelAction: async () => false,
			answerCallbackQuery: async (_id, text) => {
				events.push(`answer:${text ?? ""}`);
			},
		},
	);
	assert.deepEqual(events, ["answer:", "answer:此消息已失效。", "status"]);
});

test("Menu helpers route stored callback queries through matching action handlers", async () => {
	const events: string[] = [];
	const state = createMenuState(2);
	await handleStoredTelegramMenuCallback(
		{ id: "callback-1", data: "menu:model", message: { message_id: 2 } },
		{
			getStoredModelMenuState: (messageId) => {
				events.push(`get:${messageId}`);
				return state;
			},
			handleStatusAction: async (nextState) => {
				events.push(`status:${nextState.messageId}`);
				return true;
			},
			handleThinkingAction: async () => {
				events.push("unexpected:thinking");
				return false;
			},
			handleModelAction: async () => {
				events.push("unexpected:model");
				return false;
			},
			answerCallbackQuery: async (_id, text) => {
				events.push(`answer:${text ?? ""}`);
			},
		},
	);
	await handleStoredTelegramMenuCallback(
		{ id: "callback-2", data: "menu:model" },
		{
			getStoredModelMenuState: (messageId) => {
				events.push(`get:${messageId ?? "none"}`);
				return undefined;
			},
			handleStatusAction: async () => false,
			handleThinkingAction: async () => false,
			handleModelAction: async () => false,
			answerCallbackQuery: async (_id, text) => {
				events.push(`answer:${text ?? ""}`);
			},
		},
	);
	assert.deepEqual(events, ["get:2", "status:2", "get:none", "answer:此消息已失效。"]);
});

test("Menu runtime routes stored callback queries through callback action ports", async () => {
	const events: string[] = [];
	const model = createMenuModel("openai", "gpt-5", true);
	const state: TelegramModelMenuState<typeof model> = {
		...createMenuState<typeof model>(2),
		allModels: [{ model, thinkingLevel: "high" }],
		mode: "status",
	};
	let thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" = "medium";
	await handleTelegramMenuCallbackRuntime(
		{ id: "callback-1", data: "menu:thinking", message: { message_id: 2 } },
		{ idle: true },
		{
			getStoredModelMenuState: (messageId) => {
				events.push(`get:${messageId}`);
				return state;
			},
			getActiveModel: () => model,
			getThinkingLevel: () => thinkingLevel,
			setThinkingLevel: (level) => {
				thinkingLevel = level;
				events.push(`thinking:${level}`);
			},
			updateStatus: () => {
				events.push("status");
			},
			updateModelMenuMessage: async () => {
				events.push("model-menu");
			},
			updateThinkingMenuMessage: async () => {
				events.push("thinking-menu");
			},
			updateStatusMessage: async () => {
				events.push("status-menu");
			},
			answerCallbackQuery: async (_id, text) => {
				events.push(`answer:${text ?? ""}`);
			},
			isIdle: (ctx) => ctx.idle,
			hasActiveTelegramTurn: () => true,
			hasAbortHandler: () => true,
			hasActiveToolExecutions: () => false,
			setModel: async (nextModel) => {
				events.push(`set-model:${nextModel.id}`);
				return true;
			},
			setCurrentModel: (nextModel) => {
				events.push(`current:${nextModel.id}`);
			},
			stagePendingModelSwitch: (selection) => {
				events.push(`pending:${selection.model.id}`);
			},
			restartInterruptedTelegramTurn: (selection) => {
				events.push(`restart:${selection.model.id}`);
				return true;
			},
		},
	);
	await handleTelegramMenuCallbackRuntime(
		{ id: "callback-2", data: "thinking:set:high", message: { message_id: 2 } },
		{ idle: true },
		{
			getStoredModelMenuState: () => state,
			getActiveModel: () => model,
			getThinkingLevel: () => thinkingLevel,
			setThinkingLevel: (level) => {
				thinkingLevel = level;
				events.push(`thinking:${level}`);
			},
			updateStatus: () => {
				events.push("status");
			},
			updateModelMenuMessage: async () => {
				events.push("unexpected:model-menu");
			},
			updateThinkingMenuMessage: async () => {
				events.push("unexpected:thinking-menu");
			},
			updateStatusMessage: async () => {
				events.push("status-menu");
			},
			answerCallbackQuery: async (_id, text) => {
				events.push(`answer:${text ?? ""}`);
			},
			isIdle: (ctx) => ctx.idle,
			hasActiveTelegramTurn: () => true,
			hasAbortHandler: () => true,
			hasActiveToolExecutions: () => false,
			setModel: async () => true,
			setCurrentModel: () => {},
			stagePendingModelSwitch: () => {},
			restartInterruptedTelegramTurn: () => true,
		},
	);
	await handleTelegramMenuCallbackRuntime(
		{ id: "callback-3", data: "model:pick:0", message: { message_id: 2 } },
		{ idle: false },
		{
			getStoredModelMenuState: () => state,
			getActiveModel: () => createMenuModel("anthropic", "claude-3", true),
			getThinkingLevel: () => thinkingLevel,
			setThinkingLevel: (level) => {
				thinkingLevel = level;
				events.push(`thinking:${level}`);
			},
			updateStatus: () => {
				events.push("status");
			},
			updateModelMenuMessage: async () => {
				events.push("model-menu");
			},
			updateThinkingMenuMessage: async () => {
				events.push("unexpected:thinking-menu");
			},
			updateStatusMessage: async () => {
				events.push("status-menu");
			},
			answerCallbackQuery: async (_id, text) => {
				events.push(`answer:${text ?? ""}`);
			},
			isIdle: (ctx) => ctx.idle,
			hasActiveTelegramTurn: () => true,
			hasAbortHandler: () => true,
			hasActiveToolExecutions: () => false,
			setModel: async (nextModel) => {
				events.push(`set-model:${nextModel.id}`);
				return true;
			},
			setCurrentModel: (nextModel) => {
				events.push(`current:${nextModel.id}`);
			},
			stagePendingModelSwitch: (selection) => {
				events.push(`pending:${selection.model.id}`);
			},
			restartInterruptedTelegramTurn: (selection) => {
				events.push(`restart:${selection.model.id}`);
				return true;
			},
		},
	);
	assert.deepEqual(events, [
		"get:2",
		"thinking-menu",
		"answer:",
		"thinking:high",
		"status",
		"status-menu",
		"answer:Thinking: high",
		"set-model:gpt-5",
		"current:gpt-5",
		"thinking:high",
		"status",
		"model-menu",
		"restart:gpt-5",
		"answer:正在切换到 gpt-5 并继续…",
	]);
});

test("Menu callback handler captures runtime ports", async () => {
	const events: string[] = [];
	const state: TelegramModelMenuState = createMenuState(2);
	const handleCallback = createTelegramMenuCallbackHandler<
		{ id: string; data?: string; message?: { message_id?: number } },
		{ idle: boolean }
	>({
		getStoredModelMenuState: () => state,
		getActiveModel: () => createMenuModel("openai", "gpt-5"),
		getThinkingLevel: () => "medium",
		setThinkingLevel: (level) => {
			events.push(`thinking:${level}`);
		},
		updateStatus: () => {
			events.push("status");
		},
		updateModelMenuMessage: async () => {
			events.push("model-menu");
		},
		updateThinkingMenuMessage: async () => {
			events.push("thinking-menu");
		},
		updateStatusMessage: async () => {
			events.push("status-menu");
		},
		answerCallbackQuery: async (_id, text) => {
			events.push(`answer:${text ?? ""}`);
		},
		isIdle: (ctx) => ctx.idle,
		hasActiveTelegramTurn: () => false,
		hasAbortHandler: () => false,
		hasActiveToolExecutions: () => false,
		setModel: async () => true,
		setCurrentModel: () => {},
		stagePendingModelSwitch: () => {},
		restartInterruptedTelegramTurn: () => false,
	});
	await handleCallback({ id: "callback", data: "menu:model", message: { message_id: 2 } }, { idle: true });
	assert.deepEqual(events, ["model-menu", "answer:"]);
});

test("Menu callback adapter converts active tool count into runtime booleans", async () => {
	const events: string[] = [];
	let activeToolExecutions = 1;
	const getActiveToolExecutions = () => activeToolExecutions;
	const state: TelegramModelMenuState = {
		...createMenuState(2),
		allModels: [
			{ model: createMenuModel("openai", "gpt-5", true) },
			{ model: createMenuModel("anthropic", "claude-3", false) },
		],
	};
	const handleCallback = createTelegramMenuCallbackHandlerForContext<
		{ id: string; data?: string; message?: { message_id?: number } },
		{ idle: boolean }
	>({
		getStoredModelMenuState: () => state,
		getActiveModel: () => createMenuModel("openai", "gpt-5"),
		getThinkingLevel: () => "medium",
		setThinkingLevel: () => {},
		updateStatus: () => {},
		updateModelMenuMessage: async () => {
			events.push("model-menu");
		},
		updateThinkingMenuMessage: async () => {},
		updateStatusMessage: async () => {},
		answerCallbackQuery: async (_id, text) => {
			events.push(`answer:${text ?? ""}`);
		},
		isIdle: () => false,
		hasActiveTelegramTurn: () => true,
		hasAbortHandler: () => true,
		getActiveToolExecutions,
		setModel: async () => true,
		setCurrentModel: (nextModel) => {
			events.push(`current:${nextModel.id}`);
		},
		stagePendingModelSwitch: (selection) => {
			events.push(`pending:${selection.model.id}`);
		},
		restartInterruptedTelegramTurn: () => {
			events.push("restart");
			return true;
		},
	});
	await handleCallback({ id: "callback", data: "model:pick:1", message: { message_id: 2 } }, { idle: false });
	activeToolExecutions = 0;
	await handleCallback({ id: "callback", data: "model:pick:1", message: { message_id: 2 } }, { idle: false });
	assert.deepEqual(events, [
		"current:claude-3",
		"model-menu",
		"pending:claude-3",
		"answer:已切换到 claude-3。当前工具结束后将重启…",
		"current:claude-3",
		"model-menu",
		"restart",
		"answer:正在切换到 claude-3 并继续…",
	]);
});

test("Menu helpers execute model callback actions across update, switch, and restart paths", async () => {
	const events: string[] = [];
	const modelA = createMenuModel("openai", "gpt-5", true);
	const modelB = createMenuModel("anthropic", "claude-3", false);
	const state = createMenuState<MenuModel>(2, {
		scope: "all",
		allModels: [{ model: modelA }, { model: modelB }],
	});
	assert.equal(
		await handleTelegramModelMenuCallbackAction(
			"callback-1",
			{
				data: "model:page:1",
				state,
				activeModel: modelA,
				currentThinkingLevel: "medium",
				isIdle: true,
				canRestartBusyRun: false,
				hasActiveToolExecutions: false,
			},
			{
				updateModelMenuMessage: async () => {
					events.push("update-menu");
				},
				updateStatusMessage: async () => {
					events.push("status");
				},
				answerCallbackQuery: async (_id, text) => {
					events.push(`answer:${text ?? ""}`);
				},
				setModel: async () => true,
				setCurrentModel: (model) => {
					events.push(`current:${model.id}`);
				},
				setThinkingLevel: (level) => {
					events.push(`thinking:${level}`);
				},
				stagePendingModelSwitch: (selection) => {
					events.push(`pending:${selection.model.id}`);
				},
				restartInterruptedTelegramTurn: (selection) => {
					events.push(`restart:${selection.model.id}`);
					return true;
				},
			},
		),
		true,
	);
	assert.equal(
		await handleTelegramModelMenuCallbackAction(
			"callback-2",
			{
				data: "model:pick:1",
				state,
				activeModel: modelA,
				currentThinkingLevel: "medium",
				isIdle: false,
				canRestartBusyRun: true,
				hasActiveToolExecutions: true,
			},
			{
				updateModelMenuMessage: async () => {
					events.push("update-menu");
				},
				updateStatusMessage: async () => {
					events.push("unexpected:status");
				},
				answerCallbackQuery: async (_id, text) => {
					events.push(`answer:${text ?? ""}`);
				},
				setModel: async () => true,
				setCurrentModel: (model) => {
					events.push(`current:${model.id}`);
				},
				setThinkingLevel: (level) => {
					events.push(`thinking:${level}`);
				},
				stagePendingModelSwitch: (selection) => {
					events.push(`pending:${selection.model.id}`);
				},
				restartInterruptedTelegramTurn: (selection) => {
					events.push(`restart:${selection.model.id}`);
					return true;
				},
			},
		),
		true,
	);
	assert.equal(
		await handleTelegramModelMenuCallbackAction(
			"callback-3",
			{
				data: "model:pick:1",
				state,
				activeModel: modelA,
				currentThinkingLevel: "medium",
				isIdle: false,
				canRestartBusyRun: true,
				hasActiveToolExecutions: false,
			},
			{
				updateModelMenuMessage: async () => {
					events.push("update-menu");
				},
				updateStatusMessage: async () => {
					events.push("unexpected:status");
				},
				answerCallbackQuery: async (_id, text) => {
					events.push(`answer:${text ?? ""}`);
				},
				setModel: async () => true,
				setCurrentModel: (model) => {
					events.push(`current:${model.id}`);
				},
				setThinkingLevel: (level) => {
					events.push(`thinking:${level}`);
				},
				stagePendingModelSwitch: (selection) => {
					events.push(`pending:${selection.model.id}`);
				},
				restartInterruptedTelegramTurn: (selection) => {
					events.push(`restart:${selection.model.id}`);
					return true;
				},
			},
		),
		true,
	);
	assert.equal(events[0], "update-menu");
	assert.equal(events[1], "answer:");
	assert.equal(events[2], "current:claude-3");
	assert.equal(events[3], "update-menu");
	assert.equal(events[4], "pending:claude-3");
	assert.equal(events[5], "answer:已切换到 claude-3。当前工具结束后将重启…");
	assert.equal(events[6], "current:claude-3");
	assert.equal(events[7], "update-menu");
	assert.equal(events[8], "restart:claude-3");
	assert.equal(events[9], "answer:正在切换到 claude-3 并继续…");
});

test("Menu helpers handle status and thinking callback actions", async () => {
	const events: string[] = [];
	const reasoningModel = createMenuModel("openai", "gpt-5", true);
	const plainModel = createMenuModel("openai", "gpt-4o", false);
	assert.equal(
		await handleTelegramStatusMenuCallbackAction("callback-1", "menu:model", reasoningModel, {
			updateModelMenuMessage: async () => {
				events.push("menu:model");
			},
			updateThinkingMenuMessage: async () => {
				events.push("menu:thinking");
			},
			answerCallbackQuery: async (_id, text) => {
				events.push(`answer:${text ?? ""}`);
			},
		}),
		true,
	);
	assert.equal(
		await handleTelegramThinkingMenuCallbackAction("callback-2", "thinking:set:high", reasoningModel, {
			setThinkingLevel: (level) => {
				events.push(`set:${level}`);
			},
			getCurrentThinkingLevel: () => "high",
			updateStatusMessage: async () => {
				events.push("status:update");
			},
			answerCallbackQuery: async (_id, text) => {
				events.push(`answer:${text ?? ""}`);
			},
		}),
		true,
	);
	assert.equal(
		await handleTelegramStatusMenuCallbackAction("callback-3", "menu:thinking", plainModel, {
			updateModelMenuMessage: async () => {
				events.push("unexpected:model");
			},
			updateThinkingMenuMessage: async () => {
				events.push("unexpected:thinking");
			},
			answerCallbackQuery: async (_id, text) => {
				events.push(`answer:${text ?? ""}`);
			},
		}),
		true,
	);
	assert.equal(events[0], "menu:model");
	assert.equal(events[1], "answer:");
	assert.equal(events[2], "set:high");
	assert.equal(events[3], "status:update");
	assert.equal(events[4], "answer:Thinking: high");
	assert.equal(events[5], "answer:此模型不支持思考级别调整。");
});

test("Menu helpers build pure render payloads before transport", () => {
	const modelA = createMenuModel("openai", "gpt-5", true);
	const state = createMenuState(2, {
		scope: "all",
		allModels: [{ model: modelA }],
		mode: "status",
	});
	const modelPayload = buildTelegramModelMenuRenderPayload(state, modelA);
	const thinkingPayload = buildTelegramThinkingMenuRenderPayload(modelA, "medium");
	const statusPayload = buildTelegramStatusMenuRenderPayload("<b>Status</b>", modelA, "medium");
	assert.equal(modelPayload.nextMode, "model");
	assert.equal(modelPayload.text, "<b>模型</b>");
	assert.equal(modelPayload.mode, "html");
	const pageState = createMenuState(3, {
		scope: "all",
		allModels: [{ model: modelA }],
		mode: "model-pages",
	});
	const pagePayload = buildTelegramModelMenuRenderPayload(pageState, modelA);
	assert.equal(pagePayload.nextMode, "model-pages");
	assert.equal(pagePayload.text, "<b>选择页码</b>");
	assert.equal(pagePayload.mode, "html");
	assert.equal(thinkingPayload.nextMode, "thinking");
	assert.equal(thinkingPayload.text, "<b>思考级别</b>");
	assert.equal(thinkingPayload.mode, "html");
	assert.equal(statusPayload.nextMode, "status");
	assert.equal(statusPayload.text, "<b>Status</b>");
	assert.equal(statusPayload.mode, "html");
	assert.equal(state.mode, "status");
});

test("Menu action runtime opens and updates interactive menu messages", async () => {
	const events: string[] = [];
	const modelA = createMenuModel("openai", "gpt-5", true);
	const state = createMenuState<typeof modelA>(2, {
		scope: "all",
		allModels: [{ model: modelA }],
		mode: "status",
	});
	const runtime = createTelegramMenuActionRuntime<string, typeof modelA>({
		getModelMenuState: async () => state,
		getActiveModel: () => modelA,
		getThinkingLevel: () => "medium",
		buildStatusHtml: (ctx) => `<b>Status ${ctx}</b>`,
		storeModelMenuState: (nextState) => {
			events.push(`store:${nextState.messageId}`);
		},
		isIdle: () => true,
		canOfferInFlightModelSwitch: () => false,
		sendTextReply: async (_chatId, _replyToMessageId, text) => {
			events.push(`text:${text}`);
		},
		editInteractiveMessage: async (chatId, messageId, text, mode) => {
			events.push(`edit:${chatId}:${messageId}:${mode}:${text}`);
		},
		sendInteractiveMessage: async (chatId, text, mode) => {
			events.push(`send:${chatId}:${mode}:${text}`);
			return 99;
		},
	});
	await runtime.updateModelMenuMessage(state, "ctx");
	await runtime.updateThinkingMenuMessage(state, "ctx");
	await runtime.updateStatusMessage(state, "ctx");
	await runtime.sendStatusMessage(1, 2, "ctx");
	await runtime.openModelMenu(1, 2, "ctx");
	assert.equal(events[0], "edit:1:2:html:<b>模型</b>");
	assert.equal(events[1], "edit:1:2:html:<b>思考级别</b>");
	assert.equal(events[2], "edit:1:2:html:<b>Status ctx</b>");
	assert.equal(events[3], "send:1:html:<b>Status ctx</b>");
	assert.equal(events[4], "store:99");
	assert.equal(events[5], "send:1:html:<b>模型</b>");
	assert.equal(events[6], "store:99");
});

test("Menu action runtime with state builder opens menus from settings runtime", async () => {
	const events: string[] = [];
	const modelA = createMenuModel("openai", "gpt-5");
	const state = createMenuState<typeof modelA>(2, {
		scope: "all",
		allModels: [{ model: modelA }],
	});
	const runtime = createTelegramMenuActionRuntimeWithStateBuilder<
		typeof modelA,
		{
			cwd: string;
			modelRegistry: {
				refresh: () => void;
				getAvailable: () => [typeof modelA];
			};
		}
	>({
		runtime: {
			storeState: () => {},
			getState: () => undefined,
			clear: () => {},
			clearCachedInputs: () => {},
			buildState: async (options) => {
				await options.reloadSettings();
				events.push(`patterns:${options.getConfiguredScopedModelPatterns()?.length}`);
				return state;
			},
		},
		createSettingsManager: (cwd) => ({
			reload: async () => {
				events.push(`reload:${cwd}`);
			},
			getEnabledModels: () => ["openai/*"],
		}),
		getActiveModel: () => modelA,
		getThinkingLevel: () => "medium",
		buildStatusHtml: () => "status",
		storeModelMenuState: (nextState) => {
			events.push(`store:${nextState.messageId}`);
		},
		isIdle: () => true,
		canOfferInFlightModelSwitch: () => false,
		sendTextReply: async () => {},
		editInteractiveMessage: async () => {},
		sendInteractiveMessage: async (_chatId, text) => {
			events.push(`send:${text}`);
			return 99;
		},
	});
	await runtime.openModelMenu(1, 2, {
		cwd: "/repo",
		modelRegistry: { refresh: () => {}, getAvailable: () => [modelA] },
	});
	assert.deepEqual(events, ["reload:/repo", "patterns:1", "send:<b>模型</b>", "store:99"]);
});

test("Menu helpers update and send interactive menu messages", async () => {
	const events: string[] = [];
	const modelA = createMenuModel("openai", "gpt-5", true);
	const state = createMenuState(2, {
		scope: "all",
		allModels: [{ model: modelA }],
		mode: "status",
	});
	const deps = {
		editInteractiveMessage: async (
			chatId: number,
			messageId: number,
			text: string,
			mode: "markdown" | "html" | "plain",
		) => {
			events.push(`edit:${chatId}:${messageId}:${mode}:${text}`);
		},
		sendInteractiveMessage: async (chatId: number, text: string, mode: "markdown" | "html" | "plain") => {
			events.push(`send:${chatId}:${mode}:${text}`);
			return 99;
		},
	};
	await updateTelegramModelMenuMessage(state, modelA, deps);
	await updateTelegramThinkingMenuMessage(state, modelA, "medium", deps);
	await updateTelegramStatusMessage(state, "<b>Status</b>", modelA, "medium", deps);
	const sentStatusId = await sendTelegramStatusMessage(state, "<b>Status</b>", modelA, "medium", deps);
	const sentModelId = await sendTelegramModelMenuMessage(state, modelA, deps);
	assert.equal(sentStatusId, 99);
	assert.equal(sentModelId, 99);
	assert.equal(events[0], "edit:1:2:html:<b>模型</b>");
	assert.equal(events[1], "edit:1:2:html:<b>思考级别</b>");
	assert.equal(events[2], "edit:1:2:html:<b>Status</b>");
	assert.equal(events[3], "send:1:html:<b>Status</b>");
	assert.equal(events[4], "send:1:html:<b>模型</b>");
});

test("Queue menu keeps main-menu navigation on top", async () => {
	const state = createMenuState(2);
	const queuedItems: TelegramQueueItem<string>[] = [
		{
			kind: "prompt",
			chatId: 1,
			replyToMessageId: 10,
			queueOrder: 1,
			queueLane: "priority",
			laneOrder: 1,
			priorityEmoji: "🕊",
			statusSummary: "queued <prompt>",
			sourceMessageIds: [10],
			queuedAttachments: [],
			content: [{ type: "text", text: "[telegram] queued <prompt>\n\nfull body" }],
			historyText: "",
		},
	];
	const texts: string[] = [];
	const modes: string[] = [];
	const markups: Array<{
		inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
	}> = [];
	const runtime = createTelegramQueueMenuRuntime<string>({
		telegramQueueStore: {
			getQueuedItems: () => queuedItems,
			setQueuedItems: () => {},
			hasQueuedItems: () => queuedItems.length > 0,
		},
		queueMutationRuntime: {
			append: () => {},
			reorder: () => {},
			clear: () => 0,
			removeByMessageIds: () => 0,
			clearPriorityByMessageId: (messageId) => {
				const item = queuedItems.find((entry) => entry.replyToMessageId === messageId);
				if (!item) return false;
				item.queueLane = "default";
				return true;
			},
			prioritizeByMessageId: (messageId) => {
				const item = queuedItems.find((entry) => entry.replyToMessageId === messageId);
				if (!item) return false;
				item.queueLane = "priority";
				return true;
			},
		},
		sendInteractiveMessage: async (_chatId, text, mode, replyMarkup) => {
			texts.push(text);
			modes.push(mode);
			markups.push(replyMarkup);
			return 99;
		},
		editInteractiveMessage: async (_chatId, _messageId, text, mode, replyMarkup) => {
			texts.push(text);
			modes.push(mode);
			markups.push(replyMarkup);
		},
		answerCallbackQuery: async () => {},
		getModelMenuState: async () => state,
		getStoredModelMenuState: () => state,
		storeModelMenuState: () => {},
		updateStatusMessage: async () => {},
		updateStatus: () => {},
	});
	await runtime.openQueueMenu(1, 2, "ctx");
	await runtime.handleCallbackQuery(
		{
			id: "callback",
			data: "menu:queue",
			message: { chat: { id: 1 }, message_id: 2 },
		},
		"ctx",
	);
	await runtime.handleCallbackQuery(
		{
			id: "callback",
			data: "queue:pick:1:10",
			message: { chat: { id: 1 }, message_id: 2 },
		},
		"ctx",
	);
	await runtime.handleCallbackQuery(
		{
			id: "callback",
			data: "queue:prio-set:1:10:normal",
			message: { chat: { id: 1 }, message_id: 2 },
		},
		"ctx",
	);
	queuedItems.length = 0;
	await runtime.openQueueMenu(1, 2, "ctx");
	assert.equal(markups[0]?.inline_keyboard[0]?.[0]?.callback_data, "menu:back");
	assert.equal(markups[1]?.inline_keyboard[0]?.[0]?.callback_data, "menu:back");
	assert.deepEqual(markups[0]?.inline_keyboard[1], [{ text: "刷新", callback_data: "queue:refresh" }]);
	assert.equal(markups[0]?.inline_keyboard[2]?.[0]?.text, "1. 🕊 queued <prompt>");
	assert.deepEqual(markups[2]?.inline_keyboard[1], [
		{ text: "✓ 优先", callback_data: "queue:prio-set:1:10:priority" },
		{ text: "普通", callback_data: "queue:prio-set:1:10:normal" },
	]);
	assert.deepEqual(markups[2]?.inline_keyboard[2], [{ text: "删除", callback_data: "queue:delete:1:10" }]);
	assert.deepEqual(markups[3]?.inline_keyboard[1], [
		{ text: "优先", callback_data: "queue:prio-set:1:10:priority" },
		{ text: "✓ 普通", callback_data: "queue:prio-set:1:10:normal" },
	]);
	assert.deepEqual(markups[4]?.inline_keyboard, [
		[{ text: "‹ 主菜单", callback_data: "menu:back" }],
		[{ text: "刷新", callback_data: "queue:refresh:1" }],
	]);
	assert.equal(texts[0], "<b>队列</b>");
	assert.equal(texts[2], "<b>1.</b> 🕊\n<pre>[telegram] queued &lt;prompt&gt;\n\nfull body</pre>");
	assert.equal(texts[3], "<b>1.</b>\n<pre>[telegram] queued &lt;prompt&gt;\n\nfull body</pre>");
	assert.equal(texts[4], "<b>队列为空</b>");
	assert.deepEqual(modes, ["html", "html", "html", "html", "html"]);
});

test("Queue item detail renders prompt as raw preformatted HTML", async () => {
	const state = createMenuState(2);
	const longPathPrompt =
		`[telegram]\n[attachments] /home/user/.pi/agent/tmp/telegram\n` +
		`- /home/user/.pi/agent/tmp/telegram/file.txt\n${"&<>".repeat(2000)}`;
	const texts: string[] = [];
	const runtime = createTelegramQueueMenuRuntime<string>({
		telegramQueueStore: {
			getQueuedItems: () => [
				{
					kind: "prompt",
					chatId: 1,
					replyToMessageId: 10,
					queueOrder: 1,
					queueLane: "default",
					laneOrder: 1,
					statusSummary: "file prompt",
					sourceMessageIds: [10],
					queuedAttachments: [],
					content: [{ type: "text", text: longPathPrompt }],
					historyText: "",
				},
			],
			setQueuedItems: () => {},
			hasQueuedItems: () => true,
		},
		queueMutationRuntime: {
			append: () => {},
			reorder: () => {},
			clear: () => 0,
			removeByMessageIds: () => 0,
			clearPriorityByMessageId: () => false,
			prioritizeByMessageId: () => false,
		},
		sendInteractiveMessage: async () => 99,
		editInteractiveMessage: async (_chatId, _messageId, text) => {
			texts.push(text);
		},
		answerCallbackQuery: async () => {},
		getModelMenuState: async () => state,
		getStoredModelMenuState: () => state,
		storeModelMenuState: () => {},
		updateStatusMessage: async () => {},
		updateStatus: () => {},
	});
	await runtime.handleCallbackQuery(
		{
			id: "callback",
			data: "queue:pick:1:10",
			message: { chat: { id: 1 }, message_id: 2 },
		},
		"ctx",
	);
	assert.match(texts[0] ?? "", /^<b>1\.<\/b>\n<pre>\[telegram\]/);
	assert.match(texts[0] ?? "", /\/home\/user\/\.pi\/agent\/tmp\/telegram/);
	assert.match(texts[0] ?? "", /&amp;&lt;&gt;/);
	assert.match(texts[0] ?? "", /… \[truncated\]<\/pre>$/);
	assert.ok((texts[0] ?? "").length < 4096);
});

test("Queue item delete requires confirmation", async () => {
	const state = createMenuState(2);
	const queuedItems: TelegramQueueItem<string>[] = [
		{
			kind: "prompt",
			chatId: 1,
			replyToMessageId: 10,
			queueOrder: 1,
			queueLane: "default",
			laneOrder: 1,
			statusSummary: "delete me",
			sourceMessageIds: [10],
			queuedAttachments: [],
			content: [{ type: "text", text: "[telegram] delete me" }],
			historyText: "",
		},
	];
	const texts: string[] = [];
	const notices: Array<string | undefined> = [];
	const markups: Array<{
		inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
	}> = [];
	const runtime = createTelegramQueueMenuRuntime<string>({
		telegramQueueStore: {
			getQueuedItems: () => queuedItems,
			setQueuedItems: () => {},
			hasQueuedItems: () => queuedItems.length > 0,
		},
		queueMutationRuntime: {
			append: () => {},
			reorder: () => {},
			clear: () => 0,
			removeByMessageIds: (messageIds) => {
				const index = queuedItems.findIndex((item) => messageIds.includes(item.replyToMessageId));
				if (index === -1) return 0;
				queuedItems.splice(index, 1);
				return 1;
			},
			clearPriorityByMessageId: () => false,
			prioritizeByMessageId: () => false,
		},
		sendInteractiveMessage: async () => 99,
		editInteractiveMessage: async (_chatId, _messageId, text, _mode, replyMarkup) => {
			texts.push(text);
			markups.push(replyMarkup);
		},
		answerCallbackQuery: async (_id, text) => {
			notices.push(text);
		},
		getModelMenuState: async () => state,
		getStoredModelMenuState: () => state,
		storeModelMenuState: () => {},
		updateStatusMessage: async () => {},
		updateStatus: () => {},
	});
	await runtime.handleCallbackQuery(
		{
			id: "delete",
			data: "queue:delete:1:10",
			message: { chat: { id: 1 }, message_id: 2 },
		},
		"ctx",
	);
	assert.equal(queuedItems.length, 1);
	assert.equal(texts[0], "<b>删除此项？</b>");
	assert.deepEqual(markups[0]?.inline_keyboard, [
		[
			{ text: "删除", callback_data: "queue:confirm-delete:1:10" },
			{ text: "取消", callback_data: "queue:keep:1:10" },
		],
	]);
	await runtime.handleCallbackQuery(
		{
			id: "legacy-cancel",
			data: "queue:cancel:1:10",
			message: { chat: { id: 1 }, message_id: 2 },
		},
		"ctx",
	);
	assert.equal(queuedItems.length, 1);
	assert.equal(texts[1], "<b>删除此项？</b>");
	await runtime.handleCallbackQuery(
		{
			id: "keep",
			data: "queue:keep:1:10",
			message: { chat: { id: 1 }, message_id: 2 },
		},
		"ctx",
	);
	assert.equal(queuedItems.length, 1);
	assert.equal(texts[2], "<b>1.</b>\n<pre>[telegram] delete me</pre>");
	assert.equal(notices[2], "已保留在队列中。");
	await runtime.handleCallbackQuery(
		{
			id: "confirm",
			data: "queue:confirm-delete:1:10",
			message: { chat: { id: 1 }, message_id: 2 },
		},
		"ctx",
	);
	assert.equal(queuedItems.length, 0);
	assert.equal(texts[3], "<b>队列为空</b>");
	assert.equal(notices[3], "已从队列移除。");
});

test("Queue refresh rotates empty queue title", async () => {
	const state = createMenuState(2);
	const texts: string[] = [];
	const markups: Array<{
		inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
	}> = [];
	const runtime = createTelegramQueueMenuRuntime<string>({
		telegramQueueStore: {
			getQueuedItems: () => [],
			setQueuedItems: () => {},
			hasQueuedItems: () => false,
		},
		queueMutationRuntime: {
			append: () => {},
			reorder: () => {},
			clear: () => 0,
			removeByMessageIds: () => 0,
			clearPriorityByMessageId: () => false,
			prioritizeByMessageId: () => false,
		},
		sendInteractiveMessage: async (_chatId, text, _mode, replyMarkup) => {
			texts.push(text);
			markups.push(replyMarkup);
			return 99;
		},
		editInteractiveMessage: async (_chatId, _messageId, text, _mode, replyMarkup) => {
			texts.push(text);
			markups.push(replyMarkup);
		},
		answerCallbackQuery: async () => {},
		getModelMenuState: async () => state,
		getStoredModelMenuState: () => state,
		storeModelMenuState: () => {},
		updateStatusMessage: async () => {},
		updateStatus: () => {},
	});
	await runtime.openQueueMenu(1, 2, "ctx");
	await runtime.handleCallbackQuery(
		{
			id: "refresh-1",
			data: "queue:refresh:1",
			message: { chat: { id: 1 }, message_id: 99 },
		},
		"ctx",
	);
	await runtime.handleCallbackQuery(
		{
			id: "refresh-2",
			data: "queue:refresh:2",
			message: { chat: { id: 1 }, message_id: 99 },
		},
		"ctx",
	);
	assert.deepEqual(texts, ["<b>队列为空</b>", "<b>暂无排队任务</b>", "<b>这里还很安静</b>"]);
	assert.equal(markups[0]?.inline_keyboard[1]?.[0]?.callback_data, "queue:refresh:1");
	assert.equal(markups[1]?.inline_keyboard[1]?.[0]?.callback_data, "queue:refresh:2");
	assert.equal(markups[2]?.inline_keyboard[1]?.[0]?.callback_data, "queue:refresh:3");
});

test("Menu helpers build model, thinking, and status UI payloads", () => {
	const modelA = createMenuModel("openai", "gpt-5", true);
	const modelB = createMenuModel("anthropic", "claude-3", false);
	const state = createMenuState<MenuModel>(2, {
		scopedModels: [{ model: modelA, thinkingLevel: "high" }],
		allModels: [{ model: modelB }],
	});
	assert.deepEqual(getModelMenuItems(state), state.scopedModels);
	assert.match(formatScopedModelButtonText(state.scopedModels[0], modelA), /^✓ /);
	const modelMarkup = buildModelMenuReplyMarkup(state, modelA, 6);
	state.mode = "model-detail";
	state.selectedModelKey = "openai/gpt-5";
	state.allModels = [{ model: modelA }];
	const detailPayload = buildTelegramModelMenuRenderPayload(state, modelA);
	assert.deepEqual(detailPayload.replyMarkup.inline_keyboard[1], [
		{ text: "✓ 当前", callback_data: "model:pick-selected" },
	]);
	assert.deepEqual(detailPayload.replyMarkup.inline_keyboard[2], [
		{ text: "✓ 限定", callback_data: "model:scope-enable" },
		{ text: "全部", callback_data: "model:scope-disable" },
	]);
	const disabledDetailPayload = buildTelegramModelMenuRenderPayload(state, modelB);
	assert.deepEqual(disabledDetailPayload.replyMarkup.inline_keyboard[1], [
		{ text: "设为当前", callback_data: "model:pick-selected" },
	]);
	assert.equal(modelMarkup.inline_keyboard[0]?.[0]?.callback_data, "menu:back");
	assert.deepEqual(modelMarkup.inline_keyboard[1], [
		{ text: "✓ 限定", callback_data: "model:scope:scoped" },
		{ text: "全部", callback_data: "model:scope:all" },
	]);
	assert.equal(modelMarkup.inline_keyboard[2]?.[0]?.callback_data, "model:open:0");
	const thinkingText = buildThinkingMenuText();
	assert.equal(thinkingText, "<b>思考级别</b>");
	const thinkingMarkup = buildThinkingMenuReplyMarkup("medium");
	assert.equal(thinkingMarkup.inline_keyboard[0]?.[0]?.text, "‹ 主菜单");
	assert.equal(thinkingMarkup.inline_keyboard[0]?.[0]?.callback_data, "menu:back");
	assert.equal(
		thinkingMarkup.inline_keyboard.some((row) => row[0]?.text === "✓ medium"),
		true,
	);
	const statusMarkup = buildStatusReplyMarkup(modelA, "medium", 3);
	const statusCallbackData = statusMarkup.inline_keyboard.flatMap((row) => row.map((button) => button.callback_data));
	assert.equal(statusMarkup.inline_keyboard.length, 2);
	assert.equal(statusMarkup.inline_keyboard[0]?.[0]?.text.startsWith("模型"), true);
	assert.equal(statusMarkup.inline_keyboard[0]?.[1]?.text.startsWith("思考"), true);
	assert.equal(statusMarkup.inline_keyboard[1]?.[0]?.text, "队列  3");
	assert.equal(statusMarkup.inline_keyboard[1]?.[1]?.text, "设置");
	assert.equal(buildStatusReplyMarkup(undefined, "off", 0).inline_keyboard[0]?.[1]?.text, "队列");
	assert.deepEqual(statusCallbackData, ["menu:model", "menu:thinking", "menu:queue", "menu:settings"]);
	assert.equal(
		statusCallbackData.some((callbackData) => callbackData.startsWith("status:")),
		false,
	);
	const noReasoningMarkup = buildStatusReplyMarkup(modelB, "medium");
	assert.deepEqual(
		noReasoningMarkup.inline_keyboard.map((row) => row.map((button) => button.callback_data)),
		[["menu:model", "menu:queue"], ["menu:settings"]],
	);
});

test("Section callback actions preserve callback thread target", async () => {
	const registry = createTelegramExtensionSectionRegistry();
	const enqueued: Array<unknown> = [];
	const opened: Array<unknown> = [];
	registry.register({
		id: "demo",
		label: "Demo",
		render: () => ({ text: "Demo" }),
		handleCallback: async (ctx) => {
			await ctx.enqueuePrompt("section prompt");
			await ctx.open({ text: "Opened" });
			return "handled" as const;
		},
	});

	await handleTelegramMenuCallbackRuntime(
		{
			id: "cb-section",
			data: "section:0:run",
			message: {
				message_id: 2,
				message_thread_id: 55,
				chat: { id: -1001 },
			},
		},
		{},
		{
			getStoredModelMenuState: () => createMenuState(2),
			getActiveModel: () => undefined,
			getThinkingLevel: () => "medium",
			setThinkingLevel: () => {},
			updateStatus: () => {},
			updateModelMenuMessage: async () => {},
			updateThinkingMenuMessage: async () => {},
			updateStatusMessage: async () => {},
			answerCallbackQuery: async () => {},
			isIdle: () => true,
			hasActiveTelegramTurn: () => false,
			hasAbortHandler: () => false,
			hasActiveToolExecutions: () => false,
			setModel: async () => true,
			setCurrentModel: () => {},
			stagePendingModelSwitch: () => {},
			restartInterruptedTelegramTurn: () => false,
			sectionRegistry: registry,
			sendInteractiveMessage: async (_chatId, text, _mode, _markup, options) => {
				opened.push({ text, target: options?.target });
				return 3;
			},
			enqueueSectionPrompt: async (prompt, _ctx, target) => {
				enqueued.push({ prompt, target });
			},
		},
	);

	assert.deepEqual(enqueued, [{ prompt: "section prompt", target: { chatId: -1001, threadId: 55 } }]);
	assert.deepEqual(opened, [{ text: "Opened", target: { chatId: -1001, threadId: 55 } }]);
});

test("Settings menu labels proactive push with state text", () => {
	assert.deepEqual(buildTelegramSettingsMenuReplyMarkup(true, false, "hidden", "hidden").inline_keyboard[5], [
		{
			text: "主动推送  打开",
			callback_data: "settings:open:proactive",
		},
	]);
	assert.deepEqual(buildTelegramSettingsMenuReplyMarkup(false, false, "hidden", "hidden").inline_keyboard[5], [
		{
			text: "主动推送  关闭",
			callback_data: "settings:open:proactive",
		},
	]);
});

test("Settings menu exposes time injection mode selection", () => {
	assert.deepEqual(buildTelegramSettingsMenuReplyMarkup(false, false, "hidden", "hidden").inline_keyboard[2], [
		{
			text: "时间注入  关闭",
			callback_data: "settings:open:time-injection",
		},
	]);
	assert.deepEqual(buildTelegramSettingsMenuReplyMarkup(false, false, "hidden", "interval").inline_keyboard[2], [
		{
			text: "时间注入  间隔",
			callback_data: "settings:open:time-injection",
		},
	]);
	assert.deepEqual(buildTimeInjectionModeSettingsReplyMarkup("hidden").inline_keyboard[1], [
		{
			text: "✓ 关闭",
			callback_data: "settings:set:time-injection:hidden",
		},
	]);
	assert.deepEqual(buildTimeInjectionModeSettingsReplyMarkup("always").inline_keyboard[2], [
		{
			text: "✓ 始终",
			callback_data: "settings:set:time-injection:always",
		},
	]);
});

test("Settings menu marks voice mode selection with model-style dot", () => {
	assert.deepEqual(buildVoiceReplyModeSettingsReplyMarkup("hidden", false).inline_keyboard[1], [
		{ text: "✓ 关闭", callback_data: "settings:set:voice-reply:hidden" },
	]);
	assert.deepEqual(buildVoiceReplyModeSettingsReplyMarkup("mirror").inline_keyboard[2], [
		{ text: "✓ 镜像", callback_data: "settings:set:voice-reply:mirror" },
	]);
	assert.deepEqual(
		buildTelegramSettingsMenuReplyMarkup(false, false, "hidden", "hidden", undefined, false).inline_keyboard[1],
		[
			{
				text: "语音回复  关闭",
				callback_data: "settings:open:voice-reply",
			},
		],
	);
	assert.deepEqual(buildTelegramSettingsMenuReplyMarkup(false, false, "always", "hidden").inline_keyboard[1], [
		{
			text: "语音回复  始终",
			callback_data: "settings:open:voice-reply",
		},
	]);
});

test("Settings menu rehydrates expired state before persisting and rendering voice mode", async () => {
	let mode: "hidden" | "mirror" | "always" | undefined;
	let configured = false;
	const events: string[] = [];
	const runtime = createTelegramSettingsMenuRuntime({
		getModelMenuState: async (chatId) => {
			events.push(`rehydrate:${chatId}`);
			return {
				chatId,
				messageId: 0,
				mode: "model" as const,
				page: 2,
				scope: "all" as const,
				scopedModels: [],
				allModels: [],
			};
		},
		getStoredModelMenuState: () => undefined,
		storeModelMenuState: (state) => {
			events.push(`store:${state.chatId}:${state.messageId}:${state.mode}`);
		},
		editInteractiveMessage: async (chatId, messageId, text) => {
			events.push(`edit:${chatId}:${messageId}:${text.includes("镜像") || text.includes("mirror")}`);
		},
		sendInteractiveMessage: async () => 2,
		answerCallbackQuery: async (_id, text) => {
			events.push(`answer:${text ?? ""}`);
		},
		isProactivePushEnabled: () => false,
		areDraftPreviewsEnabled: () => false,
		getAssistantRenderingMode: () => "rich" as const,
		getTimeInjectionMode: () => "hidden",
		getVoiceReplyMode: () => mode ?? "hidden",
		isVoiceReplyModeConfigured: () => configured,
		setProactivePushEnabled: async () => {},
		setDraftPreviewsEnabled: async () => {},
		setAssistantRenderingMode: async () => {},
		setVoiceReplyMode: async (nextMode) => {
			mode = nextMode;
			configured = nextMode !== undefined;
			events.push(`set:${nextMode}`);
		},
		setTimeInjectionMode: async () => {},
	});

	assert.equal(
		await runtime.handleCallbackQuery(
			{
				id: "cb1",
				data: "settings:set:voice-reply:mirror",
				message: { message_id: 99, chat: { id: 1 } },
			},
			{},
		),
		true,
	);

	assert.equal(mode, "mirror");
	assert.deepEqual(events, [
		"rehydrate:1",
		"store:1:99:settings",
		"set:mirror",
		"edit:1:99:true",
		"answer:语音回复：镜像",
	]);
});

test("Settings submenu headings include current values", () => {
	assert.match(buildProactivePushSettingsText(true), /^<b>主动推送<\/b> <code>打开<\/code>/);
	assert.match(buildTimeInjectionModeSettingsText("interval"), /^<b>时间注入<\/b> <code>间隔<\/code>/);
	assert.match(buildVoiceReplyModeSettingsText("hidden", false), /^<b>语音回复<\/b> <code>关闭<\/code>/);
});

test("Settings menu marks one-line on/off checkbox controls symmetrically", () => {
	assert.deepEqual(buildProactivePushSettingsReplyMarkup(true).inline_keyboard[1], [
		{ text: "✓ 打开", callback_data: "settings:set:proactive:on" },
		{ text: "关闭", callback_data: "settings:set:proactive:off" },
	]);
	assert.deepEqual(buildProactivePushSettingsReplyMarkup(false).inline_keyboard[1], [
		{ text: "打开", callback_data: "settings:set:proactive:on" },
		{ text: "✓ 关闭", callback_data: "settings:set:proactive:off" },
	]);
});
