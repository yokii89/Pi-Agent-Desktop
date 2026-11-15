import { useState } from "react";
import { useT } from "../../../hooks/useT";
import type { ToolImage } from "../../../stores/toolPayload";
import { ImageLightbox } from "../ImageLightbox";
import styles from "./ImageResult.module.css";

/** 工具结果图片与会话插图共用查看器，避免 data URL 打开外部窗口失败。 */
export function ImageResult({ images }: { images: ToolImage[] }) {
  const t = useT();
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  if (images.length === 0) return null;
  return (
    <div className={styles.wrap}>
      {images.map((image, index) => (
        <button
          // biome-ignore lint/suspicious/noArrayIndexKey: 工具内容按位置更新，同格式图片的 base64 前缀可能相同
          key={index}
          type="button"
          className={styles.frame}
          title={image.alt}
          aria-label={t("session.image.preview", { name: image.alt })}
          onClick={() => setPreviewIndex(index)}
        >
          <img
            className={styles.img}
            src={image.src}
            alt={image.alt}
            loading="lazy"
            decoding="async"
          />
        </button>
      ))}
      {previewIndex !== null && (
        <ImageLightbox
          images={images.map((image) => ({ src: image.src, name: image.alt }))}
          index={previewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </div>
  );
}
