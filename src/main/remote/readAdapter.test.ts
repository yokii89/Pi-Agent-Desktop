import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  projectRemoteMessages,
  REMOTE_HISTORY_BYTES,
  readRemoteHistory,
  remoteSessionFile,
} from "./readAdapter";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture() {
  const base = await mkdtemp(path.join(os.tmpdir(), "pidesk-remote-"));
  temporary.push(base);
  const root = path.join(base, "sessions");
  const dir = path.join(root, "project");
  await mkdir(dir, { recursive: true });
  return { base, root, dir, file: path.join(dir, "history.jsonl") };
}
const line = (message: unknown, extra = {}) =>
  JSON.stringify({ type: "message", message, ...extra });

describe("remote history projection", () => {
  it("handles string and block text while dropping hidden, custom, thinking and tool-call content", () => {
    expect(
      projectRemoteMessages([
        { role: "user", content: "hello C:\\Users\\alice\\secret.txt" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "answer" },
            { type: "thinking", thinking: "secret" },
            { type: "toolCall", arguments: { path: "private" } },
          ],
        },
        { role: "custom", content: "do not expose" },
        { role: "assistant", display: false, content: "hidden" },
        { role: "toolResult", content: [{ type: "text", text: "visible tool result" }] },
      ]),
    ).toEqual([
      { id: "m_0_0", role: "user", text: "hello [local path]", state: "done" },
      { id: "m_1_0", role: "assistant", text: "answer", state: "done" },
      { id: "m_4_0", role: "tool", text: "visible tool result", state: "done" },
    ]);
  });
  it("chunks long text without losing content or changing page identities", () => {
    const text = "文".repeat(12_001);
    const messages = projectRemoteMessages([{ role: "assistant", content: text }], true);
    expect(messages.map((m) => m.text).join("")).toBe(text);
    expect(messages.map((m) => m.id)).toEqual(["m_0_0", "m_0_6000", "m_0_12000"]);
    expect(messages.map((m) => m.state)).toEqual(["done", "done", "running"]);
  });
  it("ignores malformed records and whitespace-only content", () => {
    expect(
      projectRemoteMessages([
        null,
        [],
        1,
        { role: "user", content: "  " },
        { role: "user", content: [null, {}, { type: "image" }] },
      ]),
    ).toEqual([]);
  });
});

describe("remote history filesystem boundary", () => {
  it("reads visible messages from the authorized directory and ignores malformed or hidden entries", async () => {
    const f = await fixture();
    await writeFile(
      f.file,
      [
        "invalid json",
        "null",
        line({ role: "user", content: "hello" }),
        line({ role: "assistant", content: "hidden record" }, { display: false }),
        line({ role: "assistant", content: "hidden message", display: false }),
        JSON.stringify({ type: "custom_message", content: "hidden notification" }),
        line({ role: "assistant", content: [{ type: "text", text: "answer" }] }),
      ].join("\n"),
    );
    const messages = await readRemoteHistory(f.file, f.dir, f.root);
    expect(messages.map((message) => message.text)).toEqual(["hello", "answer"]);
  });
  it("rejects files outside the session root, sibling project files and non-jsonl files", async () => {
    const f = await fixture();
    const other = path.join(f.root, "other");
    await mkdir(other);
    for (const file of [
      path.join(f.base, "outside.jsonl"),
      path.join(other, "other.jsonl"),
      path.join(f.dir, "not-jsonl.txt"),
    ]) {
      await writeFile(file, "private");
      await expect(remoteSessionFile(file, f.dir, f.root)).rejects.toThrow("RESOURCE_UNAVAILABLE");
    }
  });
  it("rejects a project directory replaced with a junction to an external directory", async () => {
    const f = await fixture();
    const outside = path.join(f.base, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "history.jsonl"), "private");
    await rename(f.dir, `${f.dir}-original`);
    await symlink(outside, f.dir, "junction");
    await expect(readRemoteHistory(f.file, f.dir, f.root)).rejects.toThrow("RESOURCE_UNAVAILABLE");
  });
  it("rejects oversized histories before loading their text", async () => {
    const f = await fixture();
    await writeFile(f.file, Buffer.alloc(REMOTE_HISTORY_BYTES + 1, 32));
    await expect(readRemoteHistory(f.file, f.dir, f.root)).rejects.toThrow("RESOURCE_UNAVAILABLE");
  });
  it("keeps the newest bounded history", async () => {
    const f = await fixture();
    await writeFile(
      f.file,
      Array.from({ length: 2_001 }, (_, i) => line({ role: "user", content: String(i) })).join(
        "\n",
      ),
    );
    const messages = await readRemoteHistory(f.file, f.dir, f.root);
    expect(messages).toHaveLength(2_000);
    expect(messages[0].text).toBe("1");
    expect(messages.at(-1)?.text).toBe("2000");
  });
});
