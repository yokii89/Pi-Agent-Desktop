import { appendFile, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type Binding,
  type HistoryPage,
  type HistoryQuery,
  type HistoryTail,
  parseHistoryRecord,
  parseHistoryReply,
} from "../../shared/remote";
import { MAX_FRAME_BYTES } from "../../shared/remote/business";
import { completedHistory, EMPTY_TAIL, historyPage, RemoteHistoryReader } from "./historySync";

const binding: Binding = {
  relayInstanceId: "relay",
  desktopId: "desktop",
  deviceId: "device",
  grantId: "grant",
  grantVersion: 1,
};
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

function entry(
  index: number,
  content = `message ${index}`,
  parentId: string | null = index ? `entry-${index - 1}` : null,
) {
  return `${JSON.stringify({ type: "message", id: `entry-${index}`, parentId, message: { role: index % 2 ? "assistant" : "user", content } })}\n`;
}

async function fixture(count = 1_000) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pidesk-sync-"));
  folders.push(root);
  const directory = path.join(root, "project");
  await mkdir(directory);
  const file = path.join(directory, "history.jsonl");
  await writeFile(file, Array.from({ length: count }, (_, index) => entry(index)).join(""));
  let reader = new RemoteHistoryReader();
  const read = () => reader.read(file, directory, root);
  return {
    file,
    read,
    directory,
    root,
    restart: () => {
      reader = new RemoteHistoryReader();
    },
    async query(
      direction: HistoryQuery["direction"],
      cursor: string | null = null,
      tail: HistoryTail = EMPTY_TAIL,
      scope = binding,
      limit = 50,
    ) {
      const query: HistoryQuery = {
        sessionId: "session",
        direction,
        cursor,
        limit,
        tailRevision: tail.revision,
      };
      return parseHistoryReply(historyPage(await read(), scope, query, tail), query);
    },
  };
}

function page(
  value: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>["query"]>>,
): HistoryPage {
  expect(value.status).toBe("page");
  if (value.status !== "page") throw new Error("expected page");
  return value;
}

describe("incremental desktop history", () => {
  it("holds a partial tool group until all results settle and reconstructs the boundary after restart", async () => {
    const f = await fixture(1);
    const line = (id: string, parentId: string, message: unknown) =>
      `${JSON.stringify({ type: "message", id, parentId, message })}\n`;
    await appendFile(
      f.file,
      line("calls", "entry-0", {
        role: "assistant",
        content: [
          { type: "text", text: "Reading two files" },
          { type: "toolCall", id: "tool-a", name: "read", arguments: {} },
          { type: "toolCall", id: "tool-b", name: "read", arguments: {} },
        ],
      }),
    );
    const before = completedHistory(await f.read(), false);
    expect(before.messages.map((message) => message.text)).toEqual([
      "message 0",
      "Reading two files",
    ]);
    await appendFile(
      f.file,
      line("result-a", "calls", {
        role: "toolResult",
        toolCallId: "tool-a",
        toolName: "read",
        content: "first result",
      }),
    );
    const partial = await f.read();
    expect(partial.messages).toHaveLength(3);
    expect(completedHistory(partial, false).messages).toHaveLength(2);
    expect(completedHistory(partial, true).messages).toHaveLength(3);
    f.restart();
    expect(completedHistory(await f.read(), false).messages).toHaveLength(2);
    await appendFile(
      f.file,
      line("result-b", "result-a", {
        role: "toolResult",
        toolCallId: "tool-b",
        toolName: "read",
        isError: true,
        content: "second failed",
      }),
    );
    const completed = completedHistory(await f.read(), false);
    expect(completed.messages.map((message) => message.text)).toEqual([
      "message 0",
      "Reading two files",
      "first result",
      "second failed",
    ]);
    expect(completed.messages.at(-1)?.isError).toBe(true);
  });
  it("sends 50 of 1000, zero unchanged messages, then only three new messages", async () => {
    const f = await fixture();
    const latest = page(await f.query("latest"));
    expect(latest.messages.map((message) => message.position)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 950),
    );
    expect(await f.query("after", latest.checkpoint)).toEqual({ status: "unchanged" });
    await appendFile(f.file, entry(1000) + entry(1001) + entry(1002));
    const added = page(await f.query("after", latest.checkpoint));
    expect(added.messages.map((message) => message.text)).toEqual([
      "message 1000",
      "message 1001",
      "message 1002",
    ]);
    expect(added.more).toBe(false);
    expect(await f.query("after", added.checkpoint)).toEqual({ status: "unchanged" });
    const earlier = page(await f.query("before", latest.beforeCursor));
    expect(earlier.messages[0].position).toBe(900);
    expect(earlier.messages.at(-1)?.position).toBe(949);
  });

  it("preserves finite tool categories and failures through incremental history parsing", async () => {
    const f = await fixture(1);
    const latest = page(await f.query("latest"));
    await appendFile(
      f.file,
      `${JSON.stringify({
        type: "message",
        id: "tool-entry",
        parentId: "entry-0",
        message: {
          role: "toolResult",
          toolName: "mcp__private__tool",
          isError: true,
          arguments: { command: "secret command" },
          content: "tool failed",
        },
      })}\n`,
    );
    const added = page(await f.query("after", latest.checkpoint));
    expect(added.messages).toEqual([
      {
        id: expect.any(String),
        position: 1,
        role: "tool",
        text: "tool failed",
        state: "done",
        toolKind: "mcp",
        isError: true,
      },
    ]);
    expect(() =>
      parseHistoryRecord({ ...added.messages[0], toolKind: "mcp__private__tool" }),
    ).toThrow("INVALID_FRAME");
  });

  it("resumes after desktop restart and pages accumulated changes from each committed boundary", async () => {
    const f = await fixture(2);
    const latest = page(await f.query("latest"));
    await appendFile(f.file, Array.from({ length: 123 }, (_, i) => entry(i + 2)).join(""));
    f.restart();
    let checkpoint = latest.checkpoint;
    const received: string[] = [];
    for (let i = 0; i < 3; i++) {
      const next = page(await f.query("after", checkpoint));
      received.push(...next.messages.map((message) => message.id));
      checkpoint = next.checkpoint;
      expect(next.more).toBe(i < 2);
    }
    expect(new Set(received).size).toBe(123);
    expect(await f.query("after", checkpoint)).toEqual({ status: "unchanged" });
  });

  it("indexes only complete lines and preserves their identities when finishing a partial append", async () => {
    const f = await fixture(2);
    const initial = await f.read();
    const next = entry(2);
    await appendFile(f.file, next.slice(0, 10));
    expect((await f.read()).messages).toEqual(initial.messages);
    await appendFile(f.file, next.slice(10));
    const complete = await f.read();
    expect(complete.messages.slice(0, 2)).toEqual(initial.messages);
    expect(complete.messages[2].text).toBe("message 2");
    expect(await f.read()).toBe(complete);
  });

  it("invalidates rewritten prefixes, truncations and replaced files even when a final entry id survives", async () => {
    const f = await fixture(3);
    const latest = page(await f.query("latest"));
    await writeFile(f.file, entry(0, "rewritten") + entry(1) + entry(2));
    expect(await f.query("after", latest.checkpoint)).toEqual({ status: "reset_required" });
    const rewritten = page(await f.query("latest"));
    await writeFile(f.file, entry(0));
    expect(await f.query("after", rewritten.checkpoint)).toEqual({ status: "reset_required" });
    const truncated = page(await f.query("latest"));
    await rename(f.file, `${f.file}.old`);
    await writeFile(f.file, entry(0));
    expect(await f.query("after", truncated.checkpoint)).toEqual({ status: "reset_required" });
  });

  it("follows parentId to the active branch and keeps compaction metadata out of the visible transcript", async () => {
    const f = await fixture(3);
    const latest = page(await f.query("latest"));
    await appendFile(f.file, entry(3, "new branch", "entry-0"));
    expect(await f.query("after", latest.checkpoint)).toEqual({ status: "reset_required" });
    expect((await f.read()).messages.map((message) => message.text)).toEqual([
      "message 0",
      "new branch",
    ]);
    const switched = page(await f.query("latest"));
    await appendFile(
      f.file,
      `${JSON.stringify({ type: "compaction", id: "compact", parentId: "entry-3", summary: "private" })}\n`,
    );
    expect(await f.query("after", switched.checkpoint)).toEqual({ status: "unchanged" });
    await appendFile(f.file, entry(4, "continued", "compact"));
    expect(
      page(await f.query("after", switched.checkpoint)).messages.map((message) => message.text),
    ).toEqual(["continued"]);
  });

  it("scopes cursors to the grant, direction and session, rather than trusting positions", async () => {
    const f = await fixture(100);
    const latest = page(await f.query("latest"));
    expect(await f.query("after", latest.beforeCursor)).toEqual({ status: "reset_required" });
    expect(
      await f.query("after", latest.checkpoint, EMPTY_TAIL, { ...binding, grantId: "other" }),
    ).toEqual({ status: "reset_required" });
    const query: HistoryQuery = {
      sessionId: "other",
      direction: "after",
      cursor: latest.checkpoint,
      limit: 50,
      tailRevision: null,
    };
    expect(historyPage(await f.read(), binding, query, EMPTY_TAIL)).toEqual({
      status: "reset_required",
    });
  });

  it("returns a stable empty checkpoint and starts with the first appended message", async () => {
    const f = await fixture(0);
    const latest = page(await f.query("latest"));
    expect(latest.messages).toEqual([]);
    expect(await f.query("after", latest.checkpoint)).toEqual({ status: "unchanged" });
    await appendFile(f.file, entry(0));
    expect(page(await f.query("after", latest.checkpoint)).messages[0].position).toBe(0);
  });

  it("respects frame budgets for long unicode messages and transmits a live tail only when it changed", async () => {
    const f = await fixture(0);
    await writeFile(
      f.file,
      Array.from({ length: 20 }, (_, index) => entry(index, "文😀".repeat(2_000))).join(""),
    );
    const tail: HistoryTail = {
      revision: "tail-v1",
      messages: [{ id: "partial", role: "assistant", text: "partial", state: "running" }],
    };
    const query: HistoryQuery = {
      sessionId: "session",
      direction: "latest",
      cursor: null,
      limit: 50,
      tailRevision: null,
    };
    const reply = historyPage(await f.read(), binding, query, tail);
    expect(Buffer.byteLength(JSON.stringify(reply))).toBeLessThan(MAX_FRAME_BYTES - 2_048);
    const latest = page(parseHistoryReply(reply, query));
    expect(latest.tail).toEqual(tail);
    expect(await f.query("after", latest.checkpoint, tail)).toEqual({ status: "unchanged" });
    const next = { ...query, direction: "after" as const, cursor: latest.checkpoint };
    expect(parseHistoryReply(historyPage(await f.read(), binding, next, tail), next)).toEqual({
      status: "unchanged",
      tail,
    });
  });
});
