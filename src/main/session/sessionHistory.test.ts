import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ shell: { trashItem: vi.fn() } }));
vi.mock("../settings/settings", () => ({
  getSettings: () => ({ archivedSessions: {} }),
  updateSettings: vi.fn(),
}));

import { encodeCwdToSessionDir, listAllSessions, resolveSessionFile } from "./sessionHistory";

const CWD = "C:\\bench";
const dirs: string[] = [];

async function makeAgentDir(): Promise<string> {
  const agentDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pidesk-history-"));
  dirs.push(agentDir);
  const sessionDir = path.join(agentDir, "sessions", encodeCwdToSessionDir(CWD));
  await fsp.mkdir(sessionDir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;
  return sessionDir;
}

function header(id: string): string {
  return JSON.stringify({
    type: "session",
    version: 3,
    id,
    timestamp: "2026-10-26T08:00:00.000Z",
    cwd: CWD,
  });
}

function message(id: string, timestamp: string, text: string, role = "assistant"): string {
  return JSON.stringify({
    type: "message",
    id,
    parentId: null,
    timestamp,
    message: { role, content: [{ type: "text", text }] },
  });
}

function nameEntry(name: string, timestamp: string): string {
  return JSON.stringify({
    type: "session_info",
    id: "n1",
    parentId: "m0",
    timestamp,
    name,
  });
}

async function writeSession(sessionDir: string, file: string, lines: string[]): Promise<string> {
  const target = path.join(sessionDir, file);
  await fsp.writeFile(target, `${lines.join("\n")}\n`, "utf8");
  return target;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  delete process.env.PI_CODING_AGENT_DIR;
  await Promise.all(dirs.splice(0).map((dir) => fsp.rm(dir, { recursive: true, force: true })));
});

describe("listAllSessions", () => {
  it("updatedAt 取最后消息时间：改名追加 session_info 不把旧会话顶到最前", async () => {
    const sessionDir = await makeAgentDir();
    await writeSession(sessionDir, "old.jsonl", [
      header("old"),
      message("m0", "2026-10-26T09:00:00.000Z", "旧会话"),
      nameEntry("改名后的旧会话", "2026-10-26T12:00:00.000Z"),
    ]);
    await writeSession(sessionDir, "new.jsonl", [
      header("new"),
      message("m0", "2026-10-26T11:00:00.000Z", "新会话"),
    ]);

    const sessions = await listAllSessions();

    expect(sessions.map((s) => s.file)).toEqual([
      path.join(sessionDir, "new.jsonl"),
      path.join(sessionDir, "old.jsonl"),
    ]);
    expect(sessions[1].sessionName).toBe("改名后的旧会话");
    expect(sessions[1].updatedAt).toBe(Date.parse("2026-10-26T09:00:00.000Z"));
  });

  it("mtime/size 未变命中缓存，追加后只重读新区间", async () => {
    const sessionDir = await makeAgentDir();
    const file = await writeSession(sessionDir, "one.jsonl", [
      header("one"),
      message("m0", "2026-10-26T09:00:00.000Z", "第一条"),
    ]);
    const first = await listAllSessions();
    expect(first[0].updatedAt).toBe(Date.parse("2026-10-26T09:00:00.000Z"));

    await fsp.appendFile(
      file,
      `${message("m1", "2026-10-26T10:00:00.000Z", "追加")}\n${nameEntry("追加后", "2026-10-26T10:01:00.000Z")}\n`,
      "utf8",
    );
    const second = await listAllSessions();

    expect(second[0].updatedAt).toBe(Date.parse("2026-10-26T10:00:00.000Z"));
    expect(second[0].sessionName).toBe("追加后");
    expect(second[0].firstUserMessage).toBeNull();
  });
});

describe("resolveSessionFile", () => {
  it("只接受会话目录内的 .jsonl", async () => {
    const sessionDir = await makeAgentDir();
    const file = await writeSession(sessionDir, "ok.jsonl", [header("ok")]);

    expect(resolveSessionFile(file)).toBe(path.resolve(file));
    expect(() => resolveSessionFile(path.join(sessionDir, "ok.txt"))).toThrow("非法的会话文件");
    expect(() => resolveSessionFile(path.join(os.tmpdir(), "outside.jsonl"))).toThrow(
      "会话文件不在 pi 会话目录内",
    );
  });
});
