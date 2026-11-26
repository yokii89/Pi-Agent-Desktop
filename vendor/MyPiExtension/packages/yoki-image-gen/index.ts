/**
 * yoki-image-gen — generate_image tool (OpenAI Images / OpenRouter chat images)
 * plus a live master switch via `/image-gen on|off`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { projectYokiDomain } from "@yoki/yoki-config";
import { Type } from "typebox";
import {
	isEnabled,
	loadConfig,
	loadGuidance,
	resolveAuth,
	resolveDefaultQuality,
	resolveDefaultSize,
	setEnabled,
} from "./config.ts";
import {
	buildAuthErrorMessage,
	extensionForMime,
	type ImageQuality,
	type ImageSize,
	mapCountForModel,
} from "./helpers.ts";
import { generateImages, ImageGenError } from "./images-api.ts";

const TOOL_NAME = "generate_image";
const COMMAND_NAME = "image-gen";

const DEFAULT_PROMPT_SNIPPET =
	"Generate images from a text prompt via OpenAI-compatible Images API or OpenRouter chat image models.";
const DEFAULT_PROMPT_GUIDELINES: string[] = [
	"Use generate_image when the user asks for a picture, illustration, mockup, logo, wallpaper, or any raster image from a description.",
	"Write a complete visual prompt: subject, composition, style, lighting, and constraints. Do not leave the description abstract.",
	"Prefer one strong prompt over many near-duplicates; use n>1 only when the user wants variants.",
];

const GenerateImageParams = Type.Object({
	prompt: Type.String({ description: "Detailed text description of the image to generate" }),
	size: Type.Optional(
		Type.Union(
			[
				Type.Literal("auto"),
				Type.Literal("256x256"),
				Type.Literal("512x512"),
				Type.Literal("1024x1024"),
				Type.Literal("1536x1024"),
				Type.Literal("1024x1536"),
				Type.Literal("1792x1024"),
				Type.Literal("1024x1792"),
			],
			{ description: "Image dimensions. Default: auto / config size" },
		),
	),
	quality: Type.Optional(
		Type.Union(
			[
				Type.Literal("auto"),
				Type.Literal("low"),
				Type.Literal("medium"),
				Type.Literal("high"),
				Type.Literal("standard"),
				Type.Literal("hd"),
			],
			{ description: "Quality hint. Default: auto / config quality" },
		),
	),
	n: Type.Optional(Type.Number({ description: "Number of images (1-4). Default: 1" })),
});

interface GenerateImageDetails {
	provider?: string;
	model?: string;
	paths?: string[];
	error?: string;
	disabled?: boolean;
}

function resolveOutputDir(cwd: string, configDir?: string): string {
	if (configDir?.trim()) return configDir.trim();
	return projectYokiDomain(cwd, "artifacts", "images");
}

function saveImages(outputDir: string, images: Array<{ data: string; mimeType: string }>): string[] {
	mkdirSync(outputDir, { recursive: true });
	const paths: string[] = [];
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	for (const [i, image] of images.entries()) {
		const file = join(outputDir, `gen-${stamp}-${i + 1}${extensionForMime(image.mimeType)}`);
		writeFileSync(file, Buffer.from(image.data, "base64"));
		paths.push(file);
	}
	return paths;
}

function buildStatusReport(enabled: boolean, authReady: boolean): string {
	const config = loadConfig();
	const lines = [
		"yoki-image-gen status",
		`  enabled: ${enabled ? "yes" : "no (run /image-gen on)"}`,
		`  auth: ${authReady ? "ready" : "missing (set YOKI_IMAGE_API_KEY / OPENAI_API_KEY / NEWAPI_* / OPENROUTER_API_KEY or config.json)"}`,
		`  provider: ${config.provider ?? "auto"}`,
		`  model: ${config.model ?? "(default)"}`,
		`  size: ${config.size ?? "auto"}`,
		`  quality: ${config.quality ?? "auto"}`,
		`  outputDir: ${config.outputDir ?? "<project>/.pi/yoki/artifacts/images"}`,
		`  config: ${process.env.XDG_CONFIG_HOME ? "XDG" : "~/.config"}/yoki-image-gen/config.json`,
	];
	return lines.join("\n");
}

export default function (pi: ExtensionAPI): void {
	// Live master switch is read at execute time so /image-gen on|off works
	// without restarting the session. Registration itself is gated at load so a
	// disabled install does not pollute the tool list; /image-gen on registers
	// the tool dynamically (same pattern as pi's dynamic-tools example).
	let toolRegistered = false;

	const ensureTool = (): void => {
		if (toolRegistered) return;
		toolRegistered = true;
		const guidance = loadGuidance();

		pi.registerTool({
			name: TOOL_NAME,
			label: "Generate Image",
			description:
				"Generate one or more images from a text prompt. Uses OpenAI-compatible Images API (including New API / One API proxies) or OpenRouter chat image models, depending on configuration.",
			promptSnippet: guidance.promptSnippet ?? DEFAULT_PROMPT_SNIPPET,
			promptGuidelines: guidance.promptGuidelines ?? DEFAULT_PROMPT_GUIDELINES,
			parameters: GenerateImageParams,

			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const typed = params as {
					prompt: string;
					size?: ImageSize;
					quality?: ImageQuality;
					n?: number;
				};

				if (!isEnabled()) {
					return {
						content: [
							{
								type: "text",
								text: "Error: generate_image is disabled. Run /image-gen on to enable it.",
							},
						],
						details: { disabled: true, error: "disabled" } satisfies GenerateImageDetails,
					};
				}

				const auth = resolveAuth();
				if (!auth) {
					return {
						content: [{ type: "text", text: buildAuthErrorMessage() }],
						details: { error: "unconfigured" } satisfies GenerateImageDetails,
					};
				}

				const config = loadConfig();
				const size = typed.size ?? resolveDefaultSize(config);
				const quality = typed.quality ?? resolveDefaultQuality(config);
				const n = mapCountForModel(auth.model, typed.n);

				try {
					const result = await generateImages(
						auth,
						{
							prompt: typed.prompt,
							model: auth.model,
							size,
							quality,
							n,
						},
						signal,
					);

					const paths = saveImages(resolveOutputDir(ctx.cwd, config.outputDir), result.images);

					const content: Array<
						{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
					> = [];
					for (const image of result.images) {
						content.push({ type: "image", data: image.data, mimeType: image.mimeType });
					}

					const notes: string[] = [
						`Generated ${result.images.length} image(s) via ${result.provider} / ${result.model}.`,
					];
					if (result.text) notes.push(result.text);
					if (paths.length) notes.push(`Saved to:\n${paths.map((p) => `- ${p}`).join("\n")}`);
					content.push({ type: "text", text: notes.join("\n") });

					return {
						content,
						details: {
							provider: result.provider,
							model: result.model,
							paths,
						} satisfies GenerateImageDetails,
					};
				} catch (err) {
					const message =
						err instanceof ImageGenError
							? err.message
							: `Image generation failed: ${err instanceof Error ? err.message : String(err)}`;
					return {
						content: [{ type: "text", text: message }],
						details: {
							provider: auth.provider,
							model: auth.model,
							error: message,
						} satisfies GenerateImageDetails,
					};
				}
			},
		});
	};

	if (isEnabled()) ensureTool();

	pi.registerCommand(COMMAND_NAME, {
		description: "Image generation status; /image-gen on|off toggles the generate_image tool",
		handler: async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
			if (!ctx.hasUI) return;
			const arg = args.trim().toLowerCase();
			if (arg === "on" || arg === "off") {
				const enabling = arg === "on";
				const saved = setEnabled(enabling);
				if (saved) {
					if (enabling) ensureTool();
					ctx.ui.notify(
						enabling ? "yoki-image-gen: enabled" : "yoki-image-gen: disabled",
						enabling ? "info" : "warning",
					);
				} else {
					ctx.ui.notify("yoki-image-gen: could not write the config file — edit it directly instead", "error");
				}
				return;
			}
			ctx.ui.notify(buildStatusReport(isEnabled(), resolveAuth() !== undefined), "info");
		},
	});

	// Re-register after config flip if the session started disabled.
	pi.on("session_start", async () => {
		if (isEnabled()) ensureTool();
	});
}
