/**
 * 端到端闭环（docs/design/123 验收）：真起一个「假 pi」子进程，验证
 * stdout 上的 `extension_ui_request` → 渲染层推送 → 渲染层作答 → stdin 上的
 * `extension_ui_response` 全链路走通。
 *
 * 这一步是根因 2 的实质修复点：以前这条记录进来会被事件白名单丢掉，pi 侧工具永挂。
 * 只 mock 掉 Electron 与旁路依赖，子进程与 JSONL 收发都是真的。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const bag = vi.hoisted(() => ({
  pushes: [] as Array<{ channel: string; message: Record<string, unknown> }>,
  outFile: "",
  script: [
    "const fs = require('node:fs');",
    "const out = process.argv[1];",
    "fs.appendFileSync(out, 'ready\\n');",
    "process.stdout.write(JSON.stringify({",
    "  type: 'extension_ui_request', id: 'r1', method: 'select',",
    "  title: '选一个', options: ['a', 'b'],",
    "}) + '\\n');",
    "process.stdin.on('data', (chunk) => {",
    "  for (const line of String(chunk).split('\\n')) {",
    "    if (line.trim()) fs.appendFileSync(out, line + '\\n');",
    "  }",
    "});",
  ].join("\n"),
}));

vi.mock("../window/createMainWindow", () => ({
  getMainWindow: () => ({
    webContents: {
      send: (channel: string, message: Record<string, unknown>) => {
        bag.pushes.push({ channel, message });
      },
    },
  }),
}));
vi.mock("../settings/settings", () => ({ getSettings: () => ({}) }));
vi.mock("../view/viewHost", () => ({
  ensureViewHost: async () => null,
  closeSessionViews: () => {},
  retainSessionViews: () => {},
  getViewHostRendezvousPath: () => "",
}));
vi.mock("../extension/contributionCatalog", () => ({
  getCatalogSnapshot: () => ({ entries: [] }),
}));
vi.mock("./piLauncher", () => ({
  resolvePiCommand: () => ({ file: process.execPath, args: ["-e", bag.script, bag.outFile] }),
}));

import { disposeSession, respondSessionUi, startSession } from "./piSession";

/** 轮询等待（真定时器：子进程 IO 不受 fake timers 驱动）。 */
async function waitFor<T>(read: () => T | null | undefined, timeoutMs = 8000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("等待超时");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function uiPushes(type: string): Record<string, unknown>[] {
  return bag.pushes
    .filter((p) => p.message.type === type && p.message.sessionId)
    .map((p) => p.message);
}

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pidesk-extui-"));
  bag.outFile = path.join(dir, "stdin.log");
});

afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // 测试目录清理失败不影响结论
  }
});

describe("extension_ui_request 端到端（docs/design/123）", () => {
  it("stdout 请求 → 渲染层推送 → 作答写回 stdin", async () => {
    const sessionId = await startSession({ cwd: dir });

    const pushed = await waitFor(() => uiPushes("request")[0] ?? null);
    expect(pushed).toMatchObject({
      sessionId,
      type: "request",
      id: "r1",
      payload: { method: "select", title: "选一个", options: ["a", "b"] },
    });

    expect(respondSessionUi(sessionId, "r1", { value: "b" })).toBe(true);

    const line = await waitFor(() =>
      fs
        .readFileSync(bag.outFile, "utf8")
        .split("\n")
        .find((l) => l.includes("extension_ui_response")),
    );
    expect(JSON.parse(line)).toEqual({ type: "extension_ui_response", id: "r1", value: "b" });

    // 应答成功后撤窗通知
    const settled = await waitFor(() => uiPushes("settled")[0] ?? null);
    expect(settled).toMatchObject({ sessionId, id: "r1", payload: { reason: "answered" } });

    // 重复应答不再写回
    expect(respondSessionUi(sessionId, "r1", { value: "a" })).toBe(false);

    disposeSession(sessionId);
  }, 20000);
});
