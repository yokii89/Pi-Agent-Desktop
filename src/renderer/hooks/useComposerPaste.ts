import type { ClipboardEvent, MouseEvent } from "react";
import { useUiStore } from "../stores/uiStore";
import { pasteIntoElement } from "../utils/nativePaste";
import { useT } from "./useT";

interface ComposerPasteOptions {
  disabled: boolean;
  onFiles?: (files: File[]) => void;
  onImages?: (files: Blob[], names?: string[]) => void;
}

/** 右键和快捷键共用原生 paste 事件：附件优先，文字只按纯文本插入。 */
export function useComposerPaste({ disabled, onFiles, onImages }: ComposerPasteOptions) {
  const t = useT();
  const { showToast } = useUiStore();

  const onContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    const root = event.currentTarget;
    if (disabled || !root.isContentEditable) return;

    const selection = window.getSelection();
    const hasSelection =
      selection &&
      selection.rangeCount > 0 &&
      root.contains(selection.getRangeAt(0).commonAncestorContainer);
    root.focus();
    if (selection && !hasSelection) {
      const range = document.createRange();
      range.selectNodeContents(root);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    // 交给 Electron 派发可信 paste，保留 File 的磁盘路径和截图二进制数据。
    void pasteIntoElement(root).catch(() => {
      if (root.isConnected && root.isContentEditable) showToast(t("session.input.pasteFailed"));
    });
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>): void => {
    event.preventDefault();
    if (disabled || !event.currentTarget.isContentEditable) return;

    const files = Array.from(event.clipboardData.files);
    if (files.length > 0 && onFiles) {
      onFiles(files);
      return;
    }
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length > 0 && onImages) {
      onImages(
        images,
        images.map((file) => file.name || t("session.image.clipboard")),
      );
      return;
    }
    const text = event.clipboardData.getData("text/plain");
    if (text) document.execCommand("insertText", false, text);
  };

  return { onContextMenu, onPaste };
}
