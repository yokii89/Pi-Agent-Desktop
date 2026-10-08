import { useState } from "react";
import { useT } from "../../hooks/useT";
import type { UserMessageImage } from "../../utils/imageAttach";
import { ImageLightbox } from "./ImageLightbox";
import styles from "./UserImageStrip.module.css";

/**
 * 用户气泡内的只读图片条（docs/design/21）：与输入栏缩略图同序同构，无 ×；点击进 lightbox。
 */
export function UserImageStrip({ images }: { images: UserMessageImage[] }) {
  const t = useT();
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  if (images.length === 0) return null;
  const fallback = t("session.image.attachment");
  return (
    <div className={styles.strip}>
      {images.map((image, index) => {
        const label = image.name ?? fallback;
        return (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: immutable message images
            key={index}
            type="button"
            className={styles.frame}
            title={label}
            aria-label={t("session.image.preview", { name: label })}
            onClick={() => setPreviewIndex(index)}
          >
            <img className={styles.img} src={image.src} alt={label} />
          </button>
        );
      })}
      {previewIndex !== null ? (
        <ImageLightbox
          images={images.map((image) => ({
            src: image.src,
            name: image.name ?? fallback,
          }))}
          index={previewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      ) : null}
    </div>
  );
}
