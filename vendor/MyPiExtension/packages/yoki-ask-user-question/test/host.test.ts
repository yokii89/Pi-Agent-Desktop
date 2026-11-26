import { createMockCtx } from "@yoki/yoki-test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ASK_USER_HOST_REGISTRY_KEY,
	type AskUserHost,
	getAskUserHostRegistry,
	hasAskUserHosts,
	listAskUserHosts,
	presentViaAskUserHosts,
	registerAskUserHost,
} from "../host.ts";
import type { QuestionParams } from "../tool/types.ts";

const PARAMS: QuestionParams = {
	questions: [
		{
			question: "Which?",
			header: "Pick",
			options: [
				{ label: "A", description: "a" },
				{ label: "B", description: "b" },
			],
		},
	],
};

function clearRegistry(): void {
	const g = globalThis as Record<string, unknown>;
	delete g[ASK_USER_HOST_REGISTRY_KEY];
}

afterEach(() => {
	clearRegistry();
});

function makeHost(over: Partial<AskUserHost> & Pick<AskUserHost, "id">): AskUserHost {
	return {
		id: over.id,
		priority: over.priority ?? 0,
		canHandle: over.canHandle ?? (() => true),
		present:
			over.present ??
			(async () => ({
				answers: [{ questionIndex: 0, question: "Which?", kind: "option", answer: "A" }],
				cancelled: false,
			})),
	};
}

describe("ask-user host registry", () => {
	it("register/list/unregister round-trips", () => {
		expect(hasAskUserHosts()).toBe(false);
		const off = registerAskUserHost(makeHost({ id: "h1", priority: 10 }));
		expect(hasAskUserHosts()).toBe(true);
		expect(listAskUserHosts().map((h) => h.id)).toEqual(["h1"]);
		off();
		expect(hasAskUserHosts()).toBe(false);
	});

	it("lists hosts by descending priority then id", () => {
		registerAskUserHost(makeHost({ id: "b", priority: 1 }));
		registerAskUserHost(makeHost({ id: "a", priority: 5 }));
		registerAskUserHost(makeHost({ id: "c", priority: 5 }));
		expect(listAskUserHosts().map((h) => h.id)).toEqual(["a", "c", "b"]);
	});

	it("same id replaces the previous host registration", () => {
		const first = vi.fn(async () => null);
		const second = vi.fn(async () => ({
			answers: [],
			cancelled: true,
		}));
		registerAskUserHost(makeHost({ id: "same", priority: 1, present: first }));
		registerAskUserHost(makeHost({ id: "same", priority: 1, present: second }));
		expect(listAskUserHosts()).toHaveLength(1);
		expect(getAskUserHostRegistry().list()[0].present).toBe(second);
	});

	it("presentViaAskUserHosts prefers higher priority eligible host", async () => {
		const low = vi.fn(async () => ({
			answers: [{ questionIndex: 0, question: "Which?", kind: "option" as const, answer: "low" }],
			cancelled: false,
		}));
		const high = vi.fn(async () => ({
			answers: [{ questionIndex: 0, question: "Which?", kind: "option" as const, answer: "high" }],
			cancelled: false,
		}));
		registerAskUserHost(makeHost({ id: "low", priority: 1, present: low }));
		registerAskUserHost(makeHost({ id: "high", priority: 10, present: high }));
		const result = await presentViaAskUserHosts(PARAMS, {
			toolCallId: "tc",
			ctx: createMockCtx({ hasUI: true }),
		});
		expect(result).toMatchObject({ answers: [{ answer: "high" }] });
		expect(high).toHaveBeenCalledOnce();
		expect(low).not.toHaveBeenCalled();
	});

	it("skips hosts that cannot handle and hosts that return null", async () => {
		registerAskUserHost(makeHost({ id: "no", priority: 20, canHandle: () => false }));
		registerAskUserHost(
			makeHost({
				id: "null",
				priority: 10,
				present: async () => null,
			}),
		);
		const winner = vi.fn(async () => ({
			answers: [{ questionIndex: 0, question: "Which?", kind: "option" as const, answer: "A" }],
			cancelled: false,
		}));
		registerAskUserHost(makeHost({ id: "win", priority: 1, present: winner }));
		const result = await presentViaAskUserHosts(PARAMS, {
			toolCallId: "tc",
			ctx: createMockCtx({ hasUI: false }),
		});
		expect(result).toMatchObject({ answers: [{ answer: "A" }] });
		expect(winner).toHaveBeenCalledOnce();
	});

	it("returns cancelled when signal is already aborted", async () => {
		registerAskUserHost(makeHost({ id: "h", priority: 1 }));
		const ac = new AbortController();
		ac.abort();
		const result = await presentViaAskUserHosts(PARAMS, {
			toolCallId: "tc",
			signal: ac.signal,
			ctx: createMockCtx({ hasUI: true }),
		});
		expect(result).toEqual({ answers: [], cancelled: true });
	});

	it("swallows host present errors and continues", async () => {
		registerAskUserHost(
			makeHost({
				id: "boom",
				priority: 10,
				present: async () => {
					throw new Error("boom");
				},
			}),
		);
		registerAskUserHost(
			makeHost({
				id: "ok",
				priority: 1,
				present: async () => ({ answers: [], cancelled: true }),
			}),
		);
		const result = await presentViaAskUserHosts(PARAMS, {
			toolCallId: "tc",
			ctx: createMockCtx({ hasUI: true }),
		});
		expect(result).toEqual({ answers: [], cancelled: true });
	});
});
