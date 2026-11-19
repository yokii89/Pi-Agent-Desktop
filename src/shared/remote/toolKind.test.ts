import { describe, expect, it } from "vitest";
import { classifyRemoteTool, isRemoteToolKind, REMOTE_TOOL_KINDS } from "./toolKind";

describe("remote tool presentation metadata", () => {
  it("classifies tools using the desktop session glyph categories", () => {
    for (const [name, kind] of [
      ["bash", "terminal"],
      [" tool_execution_inspect_output ", "terminal"],
      ["read", "read"],
      ["write", "write"],
      ["apply_patch", "edit"],
      ["rg", "search"],
      ["git_diff", "diff"],
      ["mcp__server__tool", "mcp"],
      ["unknown_tool", "generic"],
    ] as const) {
      expect(classifyRemoteTool(name)).toBe(kind);
    }
  });

  it("accepts only the finite public category set", () => {
    expect(REMOTE_TOOL_KINDS).toHaveLength(8);
    for (const kind of REMOTE_TOOL_KINDS) expect(isRemoteToolKind(kind)).toBe(true);
    expect(isRemoteToolKind("mcp__server__tool")).toBe(false);
    expect(isRemoteToolKind({ kind: "read" })).toBe(false);
  });
});
