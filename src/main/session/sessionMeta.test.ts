import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeSessionName, scanSessionFile } from "./sessionMeta";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fsp.rm(dir, { recursive: true, force: true })));
});

async function writeSession(lines: string[], trailingNewline = true): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "pidesk-session-meta-"));
  dirs.push(dir);
  const file = path.join(dir, "session.jsonl");
  await fsp.writeFile(file, lines.join("\n") + (trailingNewline ? "\n" : ""), "utf8");
  return file;
}

const HEADER =
  '{"type":"session","version":3,"id":"sess-1","timestamp":"2026-10-26T00:00:00.000Z","cwd":"C:\\\\demo"}';
const USER =
  '{"type":"message","id":"m1","parentId":null,"message":{"role":"user","content":"你好\\n世界"}}';
const ASSISTANT =
  '{"type":"message","id":"m2","parentId":"m1","message":{"role":"assistant","content":[{"type":"text","text":"收到"}]}}';

function nameEntry(id: string, name: string, parentId = "m1"): string {
  return JSON.stringify({
    type: "session_info",
    id,
    parentId,
    timestamp: "2026-10-26T00:01:00.000Z",
    name,
  });
}

function messageEntry(id: string, timestamp: string, role = "assistant"): string {
  return JSON.stringify({
    type: "message",
    id,
    parentId: "m1",
    timestamp,
    message: { role, content: [{ type: "text", text: "x" }] },
  });
}

describe("scanSessionFile", () => {
  it("提取头部、首条用户消息与最后一个会话名", async () => {
    const file = await writeSession([
      HEADER,
      USER,
      ASSISTANT,
      nameEntry("n1", "第一个"),
      nameEntry("n2", "第二个"),
    ]);

    const result = await scanSessionFile(file);

    expect(result.header?.id).toBe("sess-1");
    expect(result.header?.cwd).toBe("C:\\demo");
    expect(result.firstUserMessage).toBe("你好\n世界");
    expect(result.sessionName).toEqual({ found: true, value: "第二个" });
    expect(result.scannedBytes).toBe((await fsp.stat(file)).size);
  });

  it("没有 session_info 时不产生名字", async () => {
    const file = await writeSession([HEADER, USER, ASSISTANT]);

    const result = await scanSessionFile(file);

    expect(result.sessionName).toEqual({ found: false, value: null });
  });

  it("空名显式清除，且以最后一条为准", async () => {
    const file = await writeSession([HEADER, USER, nameEntry("n1", "旧名字"), nameEntry("n2", "")]);

    const result = await scanSessionFile(file);

    expect(result.sessionName).toEqual({ found: true, value: null });
  });

  it("增量扫描只读取追加区间，空名同样覆盖旧值", async () => {
    const file = await writeSession([HEADER, USER]);
    const first = await scanSessionFile(file);
    expect(first.sessionName.found).toBe(false);

    await fsp.appendFile(file, `${nameEntry("n1", "新名字")}\n`, "utf8");
    const second = await scanSessionFile(file, first.scannedBytes);
    expect(second.sessionName).toEqual({ found: true, value: "新名字" });

    await fsp.appendFile(file, `${nameEntry("n2", "  ")}\n`, "utf8");
    const third = await scanSessionFile(file, second.scannedBytes);
    expect(third.sessionName).toEqual({ found: true, value: null });
  });

  it("写了一半的行不计入，补全后从原偏移继续解析", async () => {
    const partial = nameEntry("n1", "半行");
    const file = await writeSession([HEADER, USER, partial], false);

    const first = await scanSessionFile(file);
    const size = (await fsp.stat(file)).size;
    expect(first.sessionName.found).toBe(false);
    expect(first.scannedBytes).toBeLessThan(size);

    await fsp.appendFile(file, "\n", "utf8");
    const second = await scanSessionFile(file, first.scannedBytes);
    expect(second.sessionName).toEqual({ found: true, value: "半行" });
  });

  it("首条消息很长、名字落在 256KB 之后时仍能扫描到", async () => {
    const huge =
      '{"type":"message","id":"m1","parentId":null,"message":{"role":"user","content":"' +
      "x".repeat(300 * 1024) +
      '"}}';
    const file = await writeSession([HEADER, huge, nameEntry("n1", "大文件名字")]);

    const result = await scanSessionFile(file);

    expect(result.firstUserMessage).toHaveLength(300 * 1024);
    expect(result.sessionName).toEqual({ found: true, value: "大文件名字" });
  });

  it("兼容 CRLF 行尾", async () => {
    const file = await writeSession([HEADER, USER, nameEntry("n1", "CRLF")]);
    const text = await fsp.readFile(file, "utf8");
    await fsp.writeFile(file, text.replace(/\n/g, "\r\n"), "utf8");

    const result = await scanSessionFile(file);

    expect(result.header?.id).toBe("sess-1");
    expect(result.firstUserMessage).toBe("你好\n世界");
    expect(result.sessionName).toEqual({ found: true, value: "CRLF" });
  });

  it("lastActivityAt 取最后一条 message，改名追加不算活跃", async () => {
    const file = await writeSession([
      HEADER,
      messageEntry("m1", "2026-10-26T00:00:05.000Z", "user"),
      messageEntry("m2", "2026-10-26T00:00:09.000Z"),
      metadataEntry(),
      nameEntry("n1", "改了名"),
    ]);

    const result = await scanSessionFile(file);

    expect(result.lastActivityAt).toBe(Date.parse("2026-10-26T00:00:09.000Z"));
  });

  it("只有头部与元数据时 lastActivityAt 为 null", async () => {
    const file = await writeSession([HEADER, metadataEntry(), nameEntry("n1", "名字")]);

    const result = await scanSessionFile(file);

    expect(result.lastActivityAt).toBeNull();
  });

  it("增量扫描返回追加区间内的最后消息时间", async () => {
    const file = await writeSession([HEADER, messageEntry("m1", "2026-10-26T00:00:05.000Z")]);
    const first = await scanSessionFile(file);
    expect(first.lastActivityAt).toBe(Date.parse("2026-10-26T00:00:05.000Z"));

    await fsp.appendFile(file, `${messageEntry("m2", "2026-10-26T00:02:00.000Z")}\n`, "utf8");
    const second = await scanSessionFile(file, first.scannedBytes);
    expect(second.lastActivityAt).toBe(Date.parse("2026-10-26T00:02:00.000Z"));
    expect(second.firstUserMessage).toBeNull();
  });

  it("追加 session_info 不改 lastActivityAt（改名不算活跃）", async () => {
    const file = await writeSession([HEADER, messageEntry("m1", "2026-10-26T00:00:05.000Z")]);
    const before = await scanSessionFile(file);

    await fsp.appendFile(file, `${nameEntry("n1", "改名")}\n`, "utf8");
    const after = await scanSessionFile(file, before.scannedBytes);

    expect(after.lastActivityAt).toBeNull();
    expect(after.sessionName).toEqual({ found: true, value: "改名" });
  });

  it("超长行跨块后仍能继续识别后续消息时间", async () => {
    const huge = imageEntry("big", 300 * 1024);
    const file = await writeSession([HEADER, huge, messageEntry("m2", "2026-10-26T00:03:00.000Z")]);

    const result = await scanSessionFile(file);

    expect(result.lastActivityAt).toBe(Date.parse("2026-10-26T00:03:00.000Z"));
    expect(result.scannedBytes).toBe((await fsp.stat(file)).size);
  });
});

/** 无消息的角色条目：只有 timestamp，不应被当成会话活跃。 */
function metadataEntry(): string {
  return JSON.stringify({
    type: "model_change",
    id: "c1",
    parentId: "m2",
    timestamp: "2026-10-26T00:05:00.000Z",
    provider: "p",
    modelId: "m",
  });
}

function imageEntry(id: string, bytes: number): string {
  return JSON.stringify({
    type: "message",
    id,
    parentId: "m1",
    timestamp: "2026-10-26T00:01:30.000Z",
    message: { role: "toolResult", content: [{ type: "image", data: "A".repeat(bytes) }] },
  });
}

describe("normalizeSessionName", () => {
  it("换行压成空格并 trim，空白等于未命名", () => {
    expect(normalizeSessionName("  名字\n第二行  ")).toBe("名字 第二行");
    expect(normalizeSessionName(" \r\n\t ")).toBeNull();
    expect(normalizeSessionName(undefined)).toBeNull();
  });
});
