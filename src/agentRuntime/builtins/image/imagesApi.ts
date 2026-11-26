/**
 * Image generation backends.
 *
 * - openai: POST {base}/images/generations (OpenAI Images API; New API / One API compatible)
 * - openrouter: POST {base}/chat/completions with chat-image models (message.images[])
 */

import { MAX_IMAGE_INPUT_BYTES } from "../../../shared/imageInput.js";
import { readResponseBytes, readResponseText } from "../http.js";
import type { ResolvedAuth } from "./helpers.js";
import {
  collectOpenAiImages,
  collectOpenRouterImages,
  type GeneratedImage,
  type GenerateImagesRequest,
  type GenerateImagesResult,
  joinApiUrl,
  mapCountForModel,
  mapQualityForModel,
  parseDataUrl,
} from "./helpers.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_IMAGES = 4;
const MAX_IMAGE_RESPONSE_BYTES = MAX_IMAGES * Math.ceil(MAX_IMAGE_INPUT_BYTES / 3) * 4 + 64 * 1024;

async function imagePayload(response: Response): Promise<unknown> {
  return JSON.parse(await readResponseText(response, MAX_IMAGE_RESPONSE_BYTES));
}

function assertImageCount(count: number): void {
  if (count > MAX_IMAGES) throw new ImageGenError("Image API returned too many images.");
}

export class ImageGenError extends Error {
  readonly status?: number;

  constructor(message: string, options?: { status?: number; cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ImageGenError";
    this.status = options?.status;
  }
}

async function throwHttpError(res: Response, provider: string): Promise<never> {
  await res.body?.cancel();
  // Never persist provider error bodies: they may echo credentials.
  throw new ImageGenError(
    `${provider} image generation failed (HTTP ${res.status}). Check its built-in tool settings.`,
    { status: res.status },
  );
}

async function downloadAsImage(url: string, signal?: AbortSignal): Promise<GeneratedImage> {
  const target = new URL(url);
  if (!["https:", "http:"].includes(target.protocol) || target.username || target.password)
    throw new ImageGenError("Generated image URL must use HTTP(S) without embedded credentials.");
  const res = await fetch(target, { signal, redirect: "error" });
  if (!res.ok) {
    await res.body?.cancel();
    throw new ImageGenError(`Failed to download generated image (HTTP ${res.status}).`, {
      status: res.status,
    });
  }
  const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
  const buf = await readResponseBytes(res, MAX_IMAGE_INPUT_BYTES);
  return { data: buf.toString("base64"), mimeType };
}

/** OpenAI Images API — also used by New API / One API proxies. */
async function generateOpenAiCompatible(
  auth: ResolvedAuth,
  request: GenerateImagesRequest,
  signal?: AbortSignal,
): Promise<GenerateImagesResult> {
  const n = mapCountForModel(request.model, request.n);
  const quality = mapQualityForModel(request.model, request.quality);
  const body: Record<string, unknown> = {
    model: request.model,
    prompt: request.prompt,
    n,
  };
  // GPT image models always return base64 and reject the legacy response_format option.
  if (!/(?:^|\/)gpt-image-/i.test(request.model)) body.response_format = "b64_json";
  if (request.size && request.size !== "auto") body.size = request.size;
  if (quality) body.quality = quality;

  const res = await fetch(joinApiUrl(auth.baseUrl, "/images/generations"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
    redirect: "error",
  });

  if (!res.ok) return throwHttpError(res, "OpenAI-compatible");

  const payload = (await imagePayload(res)) as {
    data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
  };
  if (!Array.isArray(payload?.data)) throw new ImageGenError("Image API returned invalid data.");
  assertImageCount(payload.data.length);
  const collected = collectOpenAiImages(payload.data);
  const images: GeneratedImage[] = [];
  let firstRevised: string | undefined;

  for (const item of collected) {
    if ("data" in item) {
      images.push(item);
      if (!firstRevised && item.revisedPrompt) firstRevised = item.revisedPrompt;
    } else {
      const downloaded = await downloadAsImage(item.url, signal);
      if (item.revisedPrompt) downloaded.revisedPrompt = item.revisedPrompt;
      images.push(downloaded);
      if (!firstRevised && item.revisedPrompt) firstRevised = item.revisedPrompt;
    }
  }

  if (images.length === 0) {
    throw new ImageGenError(
      "Image API returned no images (empty data[]). The model may have refused the prompt.",
    );
  }

  return {
    images,
    text: firstRevised ? `Revised prompt: ${firstRevised}` : undefined,
    provider: "openai",
    model: request.model,
  };
}

/** OpenRouter chat-completions image models (gpt-image-*, gemini-image, …). */
async function generateOpenRouterChat(
  auth: ResolvedAuth,
  request: GenerateImagesRequest,
  signal?: AbortSignal,
): Promise<GenerateImagesResult> {
  const sizeNote = request.size && request.size !== "auto" ? ` Image size: ${request.size}.` : "";
  const qualityNote =
    request.quality && request.quality !== "auto" ? ` Quality: ${request.quality}.` : "";
  const n = mapCountForModel(request.model, request.n);

  const res = await fetch(joinApiUrl(auth.baseUrl, "/chat/completions"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "PiDesk",
    },
    body: JSON.stringify({
      model: request.model,
      modalities: ["image", "text"],
      messages: [
        {
          role: "user",
          content: `${request.prompt}${sizeNote}${qualityNote}${n > 1 ? ` Generate ${n} images.` : ""}`,
        },
      ],
    }),
    signal,
    redirect: "error",
  });

  if (!res.ok) return throwHttpError(res, "OpenRouter");

  const payload = (await imagePayload(res)) as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ type?: string; text?: string; image_url?: { url?: string } }>;
        images?: Array<{ image_url?: string | { url?: string } }>;
      };
    }>;
  };

  const message = payload?.choices?.[0]?.message;
  if (message?.images !== undefined && !Array.isArray(message.images))
    throw new ImageGenError("OpenRouter returned invalid image data.");
  assertImageCount(message?.images?.length ?? 0);
  const chatImages = collectOpenRouterImages(message?.images);

  // Some providers put images inline in content parts instead of message.images.
  if (chatImages.length === 0 && Array.isArray(message?.content)) {
    for (const part of message.content) {
      if (part?.type !== "image_url") continue;
      const raw = part.image_url?.url;
      if (!raw) continue;
      assertImageCount(chatImages.length + 1);
      if (raw.startsWith("data:")) {
        const parsed = parseDataUrl(raw);
        if (parsed) chatImages.push(parsed);
      } else {
        chatImages.push(await downloadAsImage(raw, signal));
      }
    }
  }

  if (chatImages.length === 0) {
    const text =
      typeof message?.content === "string"
        ? message.content
        : Array.isArray(message?.content)
          ? message.content
              .map((p) => p?.text ?? "")
              .join("\n")
              .trim()
          : "";
    throw new ImageGenError(
      text
        ? `Model returned text instead of images: ${text.slice(0, 300)}`
        : "OpenRouter returned no images. The model may not support image output, or the prompt was refused.",
    );
  }

  const text =
    typeof message?.content === "string" && message.content.trim().length > 0
      ? message.content.trim()
      : undefined;

  return {
    images: chatImages,
    text,
    provider: "openrouter",
    model: request.model,
  };
}

export async function generateImages(
  auth: ResolvedAuth,
  request: GenerateImagesRequest,
  signal?: AbortSignal,
): Promise<GenerateImagesResult> {
  const timeout = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const linked = signal ? AbortSignal.any([signal, timeout]) : timeout;
  if (auth.provider === "openrouter") {
    return generateOpenRouterChat(auth, request, linked);
  }
  return generateOpenAiCompatible(auth, request, linked);
}
