import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendSessionName } from "./sessionName";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fsp.rm(dir, { recursive: true, force: true })));
});

async function writeSession(lines: string[], trailingNewline = true): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "pidesk-session-name-"));
  dirs.push(dir);
  const file = path.join(dir, "session.jsonl");
  await fsp.writeFile(file, lines.join("\n") + (trailingNewline ? "\n" : ""), "utf8");
  return file;
}

async function lastEntry(file: string): Promise<Record<string, unknown>> {
  const text = await fsp.readFile(file, "utf8");
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  return JSON.parse(lines[lines.length - 1] as string) as Record<string, unknown>;
}

const HEADER =
  '{"type":"session","version":3,"id":"sess-1","timestamp":"2026-10-26T00:00:00.000Z","cwd":"C:\\\\demo"}';
const USER =
  '{"type":"message","id":"m1","parentId":"sess-1","message":{"role":"user","content":"hi"}}';

describe("appendSessionName", () => {
  it("追加与 pi 同形的 session_info，名字清洗、parentId 指向最后一条", async () => {
    const file = await writeSession([HEADER, USER]);

    const name = await appendSessionName(file, "  名字\n第二行 ");

    expect(name).toBe("名字 第二行");
    const entry = await lastEntry(file);
    expect(entry.type).toBe("session_info");
    expect(entry.parentId).toBe("m1");
    expect(entry.name).toBe("名字 第二行");
    expect(entry.id).toMatch(/^[0-9a-f]{8}$/);
    expect(typeof entry.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(entry.timestamp as string))).toBe(false);
  });

  it("空名写入空串（pi 视为清除），下一次追加以它为新 parent", async () => {
    const file = await writeSession([HEADER, USER]);
    await appendSessionName(file, "旧名字");
    const first = await lastEntry(file);

    const name = await appendSessionName(file, "   ");

    expect(name).toBeNull();
    const entry = await lastEntry(file);
    expect(entry.name).toBe("");
    expect(entry.parentId).toBe(first.id);
  });

  it("文件尾部是写了一半的行时拒绝追加", async () => {
    const file = await writeSession([HEADER, USER, '{"type":"session_info"'], false);

    await expect(appendSessionName(file, "名字")).rejects.toThrow("正在写入");
  });

  it("末尾有空行时跳过空行取最后一条完整条目", async () => {
    const file = await writeSession([HEADER, USER, "", ""]);

    await appendSessionName(file, "名字");

    const entry = await lastEntry(file);
    expect(entry.parentId).toBe("m1");
  });

  it("最后一行超过单次回读块大小也能取到 parentId", async () => {
    const big =
      '{"type":"message","id":"big-1","parentId":"m1","message":{"role":"assistant","content":[{"type":"text","text":"' +
      "y".repeat(100 * 1024) +
      '"}]}}';
    const file = await writeSession([HEADER, USER, big]);

    await appendSessionName(file, "大行之后");

    const entry = await lastEntry(file);
    expect(entry.parentId).toBe("big-1");
  });
});
