/**
 * Regression tests for Telegram thinking menu helpers
 * Exercises thinking-menu markup, callback routing, voice guards, and send/update helpers
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
	buildTelegramThinkingMenuRenderPayload,
	buildThinkingMenuReplyMarkup,
	buildThinkingMenuText,
	handleTelegramThinkingMenuCallbackAction,
	openTelegramThinkingMenu,
	updateTelegramThinkingMenuMessage,
} from "../lib/menu-thinking.ts";

const reasoningModel = {
	provider: "openai",
	id: "gpt-5",
	reasoning: true,
};

test("Thinking menu text and reply markup expose all levels with current marker", () => {
	assert.equal(buildThinkingMenuText(), "<b>思考级别</b>");

	const markup = buildThinkingMenuReplyMarkup("medium");
	assert.equal(markup.inline_keyboard[0]?.[0]?.text, "‹ 主菜单");
	assert.equal(markup.inline_keyboard[0]?.[0]?.callback_data, "menu:back");
	assert.equal(
		markup.inline_keyboard.some((row) => row[0]?.text === "✓ medium"),
		true,
	);
	assert.equal(
		markup.inline_keyboard.every((row, index) => index === 0 || row[0]?.callback_data.startsWith("thinking:set:")),
		true,
	);
});

test("Thinking callback sets valid levels and reports current level", async () => {
	const calls: string[] = [];
	let current = "low" as const;

	const handled = await handleTelegramThinkingMenuCallbackAction("q1", "thinking:set:high", reasoningModel, {
		setThinkingLevel: (level) => {
			current = level as typeof current;
			calls.push(`set:${level}`);
		},
		getCurrentThinkingLevel: () => current,
		updateStatusMessage: async () => {
			calls.push("update-status");
		},
		answerCallbackQuery: async (_id, text) => {
			calls.push(text ?? "answered");
		},
	});

	assert.equal(handled, true);
	assert.deepEqual(calls, ["set:high", "update-status", "Thinking: high"]);
});

test("Thinking callback handles invalid, voice-active, non-reasoning, and unrelated actions", async () => {
	const answered: string[] = [];
	const deps = {
		setThinkingLevel: () => {
			throw new Error("must not set level");
		},
		getCurrentThinkingLevel: () => "off" as const,
		updateStatusMessage: async () => {
			throw new Error("must not update status");
		},
		answerCallbackQuery: async (_id: string, text?: string) => {
			answered.push(text ?? "answered");
		},
	};

	assert.equal(await handleTelegramThinkingMenuCallbackAction("q1", "thinking:set:nope", reasoningModel, deps), true);
	assert.equal(
		await handleTelegramThinkingMenuCallbackAction("q2", "thinking:set:low", reasoningModel, {
			...deps,
			isVoiceReplyActive: () => true,
		}),
		true,
	);
	assert.equal(
		await handleTelegramThinkingMenuCallbackAction("q3", "thinking:set:low", { provider: "x", id: "plain" }, deps),
		true,
	);
	assert.equal(await handleTelegramThinkingMenuCallbackAction("q4", "menu:model", reasoningModel, deps), false);

	assert.deepEqual(answered, [
		"无效的思考级别。",
		"语音回复进行中，暂时无法调整思考级别。",
		"此模型不支持思考级别调整。",
	]);
});

test("Thinking menu open and update helpers apply thinking mode and respect voice guard", async () => {
	const state: any = {
		chatId: 1,
		messageId: 2,
		mode: "status",
		page: 0,
		scope: "all",
		scopedModels: [],
		allModels: [],
	};
	const messages: unknown[] = [];
	const deps = {
		getModelMenuState: async () => state,
		getActiveModel: () => reasoningModel,
		getThinkingLevel: () => "medium" as const,
		storeModelMenuState: (nextState: unknown) => messages.push(["store", nextState]),
		editInteractiveMessage: async (...args: unknown[]) => {
			messages.push(["edit", ...args]);
		},
		sendInteractiveMessage: async (...args: unknown[]) => {
			messages.push(["send", ...args]);
			return 99;
		},
	};

	await openTelegramThinkingMenu(deps);
	assert.equal(state.messageId, 99);
	assert.equal(state.mode, "thinking");

	await updateTelegramThinkingMenuMessage(state, reasoningModel, "high", deps);
	assert.equal(state.mode, "thinking");
	assert.equal(messages.length, 3);

	const beforeVoiceGuard = messages.length;
	await openTelegramThinkingMenu({ ...deps, isVoiceReplyActive: () => true });
	await updateTelegramThinkingMenuMessage(state, reasoningModel, "low", {
		...deps,
		isVoiceReplyActive: () => true,
	});
	assert.equal(messages.length, beforeVoiceGuard);

	const payload = buildTelegramThinkingMenuRenderPayload(reasoningModel, "low");
	assert.equal(payload.nextMode, "thinking");
	assert.equal(payload.mode, "html");
});
