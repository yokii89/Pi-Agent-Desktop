import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyModelOverridePatch,
  type ModelOverrideUpdate,
  readModelOverrides,
  setModelOverride,
} from "./modelOverrides";

/** docs/design/49：补丁校验与"未知键原样保留"是写盘前的硬约束。 */

function update(patch: ModelOverrideUpdate["patch"]): ModelOverrideUpdate {
  return { provider: "newapi", modelId: "gpt-6.1-sol", patch };
}

/** 取 newapi/gpt-6.1-sol 的覆盖条目（测试断言用）。 */
function entryOf(next: Record<string, unknown>): Record<string, unknown> {
  const providers = next.providers as Record<
    string,
    { modelOverrides: Record<string, Record<string, unknown>> }
  >;
  return providers.newapi.modelOverrides["gpt-6.1-sol"];
}

describe("applyModelOverridePatch", () => {
  it("写入 contextWindow 且不动入参", () => {
    const raw: Record<string, unknown> = { providers: { newapi: {} } };
    const next = applyModelOverridePatch(raw, update({ contextWindow: 128000 }));
    expect(entryOf(next)).toEqual({ contextWindow: 128000 });
    expect(raw).toEqual({ providers: { newapi: {} } });
  });

  it("写入 / 删除 maxTokens，删键后仍保留同类其他键", () => {
    const raw: Record<string, unknown> = {
      providers: { newapi: { modelOverrides: { "gpt-6.1-sol": { contextWindow: 128000 } } } },
    };
    const written = applyModelOverridePatch(raw, update({ maxTokens: 32768 }));
    expect(entryOf(written)).toEqual({ contextWindow: 128000, maxTokens: 32768 });
    const removed = applyModelOverridePatch(written, update({ maxTokens: null }));
    expect(entryOf(removed)).toEqual({ contextWindow: 128000 });
  });

  it("null 删键并逐级清理空对象", () => {
    const raw: Record<string, unknown> = {
      providers: { newapi: { modelOverrides: { "gpt-6.1-sol": { contextWindow: 1 } } } },
    };
    const next = applyModelOverridePatch(raw, update({ contextWindow: null }));
    expect(next).toEqual({});
  });

  it("删除一个键时保留同类其他键与未知键", () => {
    const raw: Record<string, unknown> = {
      providers: {
        newapi: {
          name: "New API",
          modelOverrides: {
            "gpt-6.1-sol": { contextWindow: 1, input: ["text", "image"], compat: { x: 1 } },
          },
        },
      },
    };
    const next = applyModelOverridePatch(raw, update({ contextWindow: null }));
    const provider = (next.providers as Record<string, Record<string, unknown>>).newapi;
    expect(provider.name).toBe("New API");
    expect(provider.modelOverrides).toEqual({
      "gpt-6.1-sol": { input: ["text", "image"], compat: { x: 1 } },
    });
  });

  it("拒绝非法值", () => {
    const badInput = ["text", "audio"] as unknown as ("text" | "image")[];
    expect(() => applyModelOverridePatch({}, update({ contextWindow: 0 }))).toThrow(/正整数/);
    expect(() => applyModelOverridePatch({}, update({ contextWindow: 1.5 }))).toThrow(/正整数/);
    expect(() => applyModelOverridePatch({}, update({ maxTokens: 0 }))).toThrow(/正整数/);
    expect(() => applyModelOverridePatch({}, update({ maxTokens: 1.5 }))).toThrow(/正整数/);
    expect(() => applyModelOverridePatch({}, update({ input: badInput }))).toThrow(/input/);
    expect(() => applyModelOverridePatch({}, update({ input: [] }))).toThrow(/input/);
    expect(() => applyModelOverridePatch({}, update({}))).toThrow(/补丁为空/);
    expect(() =>
      applyModelOverridePatch({}, { provider: " ", modelId: "x", patch: { contextWindow: 1 } }),
    ).toThrow(/不能为空/);
  });

  it("input 三态：['text']（不支持）/ 支持 / 删键", () => {
    const textOnly = applyModelOverridePatch({}, update({ input: ["text"] }));
    expect(entryOf(textOnly).input).toEqual(["text"]);
    const supported = applyModelOverridePatch({}, update({ input: ["text", "image"] }));
    expect(entryOf(supported).input).toEqual(["text", "image"]);
    const removed = applyModelOverridePatch(supported, update({ input: null }));
    expect(removed).toEqual({});
  });

  it("thinkingLevels：只选关闭 = reasoning false；5 档写 xhigh/max null", () => {
    const off = applyModelOverridePatch({}, update({ thinkingLevels: ["off"] }));
    expect(entryOf(off)).toEqual({ reasoning: false });

    const five = applyModelOverridePatch(
      {},
      update({ thinkingLevels: ["off", "minimal", "low", "medium", "high"] }),
    );
    expect(entryOf(five)).toEqual({
      reasoning: true,
      thinkingLevelMap: { xhigh: null, max: null },
    });
  });

  it("thinkingLevels：任意子集只写非默认档位与 xhigh/max 的带值映射", () => {
    const next = applyModelOverridePatch({}, update({ thinkingLevels: ["low", "high", "max"] }));
    expect(entryOf(next)).toEqual({
      reasoning: true,
      thinkingLevelMap: {
        off: null,
        minimal: null,
        medium: null,
        xhigh: null,
        max: "max",
      },
    });
  });

  it("thinkingLevels：保留已有 provider 映射值与未知键，未选中档位置 null", () => {
    const raw: Record<string, unknown> = {
      providers: {
        newapi: {
          modelOverrides: {
            "gpt-6.1-sol": {
              reasoning: true,
              thinkingLevelMap: {
                off: "none",
                minimal: null,
                low: "low-custom",
                high: "high-custom",
                max: "max-custom",
              },
              compat: { supportsReasoningEffort: false },
            },
          },
        },
      },
    };
    const next = applyModelOverridePatch(raw, update({ thinkingLevels: ["off", "low", "high"] }));
    expect(entryOf(next)).toEqual({
      reasoning: true,
      thinkingLevelMap: {
        off: "none",
        minimal: null,
        low: "low-custom",
        medium: null,
        high: "high-custom",
        xhigh: null,
        max: null,
      },
      compat: { supportsReasoningEffort: false },
    });
  });

  it("thinkingLevels：null 删两键并保留其他字段；非法集合拒绝", () => {
    const raw: Record<string, unknown> = {
      providers: {
        newapi: {
          modelOverrides: {
            "gpt-6.1-sol": {
              reasoning: true,
              thinkingLevelMap: { max: "max" },
              contextWindow: 128000,
              compat: { x: 1 },
            },
          },
        },
      },
    };
    const reset = applyModelOverridePatch(raw, update({ thinkingLevels: null }));
    expect(entryOf(reset)).toEqual({ contextWindow: 128000, compat: { x: 1 } });

    expect(() => applyModelOverridePatch({}, update({ thinkingLevels: [] }))).toThrow(/思考档位/);
    expect(() => applyModelOverridePatch({}, update({ thinkingLevels: ["off", "off"] }))).toThrow(
      /重复/,
    );
    expect(() =>
      applyModelOverridePatch({}, update({ thinkingLevels: ["ultra" as unknown as "max"] })),
    ).toThrow(/思考档位/);
  });
});

describe("setModelOverride / readModelOverrides（真实文件往返）", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function makeFile(content: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), "pidesk-models-"));
    dirs.push(dir);
    const file = join(dir, "models.json");
    writeFileSync(file, JSON.stringify(content, null, 2), "utf8");
    return file;
  }

  it("写盘只动目标字段：未知键、其他 provider、其他模型全部保留", () => {
    const file = makeFile({
      $schema: "keep-me",
      providers: {
        newapi: {
          modelOverrides: {
            "deepseek-v4.1-flash": { input: ["text", "image"], maxTokens: 32768 },
            "gpt-6.1-sol": { compat: { supportsReasoningEffort: false } },
          },
        },
        deepseek: { apiKey: "keep" },
      },
    });
    setModelOverride(update({ contextWindow: 262144 }), file);
    const written = JSON.parse(readFileSync(file, "utf8"));
    expect(written.$schema).toBe("keep-me");
    expect(written.providers.deepseek).toEqual({ apiKey: "keep" });
    expect(written.providers.newapi.modelOverrides["deepseek-v4.1-flash"]).toEqual({
      input: ["text", "image"],
      maxTokens: 32768,
    });
    expect(written.providers.newapi.modelOverrides["gpt-6.1-sol"]).toEqual({
      compat: { supportsReasoningEffort: false },
      contextWindow: 262144,
    });
  });

  it("快照投影暴露管理字段（含思考）；非法值按未设置处理", () => {
    const file = makeFile({
      providers: {
        newapi: {
          modelOverrides: {
            a: { contextWindow: 131072, maxTokens: 32768, input: ["text", "image"] },
            b: { contextWindow: -5, maxTokens: 0, input: ["junk"] },
            c: { compat: { x: 1 } },
            d: { reasoning: false },
            e: { thinkingLevelMap: { off: null, max: "max", junk: 1 } },
            f: { reasoning: "yes", thinkingLevelMap: { max: 42 } },
          },
        },
      },
    });
    expect(readModelOverrides(file)).toEqual({
      newapi: {
        a: { contextWindow: 131072, maxTokens: 32768, input: ["text", "image"] },
        d: { reasoning: false },
        e: { thinkingLevelMap: { off: null, max: "max" } },
      },
    });
  });

  it("文件缺失时按空骨架读取；解析失败时抛错且不覆盖原文件", () => {
    const dir = mkdtempSync(join(tmpdir(), "pidesk-models-"));
    dirs.push(dir);
    const missing = join(dir, "models.json");
    expect(readModelOverrides(missing)).toEqual({});

    writeFileSync(missing, "{ not json", "utf8");
    expect(() => readModelOverrides(missing)).toThrow(/解析失败/);
    expect(() => setModelOverride(update({ contextWindow: 1 }), missing)).toThrow(/解析失败/);
    expect(readFileSync(missing, "utf8")).toBe("{ not json");
  });
});
