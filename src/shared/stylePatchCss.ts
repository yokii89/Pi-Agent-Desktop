import type { StylePatchDeclaration } from "./ipc";

function enabledDeclarations(declarations: StylePatchDeclaration[]): StylePatchDeclaration[] {
  return declarations.filter((item) => item.enabled && item.name.trim() && item.value.trim());
}

function buildRule(selector: string, declarations: StylePatchDeclaration[]): string | null {
  const enabled = enabledDeclarations(declarations);
  if (enabled.length === 0) return null;
  const lines = enabled.map((item) => {
    const important = item.important ? " !important" : "";
    return `  ${item.name.trim()}: ${item.value.trim()}${important};`;
  });
  return `${selector} {\n${lines.join("\n")}\n}`;
}

/** Format editable declarations as CSS for preview and clipboard export. */
export function formatStylePatchCss(
  entries: Array<{ selector: string; declarations: StylePatchDeclaration[] }>,
  host: string,
): string {
  const site = host.trim() || "本地页面";
  return entries
    .flatMap(({ selector, declarations }) => {
      const rule = buildRule(selector, declarations);
      return rule ? [`/* PiDesk 临时调整 · ${site} · ${selector} */\n${rule}`] : [];
    })
    .join("\n\n");
}
