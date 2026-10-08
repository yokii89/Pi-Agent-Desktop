import { describe, expect, it } from "vitest";
import type { McpServerEntry } from "../../shared/ipc";
import { mergeServerEntry, validateServerEntry } from "./mcpConfig";

/** mcp.json 条目校验与合并的纯函数直测（读写盘函数不在此覆盖）。 */
describe("validateServerEntry", () => {
  it("接受最小 stdio 条目并归一化 type", () => {
    const entry = validateServerEntry("fs", { command: "npx" });
    expect(entry.command).toBe("npx");
    expect(entry.type).toBe("stdio");
    expect(entry.exposure).toBeUndefined();
  });

  it("拒绝非法 server 名", () => {
    expect(() => validateServerEntry("bad name", { command: "npx" })).toThrow(/不合法/);
    expect(() => validateServerEntry("", { command: "npx" })).toThrow(/不合法/);
  });

  it("exposure 别名 codemode-deferred 归一化为 codemode，非法值报错", () => {
    const aliased = validateServerEntry("a", {
      command: "x",
      exposure: "codemode-deferred",
    } as unknown as McpServerEntry);
    expect(aliased.exposure).toBe("codemode");
    expect(() =>
      validateServerEntry("a", { command: "x", exposure: "bogus" } as unknown as McpServerEntry),
    ).toThrow(/exposure/);
  });

  it("接受 http 条目并校验 url / headers", () => {
    const entry = validateServerEntry("sentry", { url: "https://mcp.sentry.dev/mcp" });
    expect(entry.type).toBe("http");
    expect(() => validateServerEntry("sentry", { url: "ftp://x", type: "http" })).toThrow(/url/);
    // 非 URL 字符串：new URL 抛 TypeError，需转成友好报错而非裸 "Invalid URL"
    expect(() => validateServerEntry("sentry", { url: "not a url" })).toThrow(/url 必须是/);
    expect(() =>
      validateServerEntry("sentry", { url: "https://x", headers: { a: 1 } as never }),
    ).toThrow(/headers/);
  });

  it("拒绝 sse 类型；url 与 command 缺失时报错", () => {
    expect(() =>
      validateServerEntry("a", { type: "sse", url: "https://x/sse" } as unknown as McpServerEntry),
    ).toThrow(/SSE/);
    expect(() => validateServerEntry("a", { description: "only" })).toThrow(/command/);
  });

  it("校验 stdio 字段类型", () => {
    expect(() => validateServerEntry("a", { command: "x", args: ["ok", 2] as never })).toThrow(
      /args/,
    );
    expect(() => validateServerEntry("a", { command: "x", env: { K: 1 } as never })).toThrow(/env/);
    expect(() => validateServerEntry("a", { command: "x", timeout: 0 })).toThrow(/timeout/);
    expect(() => validateServerEntry("a", { command: "x", enabled: "yes" as never })).toThrow(
      /enabled/,
    );
  });

  it("校验 oauth 基础字段", () => {
    expect(() =>
      validateServerEntry("a", { url: "https://x", oauth: { callbackPort: 99999 } }),
    ).toThrow(/callbackPort/);
    expect(() =>
      validateServerEntry("a", { url: "https://x", oauth: { clientName: " " } }),
    ).toThrow(/clientName/);
    expect(
      validateServerEntry("a", { url: "https://x", oauth: { callbackPort: 8765 } }).oauth
        ?.callbackPort,
    ).toBe(8765);
  });
});

describe("mergeServerEntry", () => {
  it("保留 PiDesk 未建模的原始键（toolExposure / auth / 未知键）", () => {
    const raw = {
      command: "npx",
      toolExposure: { search_code: "direct" },
      auth: { provider: "anthropic" },
      customKey: "keep-me",
    };
    const merged = mergeServerEntry(raw, { command: "npx", enabled: false }) as Record<
      string,
      unknown
    >;
    expect(merged.toolExposure).toEqual({ search_code: "direct" });
    expect(merged.auth).toEqual({ provider: "anthropic" });
    expect(merged.customKey).toBe("keep-me");
    expect(merged.enabled).toBe(false);
  });

  it("托管字段以表单为准：表单省略即删除", () => {
    const raw = { command: "npx", args: ["-y", "pkg"], env: { K: "V" } };
    const merged = mergeServerEntry(raw, { command: "node" }) as Record<string, unknown>;
    expect(merged.command).toBe("node");
    expect(merged.args).toBeUndefined();
    expect(merged.env).toBeUndefined();
  });

  it("oauth 一层合并：保留 cimd 等未托管键，空 oauth 删除托管键", () => {
    const raw = { url: "https://x", oauth: { clientRegistration: "cimd", scope: "a b" } };
    const merged = mergeServerEntry(raw, {
      url: "https://x",
      oauth: { clientId: "id" },
    }) as Record<string, unknown>;
    expect(merged.oauth).toEqual({ clientRegistration: "cimd", scope: "a b", clientId: "id" });

    const stripped = mergeServerEntry(
      { url: "https://x", oauth: { clientId: "id", scope: "a" } },
      { url: "https://x" },
    ) as Record<string, unknown>;
    expect(stripped.oauth).toBeUndefined();
  });

  it("raw 为非对象（mcp.json 里的坏条目）时按全新条目合并", () => {
    const merged = mergeServerEntry("garbage", { command: "npx", enabled: true }) as Record<
      string,
      unknown
    >;
    expect(merged).toEqual({ command: "npx", enabled: true });
  });
});
