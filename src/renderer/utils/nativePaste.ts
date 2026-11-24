import { clipboardService } from "../services/clipboardService";

let pendingPaste: Promise<void> = Promise.resolve();

/** 窗口刚被这次右键激活时，焦点要等激活流程走完才落到编辑器：给足几帧再放弃。 */
const FOCUS_SETTLE_FRAMES = 8;

function nextFrame(doc: Document): Promise<void> {
  const win = doc.defaultView;
  if (!win?.requestAnimationFrame) return Promise.resolve();
  return new Promise<void>((resolve) => {
    win.requestAnimationFrame(() => resolve());
  });
}

/** 编辑器里没有光标（首次点击非活动窗口时 Chromium 不落光标）就把光标收到末尾。 */
function ensureCaretInEditor(root: HTMLElement): void {
  const doc = root.ownerDocument;
  const selection = doc.defaultView?.getSelection?.();
  if (!selection) return;
  if (selection.rangeCount > 0 && root.contains(selection.getRangeAt(0).commonAncestorContainer)) {
    return;
  }
  const range = doc.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * 粘贴前确认「文档聚焦 + 焦点在编辑器上」。
 * 右键常同时承担激活窗口（开发态 DevTools 持有焦点、从别的程序切回来同理）：contextmenu 已经
 * 派发但文档还没聚焦，此时派发的原生 paste 会被主进程丢弃，表现为「右键粘贴没反应」。
 * 因此窗口未激活时在有限帧内补焦点，等激活完成再粘贴；窗口已激活则尊重用户当前的焦点。
 */
async function claimEditorFocus(root: HTMLElement): Promise<boolean> {
  const doc = root.ownerDocument;
  if (!root.isConnected || !root.isContentEditable) return false;
  if (doc.hasFocus()) {
    // 焦点不在编辑器上＝用户已把焦点挪去别处，维持「不抢焦点」的既有语义
    if (doc.activeElement !== root) return false;
    ensureCaretInEditor(root);
    return true;
  }
  for (let frame = 0; frame <= FOCUS_SETTLE_FRAMES; frame += 1) {
    if (!root.isConnected || !root.isContentEditable) return false;
    root.focus({ preventScroll: true });
    if (doc.hasFocus() && doc.activeElement === root) {
      ensureCaretInEditor(root);
      return true;
    }
    await nextFrame(doc);
  }
  return false;
}

/** 执行原生粘贴；焦点、编辑状态或元素身份变化后，丢弃该次粘贴。 */
export function pasteIntoElement(root: HTMLElement): Promise<void> {
  const request = pendingPaste.then(async () => {
    const claimed = await claimEditorFocus(root);
    if (!claimed) {
      // 窗口始终没拿到焦点：粘贴根本没机会执行，交给调用方提示，别静默吞掉
      if (root.isConnected && root.isContentEditable && !root.ownerDocument.hasFocus()) {
        throw new Error("PASTE_WINDOW_NOT_FOCUSED");
      }
      return;
    }

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
