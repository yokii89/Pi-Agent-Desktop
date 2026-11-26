/**
 * New API / One API proxy provider for Pi.
 *
 * OpenAI-compatible third-party gateways (New API, One API, forks).
 * Discovers models only from GET /v1/models - never LiteLLM /model/info.
 *
 * Install:
 *   pi install npm:pi-provider-newapi
 *   /login newapi   (Manual or Import from Codex)
 *
 * Env (optional when no saved login):
 *   NEWAPI_BASE_URL=https://api.example.com
 *   NEWAPI_API_KEY=sk-...
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
	Api,
	AssistantMessage,
	Model,
	OAuthCredentials,
	OAuthLoginCallbacks,
	ThinkingLevel,
} from "@earendil-works/pi-ai";
import {
	type ExtensionAPI,
	type ExtensionCommandContext,
	getAgentDir,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { GLYPH_ERROR, GLYPH_SUCCESS, GLYPH_WARNING } from "yoki_ui/style";
import {
	builtinCapabilitiesFor,
	ensureBuiltinCapabilityIndex,
	resolveContextWindow,
} from "./capabilities.ts";
import {
	credentialSignature,
	extractApiKeyFromCodexAuth,
	extractTomlString,
	isDegenerateGatewayResponse,
	isNewApiApiType,
	mapReasoningEffort,
	mapWireApi,
	normalizeBaseUrl,
	normalizeEndpointTypes,
	pickApiForModel,
	stubModelDef,
	type NewApiApiType,
} from "./helpers.ts";
import {
	formatCacheAge,
	formatStatusPlain,
	maskKey,
	openNewApiModelPicker,
	openNewApiPanel,
	parseNewApiArgs,
	type NewApiStatusInfo,
	type PanelActionId,
	type PanelActionResult,
	type PickerItem,
} from "./panel.ts";

export {
	extractApiKeyFromCodexAuth,
	extractTomlString,
	isNewApiApiType,
	mapReasoningEffort,
	mapWireApi,
	normalizeBaseUrl,
	stubModelDef,
};
export type { NewApiApiType };

const PROVIDER_NAME = "newapi";
const DISPLAY_NAME = "New API";
const ENV_BASE_URL = "NEWAPI_BASE_URL";
const ENV_API_KEY = "NEWAPI_API_KEY";
const CACHE_FILENAME = "newapi-models.json";
const LOGIN_TIMEOUT_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 10_000;
/** Cache shape version. 2 adds per-model `supportedEndpointTypes`; 3 bumps the default output budget to 64k. Older caches refetch once. */
const CACHE_SCHEMA_VERSION = 3;
const CACHE_STALE_MS = 24 * 60 * 60 * 1000;
// After a failed discovery, remember the failure for a short window so
// subsequent spawns don't block on the same dead endpoint.
const FAILURE_STALE_MS = 10 * 60 * 1000;
const PERMANENT_EXPIRES = Number.MAX_SAFE_INTEGER;
const DEFAULT_CONTEXT_WINDOW = 1_000_000;
const DEFAULT_MAX_TOKENS = 65_536;

/** Last /v1/models discovery failure, surfaced via the panel and session start. */
let lastDiscoveryError: string | undefined;

/** Credential signature the last registerProxyProvider call was built from. */
let lastRegisteredSignature: string | undefined;

type ModelDef = {
	id: string;
	name: string;
	/** Cached fallback; registration overrides it from pi-ai's catalog by exact id. */
	reasoning: boolean;
	input: Array<"text" | "image">;
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
	/** Gateway `supported_endpoint_types`; picks the wire api per model. */
	supportedEndpointTypes?: string[];
};

type CacheFile = {
	/** Written by writeCache; validated by readCache. */
	schemaVersion?: number;
	baseUrl: string;
	apiKeyFingerprint: string;
	fetchedAt: number;
	models: ModelDef[];
	/** Discovery failed as of fetchedAt; models are last-known or placeholders. */
	failure?: boolean;
	error?: string;
};

export type StoredOAuth = OAuthCredentials & {
	type?: string;
	baseUrl?: string;
	/** Provider wire API: openai-completions or openai-responses. */
	api?: NewApiApiType;
	/** Codex/import preferred model id; applied once via setModel. */
	preferredModel?: string;
	/** Codex model_reasoning_effort mapped to pi thinking level. */
	preferredThinking?: ThinkingLevel;
};

type ModelsListResponse = {
	data?: Array<{ id?: string; name?: string; owned_by?: string; supported_endpoint_types?: unknown }>;
};

export type CodexImport = {
	apiKey: string;
	baseUrl: string;
	api: NewApiApiType;
	model?: string;
	thinking?: ThinkingLevel;
	authPath: string;
	configPath: string;
};

function fingerprint(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function getCachePath(filename: string = CACHE_FILENAME): string {
	return join(getAgentDir(), filename);
}

function getAuthPath(): string {
	return join(getAgentDir(), "auth.json");
}

function getCodexDir(): string {
	return join(homedir(), ".codex");
}

function getCodexAuthPath(): string {
	return join(getCodexDir(), "auth.json");
}

function getCodexConfigPath(): string {
	return join(getCodexDir(), "config.toml");
}

function withTimeout(timeoutMs: number, signal?: AbortSignal) {
	const controller = new AbortController();
	const onAbort = () => controller.abort(signal?.reason);
	signal?.addEventListener("abort", onAbort, { once: true });
	const timer = setTimeout(
		() => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)),
		timeoutMs,
	);
	return {
		signal: controller.signal,
		cancel: () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		},
	};
}

function looksLikeHtml(body: string, contentType: string | null): boolean {
	const ct = (contentType ?? "").toLowerCase();
	if (ct.includes("text/html")) return true;
	const trimmed = body.trimStart().toLowerCase();
	return trimmed.startsWith("<!doctype") || trimmed.startsWith("<html");
}

async function fetchJson(
	url: string,
	apiKey: string,
	options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; error: string }> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const { signal, cancel } = withTimeout(timeoutMs, options.signal);
	try {
		const response = await fetch(url, {
			headers: {
				Authorization: `Bearer ${apiKey}`,
				Accept: "application/json",
			},
			signal,
			// Avoid following host redirects into SPA HTML (common on New API frontends).
			redirect: "manual",
		});

		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get("location") ?? "(none)";
			return {
				ok: false,
				status: response.status,
				error: `Redirected to ${location}. Use the API host (not the UI host) as base URL.`,
			};
		}

		const text = await response.text();
		const contentType = response.headers.get("content-type");

		if (!response.ok) {
			const preview = text.slice(0, 200).replace(/\s+/g, " ");
			return {
				ok: false,
				status: response.status,
				error: preview || `HTTP ${response.status}`,
			};
		}

		if (looksLikeHtml(text, contentType)) {
			return {
				ok: false,
				status: response.status,
				error: `Expected JSON from ${url} but received HTML. Check base URL (API root, not UI).`,
			};
		}

		try {
			return { ok: true, data: JSON.parse(text) as unknown };
		} catch {
			const preview = text.slice(0, 120).replace(/\s+/g, " ");
			return {
				ok: false,
				status: response.status,
				error: `Invalid JSON from ${url}: ${preview}`,
			};
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, status: 0, error: message };
	} finally {
		cancel();
	}
}

const VISION_HINT_PATTERN =
	/(?:^|[-_/.:])(?:gpt-4o|gpt-4\.1|gpt-5|claude-3|claude-4|gemini|vision|vl)(?:$|[-_/.:])/i;

function guessVision(id: string): boolean {
	return VISION_HINT_PATTERN.test(id);
}

function mapModel(entry: {
	id?: string;
	name?: string;
	supported_endpoint_types?: unknown;
}): ModelDef | undefined {
	const id = entry.id?.trim();
	if (!id) return undefined;
	return {
		id,
		name: entry.name?.trim() || id,
		// Fallback for ids absent from pi-ai's built-in catalog: keep Shift+Tab
		// thinking available and keep the vision heuristic below. Composed models
		// use the catalog's reasoning/input/context when the exact id matches
		// (see capabilities.ts).
		reasoning: true,
		input: guessVision(id) ? ["text", "image"] : ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: DEFAULT_CONTEXT_WINDOW,
		maxTokens: DEFAULT_MAX_TOKENS,
		supportedEndpointTypes: normalizeEndpointTypes(entry.supported_endpoint_types),
	};
}

export async function discoverModels(
	baseUrl: string,
	apiKey: string,
	options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ModelDef[]> {
	const base = normalizeBaseUrl(baseUrl);
	const result = await fetchJson(`${base}/v1/models`, apiKey, options);
	if (!result.ok) {
		throw new Error(`/v1/models failed (${result.status || "network"}): ${result.error}`);
	}

	const payload = result.data as ModelsListResponse;
	const list = Array.isArray(payload?.data) ? payload.data : [];
	const models = list.map(mapModel).filter((m): m is ModelDef => m !== undefined);
	if (models.length === 0) {
		throw new Error("/v1/models returned no models. Check API key permissions.");
	}
	return models;
}

async function readCache(filename: string = CACHE_FILENAME): Promise<CacheFile | undefined> {
	try {
		const raw = await readFile(getCachePath(filename), "utf8");
		const parsed = JSON.parse(raw) as CacheFile;
		if (
			parsed.schemaVersion !== CACHE_SCHEMA_VERSION ||
			typeof parsed.baseUrl !== "string" ||
			typeof parsed.apiKeyFingerprint !== "string" ||
			typeof parsed.fetchedAt !== "number" ||
			!Array.isArray(parsed.models)
		) {
			return undefined;
		}
		return parsed;
	} catch {
		return undefined;
	}
}

async function writeCache(cache: CacheFile, filename: string = CACHE_FILENAME): Promise<void> {
	const path = getCachePath(filename);
	await mkdir(dirname(path), { recursive: true });
	const tmp = `${path}.${process.pid}.tmp`;
	await writeFile(
		tmp,
		JSON.stringify({ ...cache, schemaVersion: CACHE_SCHEMA_VERSION }, null, 2),
		"utf8",
	);
	await rename(tmp, path);
}

function isCacheValid(cache: CacheFile, baseUrl: string, apiKey: string): boolean {
	if (cache.baseUrl !== normalizeBaseUrl(baseUrl)) return false;
	if (cache.apiKeyFingerprint !== fingerprint(apiKey)) return false;
	const ttl = cache.failure ? FAILURE_STALE_MS : CACHE_STALE_MS;
	return Date.now() - cache.fetchedAt < ttl;
}

async function readAuthEntry(): Promise<StoredOAuth | undefined> {
	try {
		const raw = await readFile(getAuthPath(), "utf8");
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const entry = parsed[PROVIDER_NAME] as StoredOAuth | undefined;
		if (entry?.type === "oauth" && typeof entry.access === "string") return entry;
		return undefined;
	} catch {
		return undefined;
	}
}

async function resolveCredentials(): Promise<{
	baseUrl?: string;
	apiKey?: string;
	api: NewApiApiType;
	preferredModel?: string;
	preferredThinking?: ThinkingLevel;
	source: string;
}> {
	const entry = await readAuthEntry();
	if (entry) {
		const preferredThinking =
			typeof entry.preferredThinking === "string"
				? mapReasoningEffort(entry.preferredThinking) ?? (entry.preferredThinking as ThinkingLevel)
				: undefined;
		return {
			baseUrl: entry.baseUrl ? normalizeBaseUrl(entry.baseUrl) : undefined,
			apiKey: entry.access.trim(),
			api: isNewApiApiType(entry.api) ? entry.api : "openai-completions",
			preferredModel: typeof entry.preferredModel === "string" ? entry.preferredModel : undefined,
			preferredThinking,
			source: "auth.json",
		};
	}
	const envBase = process.env[ENV_BASE_URL]?.trim();
	const envKey = process.env[ENV_API_KEY]?.trim();
	return {
		baseUrl: envBase ? normalizeBaseUrl(envBase) : undefined,
		apiKey: envKey,
		api: "openai-completions",
		source: envKey || envBase ? "env" : "none",
	};
}

function credentialsFromContext(credential: unknown): {
	baseUrl?: string;
	apiKey?: string;
	api: NewApiApiType;
	preferredModel?: string;
	preferredThinking?: ThinkingLevel;
} {
	if (!credential || typeof credential !== "object") {
		return { api: "openai-completions" };
	}
	const entry = credential as StoredOAuth;
	if (entry.type === "oauth" && typeof entry.access === "string") {
		const preferredThinking =
			typeof entry.preferredThinking === "string"
				? mapReasoningEffort(entry.preferredThinking) ?? (entry.preferredThinking as ThinkingLevel)
				: undefined;
		return {
			baseUrl: typeof entry.baseUrl === "string" ? normalizeBaseUrl(entry.baseUrl) : undefined,
			apiKey: entry.access.trim(),
			api: isNewApiApiType(entry.api) ? entry.api : "openai-completions",
			preferredModel: typeof entry.preferredModel === "string" ? entry.preferredModel : undefined,
			preferredThinking,
		};
	}
	const apiKeyEntry = entry as unknown as { key?: string };
	if (entry.type === "api_key" && typeof apiKeyEntry.key === "string") {
		return {
			apiKey: apiKeyEntry.key.trim(),
			api: "openai-completions",
		};
	}
	return { api: "openai-completions" };
}

export async function importFromCodex(): Promise<CodexImport> {
	const authPath = getCodexAuthPath();
	const configPath = getCodexConfigPath();
	let authRaw: string;
	try {
		authRaw = await readFile(authPath, "utf8");
	} catch {
		throw new Error(`Codex auth not found at ${authPath}. Run Codex login or configure via CC Switch first.`);
	}

	let authJson: unknown;
	try {
		authJson = JSON.parse(authRaw) as unknown;
	} catch {
		throw new Error(`Invalid JSON in ${authPath}`);
	}

	const apiKey = extractApiKeyFromCodexAuth(authJson);
	if (!apiKey) {
		throw new Error(
			`No API key found in ${authPath}. Expected OPENAI_API_KEY (or tokens.access_token).`,
		);
	}

	let configRaw: string;
	try {
		configRaw = await readFile(configPath, "utf8");
	} catch {
		throw new Error(`Codex config not found at ${configPath}. Expected base_url from CC Switch / Codex config.`);
	}

	const modelProvider = extractTomlString(configRaw, "model_provider");
	let baseUrl: string | undefined;
	let wireApi: string | undefined;
	if (modelProvider) {
		const section = `model_providers.${modelProvider}`;
		baseUrl = extractTomlString(configRaw, "base_url", section);
		wireApi = extractTomlString(configRaw, "wire_api", section);
	}
	if (!baseUrl) {
		const sectionMatch = configRaw.match(/\[model_providers\.([^\]]+)\]/g);
		if (sectionMatch) {
			for (const header of sectionMatch) {
				const name = header.slice("[model_providers.".length, -1);
				const section = `model_providers.${name}`;
				baseUrl = extractTomlString(configRaw, "base_url", section);
				if (baseUrl) {
					wireApi = extractTomlString(configRaw, "wire_api", section);
					break;
				}
			}
		}
	}
	if (!baseUrl) {
		baseUrl = extractTomlString(configRaw, "base_url");
	}
	if (!baseUrl?.trim()) {
		throw new Error(
			`No base_url found in ${configPath}. Set [model_providers.<name>].base_url (CC Switch / Codex).`,
		);
	}

	const api = mapWireApi(wireApi);
	const model = extractTomlString(configRaw, "model");
	const thinking = mapReasoningEffort(extractTomlString(configRaw, "model_reasoning_effort"));

	return {
		apiKey,
		baseUrl: normalizeBaseUrl(baseUrl),
		api,
		model: model?.trim() || undefined,
		thinking,
		authPath,
		configPath,
	};
}

function ensurePreferredInList(models: ModelDef[], preferredModel?: string): ModelDef[] {
	if (!preferredModel) return models;
	if (models.some((m) => m.id === preferredModel)) return models;
	return [stubModelDef(preferredModel), ...models];
}

async function loginManual(callbacks: OAuthLoginCallbacks): Promise<StoredOAuth> {
	const previous = await readAuthEntry();
	const previousApi = isNewApiApiType(previous?.api) ? previous.api : "openai-completions";

	let baseUrl = "";
	let apiKey = "";
	let api: NewApiApiType = previousApi;

	for (;;) {
		if (!baseUrl) {
			const rawBase = (
				await callbacks.onPrompt({
					message: "Enter New API base URL (no trailing /v1):",
					placeholder: "https://api.example.com",
				})
			).trim();
			if (!rawBase) throw new Error("Base URL is required");
			baseUrl = normalizeBaseUrl(rawBase);

			apiKey = (await callbacks.onPrompt({ message: "Enter API key (sk-...):" })).trim();
			if (!apiKey) throw new Error("API key is required");

			const apiChoice = await callbacks.onSelect({
				message: `API type (previous: ${previousApi})`,
				options: [
					{ id: "openai-completions", label: "openai-completions (chat)" },
					{ id: "openai-responses", label: "openai-responses" },
				],
			});
			api =
				apiChoice === "openai-responses" || apiChoice === "openai-completions"
					? apiChoice
					: previousApi;
		}

		callbacks.onProgress?.("Discovering models via /v1/models...");
		try {
			const models = await discoverModels(baseUrl, apiKey, {
				timeoutMs: LOGIN_TIMEOUT_MS,
				signal: callbacks.signal,
			});

			await writeCache({
				baseUrl,
				apiKeyFingerprint: fingerprint(apiKey),
				fetchedAt: Date.now(),
				models,
			});
			callbacks.onProgress?.(`New API: discovered ${models.length} models (api=${api})`);

			return {
				access: apiKey,
				refresh: "",
				expires: PERMANENT_EXPIRES,
				baseUrl,
				api,
			};
		} catch (error) {
			if (callbacks.signal?.aborted) throw error;
			lastDiscoveryError = error instanceof Error ? error.message : String(error);
			const recovery = await callbacks.onSelect({
				message: `Model discovery failed: ${lastDiscoveryError}`,
				options: [
					{ id: "retry", label: "Retry discovery" },
					{ id: "reenter", label: "Re-enter base URL / key" },
					{ id: "abort", label: "Abort login" },
				],
			});
			if (recovery === "reenter") {
				baseUrl = "";
				continue;
			}
			if (recovery !== "retry") {
				throw new Error(`Model discovery failed: ${lastDiscoveryError}`);
			}
		}
	}
}

async function loginFromCodex(callbacks: OAuthLoginCallbacks): Promise<StoredOAuth> {
	callbacks.onProgress?.("Reading Codex credentials from ~/.codex ...");
	const imported = await importFromCodex();

	callbacks.onProgress?.(
		`Importing base_url=${imported.baseUrl} api=${imported.api}` +
			(imported.model ? ` model=${imported.model}` : "") +
			` (from ${imported.configPath})...`,
	);

	const models = await discoverModels(imported.baseUrl, imported.apiKey, {
		timeoutMs: LOGIN_TIMEOUT_MS,
		signal: callbacks.signal,
	});
	const withPreferred = ensurePreferredInList(models, imported.model);

	await writeCache({
		baseUrl: imported.baseUrl,
		apiKeyFingerprint: fingerprint(imported.apiKey),
		fetchedAt: Date.now(),
		models: withPreferred,
	});
	callbacks.onProgress?.(
		`New API: imported ${withPreferred.length} models` +
			(imported.model ? `; preferred model ${imported.model}` : ""),
	);

	const cred: StoredOAuth = {
		access: imported.apiKey,
		refresh: "",
		expires: PERMANENT_EXPIRES,
		baseUrl: imported.baseUrl,
		api: imported.api,
	};
	if (imported.model) cred.preferredModel = imported.model;
	if (imported.thinking) cred.preferredThinking = imported.thinking;
	return cred;
}

async function loginNewApi(callbacks: OAuthLoginCallbacks): Promise<StoredOAuth> {
	const mode = await callbacks.onSelect({
		message: "New API login method",
		options: [
			{ id: "manual", label: "Manual" },
			{ id: "codex", label: "Import from Codex" },
		],
	});

	if (mode === "codex") {
		return loginFromCodex(callbacks);
	}
	if (mode === "manual") {
		return loginManual(callbacks);
	}
	throw new Error("Login cancelled");
}

async function refreshStoredOAuth(credentials: OAuthCredentials): Promise<OAuthCredentials> {
	return credentials;
}

function getApiKey(credentials: OAuthCredentials): string {
	return credentials.access;
}

function modifyModels(models: Model<any>[], credentials: OAuthCredentials): Model<any>[] {
	const baseUrl =
		typeof credentials.baseUrl === "string" ? normalizeBaseUrl(credentials.baseUrl) : undefined;
	if (!baseUrl) return models;
	const v1 = `${baseUrl}/v1`;
	// Only refresh the gateway base URL; `api` is chosen per model by toProviderModels
	// from `supported_endpoint_types` and must survive credential refreshes.
	return models.map((model) => (model.provider === PROVIDER_NAME ? { ...model, baseUrl: v1 } : model));
}

function toProviderModels(models: ModelDef[], baseUrl?: string, api?: NewApiApiType) {
	const v1 = baseUrl ? `${normalizeBaseUrl(baseUrl)}/v1` : undefined;
	const resolvedApi = api ?? "openai-completions";
	return models.map((m) => {
		const capabilities = builtinCapabilitiesFor(m.id);
		return {
			id: m.id,
			name: m.name,
			api: pickApiForModel(m.supportedEndpointTypes, resolvedApi) as Api,
			// Exact-id catalog match overrides the cached fallbacks. `reasoning` and
			// `input` are API-agnostic; `contextWindow` only drops when every catalog
			// candidate agrees (see capabilities.ts). Thinking maps/compat/cost stay
			// provider-specific and are intentionally not inherited.
			reasoning: capabilities?.reasoning ?? m.reasoning,
			input: capabilities?.input ?? m.input,
			cost: m.cost,
			contextWindow: resolveContextWindow(m.contextWindow, capabilities),
			maxTokens: m.maxTokens,
			...(v1 ? { baseUrl: v1 } : {}),
		};
	});
}

const PLACEHOLDER_MODELS: ModelDef[] = [
	{
		id: "run-login-newapi",
		name: "Run /login newapi",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: DEFAULT_CONTEXT_WINDOW,
		maxTokens: DEFAULT_MAX_TOKENS,
	},
];

async function loadModels(): Promise<{
	models: ModelDef[];
	activeBaseUrl?: string;
	api: NewApiApiType;
	preferredModel?: string;
	preferredThinking?: ThinkingLevel;
}> {
	const resolved = await resolveCredentials();
	const cache = await readCache();

	if (resolved.baseUrl && resolved.apiKey && cache && isCacheValid(cache, resolved.baseUrl, resolved.apiKey)) {
		// A failure marker still answers instantly, but keep surfacing the error
		// so session start keeps warning instead of going silent.
		if (cache.failure && cache.error) lastDiscoveryError = cache.error;
		return {
			models: ensurePreferredInList(cache.models, resolved.preferredModel),
			activeBaseUrl: resolved.baseUrl,
			api: resolved.api,
			preferredModel: resolved.preferredModel,
			preferredThinking: resolved.preferredThinking,
		};
	}

	if (resolved.baseUrl && resolved.apiKey) {
		try {
			const next = await discoverModels(resolved.baseUrl, resolved.apiKey, {
				timeoutMs: DEFAULT_TIMEOUT_MS,
			});
			const withPreferred = ensurePreferredInList(next, resolved.preferredModel);
			await writeCache({
				baseUrl: normalizeBaseUrl(resolved.baseUrl),
				apiKeyFingerprint: fingerprint(resolved.apiKey),
				fetchedAt: Date.now(),
				models: withPreferred,
			});
			return {
				models: withPreferred,
				activeBaseUrl: resolved.baseUrl,
				api: resolved.api,
				preferredModel: resolved.preferredModel,
				preferredThinking: resolved.preferredThinking,
			};
		} catch (error) {
			lastDiscoveryError = error instanceof Error ? error.message : String(error);
			// Failure marker: next spawns answer from this instead of blocking on
			// the same dead endpoint for another round trip.
			try {
				await writeCache({
					baseUrl: normalizeBaseUrl(resolved.baseUrl),
					apiKeyFingerprint: fingerprint(resolved.apiKey),
					fetchedAt: Date.now(),
					models: cache?.models?.length ? cache.models : PLACEHOLDER_MODELS,
					failure: true,
					error: lastDiscoveryError,
				});
			} catch {
				// Best-effort; fall through to cache / placeholder as before.
			}
			// Fall through to cache / placeholder
		}
	}

	if (cache?.models?.length) {
		return {
			models: ensurePreferredInList(cache.models, resolved.preferredModel),
			activeBaseUrl: cache.baseUrl,
			api: resolved.api,
			preferredModel: resolved.preferredModel,
			preferredThinking: resolved.preferredThinking,
		};
	}

	return {
		models: [],
		activeBaseUrl: resolved.baseUrl,
		api: resolved.api,
		preferredModel: resolved.preferredModel,
		preferredThinking: resolved.preferredThinking,
	};
}

async function registerProxyProvider(
	pi: ExtensionAPI,
	models: ModelDef[],
	activeBaseUrl?: string,
	api: NewApiApiType = "openai-completions",
) {
	await ensureBuiltinCapabilityIndex();
	const hasModels = models.length > 0;
	const providerBaseUrl = activeBaseUrl
		? `${normalizeBaseUrl(activeBaseUrl)}/v1`
		: "https://api.example.com/v1";

	// With a stored oauth credential, register OAuth-only: pi's composer only
	// fabricates the "Sign in with an API key" login method when an apiKey is
	// configured alongside oauth, and that extra method makes /login <provider>
	// show a "Select authentication method" step. Without a stored credential,
	// keep the env-var key so NEWAPI_BASE_URL/NEWAPI_API_KEY still authenticate.
	const storedOAuth = await readAuthEntry();
	const preferredModel =
		typeof storedOAuth?.preferredModel === "string" ? storedOAuth.preferredModel : undefined;

	const config: Record<string, unknown> = {
		name: DISPLAY_NAME,
		baseUrl: providerBaseUrl,
		api,
		// Always keep the preferred model findable (real entry or stub) so
		// applyPreferredModel can short-circuit instead of re-running discovery.
		models: toProviderModels(
			ensurePreferredInList(hasModels ? models : PLACEHOLDER_MODELS, preferredModel),
			activeBaseUrl,
			api,
		),
		oauth: {
			name: DISPLAY_NAME,
			login: loginNewApi,
			refreshToken: refreshStoredOAuth,
			getApiKey,
			modifyModels,
		},
		refreshModels: async (context: any) => {
			await ensureBuiltinCapabilityIndex();
			const fromCred = credentialsFromContext(context.credential);
			const resolved = await resolveCredentials();
			const baseUrl = fromCred.baseUrl ?? resolved.baseUrl ?? activeBaseUrl;
			const apiKey = fromCred.apiKey ?? resolved.apiKey ?? process.env[ENV_API_KEY]?.trim();
			const resolvedApi = fromCred.apiKey ? fromCred.api : resolved.api;

			if (!baseUrl || !apiKey) {
				const cache = await readCache();
				if (cache?.models?.length) {
					return toProviderModels(
						ensurePreferredInList(cache.models, resolved.preferredModel),
						cache.baseUrl,
						resolvedApi,
					);
				}
				return toProviderModels(PLACEHOLDER_MODELS, undefined, resolvedApi);
			}

			if (!context.allowNetwork) {
				const cache = await readCache();
				if (cache && isCacheValid(cache, baseUrl, apiKey)) {
					return toProviderModels(
						ensurePreferredInList(cache.models, fromCred.preferredModel ?? resolved.preferredModel),
						baseUrl,
						resolvedApi,
					);
				}
			}

			const next = await discoverModels(baseUrl, apiKey, {
				timeoutMs: DEFAULT_TIMEOUT_MS,
				signal: context.signal,
			});
			const preferred = fromCred.preferredModel ?? resolved.preferredModel;
			const withPreferred = ensurePreferredInList(next, preferred);
			await writeCache({
				baseUrl: normalizeBaseUrl(baseUrl),
				apiKeyFingerprint: fingerprint(apiKey),
				fetchedAt: Date.now(),
				models: withPreferred,
			});
			return toProviderModels(withPreferred, baseUrl, resolvedApi);
		},
	};
	if (!storedOAuth) config.apiKey = `$${ENV_API_KEY}`;

	// Re-register from scratch: registerProvider merges defined values over the
	// previous registration, so omitting apiKey later could never clear it.
	try {
		pi.unregisterProvider(PROVIDER_NAME);
	} catch {
		// not registered yet
	}
	pi.registerProvider(PROVIDER_NAME, config as any);
	lastRegisteredSignature = storedOAuth ? credentialSignature(storedOAuth) : "env";
}

async function applyPreferredModel(
	pi: ExtensionAPI,
	ctx: {
		modelRegistry: { find: (provider: string, modelId: string) => Model<any> | undefined };
		ui: { notify: (message: string, level?: "info" | "warning" | "error") => void };
		model?: Model<any>;
	},
): Promise<void> {
	const resolved = await resolveCredentials();
	if (!resolved.preferredModel || resolved.source !== "auth.json") return;

	// Reuse the current registration when the credentials behind it are
	// unchanged; only a login / key / gateway change needs the heavy path.
	const entry = await readAuthEntry();
	const registrationStale = !entry || credentialSignature(entry) !== lastRegisteredSignature;
	let model = ctx.modelRegistry.find(PROVIDER_NAME, resolved.preferredModel);
	if (!model || registrationStale) {
		const loaded = await loadModels();
		await registerProxyProvider(pi, loaded.models, loaded.activeBaseUrl, loaded.api);
		model = ctx.modelRegistry.find(PROVIDER_NAME, resolved.preferredModel);
	}
	if (!model) {
		ctx.ui.notify(
			`New API: preferred model ${PROVIDER_NAME}/${resolved.preferredModel} not registered`,
			"error",
		);
		return;
	}

	try {
		const ok = await pi.setModel(model);
		if (!ok) {
			ctx.ui.notify(
				`New API: could not select ${PROVIDER_NAME}/${resolved.preferredModel} (auth not ready)`,
				"error",
			);
			return;
		}
		if (resolved.preferredThinking && model.reasoning) {
			pi.setThinkingLevel(resolved.preferredThinking);
		}
		ctx.ui.notify(
			`New API: selected ${PROVIDER_NAME}/${resolved.preferredModel}` +
				(resolved.preferredThinking ? ` thinking=${resolved.preferredThinking}` : ""),
			"info",
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`New API: setModel failed: ${message}`, "error");
	}
}

// ---------------------------------------------------------------------------
// /newapi runtime control panel
// ---------------------------------------------------------------------------

async function gatherStatus(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<NewApiStatusInfo> {
	const resolved = await resolveCredentials();
	const cache = await readCache();
	return {
		configured: Boolean(resolved.baseUrl && resolved.apiKey),
		endpoint: resolved.baseUrl,
		api: resolved.api,
		source: resolved.source as NewApiStatusInfo["source"],
		keyMask: resolved.apiKey ? maskKey(resolved.apiKey) : undefined,
		modelCount: cache && !cache.failure ? cache.models.length : 0,
		cacheAge: cache && !cache.failure ? formatCacheAge(cache.fetchedAt, Date.now()) : undefined,
		current: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
		thinking: pi.getThinkingLevel?.(),
		lastError: lastDiscoveryError,
	};
}

async function runRefresh(pi: ExtensionAPI): Promise<PanelActionResult> {
	const resolved = await resolveCredentials();
	if (!resolved.baseUrl || !resolved.apiKey) {
		return { ok: false, message: "No credentials — run /newapi login first" };
	}
	const started = Date.now();
	try {
		const models = await discoverModels(resolved.baseUrl, resolved.apiKey);
		await writeCache({
			baseUrl: normalizeBaseUrl(resolved.baseUrl),
			apiKeyFingerprint: fingerprint(resolved.apiKey),
			fetchedAt: Date.now(),
			models,
		});
		await registerProxyProvider(
			pi,
			ensurePreferredInList(models, resolved.preferredModel),
			resolved.baseUrl,
			resolved.api,
		);
		lastDiscoveryError = undefined;
		return {
			ok: true,
			message: `Refreshed ${models.length} models (${((Date.now() - started) / 1000).toFixed(1)}s)`,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		lastDiscoveryError = message;
		return { ok: false, message };
	}
}

async function runTest(): Promise<PanelActionResult> {
	const resolved = await resolveCredentials();
	if (!resolved.baseUrl || !resolved.apiKey) {
		return { ok: false, message: "No credentials — run /newapi login first" };
	}
	const started = Date.now();
	try {
		const models = await discoverModels(resolved.baseUrl, resolved.apiKey);
		lastDiscoveryError = undefined;
		return {
			ok: true,
			message: `${resolved.baseUrl} · ${models.length} models · ${Date.now() - started}ms`,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		lastDiscoveryError = message;
		return { ok: false, message };
	}
}

async function runClear(): Promise<PanelActionResult> {
	try {
		await unlink(getCachePath());
		return { ok: true, message: "Model cache cleared" };
	} catch {
		return { ok: true, message: "No model cache to clear" };
	}
}

async function runPanelAction(pi: ExtensionAPI, id: PanelActionId): Promise<PanelActionResult> {
	switch (id) {
		case "refresh":
			return runRefresh(pi);
		case "test":
			return runTest();
		case "clear":
			return runClear();
		default:
			return { ok: false, message: `Unsupported panel action: ${id}` };
	}
}

async function runPicker(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	const registry = ctx.modelRegistry as
		| { getAvailable: () => Model<Api>[] | Promise<Model<Api>[]> }
		| undefined;
	if (!registry?.getAvailable) {
		ctx.ui.notify("New API: model registry unavailable", "error");
		return;
	}
	const available = await Promise.resolve(registry.getAvailable());
	const items: PickerItem[] = available
		.filter((m) => m.provider === PROVIDER_NAME)
		.map((m) => ({ id: m.id, name: m.name ?? m.id }));

	const chosen = await openNewApiModelPicker(pi, ctx, items);
	if (!chosen) return;

	const model = available.find((m) => m.provider === PROVIDER_NAME && m.id === chosen);
	if (!model) {
		ctx.ui.notify(`New API: model ${chosen} not found`, "error");
		return;
	}
	const ok = await pi.setModel(model);
	if (!ok) {
		ctx.ui.notify(`New API: could not switch to ${PROVIDER_NAME}/${chosen} (auth not ready)`, "error");
		return;
	}
	ctx.ui.notify(`${GLYPH_SUCCESS} Model: ${PROVIDER_NAME}/${chosen}`, "info");
}

/**
 * Run the New API login flow from the extension itself, bypassing pi's
 * intermediate "Select authentication method" step: the first dialog is
 * directly "New API login method" (Manual / Import from Codex). Credentials
 * persist through the runtime's AuthStorage — the same path as /login.
 */
async function runInteractiveLogin(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	const authStorage = (ctx.modelRegistry as unknown as {
		authStorage?: { login: (providerId: string, callbacks: OAuthLoginCallbacks) => Promise<void> };
	}).authStorage;
	if (!authStorage?.login) {
		ctx.ui.notify("Run /login newapi — Manual or Import from Codex.", "info");
		return;
	}

	try {
		await authStorage.login(PROVIDER_NAME, {
			onAuth: () => {},
			onDeviceCode: () => {},
			onPrompt: async (prompt) => {
				const value = await ctx.ui.input(prompt.message, prompt.placeholder);
				if (value === undefined) throw new Error("Login cancelled");
				return value;
			},
			onSelect: async (prompt) => {
				const chosen = await ctx.ui.select(
					prompt.message,
					prompt.options.map((option) => option.label),
				);
				return prompt.options.find((option) => option.label === chosen)?.id;
			},
			onProgress: (message) => ctx.ui.notify(message, "info"),
			signal: ctx.signal,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message !== "Login cancelled") {
			ctx.ui.notify(`${GLYPH_ERROR} New API login failed: ${message}`, "error");
		}
		return;
	}

	(ctx.modelRegistry as { refresh?: () => void }).refresh?.();

	// Credential is now stored — re-register OAuth-only so /login newapi goes
	// straight to our flow for the rest of this session too.
	const loaded = await loadModels();
	await registerProxyProvider(pi, loaded.models, loaded.activeBaseUrl, loaded.api);

	ctx.ui.notify(`${GLYPH_SUCCESS} Logged in to New API`, "info");
	try {
		// Codex imports carry a preferred model — apply it right away.
		await applyPreferredModel(pi, { modelRegistry: ctx.modelRegistry, ui: ctx.ui, model: ctx.model });
	} catch {
		// Preferred-model application is best-effort; login itself succeeded.
	}
}

function notifyStatus(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	return gatherStatus(pi, ctx).then((info) => {
		for (const line of formatStatusPlain(info)) {
			ctx.ui.notify(line, info.configured ? "info" : "warning");
		}
	});
}

async function handleNewApiCommand(pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext): Promise<void> {
	const interactive = Boolean(ctx.hasUI && ctx.mode === "tui");

	switch (parseNewApiArgs(args)) {
		case "panel": {
			if (!interactive) {
				await notifyStatus(pi, ctx);
				ctx.ui.notify("Interactive panel needs TUI mode; subcommands: /newapi status|model|refresh|test|clear", "info");
				return;
			}
			const follow = await openNewApiPanel(pi, ctx, {
				getInfo: () => gatherStatus(pi, ctx),
				runAction: (id) => runPanelAction(pi, id),
			});
			if (follow === "model") await runPicker(pi, ctx);
			if (follow === "login") await runInteractiveLogin(pi, ctx);
			return;
		}
		case "status":
			await notifyStatus(pi, ctx);
			return;
		case "model": {
			if (!interactive) {
				ctx.ui.notify("The model picker requires interactive TUI mode.", "warning");
				return;
			}
			await runPicker(pi, ctx);
			return;
		}
		case "refresh": {
			const result = await runRefresh(pi);
			ctx.ui.notify(`${result.ok ? GLYPH_SUCCESS : GLYPH_ERROR} ${result.message}`, result.ok ? "info" : "error");
			return;
		}
		case "test": {
			const result = await runTest();
			ctx.ui.notify(`${result.ok ? GLYPH_SUCCESS : GLYPH_ERROR} ${result.message}`, result.ok ? "info" : "error");
			return;
		}
		case "clear": {
			const result = await runClear();
			ctx.ui.notify(`${GLYPH_SUCCESS} ${result.message}`, "info");
			return;
		}
		case "login":
			if (!ctx.hasUI) {
				ctx.ui.notify("Run /login newapi — Manual or Import from Codex.", "info");
				return;
			}
			await runInteractiveLogin(pi, ctx);
			return;
		case "usage":
			ctx.ui.notify("Usage: /newapi [panel|status|model|refresh|test|clear|login]", "info");
			return;
	}
}

/** Last assistant message on the active branch (walks past trailing context_edit entries). */
function findLastAssistantMessage(entries: SessionEntry[]): AssistantMessage | undefined {
	for (let i = entries.length - 1; i >= 0; i -= 1) {
		const entry = entries[i];
		if (entry.type === "message" && entry.message.role === "assistant") return entry.message;
	}
	return undefined;
}

export default async function (pi: ExtensionAPI) {
	// Drop legacy separate provider from earlier draft if still registered.
	try {
		pi.unregisterProvider("cc");
	} catch {
		// ignore
	}

	const loaded = await loadModels();
	await registerProxyProvider(pi, loaded.models, loaded.activeBaseUrl, loaded.api);

	// Apply Codex preferred model when setModel is available (session_start + first agent_start after login).
	let appliedPreferredKey: string | undefined;
	async function maybeApplyPreferred(
		ctx: {
			modelRegistry: { find: (provider: string, modelId: string) => Model<any> | undefined };
			ui: { notify: (message: string, level?: "info" | "warning" | "error") => void };
			model?: Model<any>;
		},
	): Promise<void> {
		const entry = await readAuthEntry();
		const preferred = entry?.preferredModel;
		if (!preferred) return;
		const key = `${preferred}|${entry?.preferredThinking ?? ""}|${entry?.access?.slice(0, 8) ?? ""}`;
		const current = ctx.model;
		// A session the host moved to another provider is the host's choice: this hook
		// only keeps newapi's own preferred model sticky, it must not steal the turn.
		if (current && current.provider !== PROVIDER_NAME) return;
		if (
			appliedPreferredKey === key &&
			current?.provider === PROVIDER_NAME &&
			current.id === preferred
		) {
			return;
		}
		await applyPreferredModel(pi, ctx);
		appliedPreferredKey = key;
	}
	pi.on("session_start", async (_event, ctx) => {
		await maybeApplyPreferred(ctx);
		if (lastDiscoveryError) {
			ctx.ui.notify(
				`New API: model discovery failed (${lastDiscoveryError}) — /newapi to inspect or retry.`,
				"warning",
			);
			lastDiscoveryError = undefined;
		}
	});
	pi.on("agent_start", async (_event, ctx) => {
		await maybeApplyPreferred(ctx);
	});

	// 网关退化响应（content 空/out=1 却报 incomplete.max_output_tokens）会被 pi 的
	// recoverable-length 启发式误判成上下文压力：丢掉该响应后真压缩一次，把大半历史
	// 摘要掉（实测 73.4k → 30.1k）。这里用一次"空压缩"顶掉误判路径——firstKeptEntryId
	// 取分支首条 → 全部条目保留、不调用摘要 LLM，pi 仍会照常自动重试。
	// 判据来自上面对网关响应的实测采样，锚点语义见本模块 isDegenerateGatewayResponse。
	pi.on("session_before_compact", (event) => {
		if (event.reason !== "overflow" || !event.willRetry) return;
		const last = findLastAssistantMessage(event.branchEntries);
		if (!last || !isDegenerateGatewayResponse(last)) return;
		const firstKeptEntryId = event.branchEntries[0]?.id;
		if (!firstKeptEntryId) return;
		return {
			compaction: {
				summary: "（网关退化响应：已跳过本次自动压缩，历史保持原样）",
				firstKeptEntryId,
				tokensBefore: event.preparation.tokensBefore,
				details: { kind: "pidesk.noop-compaction", reason: "degenerate-gateway-response" },
			},
		};
	});

	pi.registerCommand("newapi", {
		description: "New API control panel: status, model switch, refresh, test, cache",
		handler: async (args, ctx) => {
			await handleNewApiCommand(pi, args, ctx);
		},
	});

	// Muscle-memory alias: pi's official /new exists, but users habitually type
	// /clear. ctx.newSession() is the same runtimeHost.newSession() path /new uses.
	// Post-replacement work must run in withSession — the command ctx is stale
	// as soon as the session is replaced.
	pi.registerCommand("clear", {
		description: "Start a new session (alias for /new)",
		handler: async (_args, ctx) => {
			await ctx.newSession({
				withSession: async (fresh) => {
					fresh.ui.notify(`${GLYPH_SUCCESS} New session started`, "info");
				},
			});
		},
	});
}
