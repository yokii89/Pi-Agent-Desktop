import { useRef } from "react";

/**
 * 附件条拖拽排序手势（docs/design/21 P2）：
 * 自管 dragId，drop 在同列表另一项上时回调 reorder；阻断冒泡以免落入 Composer 文件拖放。
 */
export function useAttachDragReorder(onReorder: (fromId: string, toId: string) => void) {
  const dragIdRef = useRef<string | null>(null);

  const handlers = (id: string) => ({
    draggable: true,
    onDragStart: (event: React.DragEvent) => {
      dragIdRef.current = id;
      event.dataTransfer.effectAllowed = "move";
      // Firefox 需要 setData 才启动 HTML5 拖拽
      event.dataTransfer.setData("text/plain", id);
    },
    onDragOver: (event: React.DragEvent) => {
      const from = dragIdRef.current;
      if (!from || from === id) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
    },
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const from = dragIdRef.current;
      dragIdRef.current = null;
      if (from && from !== id) onReorder(from, id);
    },
    onDragEnd: () => {
      dragIdRef.current = null;
    },
  });

  return handlers;
}
