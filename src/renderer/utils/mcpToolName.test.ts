import { describe, expect, it } from "vitest";
import { parseMcpToolName } from "./mcpToolName";

describe("parseMcpToolName", () => {
  it("解析标准全名", () => {
    expect(parseMcpToolName("mcp__filesystem__read_file")).toEqual({
      server: "filesystem",
      tool: "read_file",
    });
  });

  it("server 名的 - 已被 pi 归一为 _，原样返回", () => {
    expect(parseMcpToolName("mcp__my_server__list_files")).toEqual({
      server: "my_server",
      tool: "list_files",
    });
  });

  it("tool 名内部含 __ 时整体归 tool，不按固定段数切", () => {
    expect(parseMcpToolName("mcp__server__my__tool")).toEqual({
      server: "server",
      tool: "my__tool",
    });
  });

  it("非 mcp__ 前缀返回 null", () => {
    expect(parseMcpToolName("read")).toBeNull();
    expect(parseMcpToolName("bash")).toBeNull();
  });

  it("server 段或 tool 段为空返回 null", () => {
    expect(parseMcpToolName("mcp____tool")).toBeNull();
    expect(parseMcpToolName("mcp__server__")).toBeNull();
    expect(parseMcpToolName("mcp__")).toBeNull();
  });
});
