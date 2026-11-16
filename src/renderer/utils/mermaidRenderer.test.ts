import { describe, expect, it } from "vitest";
import { canRenderMermaid, MAX_MERMAID_CHARS, MAX_MERMAID_LINES } from "./mermaidPreview";
import { namespaceMermaidSvg, renderMermaid } from "./mermaidRenderer";

describe("cached Mermaid SVG instances", () => {
  const source = `<svg id="diagram" aria-labelledby="title desc">
<style>#diagram .node{fill:#abc;marker-end:url(#arrow)}#abc:hover{stroke:#abc}</style>
<title id="title">id="label" and #diagram stay literal</title>
<desc id="desc">description</desc>
<defs><marker id="arrow"/><clipPath id="clip"/></defs>
<g data-id="data" id="abc" aria-describedby="desc absent" style="fill:#abc;clip-path:url(#clip)">
<path marker-end="url(#arrow)"/><use href="#abc"/><use xlink:href="#abc"/>
<a href="https://example.test/#abc">external</a></g></svg>`;

  it("namespaces IDs, scoped selectors, markers, fragment links and accessible references", () => {
    const svg = namespaceMermaidSvg(source, "first");
    for (const id of ["diagram", "title", "desc", "arrow", "clip", "abc"]) {
      expect(svg).toContain(`id="first-${id}"`);
    }
    expect(svg).toContain("#first-diagram .node");
    expect(svg).toContain("#first-abc:hover");
    expect(svg).toContain("marker-end:url(#first-arrow)");
    expect(svg).toContain('marker-end="url(#first-arrow)"');
    expect(svg).toContain('href="#first-abc"');
    expect(svg).toContain('xlink:href="#first-abc"');
    expect(svg).toContain('aria-labelledby="first-title first-desc"');
    expect(svg).toContain('aria-describedby="first-desc absent"');
    expect(svg).toContain("clip-path:url(#first-clip)");
  });

  it("does not alter colors, text, data attributes, external links or cached source", () => {
    const first = namespaceMermaidSvg(source, "first");
    const second = namespaceMermaidSvg(source, "second");
    for (const svg of [first, second]) {
      expect(svg).toContain("fill:#abc");
      expect(svg).toContain("stroke:#abc");
      expect(svg).toContain('id="label" and #diagram stay literal');
      expect(svg).toContain('data-id="data"');
      expect(svg).toContain('href="https://example.test/#abc"');
    }
    expect(second).not.toContain("first-");
    expect(source).toContain('<svg id="diagram"');
    expect(namespaceMermaidSvg("<svg><text>plain</text></svg>", "unused")).toBe(
      "<svg><text>plain</text></svg>",
    );
  });

  it("keeps both public preview paths within the layout budget before importing the engine", async () => {
    expect(canRenderMermaid("x".repeat(MAX_MERMAID_CHARS))).toBe(true);
    expect(canRenderMermaid("x".repeat(MAX_MERMAID_CHARS + 1))).toBe(false);
    expect(canRenderMermaid(Array(MAX_MERMAID_LINES).fill("x").join("\n"))).toBe(true);
    const code = Array(MAX_MERMAID_LINES + 1)
      .fill("x")
      .join("\n");
    expect(canRenderMermaid(code)).toBe(false);
    expect(
      await renderMermaid(
        { code, theme: "dark", fontFamily: "system-ui" },
        new AbortController().signal,
      ),
    ).toBeNull();
  });
});
