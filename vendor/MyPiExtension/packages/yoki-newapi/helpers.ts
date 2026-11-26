/**
 * Pure helpers for pi-provider-newapi (no I/O, no pi runtime).
 */

import { createHash } from "node:crypto";
import type { ThinkingLevel } from "@earendil-works/pi-ai";

export type NewApiApiType = "openai-completions" | "openai-responses";

const DEFAULT_CONTEXT_WINDOW = 1_000_000;
const DEFAULT_MAX_TOKENS = 65_536;

const VISION_HINT_PATTERN =
	/(?:^|[-_/.:])(?:gpt-4o|gpt-4\.1|gpt-5|claude-3|claude-4|gemini|vision|vl)(?:$|[-_/.:])/i;

export function normalizeBaseUrl(input: string): string {
	return input.trim().replace(/\/+$/, "").replace(/\/v1\/?$/i, "");
}

/**
 * Stable signature of the credential context a provider registration was built
 * from. Lets callers detect login / key / gateway changes that require a full
 * re-registration, and otherwise reuse the existing registration.
 */
export function credentialSignature(fields: {
	baseUrl?: string;
	access?: string;
	api?: string;
}): string {
	const material = `${normalizeBaseUrl(fields.baseUrl ?? "")}|${fields.api ?? ""}|${fields.access ?? ""}`;
	return createHash("sha256").update(material).digest("hex").slice(0, 16);
}

/** Map Codex wire_api to pi Api type. Unknown values throw. */
export function mapWireApi(wireApi: string | undefined): NewApiApiType {
	if (wireApi === undefined || wireApi === "") return "openai-completions";
	const normalized = wireApi.trim().toLowerCase();
	if (normalized === "responses") return "openai-responses";
	if (normalized === "chat" || normalized === "completions") return "openai-completions";
	throw new Error(
		`Unsupported Codex wire_api "${wireApi}". Expected "responses", "chat", or "completions".`,
	);
}

/** Map Codex model_reasoning_effort to pi ThinkingLevel; undefined if unmapped. */
export function mapReasoningEffort(effort: string | undefined): ThinkingLevel | undefined {
	if (effort === undefined || effort === "") return undefined;
	const normalized = effort.trim().toLowerCase();
	const allowed = ["minimal", "low", "medium", "high", "xhigh", "max"];
	if (allowed.includes(normalized)) {
		return normalized as ThinkingLevel;
	}
	return undefined;
}

export function isNewApiApiType(value: unknown): value is NewApiApiType {
	return value === "openai-completions" || value === "openai-responses";
}

/** Minimal TOML string-value reader for Codex config.toml. */
export function extractTomlString(toml: string, key: string, section?: string): string | undefined {
	const lines = toml.split(/\r?\n/);
	let inTargetSection = section === undefined;
	const sectionHeader = section ? `[${section}]` : undefined;
	const keyPattern = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*(.+?)\\s*$`);

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		if (trimmed.startsWith("[")) {
			if (sectionHeader) {
				inTargetSection = trimmed === sectionHeader;
			}
			continue;
		}

		if (!inTargetSection) continue;
		const match = line.match(keyPattern);
		if (!match) continue;
		const raw = match[1]!.trim();
		if (
			(raw.startsWith('"') && raw.endsWith('"')) ||
			(raw.startsWith("'") && raw.endsWith("'"))
		) {
			return raw.slice(1, -1);
		}
		const bare = raw.replace(/\s+#.*$/, "").trim();
		if (bare) return bare;
	}
	return undefined;
}

export function extractApiKeyFromCodexAuth(auth: unknown): string | undefined {
	if (!auth || typeof auth !== "object") return undefined;
	const record = auth as Record<string, unknown>;

	const directKeys = ["OPENAI_API_KEY", "openai_api_key", "api_key", "apiKey", "access_token"];
	for (const key of directKeys) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}

	const tokens = record.tokens;
	if (tokens && typeof tokens === "object") {
		const tokenRecord = tokens as Record<string, unknown>;
		for (const key of ["access_token", "api_key", "apiKey", "token"]) {
			const value = tokenRecord[key];
			if (typeof value === "string" && value.trim()) return value.trim();
		}
	}

	return undefined;
}

function guessVision(id: string): boolean {
	return VISION_HINT_PATTERN.test(id);
}

/** Filter a gateway `supported_endpoint_types` value to non-empty unique strings; undefined when unusable. */
export function normalizeEndpointTypes(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const types = value.filter((item): item is string => typeof item === "string" && item.length > 0);
	return types.length > 0 ? [...new Set(types)] : undefined;
}

/**
 * Choose the wire api for a discovered model from its `supported_endpoint_types`.
 *
 * The list is advisory: `openai-response` explicitly enables the Responses API, while a
 * non-OpenAI family (anthropic/gemini/...) marks an upstream whose responses conversion the
 * gateway does not implement (HTTP 500 on /v1/responses). Lists containing only `openai`
 * carry no such signal — measured gateways route those through /v1/responses fine — so the
 * credential api is kept instead of guessing.
 */
export function pickApiForModel(
	supportedEndpointTypes: unknown,
	fallback: NewApiApiType,
): NewApiApiType {
	const types = normalizeEndpointTypes(supportedEndpointTypes);
	if (!types) return fallback;
	if (types.includes("openai-response")) return "openai-responses";
	if (types.some((type) => type !== "openai")) return "openai-completions";
	return fallback;
}

/** Minimal assistant-message shape needed to spot degenerate gateway responses. */
export type DegenerateResponseProbe = {
	stopReason?: string;
	rawStopReason?: unknown;
	usage?: { output?: number };
	content?: unknown;
};

/**
 * A gateways' degenerate "length" response: reports hitting max_output_tokens while emitting
 * (next to) no output at all. pi's recoverable-length heuristic then misreads it as context
 * pressure — discards the response and runs a real compaction that drops most history.
 * Observed fingerprint (5/5 samples, 2026-10-09): `output=1` + `rawStopReason` containing
 * `max_output_tokens`; content is `[]` or whitespace-only text.
 */
export function isDegenerateGatewayResponse(message: DegenerateResponseProbe): boolean {
	if (message.stopReason !== "length") return false;
	if ((message.usage?.output ?? 0) > 1) return false;
	const raw = typeof message.rawStopReason === "string" ? message.rawStopReason : "";
	if (raw.includes("max_output_tokens")) return true;
	// Gateways without a raw stop reason: require provably empty output. A tool call or any
	// non-whitespace text means the model really did produce something — not degenerate.
	const blocks = Array.isArray(message.content)
		? (message.content as Array<{ type?: string; text?: string }>)
		: [];
	if (blocks.some((block) => block?.type === "toolCall")) return false;
	const text = blocks
		.filter((block) => block?.type === "text")
		.map((block) => block.text ?? "")
		.join("");
	return text.trim() === "";
}

/** Minimal model def when Codex model is missing from /v1/models. */
export function stubModelDef(id: string): {
	id: string;
	name: string;
	reasoning: boolean;
	input: Array<"text" | "image">;
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
} {
	return {
		id,
		name: id,
		reasoning: true,
		input: guessVision(id) ? ["text", "image"] : ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: DEFAULT_CONTEXT_WINDOW,
		maxTokens: DEFAULT_MAX_TOKENS,
	};
}
