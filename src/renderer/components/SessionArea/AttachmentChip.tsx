import { Folder, X } from "@phosphor-icons/react";
import type { DragEventHandler } from "react";
import { FileIcon } from "../../fileIcons/FileIcon";
import { useT } from "../../hooks/useT";
import styles from "./AttachmentChip.module.css";

export interface AttachmentChipProps {
  name: string;
  /** 绝对路径（title）。 */
  path: string;
  kind?: "file" | "dir";
  /** 图片预览；有值时缩略图在左，类型图标仍按文件名解析。 */
  previewUrl?: string;
  onRemove: () => void;
  /** 点击缩略图（图片 lightbox）。 */
  onPreview?: () => void;
  /** 拖拽排序（useAttachDragReorder 的 handlers）。 */
  dragProps?: {
    draggable?: boolean;
    onDragStart?: DragEventHandler<HTMLElement>;
    onDragOver?: DragEventHandler<HTMLElement>;
    onDrop?: DragEventHandler<HTMLElement>;
    onDragEnd?: DragEventHandler<HTMLElement>;
  };
}

/**
 * 附件条芯片（docs/design/21 + 25）：
 * 类型图标与右侧「文件」树同一套 `fileIcons`（FileIcon）；图片另带缩略图。
 */
export function AttachmentChip({
  name,
  path,
  kind = "file",
  previewUrl,
  onRemove,
  onPreview,
  dragProps,
}: AttachmentChipProps) {
  const t = useT();
  return (
    <div className={styles.chip} title={path} {...dragProps}>
      {previewUrl ? (
        <button
          type="button"
          className={styles.thumb}
          aria-label={t("session.image.preview", { name })}
          onClick={onPreview}
        >
          <img className={styles.thumbImg} src={previewUrl} alt="" />
          <FileIcon fileName={name} className={styles.typeOnThumb} />
        </button>
      ) : kind === "dir" ? (
        <Folder size={16} weight="regular" className={styles.icon} />
      ) : (
        <FileIcon fileName={name} className={styles.icon} />
      )}
      <span className={styles.label}>{name}</span>
      <button
        type="button"
        className={styles.remove}
        aria-label={t("session.chip.removeItem", { name })}
        onClick={onRemove}
      >
        <X size={12} weight="bold" />
      </button>
    </div>
  );
}
