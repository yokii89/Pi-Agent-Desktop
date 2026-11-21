import { clipboardService } from "../services/clipboardService";

let pendingPaste: Promise<void> = Promise.resolve();

/** 串行执行原生粘贴；焦点、编辑状态或元素身份变化后，丢弃该次粘贴。 */
export function pasteIntoElement(root: HTMLElement): Promise<void> {
  const request = pendingPaste.then(async () => {
    const doc = root.ownerDocument;
    const isTarget = (): boolean =>
      root.isConnected && root.isContentEditable && doc.hasFocus() && doc.activeElement === root;
    if (!isTarget()) return;

    const guardPaste = (event: ClipboardEvent): void => {
      if (!isTarget() || event.currentTarget !== doc || event.target !== root) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    // invoke 往返期间可能换输入框或卸载会话，必须在 React/浏览器处理 paste 前拦住错投。
    // iframe 的 paste 不冒泡到父文档；焦点离开和子页加载时补登记新的文档。
    const documents = new Set<Document>();
    const refreshCapture = (): void => {
      const visit = (current: Document): void => {
        if (!documents.has(current)) {
          documents.add(current);
          current.addEventListener("paste", guardPaste, { capture: true });
          current.addEventListener("focusout", refreshCapture, { capture: true });
          current.addEventListener("load", refreshCapture, { capture: true });
        }
        for (const frame of current.querySelectorAll("iframe")) {
          if (frame.contentDocument) visit(frame.contentDocument);
        }
      };
      visit(doc);
    };
    refreshCapture();
    try {
      await clipboardService.paste();
    } finally {
      for (const current of documents) {
        current.removeEventListener("paste", guardPaste, { capture: true });
        current.removeEventListener("focusout", refreshCapture, { capture: true });
        current.removeEventListener("load", refreshCapture, { capture: true });
      }
    }
  });
  // 单个失败不能阻断后续粘贴；调用方仍收到原请求的错误。
  pendingPaste = request.catch(() => undefined);
  return request;
}
