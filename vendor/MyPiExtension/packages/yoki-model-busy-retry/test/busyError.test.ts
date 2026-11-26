import { describe, expect, it } from "vitest";
import { isModelBusyError, MODEL_BUSY_CODE, parseBusyQueueHint, parseRetryAfterMs } from "../busyError.ts";

const QUEUED =
	"Qoder model is busy: request queued (10605 CALL_COUNT_LIMIT (premium), 4 ahead, ~30s wait, rate limit, retry-after-ms=30000)";
const ATTEMPTS_EXHAUSTED = "Qoder server error: model is busy (10605 RESOURCE_LIMIT, retryAfterSeconds=30, attempts=3)";
const DELAY_OVER_CAP =
	"Qoder server error: model is busy (10605 RESOURCE_LIMIT, requested delay 30000ms exceeds local cap 5000ms)";
const RAW_ENVELOPE = 'Upstream status 429: {"code":"10605","message":"{\\"isQueued\\":true,\\"waitTime\\":12.5}"}';
const LONG_QUEUED =
	"Qoder model is busy: request queued (10605 CALL_COUNT_LIMIT (p3), 15254 ahead, ~205s wait, rate limit, retry-after-ms=205000)";

describe("parseRetryAfterMs", () => {
	it("reads the wait from every shape the provider prints", () => {
		expect(parseRetryAfterMs(QUEUED)).toBe(30_000);
		expect(parseRetryAfterMs(ATTEMPTS_EXHAUSTED)).toBe(30_000);
		expect(parseRetryAfterMs(DELAY_OVER_CAP)).toBe(30_000);
		expect(parseRetryAfterMs(RAW_ENVELOPE)).toBe(12_500);
	});

	it("prefers an explicit millisecond value over the rounded seconds it also prints", () => {
		expect(parseRetryAfterMs("request queued 10605, ~30s wait, retry-after-ms=45000")).toBe(45_000);
	});

	it("keeps fractional seconds", () => {
		expect(parseRetryAfterMs('model is busy 10605 "retryAfterSeconds":2.5')).toBe(2500);
	});

	it("ignores a zero or unparsable wait", () => {
		expect(parseRetryAfterMs("retry-after-ms=0")).toBeUndefined();
		expect(parseRetryAfterMs("model is busy 10605")).toBeUndefined();
		expect(parseRetryAfterMs(undefined)).toBeUndefined();
	});
});

describe("parseBusyQueueHint", () => {
	it("reads the announced wait and the queue position together", () => {
		expect(parseBusyQueueHint(QUEUED)).toEqual({ waitMs: 30_000, ahead: 4 });
		expect(parseBusyQueueHint(LONG_QUEUED)).toEqual({ waitMs: 205_000, ahead: 15_254 });
	});

	it("leaves the position out when the failure does not report one", () => {
		expect(parseBusyQueueHint(ATTEMPTS_EXHAUSTED)).toEqual({ waitMs: 30_000, ahead: undefined });
		expect(parseBusyQueueHint(RAW_ENVELOPE)).toEqual({ waitMs: 12_500, ahead: undefined });
	});

	it("keeps a position that is only worth waiting for when it is a number", () => {
		expect(parseBusyQueueHint("request queued, 1,024 ahead, retry-after-ms=9000")).toEqual({
			waitMs: 9_000,
			ahead: 1_024,
		});
		expect(parseBusyQueueHint(undefined)).toEqual({ waitMs: undefined, ahead: undefined });
	});
});

describe("isModelBusyError", () => {
	it("recognizes the saturated-model failures worth waiting for", () => {
		for (const message of [QUEUED, ATTEMPTS_EXHAUSTED, DELAY_OVER_CAP, RAW_ENVELOPE]) {
			expect(isModelBusyError(message), message).toBe(true);
		}
	});

	it("recognizes a busy sentence that only carries a wait hint", () => {
		expect(isModelBusyError("Server is request queued, retry-after-ms=8000")).toBe(true);
	});

	it("leaves failures a wait cannot fix alone", () => {
		expect(isModelBusyError("Qoder API request failed: 502 Bad Gateway")).toBe(false);
		expect(isModelBusyError("insufficient_quota: check your billing plan")).toBe(false);
		expect(isModelBusyError("context_length_exceeded: 128000 max")).toBe(false);
		expect(isModelBusyError("request queued")).toBe(false);
		expect(isModelBusyError(undefined)).toBe(false);
		expect(isModelBusyError("")).toBe(false);
	});

	it("still classifies a rejection that arrived after partial output", () => {
		// Not retryable in practice — the caller never asks, because content already committed.
		expect(
			isModelBusyError(`Qoder model rejected the request after partial output (${MODEL_BUSY_CODE} RESOURCE_LIMIT)`),
		).toBe(true);
	});
});
