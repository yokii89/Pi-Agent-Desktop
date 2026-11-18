/** Return the page step for an unmodified arrow key, or null when the viewer should leave it alone. */
export function previewPageStep(event: KeyboardEvent): -1 | 1 | null {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  ) {
    return null;
  }
  const target = event.target;
  const targetNode =
    target && typeof target === "object" && "nodeType" in target ? (target as Node) : null;
  const targetElement =
    targetNode?.nodeType === 1 ? (targetNode as Element) : targetNode?.parentElement;
  if (targetElement) {
    if (
      targetElement.closest(
        "input, textarea, select, [contenteditable]:not([contenteditable='false'])",
      )
    ) {
      return null;
    }
  }
  const selection = targetNode?.ownerDocument?.getSelection();
  if (selection && !selection.isCollapsed) return null;

  switch (event.key) {
    case "ArrowLeft":
    case "ArrowUp":
      return -1;
    case "ArrowRight":
    case "ArrowDown":
      return 1;
    default:
      return null;
  }
}
