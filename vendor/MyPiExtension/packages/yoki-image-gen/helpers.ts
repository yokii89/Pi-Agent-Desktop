/**
 * Pure helpers for yoki-image-gen (no I/O, no pi runtime).
 */

export type ImageProviderId = "openai" | "openrouter";

export type ImageQuality = "auto" | "low" | "medium" | "high" | "standard" | "hd";

export type ImageSize =
	| "auto"
	| "256x256"
	| "512x512"
	| "1024x1024"
	| "1536x1024"
	| "1024x1536"
	| "1792x1024"
	| "1024x1792";

export interface GeneratedImage {
	data: string;
	mimeType: string;
	revisedPrompt?: string;
}

export interface GenerateImagesRequest {
	prompt: string;
	model: string;
	size?: ImageSize;
	quality?: ImageQuality;
	n?: number;
}

export interface GenerateImagesResult {
	images: GeneratedImage[];
	text?: string;
	provider: ImageProviderId;
	model: string;
}

export interface ResolvedAuth {
	provider: ImageProviderId;
	baseUrl: string;
	apiKey: string;
	model: string;
}

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export const DEFAULT_MODELS: Record<ImageProviderId, string> = {
	openai: "gpt-image-1",
	openrouter: "openai/gpt-image-2",
};

export function normalizeBaseUrl(input: string): string {
	return input
		.trim()
		.replace(/\/+$/, "")
		.replace(/\/v1\/?$/i, "");
}

export function defaultBaseUrl(provider: ImageProviderId): string {
	return provider === "openrouter" ? DEFAULT_OPENROUTER_BASE_URL : DEFAULT_OPENAI_BASE_URL;
}

/** Join a normalized base URL with a path that already starts with `/`. */
export function joinApiUrl(baseUrl: string, path: string): string {
	return `${normalizeBaseUrl(baseUrl)}${path.startsWith("/") ? path : `/${path}`}`;
}

export function isImageProviderId(value: unknown): value is ImageProviderId {
	return value === "openai" || value === "openrouter";
}

/**
 * Resolve which wire protocol to use.
 * Explicit `provider` wins; otherwise infer from baseUrl (openrouter host → openrouter).
 */
export function resolveProviderId(explicit: string | undefined, baseUrl: string | undefined): ImageProviderId {
	if (explicit && isImageProviderId(explicit)) return explicit;
	const host = (baseUrl ?? "").toLowerCase();
	if (host.includes("openrouter.ai")) return "openrouter";
	return "openai";
}

export function parseDataUrl(url: string): { mimeType: string; data: string } | undefined {
	const matches = url.match(/^data:([^;,]+);base64,(.+)$/s);
	if (!matches) return undefined;
	return { mimeType: matches[1], data: matches[2] };
}

export function extensionForMime(mimeType: string): string {
	const map: Record<string, string> = {
		"image/png": ".png",
		"image/jpeg": ".jpg",
		"image/jpg": ".jpg",
		"image/webp": ".webp",
		"image/gif": ".gif",
	};
	return map[mimeType.toLowerCase()] ?? ".png";
}

/**
 * Map user-facing quality labels onto provider wire values.
 * OpenAI Images (gpt-image-*) accepts low/medium/high/auto.
 * DALL·E 3 uses standard/hd.
 */
export function mapQualityForModel(model: string, quality: ImageQuality | undefined): string | undefined {
	if (!quality || quality === "auto") return undefined;
	const isDalle = /dall-e/i.test(model);
	if (isDalle) {
		if (quality === "hd" || quality === "high") return "hd";
		if (quality === "standard" || quality === "medium" || quality === "low") return "standard";
		return undefined;
	}
	if (quality === "standard") return "medium";
	if (quality === "hd") return "high";
	return quality;
}

/** Clamp n to 1..4. DALL·E 3 only supports n=1. */
export function mapCountForModel(model: string, n: number | undefined): number {
	const requested = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : 1;
	const clamped = Math.min(4, Math.max(1, requested));
	if (/dall-e-3/i.test(model)) return 1;
	return clamped;
}

export function buildAuthErrorMessage(hint?: string): string {
	const lines = [
		"Error: image generation is not configured. Configure one of:",
		"  1. Set YOKI_IMAGE_API_KEY (and optionally YOKI_IMAGE_BASE_URL / YOKI_IMAGE_MODEL)",
		"  2. Set OPENAI_API_KEY for OpenAI Images API",
		"  3. Set NEWAPI_BASE_URL + NEWAPI_API_KEY for a New API / One API proxy",
		"  4. Set OPENROUTER_API_KEY for OpenRouter chat image models",
		`  5. Create config at ~/.config/yoki-image-gen/config.json with { "provider", "baseUrl", "apiKey", "model" }`,
	];
	if (hint) lines.push(`Detail: ${hint}`);
	return lines.join("\n");
}

/**
 * Parse OpenAI Images API `data[].url` / `data[].b64_json` entries into GeneratedImage.
 * Remote URLs are left for the caller to download (see images-api.ts).
 */
export function collectOpenAiImages(
	data: Array<{ b64_json?: string; url?: string; revised_prompt?: string }> | undefined,
): Array<GeneratedImage | { url: string; revisedPrompt?: string }> {
	const out: Array<GeneratedImage | { url: string; revisedPrompt?: string }> = [];
	for (const item of data ?? []) {
		const revisedPrompt = item.revised_prompt;
		if (item.b64_json) {
			out.push({ data: item.b64_json, mimeType: "image/png", revisedPrompt });
		} else if (item.url) {
			out.push({ url: item.url, revisedPrompt });
		}
	}
	return out;
}

/**
 * Parse OpenRouter-style chat `message.images[].image_url` entries (data: URLs).
 */
export function collectOpenRouterImages(
	images: Array<{ image_url?: string | { url?: string } }> | undefined,
): GeneratedImage[] {
	const out: GeneratedImage[] = [];
	for (const image of images ?? []) {
		const raw = typeof image.image_url === "string" ? image.image_url : image.image_url?.url;
		if (!raw) continue;
		const parsed = parseDataUrl(raw);
		if (parsed) {
			out.push(parsed);
		}
		// Non-data URLs cannot be inlined into ImageContent; skip silently here.
		// The OpenAI-compatible path downloads remote URLs separately.
	}
	return out;
}
