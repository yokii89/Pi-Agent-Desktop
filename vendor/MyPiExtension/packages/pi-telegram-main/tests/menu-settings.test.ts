/**
 * Regression tests for Telegram settings menu helpers
 * Exercises settings text/markup, callback mutations, stale-message fallback, and runtime wiring
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
	buildAssistantRenderingSettingsReplyMarkup,
	buildAssistantRenderingSettingsText,
	buildDraftPreviewsSettingsReplyMarkup,
	buildDraftPreviewsSettingsText,
	buildProactivePushSettingsReplyMarkup,
	buildProactivePushSettingsText,
	buildTelegramSettingsMenuReplyMarkup,
	buildTelegramSettingsMenuText,
	buildTimeInjectionModeSettingsReplyMarkup,
	buildVoiceReplyModeSettingsReplyMarkup,
	createTelegramSettingsMenuRuntime,
	handleTelegramSettingsMenuCallbackAction,
} from "../lib/menu-settings.ts";

test("Settings menu text and reply markup expose built-in controls", () => {
	assert.equal(buildTelegramSettingsMenuText(), "<b>设置</b>");

	const markup = buildTelegramSettingsMenuReplyMarkup(true, false, "hidden", "hidden", undefined, false);

	assert.deepEqual(
		markup.inline_keyboard.map((row) => row[0]?.callback_data),
		[
			"menu:back",
			"settings:open:voice-reply",
			"settings:open:time-injection",
			"settings:open:draft-previews",
			"settings:open:assistant-rendering",
			"settings:open:proactive",
		],
	);
	assert.equal(markup.inline_keyboard[1]?.[0]?.text, "语音回复  关闭");
	assert.equal(markup.inline_keyboard[2]?.[0]?.text, "时间注入  关闭");
	assert.equal(markup.inline_keyboard[3]?.[0]?.text, "草稿预览  关闭");
	assert.equal(markup.inline_keyboard[4]?.[0]?.text, "回答渲染  富文本");
	assert.equal(markup.inline_keyboard[5]?.[0]?.text, "主动推送  打开");
});

test("Settings detail markups show active values", () => {
	const proactiveText = buildProactivePushSettingsText(true);
	assert.match(proactiveText, /<code>打开<\/code>/);
	assert.match(proactiveText, /<code>关闭<\/code>/);
	assert.match(proactiveText, /<code>打开<\/code>（默认）/);
	assert.match(proactiveText, /完成的公开内容块/);
	assert.ok(proactiveText.indexOf("<code>打开</code>（默认）") < proactiveText.indexOf("<code>关闭</code>"));
	assert.match(buildDraftPreviewsSettingsText(false), /<code>关闭<\/code>/);
	assert.equal(buildDraftPreviewsSettingsReplyMarkup(true).inline_keyboard[1]?.[0]?.text, "✓ 打开");
	assert.match(buildAssistantRenderingSettingsText("html"), /<code>HTML<\/code>/);
	assert.equal(buildAssistantRenderingSettingsReplyMarkup("rich").inline_keyboard[1]?.[0]?.text, "✓ 富文本");
	assert.equal(buildProactivePushSettingsReplyMarkup(false).inline_keyboard[1]?.[1]?.text, "✓ 关闭");
	assert.equal(buildTimeInjectionModeSettingsReplyMarkup("interval").inline_keyboard[3]?.[0]?.text, "✓ 间隔");
	assert.equal(buildVoiceReplyModeSettingsReplyMarkup("mirror", true).inline_keyboard[2]?.[0]?.text, "✓ 镜像");
	assert.equal(buildVoiceReplyModeSettingsReplyMarkup("hidden", false).inline_keyboard[1]?.[0]?.text, "✓ 关闭");
});

test("Settings callback action mutates voice, time, and proactive settings", async () => {
	const calls: string[] = [];
	const deps = {
		isProactivePushEnabled: () => false,
		getVoiceReplyMode: () => "hidden" as const,
		isVoiceReplyModeConfigured: () => true,
		getTimeInjectionMode: () => "hidden" as const,
		areDraftPreviewsEnabled: () => false,
		getAssistantRenderingMode: () => "rich" as const,
		setProactivePushEnabled: async (enabled: boolean) => {
			calls.push(`proactive:${enabled}`);
		},
		setDraftPreviewsEnabled: async (enabled: boolean) => {
			calls.push(`draft-previews:${enabled}`);
		},
		setAssistantRenderingMode: async (mode: "rich" | "html") => {
			calls.push(`rendering:${mode}`);
		},
		setVoiceReplyMode: async (mode: "hidden" | "mirror" | "always" | undefined) => {
			calls.push(`voice:${mode ?? "hidden"}`);
		},
		setTimeInjectionMode: async (mode: "hidden" | "always" | "interval") => {
			calls.push(`time:${mode}`);
		},
		updateSettingsMessage: async (text: string) => {
			calls.push(`update:${text.split("\n")[0]}`);
		},
		answerCallbackQuery: async (_id: string, text?: string) => {
			calls.push(`answer:${text ?? ""}`);
		},
	};

	assert.equal(await handleTelegramSettingsMenuCallbackAction("q1", "settings:set:voice-reply:hidden", deps), true);
	assert.equal(await handleTelegramSettingsMenuCallbackAction("q2", "settings:set:time:off", deps), true);
	assert.equal(await handleTelegramSettingsMenuCallbackAction("q3", "settings:set:draft-previews:on", deps), true);
	assert.equal(
		await handleTelegramSettingsMenuCallbackAction("q4", "settings:set:assistant-rendering:html", deps),
		true,
	);
	assert.equal(await handleTelegramSettingsMenuCallbackAction("q5", "settings:set:proactive:on", deps), true);
	assert.equal(await handleTelegramSettingsMenuCallbackAction("q6", "other", deps), false);

	assert.deepEqual(calls, [
		"voice:hidden",
		"update:<b>语音回复</b> <code>关闭</code>",
		"answer:语音回复：关闭",
		"time:hidden",
		"update:<b>时间注入</b> <code>关闭</code>",
		"answer:时间注入：关闭",
		"draft-previews:true",
		"update:<b>草稿预览</b> <code>关闭</code>",
		"answer:草稿预览已打开",
		"rendering:html",
		"update:<b>回答渲染</b> <code>富文本</code>",
		"answer:回答渲染：HTML",
		"proactive:true",
		"update:<b>主动推送</b> <code>关闭</code>",
		"answer:主动推送已打开",
	]);
});

test("Settings runtime opens menus and rehydrates stale callback state", async () => {
	const state: any = {
		chatId: 1,
		messageId: 2,
		mode: "status",
		page: 0,
		scope: "all",
		scopedModels: [],
		allModels: [],
	};
	const calls: string[] = [];
	let storedState: typeof state | undefined;
	const runtime = createTelegramSettingsMenuRuntime({
		isProactivePushEnabled: () => true,
		getVoiceReplyMode: () => "hidden",
		isVoiceReplyModeConfigured: () => true,
		getTimeInjectionMode: () => "hidden",
		areDraftPreviewsEnabled: () => false,
		getAssistantRenderingMode: () => "rich",
		setProactivePushEnabled: async (enabled) => {
			calls.push(`proactive:${enabled}`);
		},
		setDraftPreviewsEnabled: async (enabled) => {
			calls.push(`draft-previews:${enabled}`);
		},
		setAssistantRenderingMode: async (mode) => {
			calls.push(`rendering:${mode}`);
		},
		setVoiceReplyMode: async (mode) => {
			calls.push(`voice:${mode ?? "hidden"}`);
		},
		setTimeInjectionMode: async (mode) => {
			calls.push(`time:${mode}`);
		},
		getModelMenuState: async (_chatId, _ctx, threadId) => {
			state.threadId = threadId;
			return state;
		},
		getStoredModelMenuState: () => storedState,
		storeModelMenuState: (nextState) => {
			storedState = nextState;
			calls.push(`store:${nextState.mode}`);
		},
		editInteractiveMessage: async () => {
			calls.push("edit");
		},
		sendInteractiveMessage: async (_chatId, _text, mode) => {
			calls.push(`send:${mode}`);
			return 99;
		},
		answerCallbackQuery: async (_id, text) => {
			calls.push(`answer:${text ?? ""}`);
		},
	});

	await runtime.openSettingsMenu(1, 2, "ctx");
	assert.equal(state.messageId, 99);
	assert.equal(state.mode, "settings");
	assert.deepEqual(calls, ["send:html", "store:settings"]);

	storedState = undefined;
	calls.length = 0;
	assert.equal(
		await runtime.handleCallbackQuery(
			{
				id: "q1",
				data: "settings:set:voice-reply:always",
				message: { message_id: 99, message_thread_id: 7, chat: { id: 1 } },
			},
			"ctx",
		),
		true,
	);
	assert.equal(storedState?.threadId, 7);
	assert.equal(
		await runtime.handleCallbackQuery(
			{
				id: "q2",
				data: "settings:set:time:off",
				message: { message_id: 99, chat: { id: 1 } },
			},
			"ctx",
		),
		true,
	);
	assert.deepEqual(calls, [
		"store:settings",
		"voice:always",
		"edit",
		"answer:语音回复：始终",
		"time:hidden",
		"edit",
		"answer:时间注入：关闭",
	]);
});
