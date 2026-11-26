import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** Keep a bounded model-visible preview while preserving complete fetched text on disk. */
export async function boundedWebText(
  text: string,
): Promise<{ text: string; fullOutputPath?: string }> {
  const head = text.split("\n").slice(0, 2000).join("\n");
  const bytes = Buffer.from(head);
  if (bytes.length <= 50 * 1024 && head === text) return { text };
  const preview = new TextDecoder().decode(bytes.subarray(0, 50 * 1024), { stream: true });
  const directory = await mkdtemp(path.join(tmpdir(), "pidesk-web-"));
  const fullOutputPath = path.join(directory, "content.txt");
  await writeFile(fullOutputPath, text, "utf8");
  return {
    text: `${preview}\n\n[Content truncated. Full content saved to: ${fullOutputPath}]`,
    fullOutputPath,
  };
}
export function toolArgs(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid tool arguments.");
  return value as Record<string, unknown>;
}
