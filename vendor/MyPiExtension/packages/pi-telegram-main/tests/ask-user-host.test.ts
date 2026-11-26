/**
 * Telegram ask_user_question host unit tests
 */

import assert from "node:assert/strict";
import test from "node:test";
import { _askUserHostTest } from "../lib/ask-user-host.ts";

test.afterEach(() => {
	_askUserHostTest.reset();
});

test("callback_data stays under Telegram 64-byte limit", () => {
	const data = _askUserHostTest.callbackData("zz99", "tog", "3");
	assert.ok(data.startsWith(_askUserHostTest.CALLBACK_PREFIX));
	assert.ok(new TextEncoder().encode(data).byteLength <= 64);
});

test("parseCallbackData round-trips session/action/payload", () => {
	const data = _askUserHostTest.callbackData("a1", "opt", "2");
	const parsed = _askUserHostTest.parseCallbackData(data);
	assert.deepEqual(parsed, {
		sessionId: "a1",
		action: "opt",
		payload: "2",
	});
});

test("parseCallbackData ignores foreign namespaces", () => {
	assert.equal(_askUserHostTest.parseCallbackData("menu:back"), undefined);
	assert.equal(_askUserHostTest.parseCallbackData("tgbtn:1"), undefined);
});

test("buildView renders question header and option buttons", () => {
	const view = _askUserHostTest.buildView({
		id: "s1",
		params: {
			questions: [
				{
					question: "Which runtime?",
					header: "Runtime",
					options: [
						{ label: "Node", description: "Node.js" },
						{ label: "Bun", description: "Bun runtime" },
					],
				},
			],
		},
		questionIndex: 0,
		answers: [],
		multiChecked: new Set(),
		waitingForCustomText: false,
		handle: undefined,
		resolve: () => {},
		settled: false,
		timeout: undefined,
		onAbort: undefined,
		signal: undefined,
	} as never);

	assert.match(view.text, /Runtime/);
	assert.match(view.text, /Which runtime\?/);
	assert.equal(view.parseMode, "html");
	const labels = view.replyMarkup?.inline_keyboard.flatMap((row) => row.map((button) => button.text));
	assert.deepEqual(labels?.slice(0, 2), ["Node", "Bun"]);
	assert.ok(labels?.includes("✏️ 自定义"));
	assert.ok(labels?.includes("❌ 取消"));
});

test("buildView multi-select marks checked options and confirm action", () => {
	const view = _askUserHostTest.buildView({
		id: "s2",
		params: {
			questions: [
				{
					question: "Pick features?",
					header: "Features",
					multiSelect: true,
					options: [
						{ label: "A", description: "a" },
						{ label: "B", description: "b" },
					],
				},
			],
		},
		questionIndex: 0,
		answers: [],
		multiChecked: new Set([1]),
		waitingForCustomText: false,
		handle: undefined,
		resolve: () => {},
		settled: false,
		timeout: undefined,
		onAbort: undefined,
		signal: undefined,
	} as never);

	assert.match(view.text, /🟢/);
	const labels = view.replyMarkup?.inline_keyboard.flatMap((row) => row.map((button) => button.text));
	assert.ok(labels?.some((label) => label.includes("B")));
	assert.ok(labels?.includes("✅ 确认"));
});

test("host id is stable for registry identity", () => {
	assert.equal(_askUserHostTest.HOST_ID, "pi-telegram");
});
