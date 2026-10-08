import type { ToolImage } from "../../../stores/toolPayload";
import styles from "./ImageResult.module.css";

/** 工具结果中的图片预览：限高 contain，点击新窗口查看。 */
export function ImageResult({ images }: { images: ToolImage[] }) {
  if (images.length === 0) return null;
  return (
    <div className={styles.wrap}>
      {images.map((image) => (
        <a
          key={image.src.slice(0, 64)}
          className={styles.frame}
          href={image.src}
          target="_blank"
          rel="noreferrer"
          title={image.alt}
        >
          <img className={styles.img} src={image.src} alt={image.alt} />
        </a>
      ))}
    </div>
  );
}
