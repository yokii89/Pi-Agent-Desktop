import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readSessionTranscript } from "./sessionTranscriptRead";

/**
 * 历史读盘（docs/design/129 §8.4）：扩展自定义消息在 pi 的 JSONL 里是独立的
 * `type: "custom_message"` 行，不是 `type: "message"` 里的一条。
 * 读盘不认它，重开会话就查不到「哪个作业结束了」。
 */

const dirs: string[] = [];

async function writeSession(lines: string[]): Promise<string> {
  const agentDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pidesk-transcript-"));
  dirs.push(agentDir);
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const sessionDir = path.join(agentDir, "sessions", "bench");
  await fsp.mkdir(sessionDir, { recursive: true });
  const file = path.join(sessionDir, "s1.jsonl");
  await fsp.writeFile(file, `${lines.join("\n")}\n`, "utf8");
  return file;
}

function header(): string {
  return JSON.stringify({
    type: "session",
    version: 3,
    id: "sess-transcript",
    timestamp: "2026-11-06T08:00:00.000Z",
    cwd: "D:\\bench",
  });
}

function userMessage(text: string): string {
  return JSON.stringify({
    type: "message",
    id: "m1",
    parentId: null,
    timestamp: "2026-11-06T08:00:01.000Z",
    message: { role: "user", content: [{ type: "text", text }] },
  });
}

function customMessage(customType: string, content: unknown, display: boolean): string {
  return JSON.stringify({
    type: "custom_message",
    id: "c1",
    parentId: "m1",
    timestamp: "2026-11-06T08:10:00.000Z",
    customType,
    content,
    display,
  });
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) await fsp.rm(dir, { recursive: true, force: true });
});

describe("readSessionTranscript — custom messages", () => {
  it("maps a custom_message line into a role:custom message with its type and display flag", async () => {
    const file = await writeSession([
      header(),
      userMessage("下载 isubs"),
      customMessage("bash-job", [{ type: "text", text: "Bash job J-7 finished: exit 0" }], true),
    ]);
    const { messages } = await readSessionTranscript(file);
    expect(messages.map((message) => message.role)).toEqual(["user", "custom"]);
    const custom = messages[1];
    expect(custom?.customType).toBe("bash-job");
    expect(custom?.display).toBe(true);
    expect(custom?.content).toEqual([{ type: "text", text: "Bash job J-7 finished: exit 0" }]);
  });

  it("keeps a plain-string body readable as one text block", async () => {
    const file = await writeSession([header(), customMessage("bash-job", "job done", true)]);
    const { messages } = await readSessionTranscript(file);
    expect(messages[0]?.content).toEqual([{ type: "text", text: "job done" }]);
  });

  it("carries display:false through — the renderer decides, not the reader", async () => {
    const file = await writeSession([header(), customMessage("bash-job", "internal", false)]);
    const { messages } = await readSessionTranscript(file);
    expect(messages[0]?.display).toBe(false);
  });

  it("skips malformed custom lines instead of failing the whole transcript", async () => {
    const file = await writeSession([
      header(),
      JSON.stringify({ type: "custom_message", id: "c1" }),
      JSON.stringify({ type: "custom_message", id: "c2", customType: "bash-job", content: 42 }),
      customMessage("bash-job", "ok", true),
    ]);
    const { messages } = await readSessionTranscript(file);
    expect(messages).toHaveLength(1);
  });
});
