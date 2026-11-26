import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import type { RuntimeBuiltinToolsConfig } from "../../../shared/builtinTools.js";
import { parseImageInputContent } from "../../../shared/imageInput.js";
import { toolArgs } from "../output.js";
import { extensionForMime, type ImageQuality, type ImageSize } from "./helpers.js";
import { generateImages } from "./imagesApi.js";

/** Paid image requests are unsafe to replay; an interrupted call requires a new explicit invocation. */
export function imageTool(
  cwd: string,
  getConfig: () => RuntimeBuiltinToolsConfig,
): ToolRegistration {
  return {
    name: "generate_image",
    description:
      "Generate and save images from a detailed visual prompt. Supports OpenAI-compatible Images APIs and OpenRouter image models. Files are saved inside the current project. Configure in Settings → Models → Built-in tools. Include subject, composition, style and lighting in the prompt.",
    replay: "unsafe",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", minLength: 1, maxLength: 32000 },
        size: {
          type: "string",
          enum: [
            "auto",
            "256x256",
            "512x512",
            "1024x1024",
            "1536x1024",
            "1024x1536",
            "1792x1024",
            "1024x1792",
          ],
        },
        quality: { type: "string", enum: ["auto", "low", "medium", "high", "standard", "hd"] },
        n: { type: "integer", minimum: 1, maximum: 4 },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    execute: async (args, api, context) => {
      const input = toolArgs(args);
      const auth = getConfig().image;
      if (!auth.apiKey)
        throw new Error("Configure image generation in Settings → Models → Built-in tools first.");
      api.output(`Generating images with ${auth.model}…\n`);
      const result = await generateImages(
        auth,
        {
          prompt: String(input.prompt),
          model: auth.model,
          size: input.size as ImageSize | undefined,
          quality: input.quality as ImageQuality | undefined,
          n: input.n as number | undefined,
        },
        context.abortSignal,
      );
      const images = result.images.map((image) => {
        const parsed = parseImageInputContent({
          type: "image",
          data: image.data,
          mimeType: image.mimeType,
        });
        if (!parsed)
          throw new Error(
            "Image API returned an unsupported image or an image over the desktop 6 MiB limit.",
          );
        return parsed;
      });
      if (images.length > 4) throw new Error("Image API returned too many images.");
      context.abortSignal?.throwIfAborted();
      const directory = path.join(cwd, ".pidesk", "artifacts", "images");
      await mkdir(directory, { recursive: true });
      const paths: string[] = [];
      for (const image of images) {
        const file = path.join(directory, `${randomUUID()}${extensionForMime(image.mimeType)}`);
        await writeFile(file, Buffer.from(image.data, "base64"), { flag: "wx" });
        paths.push(file);
      }
      return {
        output: [
          ...images,
          {
            type: "text",
            text: `Generated ${images.length} image(s) via ${result.provider} / ${result.model}.\n${result.text ?? ""}\nSaved to:\n${paths.join("\n")}`,
          },
        ],
        details: { provider: result.provider, model: result.model, paths },
      };
    },
  };
}
