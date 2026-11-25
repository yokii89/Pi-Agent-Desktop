/** Stable stored identity. UI SessionId identifies only the current attachment to the runtime. */
export type SessionRef = { kind: "durable"; id: string } | { kind: "legacy-jsonl"; file: string };

export const DURABLE_SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Presentation/index key for existing sidebar preferences; never a filesystem path. */
export function sessionRefKey(ref: SessionRef): string {
  return ref.kind === "durable" ? `durable:${ref.id.toLowerCase()}` : ref.file;
}

/** Decode sidebar keys at the compatibility boundary, before any filesystem access. */
export function sessionRefFromKey(key: string): SessionRef {
  if (key.startsWith("durable:")) {
    const id = key.slice(8);
    if (!DURABLE_SESSION_ID.test(id)) throw new Error("Invalid Durable session reference.");
    return { kind: "durable", id: id.toLowerCase() };
  }
  return { kind: "legacy-jsonl", file: key };
}
