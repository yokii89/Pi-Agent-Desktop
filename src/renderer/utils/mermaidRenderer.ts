import { prepareMermaid } from "./mermaidLoader";
import { canRenderMermaid } from "./mermaidPreview";
import { MermaidRenderCache, type MermaidRenderSpec } from "./mermaidRenderCache";

let renderSeq = 0;
const diagrams = new MermaidRenderCache(async ({ code, theme, fontFamily }, signal) => {
  const mermaid = await prepareMermaid(theme, fontFamily);
  signal.throwIfAborted();
  const valid = await mermaid.parse(code, { suppressErrors: true });
  signal.throwIfAborted();
  if (!valid) return null;
  return (await mermaid.render(`pidesk-mmd-${++renderSeq}`, code)).svg;
});

/** 统一布局入口；返回的缓存 SVG 在挂载前必须经 namespaceMermaidSvg 分配实例 ID。 */
export function renderMermaid(
  spec: MermaidRenderSpec,
  signal: AbortSignal,
): Promise<string | null> {
  if (!canRenderMermaid(spec.code)) return Promise.resolve(null);
  return diagrams.request(spec, signal);
}

/**
 * 每个实例独立改写 SVG 的 ID、标记引用和 CSS 选择器。
 * 只改已声明的 ID 引用，不改文字标签、外部链接或颜色；缓存命中也不会产生重复 DOM ID。
 */
export function namespaceMermaidSvg(svg: string, prefix: string): string {
  const ids = new Map<string, string>();
  for (const tag of svg.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const id = /\sid="([^"]+)"/.exec(tag[0]);
    if (id) ids.set(id[1], `${prefix}-${id[1]}`);
  }
  const escaped = [...ids.keys()]
    .sort((left, right) => right.length - left.length)
    .map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (escaped.length === 0) return svg;
  const refs = new RegExp(`#(${escaped.join("|")})(?=[\\s\\)\\]\\[.,:;{}>+~"']|$)`, "g");
  const rewriteRefs = (value: string): string =>
    value.replace(refs, (_match: string, id: string) => `#${ids.get(id)}`);
  const rewriteUrls = (value: string): string =>
    value.replace(/url\(\s*["']?#[^)]*\)/g, rewriteRefs);
  return svg
    .replace(
      /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/g,
      (_match, open, css: string, close) =>
        `${open}${rewriteUrls(css.replace(/[^{}]+\{/g, rewriteRefs))}${close}`,
    )
    .replace(/<[a-zA-Z][^>]*>/g, (tag) =>
      tag.replace(/([\w:-]+)="([^"]*)"/g, (attribute, name: string, value: string) => {
        if (name === "id") return `id="${ids.get(value) ?? value}"`;
        if (name === "aria-labelledby" || name === "aria-describedby") {
          return `${name}="${value
            .split(/\s+/)
            .map((id) => ids.get(id) ?? id)
            .join(" ")}"`;
        }
        if ((name === "href" || name === "xlink:href") && value.startsWith("#")) {
          return `${name}="#${ids.get(value.slice(1)) ?? value.slice(1)}"`;
        }
        if (value.includes("url(")) return `${name}="${rewriteUrls(value)}"`;
        return attribute;
      }),
    );
}
