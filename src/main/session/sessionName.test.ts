import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { appendSessionName } from "./sessionName";

it("refuses offline legacy rename without appending session_info or changing the source", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pidesk-legacy-name-"));
  const file = path.join(directory, "session.jsonl");
  try {
    const text = '{"type":"session","id":"legacy"}\n';
    await writeFile(file, text);
    await expect(appendSessionName(file, "new title")).rejects.toThrow("read-only");
    await expect(appendSessionName(file, "")).rejects.toThrow("read-only");
    expect(await readFile(file, "utf8")).toBe(text);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
