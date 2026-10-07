import type { FileMention } from "../stores/composerStore";

export interface PositionedFileMention extends FileMention {
  offset: number;
}

export const FILE_MENTION_PREFIX = "<!-- pidesk:file-mentions:v1 ";

/** File labels are identical in the composer, message bubble and copied text. */
export function fileMentionName(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || path
  );
}

/**
 * Keep exact chip positions and kinds in the existing text transport/history.
 * `extraPaths` are strip file attachments (docs/design/25): path payload only,
 * no inline `@token` — history renders them as the trailing `files` chip row.
 */
export function formatFileMentionPrompt(
  text: string,
  mentions: PositionedFileMention[],
  extraPaths: readonly string[] = [],
): string {
  const body = text.trim();
  const paths = [...new Set([...mentions.map((mention) => mention.path), ...extraPaths])];
  if (paths.length === 0) return body;
  const pathNote = `引用路径：\n${paths.map((path) => `- ${path}`).join("\n")}`;
  if (mentions.length === 0) {
    return body ? `${body}\n\n${pathNote}` : pathNote;
  }
  const leading = text.length - text.trimStart().length;
  const positions = mentions.map((mention) => ({ ...mention, offset: mention.offset - leading }));
  // Escape comment terminators in filenames while retaining ordinary JSON for the agent.
  const metadata = JSON.stringify(positions).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  return `${body}\n\n${FILE_MENTION_PREFIX}${metadata} -->\n\n${pathNote}`;
}

/** Reject malformed or stale metadata rather than replacing unrelated user text. */
export function readFileMentionMetadata(
  value: string,
  body: string,
  paths: string[],
): PositionedFileMention[] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    let end = 0;
    const seen = new Set<string>();
    for (const item of parsed) {
      if (!item || typeof item !== "object") return null;
      const m = item as Record<string, unknown>;
      if (
        typeof m.path !== "string" ||
        !paths.includes(m.path) ||
        seen.has(m.path) ||
        typeof m.displayPath !== "string" ||
        !m.displayPath ||
        (m.kind !== undefined && m.kind !== "file" && m.kind !== "dir") ||
        typeof m.offset !== "number" ||
        !Number.isInteger(m.offset) ||
        m.offset < end ||
        body.slice(m.offset, m.offset + m.displayPath.length + 1) !== `@${m.displayPath}`
      )
        return null;
      end = m.offset + m.displayPath.length + 1;
      seen.add(m.path);
    }
    return parsed as PositionedFileMention[];
  } catch {
    return null;
  }
}
