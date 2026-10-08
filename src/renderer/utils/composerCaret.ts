/** Text immediately before the caret, bounded by chips and line breaks. */
export function textBeforeCaret(
  root: HTMLElement,
): { text: string; nodes: Text[]; range: Range } | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed) return null;
  const caret = selection.getRangeAt(0);
  if (!root.contains(caret.startContainer)) return null;
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(caret.startContainer, caret.startOffset);
  const nodes: Text[] = [];
  let text = "";
  const walk = (node: Node): void => {
    if (!range.intersectsNode(node)) return;
    if (node instanceof Text) {
      nodes.push(node);
      text += node.data.slice(0, node === caret.startContainer ? caret.startOffset : undefined);
    } else if (node instanceof HTMLElement) {
      if (node.contentEditable === "false" || node.tagName === "BR") {
        nodes.length = 0;
        text = "";
        return;
      }
      if (node.tagName === "DIV" || node.tagName === "P") {
        nodes.length = 0;
        text = "";
      }
      for (const child of node.childNodes) walk(child);
    }
  };
  for (const child of root.childNodes) walk(child);
  return { text, nodes, range: caret.cloneRange() };
}

/** Select only the trailing token; never rebuild the editable tree. */
export function trailingTokenRange(root: HTMLElement, pattern: RegExp): Range | null {
  const context = textBeforeCaret(root);
  if (!context) return null;
  const token = context.text.match(/\S+$/)?.[0];
  if (!token) return null;
  pattern.lastIndex = 0;
  if (!pattern.test(token)) return null;
  let offset = context.text.length - token.length;
  for (const node of context.nodes) {
    if (offset < node.length) {
      context.range.setStart(node, offset);
      return context.range;
    }
    offset -= node.length;
  }
  return null;
}

/** Replace a caret token with one node and place the caret after it. */
export function replaceCaretToken(root: HTMLElement, pattern: RegExp, node: Node): boolean {
  const range = trailingTokenRange(root, pattern);
  if (!range) return false;
  range.deleteContents();
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return true;
}
