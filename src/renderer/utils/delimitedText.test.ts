import { describe, expect, it } from "vitest";
import { delimiterForPath, parseDelimitedText } from "./delimitedText";

describe("parseDelimitedText", () => {
  it("handles quoted separators, escaped quotes and multiline cells", () => {
    expect(parseDelimitedText('name,note\nAlice,"a,b"\nBob,"say ""hi"""\n', ",").rows).toEqual([
      ["name", "note"],
      ["Alice", "a,b"],
      ["Bob", 'say "hi"'],
    ]);
  });

  it("supports TSV and ignores CRLF carriage returns", () => {
    expect(parseDelimitedText("a\tb\r\n1\t2\r\n", "\t").rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("caps rows and columns and stops after the display limit", () => {
    const content = `${Array.from({ length: 60 }, (_, index) => `c${index}`).join(",")}\n${Array.from(
      { length: 250 },
      (_, index) => `${index},value`,
    ).join("\n")}`;
    const result = parseDelimitedText(content, ",");
    expect(result.rows).toHaveLength(201);
    expect(result.rows[0]).toHaveLength(40);
    expect(result.truncated).toBe(true);
  });

  it("does not mark a file truncated when it ends exactly at the row cap", () => {
    const content = Array.from({ length: 201 }, (_, index) => `${index},value`).join("\n");
    expect(parseDelimitedText(content, ",").truncated).toBe(false);
  });
});

describe("delimiterForPath", () => {
  it("uses tab only for tsv", () => {
    expect(delimiterForPath("data.TSV")).toBe("\t");
    expect(delimiterForPath("data.csv")).toBe(",");
  });
});
