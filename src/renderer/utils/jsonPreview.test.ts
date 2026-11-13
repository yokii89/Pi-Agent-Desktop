import { describe, expect, it } from "vitest";
import { formatJsonPreview } from "./jsonPreview";

describe("formatJsonPreview", () => {
  it("expands compact JSON-family files", () => {
    expect(formatJsonPreview("settings.json", '{"a":1,"nested":{"b":true}}', false)).toBe(
      '{\n  "a": 1,\n  "nested": {\n    "b": true\n  }\n}',
    );
    expect(formatJsonPreview("settings.jsonc", '{/* comment */"a":1}', false)).toBe(
      '{\n  "a": 1\n}',
    );
    expect(formatJsonPreview("settings.json5", "{a: 'one', list: [1, 2,],}", false)).toBe(
      "{\n  a: 'one',\n  list: [\n    1,\n    2,\n  ],\n}",
    );
  });

  it("preserves multiline, invalid, truncated, and non-JSON content", () => {
    expect(formatJsonPreview("a.json", '{\n"a":1}', false)).toBe('{\n"a":1}');
    expect(formatJsonPreview("a.json", "{broken", false)).toBe("{broken");
    expect(formatJsonPreview("a.json", '{"a":1}', true)).toBe('{"a":1}');
    expect(formatJsonPreview("a.jsonl", '{"a":1}', false)).toBe('{"a":1}');
  });
});
