import { renderToString } from "katex";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkMath from "remark-math";
import { describe, expect, it } from "vitest";
import { splitStableBlocks } from "../components/SessionArea/markdownBlocks";
import { normalizeMathDelimiters } from "./markdownMath";

function render(source: string): string {
  return renderToStaticMarkup(
    createElement(Markdown, { remarkPlugins: [remarkMath] }, normalizeMathDelimiters(source)),
  );
}

const formula = String.raw`\mathrm{OA}=\frac{\operatorname{tr}(\mathbf H)}{\sum_{i,j}H_{ij}}.`;

describe("Markdown mathematics", () => {
  it("typesets the reported formula with fractions, operators and accessible MathML", () => {
    const html = renderToString(formula, { displayMode: true, trust: false, throwOnError: true });
    expect(html).toContain('class="katex-display"');
    expect(html).toContain("<math");
    expect(html).toContain("mfrac");
    expect(html).toContain("OA");
  });
  it("recognizes the reported formula with both display delimiters", () => {
    for (const source of [`$$\n${formula}\n$$`, `\\[\n${formula}\n\\]`]) {
      expect(render(source)).toContain("math-display");
      expect(render(source)).toContain(formula);
    }
  });

  it("recognizes inline TeX and dollar delimiters", () => {
    expect(render(String.raw`公式 \(x^2\) 与 $y_i$`).match(/math-inline/g)).toHaveLength(2);
  });

  it("preserves fenced, inline and indented code, escaped delimiters and ordinary brackets", () => {
    for (const source of [
      "`\\(x\\)`",
      "```tex\n\\[x\\]\n```",
      "~~~\n\\(x\\)\n~~~",
      "    \\[x\\]",
      String.raw`\\[x\\]`,
      "[普通文字]",
    ]) {
      expect(normalizeMathDelimiters(source)).toBe(source);
    }
  });

  it("keeps blank lines within complete and partial streamed display expressions", () => {
    for (const [open, close] of [
      ["$$", "$$"],
      ["\\[", "\\]"],
    ]) {
      const source = `前文\n\n${open}\nx = 1\n\n+ 2\n${close}\n\n后文`;
      const { blocks, tail } = splitStableBlocks(source);
      expect([...blocks, tail].join("\n")).toBe(source);
      expect(blocks.some((block) => block.includes("x = 1\n\n+ 2"))).toBe(true);
      const partial = `${open}\nx = 1\n\n+ 2`;
      expect(splitStableBlocks(partial)).toEqual({ blocks: [], tail: partial });
    }
  });
});
