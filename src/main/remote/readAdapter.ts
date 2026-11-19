import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { classifyRemoteTool } from "../../shared/remote/toolKind";
import type { RemoteMessage } from "./readOnlyBridge";
import { sanitizeRemoteText } from "./sanitize";

/** Match the local companion's read budget before loading a transcript into memory. */
export const REMOTE_HISTORY_BYTES = 2 * 1024 * 1024;
const MAX_MESSAGES = 2_000;
const MESSAGE_CHUNK = 6_000;

function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return (
    !!relative &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/** Resolve both the catalog directory and its file, rejecting symlinks outside the session tree. */
export async function remoteSessionFile(
  file: string,
  directory: string,
  sessionRoot: string,
): Promise<string> {
  const [root, dir, resolved] = await Promise.all([
    realpath(sessionRoot),
    realpath(directory),
    realpath(file),
  ]);
  if (
    !inside(root, dir) ||
    !inside(root, resolved) ||
    path.dirname(resolved) !== dir ||
    path.extname(resolved).toLowerCase() !== ".jsonl"
  ) {
    throw new Error("RESOURCE_UNAVAILABLE");
  }
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error("RESOURCE_UNAVAILABLE");
  return resolved;
}

/** Keep visible text only, including tool results supported by the current phone protocol. */
export function projectRemoteMessages(raw: readonly unknown[], running = false): RemoteMessage[] {
  const messages: RemoteMessage[] = [];
  for (const [index, value] of raw.entries()) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const item = value as Record<string, unknown>;
    if (item.display === false || !["user", "assistant", "toolResult"].includes(String(item.role)))
      continue;
    const role = item.role === "toolResult" ? "tool" : (item.role as "user" | "assistant");
    const body = sanitizeRemoteText(
      typeof item.content === "string"
        ? item.content
        : (Array.isArray(item.content) ? item.content : [])
            .flatMap((block: unknown) => {
              if (!block || typeof block !== "object") return [];
              const part = block as Record<string, unknown>;
              return part.type === "text" && typeof part.text === "string" ? [part.text] : [];
            })
            .join("\n"),
    );
    const toolKind =
      role === "tool" && typeof item.toolName === "string"
        ? classifyRemoteTool(item.toolName)
        : undefined;
    const isError = role === "tool" && item.isError === true;
    if (!body.trim()) continue;
    for (let start = 0; start < body.length; start += MESSAGE_CHUNK) {
      messages.push({
        id: `m_${index}_${start}`,
        role,
        text: body.slice(start, start + MESSAGE_CHUNK),
        ...(toolKind ? { toolKind } : {}),
        state:
          role === "assistant" && running && start + MESSAGE_CHUNK >= body.length
            ? "running"
            : "done",
        ...(isError ? { isError: true } : {}),
      });
    }
  }
  return messages;
}

/** Read through a bounded handle and recheck the real path before returning any projected text. */
export async function readRemoteHistory(
  file: string,
  directory: string,
  sessionRoot: string,
): Promise<RemoteMessage[]> {
  const resolved = await remoteSessionFile(file, directory, sessionRoot);
  const handle = await open(resolved, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > REMOTE_HISTORY_BYTES) throw new Error("RESOURCE_UNAVAILABLE");
    const buffer = Buffer.alloc(REMOTE_HISTORY_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (
      total > REMOTE_HISTORY_BYTES ||
      (await remoteSessionFile(file, directory, sessionRoot)) !== resolved
    )
      throw new Error("RESOURCE_UNAVAILABLE");
    const current = await stat(resolved);
    if (current.dev !== info.dev || current.ino !== info.ino)
      throw new Error("RESOURCE_UNAVAILABLE");
    const messages: unknown[] = [];
    for (const line of buffer.subarray(0, total).toString("utf8").split("\n")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      const entry = parsed as Record<string, unknown>;
      if (entry.type === "message" && entry.display !== false) messages.push(entry.message);
    }
    return projectRemoteMessages(messages.slice(-MAX_MESSAGES));
  } finally {
    await handle.close();
  }
}
