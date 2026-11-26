import { describe, expect, it } from "vitest";
import {
	buildCapabilityIndex,
	builtinCapabilitiesFor,
	type BuiltinCapabilities,
	ensureBuiltinCapabilityIndex,
	lookupCapabilities,
	normalizeModelId,
	resolveContextWindow,
} from "../capabilities.ts";

describe("normalizeModelId", () => {
	it("trims and lowercases ids", () => {
		expect(normalizeModelId("  GPT-5.2  ")).toBe("gpt-5.2");
	});
});

describe("buildCapabilityIndex", () => {
	const index = buildCapabilityIndex([
		// Same exact id in a gateway and the vendor catalog; vendor must win.
		{
			provider: "radius",
			id: "gpt-5.2",
			reasoning: false,
			input: ["text"],
			contextWindow: 1050000,
		},
		{
			provider: "openai",
			id: "gpt-5.2",
			reasoning: true,
			input: ["text", "image"],
			contextWindow: 400000,
		},
		// Unanimous context: safe to expose.
		{
			provider: "openai",
			id: "gpt-4o",
			reasoning: false,
			input: ["text", "image"],
			contextWindow: 128000,
		},
		{
			provider: "azure",
			id: "gpt-4o",
			reasoning: false,
			input: ["text", "image"],
			contextWindow: 128000,
		},
		// Distinct model; must never satisfy an exact `gpt-5.2` lookup.
		{
			provider: "openai",
			id: "gpt-5.2-chat",
			reasoning: false,
			input: ["text"],
			contextWindow: 400000,
		},
	]);

	it("looks up exact ids case-insensitively", () => {
		expect(lookupCapabilities(index, "gpt-4o")?.reasoning).toBe(false);
		expect(lookupCapabilities(index, "GPT-4O")?.reasoning).toBe(false);
	});

	it("prefers vendor catalogs for reasoning and input", () => {
		const hit = lookupCapabilities(index, "gpt-5.2");
		expect(hit?.reasoning).toBe(true);
		expect(hit?.input).toEqual(["text", "image"]);
	});

	it("exposes contextWindow only when every candidate agrees", () => {
		expect(lookupCapabilities(index, "gpt-4o")?.contextWindow).toBe(128000);
		expect(lookupCapabilities(index, "gpt-5.2")?.contextWindow).toBeUndefined();
	});

	it("does not fuzzy-match suffixes", () => {
		expect(lookupCapabilities(index, "gpt-5.2-chat")?.reasoning).toBe(false);
		expect(lookupCapabilities(index, "gpt-5")).toBeUndefined();
		expect(lookupCapabilities(index, "gpt-5.2-latest")).toBeUndefined();
	});

	it("returns undefined for unknown ids and for a missing index", () => {
		expect(lookupCapabilities(index, "not-a-model")).toBeUndefined();
		expect(lookupCapabilities(null, "gpt-4o")).toBeUndefined();
	});
});

describe("resolveContextWindow", () => {
	const hit: BuiltinCapabilities = {
		reasoning: true,
		input: ["text"],
		contextWindow: 128000,
	};

	it("adopts only a lower catalog value", () => {
		expect(resolveContextWindow(1_000_000, hit)).toBe(128000);
		expect(resolveContextWindow(128000, hit)).toBe(128000);
		expect(resolveContextWindow(100_000, hit)).toBe(100_000);
	});

	it("keeps the fallback when the catalog value is missing", () => {
		expect(resolveContextWindow(1_000_000, undefined)).toBe(1_000_000);
		expect(resolveContextWindow(1_000_000, { reasoning: true, input: ["text"] })).toBe(
			1_000_000,
		);
	});
});

describe("pi-ai built-in catalog integration", () => {
	it("loads capabilities for known ids and leaves unknown ids undefined", async () => {
		await ensureBuiltinCapabilityIndex();

		const gpt4o = builtinCapabilitiesFor("gpt-4o");
		expect(gpt4o?.reasoning).toBe(false);
		expect(gpt4o?.input).toContain("image");
		expect(gpt4o?.contextWindow).toBe(128000);

		// Conflicting context windows across catalogs (272k vs 1.05M).
		const gpt54 = builtinCapabilitiesFor("gpt-5.4");
		expect(gpt54?.reasoning).toBe(true);
		expect(gpt54?.contextWindow).toBeUndefined();

		expect(builtinCapabilitiesFor("definitely-not-a-real-model")).toBeUndefined();
	});
});
