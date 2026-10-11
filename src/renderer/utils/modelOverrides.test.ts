import { describe, expect, it } from "vitest";
import type { PiModelOption, PiModelOverridesSnapshot } from "../../shared/ipc";
import {
  buildModelOverrideRows,
  filterModelOverrideRows,
  formatModelWindow,
} from "./modelOverrides";

/** docs/design/49 起、docs/design/50 改版：行排序（已修改 → 默认 → 原序）、三档过滤与窗口格式化。 */

function model(modelId: string, extra: Partial<PiModelOption> = {}): PiModelOption {
  return { provider: "newapi", modelId, label: modelId, ...extra };
}

describe("buildModelOverrideRows", () => {
  it("已修改置顶、当前默认其次、其余保持清单原序", () => {
    const models = [model("a"), model("b"), model("c"), model("d")];
    const overrides: PiModelOverridesSnapshot = { newapi: { c: { contextWindow: 131072 } } };
    const rows = buildModelOverrideRows(models, overrides, "newapi/b");
    expect(rows.map((r) => r.modelId)).toEqual(["c", "b", "a", "d"]);
    expect(rows[0].hasOverride).toBe(true);
    expect(rows[0].overrideWindow).toBe(131072);
    expect(rows[0].isDefault).toBe(false);
    expect(rows[1].isDefault).toBe(true);
    expect(rows[1].hasOverride).toBe(false);
  });

  it("带上当前生效值（含覆盖后的窗口与模态）", () => {
    const rows = buildModelOverrideRows(
      [model("x", { contextWindow: 262144, input: ["text", "image"] })],
      {},
      null,
    );
    expect(rows[0].effectiveWindow).toBe(262144);
    expect(rows[0].effectiveInput).toEqual(["text", "image"]);
    expect(rows[0].hasOverride).toBe(false);
  });
});

describe("filterModelOverrideRows", () => {
  const rows = buildModelOverrideRows(
    [
      model("deepseek-v4.1-flash", { input: ["text"] }),
      model("gpt-6.1-sol", { input: ["text", "image"] }),
      model("claude-fable-5", { input: ["text"] }),
      model("kimi-k2", { input: ["text", "image"] }),
    ],
    { newapi: { "gpt-6.1-sol": { input: ["text", "image"] } } },
    "newapi/kimi-k2",
  );

  it("查询按 id/label 子串匹配（大小写不敏感）", () => {
    expect(filterModelOverrideRows(rows, "CLAUDE", "all").map((r) => r.modelId)).toEqual([
      "claude-fable-5",
    ]);
    expect(filterModelOverrideRows(rows, "  ", "all")).toHaveLength(4);
  });

  it("modified 档只留已修改的行", () => {
    expect(filterModelOverrideRows(rows, "", "modified").map((r) => r.modelId)).toEqual([
      "gpt-6.1-sol",
    ]);
  });

  it("review 档=默认被判纯文本且未修改；已改过或生效模态未知的都不算", () => {
    expect(filterModelOverrideRows(rows, "", "review").map((r) => r.modelId)).toEqual([
      "deepseek-v4.1-flash",
      "claude-fable-5",
    ]);
    // 生效模态缺失（老 pi 未回传 input）时不能提示用户去确认
    const unknown = buildModelOverrideRows([model("mystery")], {}, null);
    expect(filterModelOverrideRows(unknown, "", "review")).toEqual([]);
    // 自己改成纯文本的行是"已决定"，不再算待确认
    const chosen = buildModelOverrideRows(
      [model("chosen", { input: ["text"] })],
      { newapi: { chosen: { input: ["text"] } } },
      null,
    );
    expect(filterModelOverrideRows(chosen, "", "review")).toEqual([]);
  });

  it("两档过滤与查询叠加", () => {
    expect(filterModelOverrideRows(rows, "fable", "review").map((r) => r.modelId)).toEqual([
      "claude-fable-5",
    ]);
    expect(filterModelOverrideRows(rows, "kimi", "modified")).toEqual([]);
  });
});

describe("formatModelWindow", () => {
  it("M / k / 未知", () => {
    expect(formatModelWindow(1_000_000)).toBe("1M");
    expect(formatModelWindow(1_500_000)).toBe("1.5M");
    expect(formatModelWindow(131072)).toBe("131k");
    expect(formatModelWindow(200000)).toBe("200k");
    expect(formatModelWindow(undefined)).toBe("—");
    expect(formatModelWindow(0)).toBe("—");
  });
});
