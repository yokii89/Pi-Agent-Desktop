/** Legacy JSONL is immutable, including names and old settings migrations. */
export async function appendSessionName(_file: string, _rawName: string): Promise<string | null> {
  throw new Error("Legacy JSONL sessions are read-only.");
}
