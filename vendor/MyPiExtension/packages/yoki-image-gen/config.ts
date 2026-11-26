/**
 * Config + auth resolution for yoki-image-gen.
 *
 * Precedence (highest wins per field):
 *   env YOKI_IMAGE_* → config.json → provider-specific env fallbacks → defaults.
 */

import {
	configPath,
	type GuidanceFields,
	loadJsonConfigWithLegacyFallback,
	readEnvVar,
	saveJsonConfig,
	validateGuidanceFields,
} from "@yoki/yoki-config";
import {
	DEFAULT_MODELS,
	defaultBaseUrl,
	type ImageProviderId,
	type ImageQuality,
	type ImageSize,
	isImageProviderId,
	type ResolvedAuth,
	resolveProviderId,
} from "./helpers.ts";

export const CONFIG_PATH = configPath("yoki-image-gen");

export interface YokiImageGenConfig {
	/** Master switch — `false` disables generate_image without uninstalling.
	 *  Read fresh per call so `/image-gen on|off` takes effect live. */
	enabled?: boolean;
	/** Wire protocol: openai (Images API) or openrouter (chat images). Default auto. */
	provider?: "auto" | "openai" | "openrouter";
	baseUrl?: string;
	apiKey?: string;
	model?: string;
	size?: ImageSize;
	quality?: ImageQuality;
	/** Directory for saved PNGs. Default: <project>/.pi/yoki/artifacts/images */
	outputDir?: string;
	guidance?: GuidanceFields;
}

export function loadConfig(): YokiImageGenConfig {
	return loadJsonConfigWithLegacyFallback<YokiImageGenConfig>("yoki-image-gen");
}

/** Image generation defaults ON. Only an explicit `false` disables. */
export function isEnabled(): boolean {
	return loadConfig().enabled !== false;
}

/** Persist the master switch so `/image-gen on|off` survives restarts. */
export function setEnabled(enabled: boolean): boolean {
	return saveJsonConfig(CONFIG_PATH, { ...loadConfig(), enabled });
}

export function loadGuidance(): GuidanceFields {
	return validateGuidanceFields(loadConfig().guidance);
}

type AuthCandidate = {
	providerHint?: string;
	baseUrl?: string;
	apiKey?: string;
	model?: string;
};

/**
 * Collect auth candidates in precedence order:
 * YOKI_IMAGE_* env → config file → OPENAI_* → NEWAPI_* → OPENROUTER_*.
 */
function collectCandidates(config: YokiImageGenConfig): AuthCandidate[] {
	return [
		{
			providerHint: readEnvVar("YOKI_IMAGE_PROVIDER"),
			baseUrl: readEnvVar("YOKI_IMAGE_BASE_URL"),
			apiKey: readEnvVar("YOKI_IMAGE_API_KEY"),
			model: readEnvVar("YOKI_IMAGE_MODEL"),
		},
		{
			providerHint: config.provider === "auto" ? undefined : config.provider,
			baseUrl: config.baseUrl,
			apiKey: config.apiKey,
			model: config.model,
		},
		{
			providerHint: "openai",
			baseUrl: readEnvVar("OPENAI_BASE_URL"),
			apiKey: readEnvVar("OPENAI_API_KEY"),
			model: readEnvVar("OPENAI_IMAGE_MODEL"),
		},
		{
			providerHint: "openai",
			baseUrl: readEnvVar("NEWAPI_BASE_URL"),
			apiKey: readEnvVar("NEWAPI_API_KEY"),
			model: readEnvVar("NEWAPI_IMAGE_MODEL"),
		},
		{
			providerHint: "openrouter",
			baseUrl: readEnvVar("OPENROUTER_BASE_URL"),
			apiKey: readEnvVar("OPENROUTER_API_KEY"),
			model: readEnvVar("OPENROUTER_IMAGE_MODEL"),
		},
	];
}

/**
 * Resolve a usable auth triple, or undefined when nothing is configured.
 * Field-level merge: first non-empty apiKey/baseUrl/model wins, while provider
 * is inferred from the winning baseUrl when the explicit hint is missing/auto.
 */
export function resolveAuth(config: YokiImageGenConfig = loadConfig()): ResolvedAuth | undefined {
	const candidates = collectCandidates(config);

	let apiKey: string | undefined;
	let baseUrl: string | undefined;
	let model: string | undefined;
	let providerHint: string | undefined;

	for (const c of candidates) {
		if (apiKey === undefined && c.apiKey) apiKey = c.apiKey;
		if (baseUrl === undefined && c.baseUrl) baseUrl = c.baseUrl;
		if (model === undefined && c.model) model = c.model;
		if (providerHint === undefined && c.providerHint) providerHint = c.providerHint;
		if (apiKey && baseUrl && model && providerHint) break;
	}

	if (!apiKey) return undefined;

	const provider: ImageProviderId = resolveProviderId(
		isImageProviderId(providerHint) ? providerHint : undefined,
		baseUrl,
	);
	const resolvedBase = baseUrl ?? defaultBaseUrl(provider);
	const resolvedModel = model ?? DEFAULT_MODELS[provider];

	return {
		provider,
		baseUrl: resolvedBase,
		apiKey,
		model: resolvedModel,
	};
}

export function resolveDefaultSize(config: YokiImageGenConfig = loadConfig()): ImageSize {
	return config.size ?? "auto";
}

export function resolveDefaultQuality(config: YokiImageGenConfig = loadConfig()): ImageQuality {
	return config.quality ?? "auto";
}
