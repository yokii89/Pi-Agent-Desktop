import type { ComposerDraftPart } from "../stores/composerDrafts";
import type { PositionedFileMention } from "./fileMentionFormat";

export const EL_ID_ATTR = "data-el-id";
export const FILE_ID_ATTR = "data-file-id";
export const SLASH_CMD_ATTR = "data-slash-cmd";

/** Insert an external context chip at the selection, or append when unfocused. */
export function insertNodeAtCaret(root: HTMLElement, node: Node): void {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !root.contains(selection.anchorNode)) {
    root.append(node, document.createTextNode(" "));
    return;
  }
  const range = selection.getRangeAt(0);
  range.deleteContents();
  range.insertNode(node);
  const spacer = document.createTextNode(" ");
  node.parentNode?.insertBefore(spacer, node.nextSibling);
  range.setStartAfter(spacer);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Serialize chip positions from the DOM, which owns the editable document order. */
export function readComposerDom(root: HTMLElement): {
  text: string;
  itemIds: string[];
  filePaths: string[];
  fileMentions: PositionedFileMention[];
} {
  const itemIds: string[] = [];
  const filePaths: string[] = [];
  const fileMentions: PositionedFileMention[] = [];
  let text = "";
  const walk = (node: Node): void => {
    if (node instanceof Text) {
      text += node.data;
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const fileId = node.getAttribute(FILE_ID_ATTR);
    if (fileId) {
      filePaths.push(fileId);
      fileMentions.push({
        path: fileId,
        displayPath: node.dataset.label || fileId,
        kind: node.dataset.kind === "dir" ? "dir" : "file",
        offset: text.length,
      });
      text += `@${node.dataset.label || fileId}`;
      return;
    }
    const slashId = node.getAttribute(SLASH_CMD_ATTR);
    if (slashId) {
      text += `/${node.dataset.label || slashId}`;
      return;
    }
    const elId = node.getAttribute(EL_ID_ATTR);
    if (elId) {
      itemIds.push(elId);
      text += `⟨${node.dataset.label || "el"}⟩`;
      return;
    }
    if (node.tagName === "BR") {
      text += "\n";
      return;
    }
    if ((node.tagName === "DIV" || node.tagName === "P") && text && !text.endsWith("\n"))
      text += "\n";
    for (const child of node.childNodes) walk(child);
  };
  for (const child of root.childNodes) walk(child);
  return { text, itemIds, filePaths, fileMentions };
}

/** 保存文字、换行和原子芯片的顺序；URL 等展示装饰不进入草稿。 */
export function readComposerDraft(root: HTMLElement): ComposerDraftPart[] {
  const parts: ComposerDraftPart[] = [];
  let hasContent = false;
  let endsWithNewline = false;
  const appendText = (text: string): void => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last?.kind === "text") last.text += text;
    else parts.push({ kind: "text", text });
    hasContent = true;
    endsWithNewline = text.endsWith("\n");
  };
  const walk = (node: Node): void => {
    if (node instanceof Text) {
      appendText(node.data);
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const path = node.getAttribute(FILE_ID_ATTR);
    const name = node.getAttribute(SLASH_CMD_ATTR);
    const id = node.getAttribute(EL_ID_ATTR);
    if (path || name || id) {
      if (path) parts.push({ kind: "file", path });
      else if (name) parts.push({ kind: "slash", name });
      else if (id) parts.push({ kind: "element", id });
      hasContent = true;
      endsWithNewline = false;
      return;
    }
    if (node.tagName === "BR") {
      appendText("\n");
      return;
    }
    if ((node.tagName === "DIV" || node.tagName === "P") && hasContent && !endsWithNewline) {
      appendText("\n");
    }
    for (const child of node.childNodes) walk(child);
  };
  for (const child of root.childNodes) walk(child);
  return parts;
}

/** 从语义草稿恢复内容，芯片由当前组件重建以保留图标和交互。 */
export function restoreComposerDraft(
  root: HTMLElement,
  parts: ComposerDraftPart[],
  paintChip: (part: Exclude<ComposerDraftPart, { kind: "text" }>) => Node | null,
): void {
  const fragment = document.createDocumentFragment();
  for (const part of parts) {
    if (part.kind !== "text") {
      const chip = paintChip(part);
      if (chip) fragment.appendChild(chip);
      continue;
    }
    part.text.split("\n").forEach((text, index) => {
      if (index > 0) fragment.appendChild(document.createElement("br"));
      if (text) fragment.appendChild(document.createTextNode(text));
    });
  }
  root.replaceChildren(fragment);
}

/** Chips count as content even if there is no user text. */
export function hasVisibleContent(root: HTMLElement): boolean {
  return (
    Boolean(root.querySelector(`[${EL_ID_ATTR}], [${FILE_ID_ATTR}], [${SLASH_CMD_ATTR}]`)) ||
    Boolean(root.textContent?.trim())
  );
}
