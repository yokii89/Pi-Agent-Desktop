/**
 * Unit tests for pure helpers in pi-provider-newapi (no network).
 * Run from this directory:
 *   node ../../node_modules/vitest/dist/cli.js --run helpers.test.ts
 * or with vitest if linked.
 */

import { describe, expect, it } from "vitest";
import {
	credentialSignature,
	extractApiKeyFromCodexAuth,
	extractTomlString,
	isDegenerateGatewayResponse,
	mapReasoningEffort,
	mapWireApi,
	normalizeBaseUrl,
	normalizeEndpointTypes,
	pickApiForModel,
	stubModelDef,
} from "../helpers.ts";

describe("normalizeBaseUrl", () => {
	it("strips trailing slashes and /v1", () => {
		expect(normalizeBaseUrl("http://host:8317/v1")).toBe("http://host:8317");
		expect(normalizeBaseUrl("https://api.example.com/v1/")).toBe("https://api.example.com");
		expect(normalizeBaseUrl("https://api.example.com///")).toBe("https://api.example.com");
		expect(normalizeBaseUrl("  https://x.com  ")).toBe("https://x.com");
	});
});

describe("mapWireApi", () => {
	it("maps responses to openai-responses", () => {
		expect(mapWireApi("responses")).toBe("openai-responses");
		expect(mapWireApi("Responses")).toBe("openai-responses");
	});

	it("maps chat/completions/absent to openai-completions", () => {
		expect(mapWireApi(undefined)).toBe("openai-completions");
		expect(mapWireApi("")).toBe("openai-completions");
		expect(mapWireApi("chat")).toBe("openai-completions");
		expect(mapWireApi("completions")).toBe("openai-completions");
	});

	it("throws on unknown wire_api", () => {
		expect(() => mapWireApi("websocket")).toThrow(/Unsupported Codex wire_api/);
	});
});

describe("mapReasoningEffort", () => {
	it("maps known efforts", () => {
		expect(mapReasoningEffort("minimal")).toBe("minimal");
		expect(mapReasoningEffort("low")).toBe("low");
		expect(mapReasoningEffort("medium")).toBe("medium");
		expect(mapReasoningEffort("high")).toBe("high");
		expect(mapReasoningEffort("xhigh")).toBe("xhigh");
		expect(mapReasoningEffort("max")).toBe("max");
		expect(mapReasoningEffort("MAX")).toBe("max");
	});

	it("returns undefined for unmapped", () => {
		expect(mapReasoningEffort(undefined)).toBeUndefined();
		expect(mapReasoningEffort("")).toBeUndefined();
		expect(mapReasoningEffort("ultra")).toBeUndefined();
		expect(mapReasoningEffort("off")).toBeUndefined();
	});
});

describe("extractTomlString", () => {
	const sample = `
model_provider = "custom"
model = "grok-4.5"
model_reasoning_effort = "max"

[model_providers.custom]
name = "custom"
wire_api = "responses"
base_url = "http://gateway.invalid:8317/v1"

[model_providers.other]
base_url = "https://other.example/v1"
wire_api = "chat"
`;

	it("reads top-level keys", () => {
		expect(extractTomlString(sample, "model_provider")).toBe("custom");
		expect(extractTomlString(sample, "model")).toBe("grok-4.5");
		expect(extractTomlString(sample, "model_reasoning_effort")).toBe("max");
	});

	it("reads section keys", () => {
		expect(extractTomlString(sample, "base_url", "model_providers.custom")).toBe(
			"http://gateway.invalid:8317/v1",
		);
		expect(extractTomlString(sample, "wire_api", "model_providers.custom")).toBe("responses");
		expect(extractTomlString(sample, "wire_api", "model_providers.other")).toBe("chat");
	});
});

describe("extractApiKeyFromCodexAuth", () => {
	it("prefers OPENAI_API_KEY", () => {
		expect(
			extractApiKeyFromCodexAuth({ OPENAI_API_KEY: "sk-abc", tokens: { access_token: "tok" } }),
		).toBe("sk-abc");
	});

	it("falls back to tokens.access_token", () => {
		expect(extractApiKeyFromCodexAuth({ tokens: { access_token: " tok " } })).toBe("tok");
	});

	it("returns undefined when missing", () => {
		expect(extractApiKeyFromCodexAuth({})).toBeUndefined();
		expect(extractApiKeyFromCodexAuth(null)).toBeUndefined();
	});
});

describe("stubModelDef", () => {
	it("builds a selectable model entry", () => {
		const m = stubModelDef("grok-4.5");
		expect(m.id).toBe("grok-4.5");
		expect(m.name).toBe("grok-4.5");
		expect(m.reasoning).toBe(true);
	});
});

describe("credentialSignature", () => {
	const base = { baseUrl: "https://gw.example.com", access: "sk-abc", api: "openai-completions" };

	it("is stable for identical credential context", () => {
		expect(credentialSignature(base)).toBe(credentialSignature({ ...base }));
	});

	it("normalizes base URL before hashing", () => {
		expect(credentialSignature({ ...base, baseUrl: "https://gw.example.com/v1/" })).toBe(
			credentialSignature(base),
		);
	});

	it("changes when key, base URL, or api changes", () => {
		expect(credentialSignature({ ...base, access: "sk-other" })).not.toBe(credentialSignature(base));
		expect(credentialSignature({ ...base, baseUrl: "https://other.example.com" })).not.toBe(
			credentialSignature(base),
		);
		expect(credentialSignature({ ...base, api: "openai-responses" })).not.toBe(
			credentialSignature(base),
		);
	});

	it("treats undefined and empty fields the same", () => {
		expect(credentialSignature({})).toBe(credentialSignature({ baseUrl: "", access: "", api: "" }));
	});
});

describe("codex config integration (synthetic)", () => {
	it("yields responses + model + thinking from typical CC Switch config", () => {
		const config = `
model_provider = "custom"
model = "grok-4.5"
model_reasoning_effort = "max"

[model_providers.custom]
wire_api = "responses"
base_url = "http://gateway.invalid:8317/v1"
`;
		const provider = extractTomlString(config, "model_provider");
		const section = `model_providers.${provider}`;
		const baseUrl = normalizeBaseUrl(extractTomlString(config, "base_url", section)!);
		const api = mapWireApi(extractTomlString(config, "wire_api", section));
		const model = extractTomlString(config, "model");
		const thinking = mapReasoningEffort(extractTomlString(config, "model_reasoning_effort"));

		expect(baseUrl).toBe("http://gateway.invalid:8317");
		expect(api).toBe("openai-responses");
		expect(model).toBe("grok-4.5");
		expect(thinking).toBe("max");
	});
});

describe("normalizeEndpointTypes", () => {
	it("keeps non-empty unique strings from arrays", () => {
		expect(normalizeEndpointTypes(["openai", "openai", "gemini", ""])).toEqual(["openai", "gemini"]);
	});

	it("returns undefined for non-arrays and unusable values", () => {
		expect(normalizeEndpointTypes(undefined)).toBeUndefined();
		expect(normalizeEndpointTypes("openai")).toBeUndefined();
		expect(normalizeEndpointTypes([1, 2])).toBeUndefined();
		expect(normalizeEndpointTypes([])).toBeUndefined();
	});
});

describe("pickApiForModel", () => {
	it("explicit openai-response enables the Responses API", () => {
		expect(pickApiForModel(["openai-response", "openai"], "openai-completions")).toBe("openai-responses");
		expect(pickApiForModel(["openai", "openai-response"], "openai-completions")).toBe("openai-responses");
	});

	it("keeps the credential api when the list is openai-only or unusable", () => {
		// Real gateway distribution: deepseek-v4.1-flash = ["openai"] but responses works
		// (891 logged calls) - demoting it would be a regression.
		expect(pickApiForModel(["openai"], "openai-responses")).toBe("openai-responses");
		expect(pickApiForModel(["openai"], "openai-completions")).toBe("openai-completions");
		expect(pickApiForModel(undefined, "openai-responses")).toBe("openai-responses");
		expect(pickApiForModel([], "openai-responses")).toBe("openai-responses");
		expect(pickApiForModel("openai", "openai-responses")).toBe("openai-responses");
	});

	it("demotes non-OpenAI families to completions", () => {
		// claude = ["anthropic","openai"] -> /v1/responses HTTP 500 (convert_request_failed)
		expect(pickApiForModel(["anthropic", "openai"], "openai-responses")).toBe("openai-completions");
		expect(pickApiForModel(["gemini", "openai"], "openai-responses")).toBe("openai-completions");
		expect(pickApiForModel(["anthropic", "gemini", "openai"], "openai-responses")).toBe("openai-completions");
		expect(pickApiForModel(["0"], "openai-responses")).toBe("openai-completions");
		expect(pickApiForModel(["decisions"], "openai-responses")).toBe("openai-completions");
	});
});

describe("isDegenerateGatewayResponse", () => {
	/** All 5 real samples recorded 2026-10-09 (gpt-6.1-sol, incomplete.max_output_tokens). */
	const realSamples = [
		{ stopReason: "length", rawStopReason: "incomplete.max_output_tokens", usage: { output: 1 }, content: [] },
		{ stopReason: "length", rawStopReason: "incomplete.max_output_tokens", usage: { output: 1 }, content: [] },
		{ stopReason: "length", rawStopReason: "incomplete.max_output_tokens", usage: { output: 1 }, content: [] },
		{
			stopReason: "length",
			rawStopReason: "incomplete.max_output_tokens",
			usage: { output: 1 },
			content: [{ type: "text", text: " " }],
		},
		{
			stopReason: "length",
			rawStopReason: "incomplete.max_output_tokens",
			usage: { output: 1 },
			content: [{ type: "text", text: " " }],
		},
	];

	it("flags every real degenerate sample (2/5 carried a whitespace-only text block)", () => {
		for (const sample of realSamples) expect(isDegenerateGatewayResponse(sample)).toBe(true);
	});

	it("flags raw-less gateways only when output is provably empty", () => {
		expect(isDegenerateGatewayResponse({ stopReason: "length", usage: { output: 0 }, content: [] })).toBe(true);
		expect(
			isDegenerateGatewayResponse({
				stopReason: "length",
				usage: { output: 1 },
				content: [{ type: "text", text: " \n\t" }],
			}),
		).toBe(true);
		expect(
			isDegenerateGatewayResponse({
				stopReason: "length",
				usage: { output: 1 },
				content: [{ type: "text", text: "hello" }],
			}),
		).toBe(false);
		expect(
			isDegenerateGatewayResponse({
				stopReason: "length",
				usage: { output: 1 },
				content: [{ type: "toolCall", id: "x", name: "bash", arguments: {} }],
			}),
		).toBe(false);
	});

	it("never flags real truncation or normal stops", () => {
		expect(isDegenerateGatewayResponse({ stopReason: "stop", usage: { output: 1048 } })).toBe(false);
		expect(isDegenerateGatewayResponse({ stopReason: "toolUse", usage: { output: 320 } })).toBe(false);
		// Real length truncation at the model's budget: output == maxTokens.
		expect(
			isDegenerateGatewayResponse({
				stopReason: "length",
				rawStopReason: "incomplete.max_output_tokens",
				usage: { output: 65536 },
				content: [{ type: "text", text: "long..." }],
			}),
		).toBe(false);
	});
});
