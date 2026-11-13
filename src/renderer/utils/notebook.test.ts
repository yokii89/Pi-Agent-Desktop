import { describe, expect, it } from "vitest";
import { parseNotebook } from "./notebook";

describe("parseNotebook", () => {
  it("normalizes source arrays, text output and PNG output", () => {
    const result = parseNotebook(
      JSON.stringify({
        metadata: { language_info: { name: "python" } },
        cells: [
          {
            cell_type: "code",
            source: ["print(1)", "\n"],
            execution_count: 2,
            outputs: [
              { output_type: "stream", text: ["1", "\n"] },
              {
                output_type: "display_data",
                data: { "image/png": "YWJj", "text/html": "<script>bad</script>" },
              },
            ],
          },
        ],
      }),
    );
    expect(result).toEqual({
      cells: [
        {
          type: "code",
          source: "print(1)\n",
          language: "python",
          executionCount: 2,
          outputs: [
            { text: "1\n", imageDataUrl: null, truncated: false },
            { text: null, imageDataUrl: "data:image/png;base64,YWJj", truncated: false },
          ],
        },
      ],
      truncated: false,
    });
  });

  it("rejects non-notebook JSON", () => {
    expect(parseNotebook('{"hello":true}')).toBeNull();
    expect(parseNotebook("bad json")).toBeNull();
  });

  it("caps rendered notebook cells", () => {
    const cells = Array.from({ length: 70 }, () => ({ cell_type: "raw", source: "x" }));
    const result = parseNotebook(JSON.stringify({ cells }));
    expect(result?.cells).toHaveLength(50);
    expect(result?.truncated).toBe(true);
  });

  it("caps output count and long output text", () => {
    const outputs = Array.from({ length: 7 }, () => ({ text: "x".repeat(25_000) }));
    const result = parseNotebook(JSON.stringify({ cells: [{ cell_type: "code", outputs }] }));
    expect(result?.cells[0].outputs).toHaveLength(5);
    expect(result?.cells[0].outputs[0].text).toHaveLength(20_000);
    expect(result?.cells[0].outputs[0].truncated).toBe(true);
    expect(result?.truncated).toBe(true);
  });
});
