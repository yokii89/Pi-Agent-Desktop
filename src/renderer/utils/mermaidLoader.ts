/**
 * mermaid 的按需加载路径与全局配置（docs/design/125）。
 *
 * `import("mermaid")` 必须是动态 import：mermaid 内部按图表类型切成 60+ 个惰性 chunk
 * （含 elk 布局引擎，单张流程图默认要拉 ~2.2 MB），静态引入会把它们全塞进主 bundle、
 * 拖慢启动——与 GSAP 同一条款。没有 ` ```mermaid ` 围栏的会话，一个字节都不会加载。
 *
 * `initialize` 是全局的，逐块重复调用会把解析器与布局注册表一起重置，所以只在
 * 主题真的变了以后重配一次。
 */

export type Mermaid = typeof import("mermaid").default;

/** mermaid 的主题档：界面 light → `default`，dark → `dark`。 */
export type MermaidTheme = "default" | "dark";

let mermaidPromise: Promise<Mermaid> | null = null;

/** 首次调用才加载 mermaid 主 chunk；后续复用同一 Promise。 */
export function loadMermaid(): Promise<Mermaid> {
  mermaidPromise ??= import("mermaid").then((mod) => mod.default);
  return mermaidPromise;
}

let configuredTheme: MermaidTheme | null = null;

/** 取 tokens.css 的界面字体，避免图内标注用 mermaid 自带的 trebuchet 而跟正文脱节。 */
function uiFontFamily(): string | undefined {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-family-ui")
    .trim();
  return value.length > 0 ? value : undefined;
}

/** 加载并按当前主题配置好；返回可直接 `parse` / `render` 的实例。 */
export async function prepareMermaid(theme: MermaidTheme): Promise<Mermaid> {
  const mermaid = await loadMermaid();
  if (configuredTheme !== theme) {
    const fontFamily = uiFontFamily();
    mermaid.initialize({
      startOnLoad: false,
      // strict：输出经 DOMPurify 消毒，图内不注入脚本；生产 CSP 无需为此放宽
      securityLevel: "strict",
      theme,
      ...(fontFamily ? { themeVariables: { fontFamily } } : {}),
    });
    configuredTheme = theme;
  }
  return mermaid;
}
