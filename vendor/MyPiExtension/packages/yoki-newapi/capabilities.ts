/**
 * Exact-ID capability lookup against pi-ai's built-in chat catalog.
 *
 * Inherited:
 * - `reasoning` (API-agnostic boolean)
 * - `input` modalities (text / image; vendor catalogs win on conflicts)
 * - `contextWindow`, but ONLY when every exact candidate agrees AND the value is
 *   lower than the provider's current fallback. Conflicts (e.g. gpt-5.4: 272k in
 *   openai vs 1.05M in azure) stay at the fallback to avoid premature compaction.
 *
 * NOT inherited:
 * - `thinkingLevelMap` / `compat` / `samplingParams*`: API-specific values.
 * - `maxTokens`: raising the output budget can trigger upstream 400s; the
 *   provider keeps its own budget and `models.json` overrides stay topmost.
 * - `cost`: relay pricing differs from the official catalog.
 *
 * Exact matching is deliberate: fuzzy normalization creates false matches
 * (e.g. `gpt-5.2` -> `gpt-5.2-chat`, which is a different, non-reasoning model).
 */

export type CapabilityInput = "text" | "image";

/** Minimal shape needed from a built-in catalog entry. */
export interface BuiltinCapabilityEntry {
	provider: string;
	id: string;
	reasoning: boolean;
	input: readonly CapabilityInput[];
	contextWindow: number;
}

export interface BuiltinCapabilities {
	reasoning: boolean;
	input: CapabilityInput[];
	/** Present only when every exact candidate agrees on the value. */
	contextWindow?: number;
}

/**
 * Vendor-authoritative catalogs first; gateway/aggregator catalogs follow.
 * Only matters when the same exact id appears in multiple catalogs with a
 * conflicting flag/modality (context conflicts are handled separately).
 */
const PROVIDER_PRIORITY = new Map<string, number>(
	[
		"anthropic",
		"openai",
		"google",
		"google-vertex",
		"deepseek",
		"xai",
		"mistral",
		"meta",
		"amazon-bedrock",
		"azure",
		"moonshotai",
		"moonshotai-cn",
		"minimax",
		"minimax-cn",
		"zai",
		"zai-coding-cn",
		"kimi-coding",
		"qwen-token-plan",
		"qwen-token-plan-cn",
		"qwen-token-plan-individual",
		"xiaomi",
		"xiaomi-token-plan-ams",
		"xiaomi-token-plan-cn",
		"xiaomi-token-plan-sgp",
		"nvidia",
		"cerebras",
		"groq",
		"together",
		"fireworks",
		"baseten",
	]
		.map((provider, index) => [provider, index] as const),
);

function providerRank(provider: string): number {
	return PROVIDER_PRIORITY.get(provider) ?? PROVIDER_PRIORITY.size;
}

/** Model ids are matched case-insensitively; surrounding whitespace is ignored. */
export function normalizeModelId(id: string): string {
	return id.trim().toLowerCase();
}

/**
 * Build an exact-id capability index. `reasoning` / `input` take the
 * highest-priority candidate; `contextWindow` is kept only when every candidate
 * agrees. The lower-than-fallback check lives in `resolveContextWindow` because
 * the fallback is known at composition time.
 */
export function buildCapabilityIndex(
	entries: readonly BuiltinCapabilityEntry[],
): Map<string, BuiltinCapabilities> {
	const groups = new Map<string, BuiltinCapabilityEntry[]>();
	for (const entry of entries) {
		const key = normalizeModelId(entry.id);
		if (!key) continue;
		const group = groups.get(key);
		if (group) group.push(entry);
		else groups.set(key, [entry]);
	}

	const index = new Map<string, BuiltinCapabilities>();
	for (const [key, group] of groups) {
		const sorted = [...group].sort(
			(a, b) => providerRank(a.provider) - providerRank(b.provider),
		);
		const first = sorted[0];
		const sameContext = group.every(
			(entry) => entry.contextWindow === first.contextWindow,
		);
		index.set(key, {
			reasoning: first.reasoning,
			input: [...first.input],
			...(sameContext ? { contextWindow: first.contextWindow } : {}),
		});
	}
	return index;
}

export function lookupCapabilities(
	index: ReadonlyMap<string, BuiltinCapabilities> | null,
	id: string,
): BuiltinCapabilities | undefined {
	return index?.get(normalizeModelId(id));
}

/**
 * Adopt the catalog's context window only when it is lower than the provider's
 * current fallback. Higher values are ignored: the relay may be capped by its
 * own upstream, and overstating the window delays compaction.
 */
export function resolveContextWindow(
	fallback: number,
	capabilities: BuiltinCapabilities | undefined,
): number {
	const catalog = capabilities?.contextWindow;
	return catalog !== undefined && catalog < fallback ? catalog : fallback;
}

type BuiltinCatalog = typeof import("@earendil-works/pi-ai/providers/all");

let indexPromise: Promise<Map<string, BuiltinCapabilities> | null> | null = null;
let index: Map<string, BuiltinCapabilities> | null = null;

async function loadIndex(): Promise<Map<string, BuiltinCapabilities> | null> {
	try {
		const catalog = (await import("@earendil-works/pi-ai/providers/all")) as BuiltinCatalog;
		const entries: BuiltinCapabilityEntry[] = [];
		for (const provider of catalog.getBuiltinProviders()) {
			for (const model of catalog.getBuiltinModels(provider)) {
				entries.push({
					provider,
					id: model.id,
					reasoning: model.reasoning,
					input: model.input,
					contextWindow: model.contextWindow,
				});
			}
		}
		return buildCapabilityIndex(entries);
	} catch {
		// Older pi-ai or a missing export: keep the caller's own fallbacks.
		return null;
	}
}

/**
 * Load pi-ai's built-in catalog once per process. Failures are cached (null)
 * so every model composition does not retry a broken import.
 */
export async function ensureBuiltinCapabilityIndex(): Promise<void> {
	if (index !== null) return;
	indexPromise ??= loadIndex();
	index = await indexPromise;
}

/** `undefined` means "not in the built-in catalog": caller keeps its fallbacks. */
export function builtinCapabilitiesFor(id: string): BuiltinCapabilities | undefined {
	return lookupCapabilities(index, id);
}
