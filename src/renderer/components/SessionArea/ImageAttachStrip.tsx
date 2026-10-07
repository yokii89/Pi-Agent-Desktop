import { useState } from "react";
import { useAttachDragReorder } from "../../hooks/useAttachDragReorder";
import type { ComposerImageAttachment } from "../../utils/imageAttach";
import { AttachmentChip } from "./AttachmentChip";
import styles from "./ImageAttachStrip.module.css";
import { ImageLightbox } from "./ImageLightbox";

/**
 * 输入栏待发图片附件条（docs/design/21）：
 * 缩略图 + 文件树同款类型角标；独立于 contenteditable 的兄弟节点。
 */
export function ImageAttachStrip({
  images,
  onRemove,
  onReorder,
  hint,
}: {
  images: ComposerImageAttachment[];
  onRemove: (id: string) => void;
  /** 拖拽排序（docs/design/21 P2）。 */
  onReorder?: (fromId: string, toId: string) => void;
  /** 软提示（如目录未声明视觉）；不阻止发送。 */
  hint?: string | null;
}) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const dragHandlers = useAttachDragReorder(onReorder ?? (() => undefined));
  if (images.length === 0) return null;
  return (
    <div className={styles.strip}>
      {images.map((image, index) => (
        <AttachmentChip
          key={image.id}
          name={image.name}
          path={image.name}
          kind="file"
          previewUrl={image.previewUrl}
          onRemove={() => onRemove(image.id)}
          onPreview={() => setPreviewIndex(index)}
          dragProps={onReorder ? dragHandlers(image.id) : undefined}
        />
      ))}
      {hint ? (
        <span className={styles.hint} title={hint}>
          {hint}
        </span>
      ) : null}
      {previewIndex !== null ? (
        <ImageLightbox
          images={images.map((image) => ({ src: image.previewUrl, name: image.name }))}
          index={previewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      ) : null}
    </div>
  );
}
