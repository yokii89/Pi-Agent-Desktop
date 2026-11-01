/**
 * rendezvous 文件的「按实例命名 + 陈旧回收」（docs/design/15 P0-1 的多实例补充）。
 *
 * 回归场景：dev 实例与安装包实例同时运行时共用固定名文件，后启动者把先启动者的
 * 会话引到自己的 pipe 上，扩展侧 `connect EPERM` → 静默回落 → `ask_user_question`
 * 的桌面问卷再也出不来。
 *
 * 只 mock 掉 viewHost 的三个 Electron 耦合点，本文件不启动真 Host。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../settings/settings", () => ({ getSettings: () => ({}) }));
vi.mock("../notification/toastService", () => ({ showSystemToast: () => true }));
vi.mock("../window/createMainWindow", () => ({ getMainWindow: () => null }));

import { getViewHostRendezvousPath, pruneStaleRendezvous } from "./viewHost";

const dirs: string[] = [];

function tmpDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `pidesk-rdv-test-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  dirs.push(dir);
  return dir;
}

function write(file: string, payload: unknown): void {
  fs.writeFileSync(file, typeof payload === "string" ? payload : JSON.stringify(payload), "utf8");
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // 测试目录清理失败不影响断言
    }
  }
});

describe("getViewHostRendezvousPath（按实例命名）", () => {
  it("路径带本实例 pid，多开不再互相覆盖", () => {
    expect(path.basename(getViewHostRendezvousPath())).toBe(`pidesk-view-host-${process.pid}.json`);
  });

  it("不再使用旧版固定名", () => {
    expect(getViewHostRendezvousPath()).not.toContain("pidesk-view-host.json");
  });
});

describe("pruneStaleRendezvous（按 pid 存活回收）", () => {
  it("只删 pid 已不存在的文件，保留活实例与无关文件", () => {
    const dir = tmpDir();
    const dead = path.join(dir, "pidesk-view-host-999999999.json");
    const mine = path.join(dir, `pidesk-view-host-${process.pid}.json`);
    const legacyDead = path.join(dir, "pidesk-view-host.json");
    const unrelated = path.join(dir, "pidesk-view-host-notes.txt");

    write(dead, { endpoint: "x", token: "t", protocol: "view/v1", pid: 999999999 });
    write(mine, { endpoint: "x", token: "t", protocol: "view/v1", pid: process.pid });
    write(legacyDead, { endpoint: "x", token: "t", protocol: "view/v1", pid: 999999998 });
    write(unrelated, "not a rendezvous");

    expect(pruneStaleRendezvous(dir)).toBe(2);
    expect(fs.existsSync(dead)).toBe(false);
    expect(fs.existsSync(legacyDead)).toBe(false);
    expect(fs.existsSync(mine)).toBe(true);
    expect(fs.existsSync(unrelated)).toBe(true);
  });

  it("解析不出 pid 的文件：新的留着，超过窗口的才删", () => {
    const dir = tmpDir();
    const fresh = path.join(dir, "pidesk-view-host-111.json");
    const old = path.join(dir, "pidesk-view-host-222.json");
    write(fresh, "{ half-written");
    write(old, "{ half-written");
    const past = new Date(Date.now() - 5 * 60_000);
    fs.utimesSync(old, past, past);

    expect(pruneStaleRendezvous(dir)).toBe(1);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(old)).toBe(false);
  });

  it("目录不可读时静默返回 0", () => {
    expect(pruneStaleRendezvous(path.join(tmpDir(), "nope"))).toBe(0);
  });
});
