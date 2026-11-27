import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VIEW_SESSION_OWNER_ENTRY_TYPE } from "../../shared/view";
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

const VIEW_OWNER = { panelId: "extension.review.children", rootSessionId: "root-session" };

function ownerEntry(data: unknown = VIEW_OWNER): string {
  return JSON.stringify({
    type: "custom",
    id: "owner",
    parentId: null,
    timestamp: "2026-10-26T01:00:00.000Z",
    customType: VIEW_SESSION_OWNER_ENTRY_TYPE,
    data,
  });
}

function userMessageEntry(id: string, content: unknown): string {
  return JSON.stringify({
    type: "message",
    id,
    parentId: "m1",
    timestamp: "2026-10-26T00:02:00.000Z",
    message: { role: "user", content },
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
    expect(result.latestUserMessage).toEqual({ found: true, value: "你好\n世界" });
    expect(result.sessionName).toEqual({ found: true, value: "第二个" });
    expect(result.viewOwner).toBeNull();
    expect(result.scannedBytes).toBe((await fsp.stat(file)).size);
  });

  it("读取通用 custom 面板归属，不把标记时间当成消息活跃时间", async () => {
    const file = await writeSession([
      HEADER,
      ownerEntry(),
      messageEntry("m1", "2026-10-26T00:00:05.000Z", "user"),
      ownerEntry({ ...VIEW_OWNER, panelId: "another.extension.panel" }),
    ]);

    const result = await scanSessionFile(file);

    expect(result.viewOwner).toEqual({ ...VIEW_OWNER, panelId: "another.extension.panel" });
    expect(result.lastActivityAt).toBe(Date.parse("2026-10-26T00:00:05.000Z"));
  });

  it.each([
    null,
    {},
    [],
    "",
    { panelId: "", rootSessionId: "root" },
    { panelId: " \t", rootSessionId: "root" },
    { panelId: "panel", rootSessionId: "" },
    { panelId: "panel", rootSessionId: " \n" },
    { panelId: 123, rootSessionId: "root" },
    { panelId: "panel", rootSessionId: false },
  ])("忽略空或无效的面板归属数据：%j", async (data) => {
    const file = await writeSession([HEADER, ownerEntry(data)]);

    const result = await scanSessionFile(file);

    expect(result.viewOwner).toBeNull();
    expect(result.lastActivityAt).toBeNull();
  });

  it("只有顶层同名 custom 条目可声明归属，损坏或伪造标记不隐藏会话", async () => {
    const marker = JSON.parse(ownerEntry());
    const file = await writeSession([
      HEADER,
      JSON.stringify({ type: "custom", customType: VIEW_SESSION_OWNER_ENTRY_TYPE }),
      JSON.stringify({ ...marker, type: "custom_message" }),
      JSON.stringify({ ...marker, customType: "another:owner" }),
      JSON.stringify({ type: "custom", customType: "extension:data", data: marker }),
      JSON.stringify({ type: "session_info", name: VIEW_SESSION_OWNER_ENTRY_TYPE }),
      ownerEntry().slice(0, -1),
    ]);

    expect((await scanSessionFile(file)).viewOwner).toBeNull();
  });

  it("增量扫描等归属标记换行后生效，无效后续标记不覆盖有效值", async () => {
    const file = await writeSession([HEADER, USER]);
    const before = await scanSessionFile(file);
    expect(before.viewOwner).toBeNull();

    await fsp.appendFile(file, ownerEntry(), "utf8");
    const partial = await scanSessionFile(file, before.scannedBytes);
    expect(partial.viewOwner).toBeNull();
    expect(partial.scannedBytes).toBe(before.scannedBytes);

    await fsp.appendFile(file, `\n${ownerEntry({})}\n`, "utf8");
    const complete = await scanSessionFile(file, partial.scannedBytes);
    expect(complete.viewOwner).toEqual(VIEW_OWNER);
    expect(complete.lastActivityAt).toBeNull();
  });

  it("归属标记不受 JSON 键序或字段空白影响", async () => {
    const marker = `{ "data": ${JSON.stringify(VIEW_OWNER)}, "customType": "${VIEW_SESSION_OWNER_ENTRY_TYPE}", "type": "custom" }`;
    const file = await writeSession([HEADER, marker]);

    expect((await scanSessionFile(file)).viewOwner).toEqual(VIEW_OWNER);
  });

  it("提取最新用户消息的文本块，但保留首条用户消息不变", async () => {
    const latest = userMessageEntry("m3", [
      { type: "text", text: "最新提示" },
      { type: "image", data: "ignored" },
      { type: "text", text: "词内容" },
    ]);
    const file = await writeSession([HEADER, USER, ASSISTANT, latest]);

    const result = await scanSessionFile(file);

    expect(result.firstUserMessage).toBe("你好\n世界");
    expect(result.latestUserMessage).toEqual({ found: true, value: "最新提示\n词内容" });
  });

  it("忽略内容中伪造 role 标记的非用户消息", async () => {
    const assistant = JSON.stringify({
      type: "message",
      id: "m3",
      parentId: "m2",
      timestamp: "2026-10-26T00:03:00.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: '包含字面量 "role":"user" 的回答' }],
      },
    });
    const file = await writeSession([HEADER, USER, assistant]);

    const result = await scanSessionFile(file);

    expect(result.latestUserMessage).toEqual({ found: true, value: "你好\n世界" });
  });

  it("最新用户提示词有界截断，且后续无文本输入会清空旧摘要", async () => {
    const longPrompt = userMessageEntry("m3", [{ type: "text", text: "字".repeat(400) }]);
    const file = await writeSession([HEADER, USER, longPrompt]);
    const full = await scanSessionFile(file);
    expect(full.latestUserMessage.value).toBe("字".repeat(256));

    const offset = full.scannedBytes;
    await fsp.appendFile(
      file,
      `${userMessageEntry("m4", [{ type: "image", data: "image" }])}\n`,
      "utf8",
    );
    const incremental = await scanSessionFile(file, offset);
    expect(incremental.latestUserMessage).toEqual({ found: true, value: null });
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
    expect(second.latestUserMessage.found).toBe(false);
  });

  it("增量扫描只返回新增区间内最新的用户提示词", async () => {
    const file = await writeSession([HEADER, USER]);
    const first = await scanSessionFile(file);
    expect(first.latestUserMessage).toEqual({ found: true, value: "你好\n世界" });

    await fsp.appendFile(
      file,
      `${userMessageEntry("m2", [{ type: "text", text: "后续用户提示词" }])}\n`,
      "utf8",
    );
    const next = await scanSessionFile(file, first.scannedBytes);
    expect(next.latestUserMessage).toEqual({ found: true, value: "后续用户提示词" });
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
