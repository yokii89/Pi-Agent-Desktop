import { describe, expect, it } from "vitest";
import { MAX_WRITE_BYTES, planTextSave, type TextSaveInput } from "./saveText";

function base(overrides: Partial<TextSaveInput> = {}): TextSaveInput {
  return {
    diskMtimeMs: 1_700_000_000_000,
    expectedMtimeMs: 1_700_000_000_000,
    force: false,
    byteLength: 12,
    ...overrides,
  };
}

describe("planTextSave", () => {
  it("mtime 一致 → 写入", () => {
    expect(planTextSave(base())).toEqual({ status: "write" });
  });

  it("mtime 不一致 → 冲突，并回报磁盘现状", () => {
    expect(planTextSave(base({ diskMtimeMs: 1_700_000_000_123 }))).toEqual({
      status: "conflict",
      mtimeMs: 1_700_000_000_123,
    });
  });

  it("mtime 只差小数位不算冲突", () => {
    expect(planTextSave(base({ diskMtimeMs: 1_700_000_000_000.4 }))).toEqual({ status: "write" });
  });

  it("force 跳过 mtime 校验（用户已确认覆盖）", () => {
    expect(planTextSave(base({ diskMtimeMs: 1_700_000_000_999, force: true }))).toEqual({
      status: "write",
    });
  });

  it("没有合法基线时不拦（退化到直接覆盖）", () => {
    expect(planTextSave(base({ expectedMtimeMs: Number.NaN }))).toEqual({ status: "write" });
  });

  it("超过体量上限抛出可读错误", () => {
    expect(() => planTextSave(base({ byteLength: MAX_WRITE_BYTES + 1 }))).toThrow(/不支持保存/);
  });

  it("非法字节数抛出", () => {
    expect(() => planTextSave(base({ byteLength: Number.NaN }))).toThrow(/内容无效/);
  });
});
