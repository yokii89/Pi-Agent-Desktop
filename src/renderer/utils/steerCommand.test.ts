import { describe, expect, it } from "vitest";
import { parseSteerCommand } from "./steerCommand";

describe("parseSteerCommand (docs/design/73)", () => {
  it("passes normal text through", () => {
    expect(parseSteerCommand("帮我补测试")).toEqual({ steer: false, text: "帮我补测试" });
  });

  it("strips the command and its leading whitespace", () => {
    expect(parseSteerCommand("/steer 先别改样式")).toEqual({ steer: true, text: "先别改样式" });
    expect(parseSteerCommand("/steer\n先别改样式")).toEqual({ steer: true, text: "先别改样式" });
    expect(parseSteerCommand("  /steer 先别改样式")).toEqual({ steer: true, text: "先别改样式" });
  });

  it("is case-insensitive and allows an empty body", () => {
    expect(parseSteerCommand("/STEER 改方向")).toEqual({ steer: true, text: "改方向" });
    expect(parseSteerCommand("/steer")).toEqual({ steer: true, text: "" });
    expect(parseSteerCommand("/steer   ")).toEqual({ steer: true, text: "" });
  });

  it("does not hijack longer slash commands", () => {
    expect(parseSteerCommand("/steering 说明")).toEqual({
      steer: false,
      text: "/steering 说明",
    });
    expect(parseSteerCommand("/skill:steer")).toEqual({ steer: false, text: "/skill:steer" });
  });
});
