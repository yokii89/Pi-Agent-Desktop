import { describe, expect, it } from "vitest";
import {
  imageCapabilityFromInput,
  imageCapabilityHint,
  imageCapabilityToast,
} from "./imageCapability";

describe("imageCapabilityFromInput", () => {
  it("maps catalog input to three states", () => {
    expect(imageCapabilityFromInput(["text", "image"])).toBe("supported");
    expect(imageCapabilityFromInput(["image"])).toBe("supported");
    expect(imageCapabilityFromInput(["text"])).toBe("declared-no");
    expect(imageCapabilityFromInput(null)).toBe("unknown");
    expect(imageCapabilityFromInput(undefined)).toBe("unknown");
    expect(imageCapabilityFromInput([])).toBe("unknown");
    expect(imageCapabilityFromInput(["audio" as never])).toBe("unknown");
  });
});

describe("hints", () => {
  it("only declared-no produces a soft hint", () => {
    expect(imageCapabilityHint("supported")).toBeNull();
    expect(imageCapabilityHint("unknown")).toBeNull();
    expect(imageCapabilityHint("declared-no")).toBe("模型目录未声明支持图片");
    expect(imageCapabilityToast("declared-no")).toContain("若失败可换");
    expect(imageCapabilityToast("supported")).toBeNull();
    expect(imageCapabilityToast("unknown")).toBeNull();
  });
});
