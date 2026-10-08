import { useAttachDragReorder } from "../../hooks/useAttachDragReorder";
import type { ComposerFileAttachment } from "../../utils/fileAttach";
import { AttachmentChip } from "./AttachmentChip";
import styles from "./FileAttachStrip.module.css";

/**
 * 输入栏待发文件附件条（docs/design/25）：
 * 类型图标复用右侧「文件」树的 fileIcons；发送走路径引用。
 */
export function FileAttachStrip({
  files,
  onRemove,
  onReorder,
}: {
  files: ComposerFileAttachment[];
  onRemove: (id: string) => void;
  /** 拖拽排序（与图片条同一手势语言）。 */
  onReorder?: (fromId: string, toId: string) => void;
}) {
  const dragHandlers = useAttachDragReorder(onReorder ?? (() => undefined));
  if (files.length === 0) return null;
  return (
    <div className={styles.strip}>
      {files.map((file) => (
        <AttachmentChip
          key={file.id}
          name={file.name}
          path={file.path}
          kind={file.kind}
          onRemove={() => onRemove(file.id)}
          dragProps={onReorder ? dragHandlers(file.id) : undefined}
        />
      ))}
    </div>
  );
}
