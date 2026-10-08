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

/** Chips count as content even if there is no user text. */
export function hasVisibleContent(root: HTMLElement): boolean {
  return (
    Boolean(root.querySelector(`[${EL_ID_ATTR}], [${FILE_ID_ATTR}], [${SLASH_CMD_ATTR}]`)) ||
    Boolean(root.textContent?.trim())
  );
}
