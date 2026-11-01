import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mergePreferredModelAuth } from "./piAuth";

/** 芯片选模型要并入 auth.json：只许改 preferredModel，凭据字段一个字节都不能动。 */

let agentDir = "";

function seedAuth(entries: Record<string, unknown>): string {
  const file = path.join(agentDir, "auth.json");
  writeFileSync(file, JSON.stringify(entries, null, 2), "utf8");
  return file;
}

function readAuth(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

beforeEach(() => {
  agentDir = mkdtempSync(path.join(tmpdir(), "pidesk-auth-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
});

afterEach(() => {
  delete process.env.PI_CODING_AGENT_DIR;
  rmSync(agentDir, { recursive: true, force: true });
});

describe("mergePreferredModelAuth", () => {
  it("只并 preferredModel：token / refresh / 未知字段原样保留", () => {
    const file = seedAuth({
      "qoder-cn": { type: "oauth", access: "jt-x", refresh: "pat|a|b|u|m", machineID: "m-1" },
    });
    mergePreferredModelAuth("qoder-cn", "Qwen3.8-Flash");
    expect(readAuth(file)).toEqual({
      "qoder-cn": {
        type: "oauth",
        access: "jt-x",
        refresh: "pat|a|b|u|m",
        machineID: "m-1",
        preferredModel: "Qwen3.8-Flash",
      },
    });
  });

  it("原位覆盖已有值，且不动其它 provider 键", () => {
    const file = seedAuth({
      newapi: { type: "oauth", access: "sk-1", preferredModel: "deepseek-v4.1-flash" },
      "qoder-cn": { type: "oauth", access: "jt-x" },
    });
    mergePreferredModelAuth("newapi", "gpt-6.1-sol");
    expect(readAuth(file)).toEqual({
      newapi: { type: "oauth", access: "sk-1", preferredModel: "gpt-6.1-sol" },
      "qoder-cn": { type: "oauth", access: "jt-x" },
    });
  });

  it("provider 键不存在时不创建条目", () => {
    const file = seedAuth({ newapi: { type: "oauth", access: "sk-1" } });
    mergePreferredModelAuth("deepseek", "deepseek-v4-flash");
    expect(readAuth(file)).toEqual({ newapi: { type: "oauth", access: "sk-1" } });
  });

  it("值未变化时不重写文件", () => {
    const file = seedAuth({ newapi: { type: "oauth", access: "sk-1", preferredModel: "a" } });
    // 只读位：真发生写入会 EPERM 抛出，比 mtime 断言可靠
    chmodSync(file, 0o444);
    expect(() => mergePreferredModelAuth("newapi", "a")).not.toThrow();
    chmodSync(file, 0o644);
    expect(readAuth(file)).toEqual({
      newapi: { type: "oauth", access: "sk-1", preferredModel: "a" },
    });
  });
});
