import JSON5 from "json5";
import { isJsonPath } from "../../shared/fileKinds";

/** Expand compact JSON files for readable preview. */
export function formatJsonPreview(path: string, content: string, truncated: boolean): string {
  if (truncated || !isJsonPath(path) || /\r?\n/.test(content)) return content;

  try {
    const value = JSON5.parse(content);
    return path.toLowerCase().endsWith(".json5")
      ? JSON5.stringify(value, null, 2)
      : JSON.stringify(value, null, 2);
  } catch {
    return content;
  }
}
