import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VIEW_SESSION_OWNER_ENTRY_TYPE } from "../../shared/view";

const historySettings = vi.hoisted(() => ({ archivedSessions: {} as Record<string, number> }));

vi.mock("electron", () => ({ shell: { trashItem: vi.fn() } }));
vi.mock("../settings/settings", () => ({
  getSettings: () => historySettings,
  updateSettings: vi.fn(),
}));

import { updateSettings } from "../settings/settings";
import {
  collectSessionFiles,
  encodeCwdToSessionDir,
  getSessionMeta,
  invalidateSessionMeta,
  listAllSessions,
  listSessions,
  resolveSessionFile,
} from "./sessionHistory";
import * as sessionMeta from "./sessionMeta";
import { readSessionTranscript } from "./sessionTranscriptRead";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
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

function header(id: string, parentSession?: string): string {
  return JSON.stringify({
    type: "session",
    version: 3,
    id,
    timestamp: "2026-10-26T08:00:00.000Z",
    cwd: CWD,
    parentSession,
  });
}

const VIEW_OWNER = { panelId: "extension.review.children", rootSessionId: "root-session" };

function ownerEntry(data: unknown = VIEW_OWNER): string {
  return JSON.stringify({
    type: "custom",
    id: "owner",
    parentId: null,
    timestamp: "2026-10-26T23:00:00.000Z",
    customType: VIEW_SESSION_OWNER_ENTRY_TYPE,
    data,
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
  historySettings.archivedSessions = {};
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await Promise.all(dirs.splice(0).map((dir) => fsp.rm(dir, { recursive: true, force: true })));
});

describe("getSessionMeta", () => {
  it("首次读取归属并缓存，追加消息或无效标记时保留归属", async () => {
    const sessionDir = await makeAgentDir();
    const file = await writeSession(sessionDir, "owned.jsonl", [
      header("owned"),
      ownerEntry(),
      message("m0", "2026-10-26T09:00:00.000Z", "第一条", "user"),
    ]);
    const scan = vi.spyOn(sessionMeta, "scanSessionFile");

    const first = await getSessionMeta(file);
    expect(first.viewOwner).toEqual(VIEW_OWNER);
    expect(first.firstUserMessage).toBe("第一条");
    expect(first.lastActivityAt).toBe(Date.parse("2026-10-26T09:00:00.000Z"));
    expect(await getSessionMeta(file)).toBe(first);
    expect(scan).toHaveBeenCalledTimes(1);
    const initialSize = (await fsp.stat(file)).size;

    await fsp.appendFile(
      file,
      `${message("m1", "2026-10-26T10:00:00.000Z", "追加", "user")}\n`,
      "utf8",
    );
    const next = await getSessionMeta(file);
    expect(scan).toHaveBeenLastCalledWith(file, initialSize);
    expect(next.viewOwner).toEqual(VIEW_OWNER);
    expect(next.header?.id).toBe("owned");
    expect(next.firstUserMessage).toBe("第一条");
    expect(next.latestUserMessage).toBe("追加");
    expect(next.lastActivityAt).toBe(Date.parse("2026-10-26T10:00:00.000Z"));

    await fsp.appendFile(file, `${ownerEntry({})}\n${nameEntry("新名称", "2026-10-27")}\n`);
    const renamed = await getSessionMeta(file);
    expect(renamed.viewOwner).toEqual(VIEW_OWNER);
    expect(renamed.lastActivityAt).toBe(next.lastActivityAt);
    expect(renamed.sessionName).toBe("新名称");
  });

  it("增量补齐归属标记后隐藏会话，标记本身不更新活跃时间", async () => {
    const sessionDir = await makeAgentDir();
    const file = await writeSession(sessionDir, "late-owner.jsonl", [
      header("late-owner"),
      message("m0", "2026-10-26T09:00:00.000Z", "正文", "user"),
    ]);
    const first = await getSessionMeta(file);
    expect(first.viewOwner).toBeNull();

    await fsp.appendFile(file, ownerEntry(), "utf8");
    expect((await getSessionMeta(file)).viewOwner).toBeNull();
    await fsp.appendFile(file, "\n", "utf8");
    const owned = await getSessionMeta(file);
    expect(owned.viewOwner).toEqual(VIEW_OWNER);
    expect(owned.lastActivityAt).toBe(first.lastActivityAt);
    expect(await listSessions(CWD)).toEqual([]);
    expect(await listAllSessions()).toEqual([]);
  });

  it("完整重读不沿用旧归属，文件消失时清掉缓存", async () => {
    const sessionDir = await makeAgentDir();
    const file = await writeSession(sessionDir, "replaced.jsonl", [header("owned"), ownerEntry()]);
    expect((await getSessionMeta(file)).viewOwner).toEqual(VIEW_OWNER);

    await fsp.writeFile(file, `${header("main")}\n`, "utf8");
    expect((await getSessionMeta(file)).viewOwner).toBeNull();
    expect((await getSessionMeta(file)).header?.id).toBe("main");
    await fsp.rm(file);
    expect((await getSessionMeta(file)).header).toBeNull();
    expect((await getSessionMeta(file)).viewOwner).toBeNull();
  });
});

describe("scoped session history", () => {
  it("两个列表仅排除有效归属，普通会话与 fork 保持可见且子会话可直接读取", async () => {
    const sessionDir = await makeAgentDir();
    const main = await writeSession(sessionDir, "main.jsonl", [
      header("main"),
      nameEntry("Agent child session", "2026-10-26T12:00:00.000Z"),
      message("m0", "2026-10-26T09:00:00.000Z", "主会话", "user"),
    ]);
    const fork = await writeSession(sessionDir, "fork.jsonl", [
      header("fork", main),
      message("m0", "2026-10-26T10:00:00.000Z", "普通分叉", "user"),
    ]);
    const invalid = await writeSession(sessionDir, "invalid.jsonl", [
      header("invalid"),
      ownerEntry({ panelId: "", rootSessionId: "root-session" }),
      ownerEntry({ panelId: "some.panel", rootSessionId: " " }),
      message("m0", "2026-10-26T11:00:00.000Z", "无效归属", "user"),
    ]);
    const child = await writeSession(sessionDir, "child.jsonl", [
      header("child", main),
      ownerEntry(),
      message("m0", "2026-10-26T12:00:00.000Z", "子会话正文", "user"),
    ]);
    const before = await fsp.readFile(child, "utf8");

    for (const sessions of [await listSessions(CWD), await listAllSessions()]) {
      expect(sessions.map((session) => session.file)).toEqual([invalid, fork, main]);
      expect(sessions.find((session) => session.file === main)?.sessionName).toBe(
        "Agent child session",
      );
    }
    expect(resolveSessionFile(child)).toBe(path.resolve(child));
    expect((await readSessionTranscript(child)).messages[0].content).toEqual([
      { type: "text", text: "子会话正文" },
    ]);
    expect(await fsp.readFile(child, "utf8")).toBe(before);
    expect(
      (await collectSessionFiles(Number.POSITIVE_INFINITY)).map((entry) => entry.file),
    ).toContain(child);
  });

  it("大量较新的子会话不挤占两个列表的主会话名额，也不扫描上限之外的全部冷文件", async () => {
    const sessionDir = await makeAgentDir();
    const scan = vi.spyOn(sessionMeta, "scanSessionFile");
    const base = Date.parse("2026-10-26T09:00:00.000Z");
    const mains = await Promise.all(
      Array.from({ length: 115 }, async (_, index) => {
        const time = new Date(base + index * 1000);
        const file = await writeSession(sessionDir, `main-${index}.jsonl`, [
          header(`main-${index}`),
          message("m0", time.toISOString(), `主会话 ${index}`, "user"),
        ]);
        await fsp.utimes(file, time, time);
        return file;
      }),
    );
    await Promise.all(
      Array.from({ length: 125 }, async (_, index) => {
        const time = new Date(base + (1000 + index) * 1000);
        const file = await writeSession(sessionDir, `child-${index}.jsonl`, [
          header(`child-${index}`),
          ownerEntry(),
          message("m0", time.toISOString(), "子会话", "user"),
        ]);
        await fsp.utimes(file, time, time);
      }),
    );
    const newestMains = [...mains].reverse();

    expect((await listSessions(CWD)).map((session) => session.file)).toEqual(
      newestMains.slice(0, 30),
    );
    expect((await listAllSessions()).map((session) => session.file)).toEqual(
      newestMains.slice(0, 100),
    );
    expect((await listSessions(CWD)).map((session) => session.file)).toEqual(
      newestMains.slice(0, 30),
    );
    expect((await listAllSessions()).map((session) => session.file)).toEqual(
      newestMains.slice(0, 100),
    );
    // 每个候选至多扫描一次；有限并发只允许上限附近少量在途候选。
    expect(scan.mock.calls.length).toBeLessThanOrEqual(125 + 100 + 7);
    expect(scan.mock.calls.some(([file]) => file === mains[0])).toBe(false);
  });

  it("归档补齐也排除归属会话，保留磁盘文件并仅清理不存在的登记", async () => {
    const sessionDir = await makeAgentDir();
    const main = await writeSession(sessionDir, "archived-main.jsonl", [header("archived-main")]);
    const child = await writeSession(sessionDir, "archived-child.jsonl", [
      header("archived-child"),
      ownerEntry(),
    ]);
    const missing = path.join(sessionDir, "missing.jsonl");
    historySettings.archivedSessions = { [main]: 1, [child]: 2, [missing]: 3 };
    // 归档补齐路径也支持目录枚举之外、但仍在 sessions 根内的登记。
    const archivedDir = path.join(sessionDir, "nested");
    await fsp.mkdir(archivedDir);
    const olderMain = await writeSession(archivedDir, "older-main.jsonl", [header("older-main")]);
    const olderChild = await writeSession(archivedDir, "older-child.jsonl", [
      header("older-child"),
      ownerEntry(),
    ]);
    historySettings.archivedSessions[olderMain] = 4;
    historySettings.archivedSessions[olderChild] = 5;

    const sessions = await listAllSessions();

    expect(sessions.map((session) => session.file).sort()).toEqual([main, olderMain].sort());
    expect(updateSettings).toHaveBeenCalledWith({
      archivedSessions: { [main]: 1, [child]: 2, [olderMain]: 4, [olderChild]: 5 },
    });
    expect((await fsp.stat(child)).isFile()).toBe(true);
    expect((await fsp.stat(olderChild)).isFile()).toBe(true);
  });

  it("会话目录不存在时两个列表仍返回空数组", async () => {
    const sessionDir = await makeAgentDir();
    await fsp.rm(path.dirname(sessionDir), { recursive: true });

    expect(await listSessions(CWD)).toEqual([]);
    expect(await listAllSessions()).toEqual([]);
  });
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
      `${message("m1", "2026-10-26T10:00:00.000Z", "追加")}\n${message("m2", "2026-10-26T10:00:00.000Z", "追加后的用户提示", "user")}\n${nameEntry("追加后", "2026-10-26T10:01:00.000Z")}\n`,
      "utf8",
    );
    const second = await listAllSessions();

    expect(second[0].updatedAt).toBe(Date.parse("2026-10-26T10:00:00.000Z"));
    expect(second[0].sessionName).toBe("追加后");
    expect(second[0].firstUserMessage).toBeNull();
    expect(second[0].latestUserMessage).toBe("追加后的用户提示");
  });
});

describe("getSessionMeta configuration", () => {
  it("缓存命中与无配置追加保留旧值，独立增量变更只覆盖对应字段", async () => {
    const sessionDir = await makeAgentDir();
    const file = await writeSession(sessionDir, "config.jsonl", [
      header("config"),
      JSON.stringify({ type: "model_change", modelId: "saved-model" }),
      JSON.stringify({ type: "thinking_level_change", thinkingLevel: "medium" }),
    ]);
    await listAllSessions();
    const initial = await getSessionMeta(file);
    expect(initial.configuration).toEqual({ modelLabel: "saved-model", thinkingLevel: "medium" });
    expect(await getSessionMeta(file)).toBe(initial);

    await fsp.appendFile(
      file,
      `${JSON.stringify({ type: "thinking_level_change", thinkingLevel: "xhigh" })}\n`,
    );
    expect((await getSessionMeta(file)).configuration).toEqual({
      modelLabel: "saved-model",
      thinkingLevel: "xhigh",
    });

    await fsp.appendFile(
      file,
      `${nameEntry("renamed", "2026-10-26T10:01:00.000Z")}\n{"type":"model_change","modelId":false}\n{"type":"thinking_level_change","thinkingLevel":"invalid"}\nmalformed\n`,
    );
    expect((await getSessionMeta(file)).configuration).toEqual({
      modelLabel: "saved-model",
      thinkingLevel: "xhigh",
    });

    await fsp.appendFile(
      file,
      `${JSON.stringify({ type: "model_change", modelId: "new-model" })}\n`,
    );
    expect((await getSessionMeta(file)).configuration).toEqual({
      modelLabel: "new-model",
      thinkingLevel: "xhigh",
    });
  });

  it("截断与缓存失效后重读清除旧配置", async () => {
    const sessionDir = await makeAgentDir();
    const file = await writeSession(sessionDir, "truncate.jsonl", [
      header("config"),
      JSON.stringify({ type: "model_change", modelId: "saved" }),
      JSON.stringify({ type: "thinking_level_change", thinkingLevel: "high" }),
    ]);
    expect((await getSessionMeta(file)).configuration).toEqual({
      modelLabel: "saved",
      thinkingLevel: "high",
    });
    await fsp.writeFile(file, `${header("config")}\n`);
    expect((await getSessionMeta(file)).configuration).toEqual({});
    await fsp.appendFile(file, '{"type":"model_change","modelId":"current"}\n');
    expect((await getSessionMeta(file)).configuration).toEqual({ modelLabel: "current" });
    await fsp.writeFile(file, `${header("replacement")}\n`);
    invalidateSessionMeta(file);
    expect((await getSessionMeta(file)).configuration).toEqual({});
    await fsp.rm(file);
    expect((await getSessionMeta(file)).configuration).toEqual({});
  });

  it("同大小文件重写时清除原思考档位", async () => {
    const sessionDir = await makeAgentDir();
    const file = await writeSession(sessionDir, "rewrite.jsonl", [
      header("config"),
      JSON.stringify({ type: "model_change", modelId: "old-model" }),
      JSON.stringify({ type: "thinking_level_change", thinkingLevel: "high" }),
    ]);
    const before = await getSessionMeta(file);
    expect(before.configuration.thinkingLevel).toBe("high");
    const oldText = await fsp.readFile(file, "utf8");
    const newText = `${header("config")}\n${JSON.stringify({ type: "model_change", modelId: "new-model" })}\n`;
    await fsp.writeFile(file, newText.padEnd(Buffer.byteLength(oldText), "\n"));
    const changed = new Date(Date.now() + 2_000);
    await fsp.utimes(file, changed, changed);
    expect((await getSessionMeta(file)).configuration).toEqual({ modelLabel: "new-model" });
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
