import { t } from "../../shared/i18n";
import type { FileMention } from "../stores/composerStore";
import {
  FILE_MENTION_PREFIX,
  fileMentionName,
  type PositionedFileMention,
  readFileMentionMetadata,
} from "./fileMentionFormat";

export type UserMessagePart =
  | { kind: "text"; text: string }
  | { kind: "file"; mention: FileMention };

export interface UserMessageSegment {
  kind: "text" | "plan" | "quote" | "files";
  content: string;
  parts?: UserMessagePart[];
}

/** Old messages lack chip positions: match only unambiguous path suffixes. */
function legacyMentions(body: string, paths: string[]): PositionedFileMention[] {
  const candidates = paths
    .flatMap((path) => {
      const normalized = path.replace(/\\/g, "/").replace(/\/$/, "");
      const pieces = normalized.split("/");
      return pieces.map((_, index) => ({ path, displayPath: pieces.slice(index).join("/") }));
    })
    .sort((a, b) => b.displayPath.length - a.displayPath.length);
  const mentions: PositionedFileMention[] = [];
  const used = new Set<string>();
  for (let offset = 0; offset < body.length; offset += 1) {
    if (body[offset] !== "@" || (offset > 0 && !/[\s(（]/.test(body[offset - 1]))) continue;
    const matches = candidates.filter((candidate) => {
      const token = `@${candidate.displayPath}`;
      const next = body[offset + token.length];
      return (
        body.slice(offset, offset + token.length).replace(/\\/g, "/") === token &&
        (!next || /[\s,;:!?，。；：！？)）]/.test(next))
      );
    });
    const match = matches[0];
    if (!match || used.has(match.path)) continue;
    if (
      matches.some(
        (candidate) => candidate.displayPath === match.displayPath && candidate.path !== match.path,
      )
    )
      continue;
    mentions.push({ ...match, offset, kind: /[\\/]$/.test(match.path) ? "dir" : undefined });
    used.add(match.path);
    offset += match.displayPath.length;
  }
  return mentions;
}

/** Restore readable segments and inline files, hiding machine-only path notes. */
export function parseUserMessageSegments(text: string): UserMessageSegment[] {
  let body = text.replace(/\r\n/g, "\n").trimEnd();
  let paths: string[] = [];
  const pathNote = /(?:^|\n)引用路径：\n((?:- [^\n]+(?:\n|$))+)$/u.exec(body);
  if (pathNote) {
    paths = [
      ...new Set(
        pathNote[1]
          .trimEnd()
          .split("\n")
          .map((line) => line.slice(2)),
      ),
    ];
    body = body.slice(0, pathNote.index).trimEnd();
  }

  let mentions: PositionedFileMention[] | null = null;
  const metadataStart = body.lastIndexOf(FILE_MENTION_PREFIX);
  if (paths.length > 0 && metadataStart >= 0 && body.endsWith(" -->")) {
    const value = body.slice(metadataStart + FILE_MENTION_PREFIX.length, -4);
    body = body.slice(0, metadataStart).trimEnd();
    // buildPageContext prepends browser details in persisted pi messages; offsets belong to 用户说明.
    const userHeading = "\n## 用户说明\n";
    const headingAt = body.startsWith("[页面上下文 · 来自 PiDesk 浏览器面板]\n")
      ? body.indexOf(userHeading)
      : -1;
    const bodyStart = headingAt < 0 ? 0 : headingAt + userHeading.length;
    mentions =
      readFileMentionMetadata(value, body.slice(bodyStart), paths)?.map((mention) => ({
        ...mention,
        offset: mention.offset + bodyStart,
      })) ?? null;
  }
  mentions ??= legacyMentions(body, paths);
  const used = new Set<string>();
  const inline = (content: string, start: number): UserMessagePart[] => {
    const parts: UserMessagePart[] = [];
    let cursor = 0;
    for (const mention of mentions) {
      const local = mention.offset - start;
      if (local < cursor || local + mention.displayPath.length + 1 > content.length) continue;
      if (local > cursor) parts.push({ kind: "text", text: content.slice(cursor, local) });
      parts.push({ kind: "file", mention });
      used.add(mention.path);
      cursor = local + mention.displayPath.length + 1;
    }
    if (cursor < content.length) parts.push({ kind: "text", text: content.slice(cursor) });
    return parts;
  };
  const segments: UserMessageSegment[] = [];
  const lines = body.split("\n");
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  const push = (
    kind: UserMessageSegment["kind"],
    content: string,
    parts: UserMessagePart[],
  ): void => {
    segments.push({
      kind,
      content,
      ...(parts.some((part) => part.kind === "file") ? { parts } : {}),
    });
  };
  let index = 0;
  if (lines[0].startsWith("【计划模式】")) {
    segments.push({ kind: "plan", content: lines[0].slice("【计划模式】".length) });
    index = 1;
  }
  const quote = (line: string): boolean => line === ">" || line.startsWith("> ");
  while (index < lines.length) {
    if (!lines[index].trim()) {
      index += 1;
      continue;
    }
    const start = index;
    if (quote(lines[index])) {
      const content: string[] = [];
      const parts: UserMessagePart[] = [];
      while (index < lines.length && quote(lines[index])) {
        const prefix = Math.min(2, lines[index].length);
        const line = lines[index].slice(prefix);
        if (content.length > 0) parts.push({ kind: "text", text: "\n" });
        content.push(line);
        parts.push(...inline(line, offsets[index] + prefix));
        index += 1;
      }
      push("quote", content.join("\n"), parts);
    } else {
      while (index < lines.length && !quote(lines[index])) index += 1;
      let end = index;
      while (end > start && !lines[end - 1].trim()) end -= 1;
      const content = lines.slice(start, end).join("\n");
      push("text", content, inline(content, offsets[start]));
    }
  }
  const remaining = paths.filter((path) => !used.has(path));
  if (remaining.length > 0) {
    segments.push({
      kind: "files",
      content: "",
      parts: remaining.map((path) => ({
        kind: "file",
        mention: {
          path,
          displayPath: fileMentionName(path),
          kind: /[\\/]$/.test(path) ? "dir" : undefined,
        },
      })),
    });
  }
  return segments;
}

/** Copy the readable message, preserving quotes and reducing chips to @basename. */
export function readableUserMessage(segments: UserMessageSegment[]): string {
  return segments
    .filter((segment) => segment.kind !== "plan")
    .map((segment) => {
      const content =
        segment.parts
          ?.map((part) =>
            part.kind === "file" ? `@${fileMentionName(part.mention.displayPath)}` : part.text,
          )
          .join(segment.kind === "files" ? " " : "") ?? segment.content;
      return segment.kind === "quote"
        ? content
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n")
        : content;
    })
    .join("\n\n");
}

/** 仅图无文时复制得到占位说明，避免复制出空字符串。 */
export function readableUserMessageWithImages(
  segments: UserMessageSegment[],
  imageCount: number,
): string {
  const body = readableUserMessage(segments).trim();
  if (body) return body;
  if (imageCount > 0) {
    return imageCount === 1
      ? t("session.image.copyOne")
      : t("session.image.copyMany", { count: imageCount });
  }
  return "";
}
