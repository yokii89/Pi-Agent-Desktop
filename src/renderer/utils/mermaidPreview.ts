import { countCodeLines } from "./codeLines";

/** 图表布局预算由围栏和独立文件共用，避免大图在其中一个入口绕过保护。 */
export const MAX_MERMAID_CHARS = 8_000;
export const MAX_MERMAID_LINES = 200;

/** 是否可提交给 Mermaid 布局；超出预算时使用源码视图。 */
export function canRenderMermaid(code: string): boolean {
  return code.length <= MAX_MERMAID_CHARS && countCodeLines(code) <= MAX_MERMAID_LINES;
}
