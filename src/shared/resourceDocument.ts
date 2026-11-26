import { durableResourceError } from "./durableResources.js";

export interface ResourceDocument {
  name?: string;
  description?: string;
  hidden: boolean;
  body: string;
}

function scalar(value: string, label: string): string {
  const text = value.trim();
  if (text.startsWith('"')) {
    try {
      const quoted = /^("(?:\\.|[^"\\])*")(?:\s+#.*)?$/.exec(text);
      const parsed: unknown = quoted ? JSON.parse(quoted[1]) : undefined;
      if (typeof parsed === "string") return parsed;
    } catch {
      // Invalid quoted metadata must not turn into a different command name.
    }
    throw durableResourceError("invalid", label);
  }
  if (text.startsWith("'")) {
    const quoted = /^'((?:''|[^'])*)'(?:\s+#.*)?$/.exec(text);
    if (!quoted) throw durableResourceError("invalid", label);
    return quoted[1].replace(/''/g, "'");
  }
  if (/^[!&*[{]/.test(text)) throw durableResourceError("invalid", label);
  return text.replace(/\s+#.*$/, "").trim();
}

/** Metadata grammar shared by runtime loading and the read-only skill Doctor. */
export function parseResourceDocument(text: string, label: string): ResourceDocument {
  if (!text.startsWith("---\n")) return { body: text, hidden: false };
  const lines = text.split("\n");
  const end = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/.test(line));
  if (end < 0) throw durableResourceError("invalid", label);
  const fields = new Map<string, string>();
  for (let index = 1; index < end; index++) {
    const match = /^(name|description|disable-model-invocation):\s*(.*)$/.exec(lines[index]);
    if (!match) continue;
    if (fields.has(match[1])) throw durableResourceError("invalid", label);
    let value = match[2];
    if (/^[>|][-+]?\s*$/.test(value)) {
      const folded = value.startsWith(">");
      const block: string[] = [];
      while (index + 1 < end && (/^\s/.test(lines[index + 1]) || !lines[index + 1])) {
        block.push(lines[++index].trim());
      }
      value = block.join(folded ? " " : "\n").trim();
    } else value = scalar(value, label);
    fields.set(match[1], value);
  }
  const hidden = fields.get("disable-model-invocation");
  if (hidden !== undefined && hidden !== "true" && hidden !== "false")
    throw durableResourceError("invalid", label);
  return {
    name: fields.get("name"),
    description: fields.get("description"),
    hidden: hidden === "true",
    body: lines
      .slice(end + 1)
      .join("\n")
      .trim(),
  };
}
