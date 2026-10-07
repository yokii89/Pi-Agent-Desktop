import { useCallback, useEffect, useState } from "react";
import { useT } from "../../hooks/useT";
import { Modal } from "../ui/Modal";
import styles from "./ImageLightbox.module.css";

export interface LightboxImage {
  src: string;
  name?: string;
}

/**
 * 附件缩略图 lightbox（docs/design/21 P1）：
 * Esc / 遮罩关闭；多图时 ←/→ 切换；动画由 Modal 遮罩承担，尊重 prefers-reduced-motion。
 */
export function ImageLightbox({
  images,
  index,
  onClose,
}: {
  images: LightboxImage[];
  index: number;
  onClose: () => void;
}) {
  const t = useT();
  const [current, setCurrent] = useState(index);

  useEffect(() => {
    setCurrent(index);
  }, [index]);

  const showDelta = useCallback(
    (delta: number) => {
      if (images.length <= 1) return;
      setCurrent((value) => (value + delta + images.length) % images.length);
    },
    [images.length],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "ArrowLeft") {
        event.stopPropagation();
        showDelta(-1);
      } else if (event.key === "ArrowRight") {
        event.stopPropagation();
        showDelta(1);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showDelta]);

  const image = images[Math.min(Math.max(current, 0), images.length - 1)];
  if (!image) return null;
  const label = image.name ?? t("session.image.attachment");

  return (
    <Modal open onClose={onClose} ariaLabel={label} panelClassName={styles.panel}>
      <div className={styles.stage}>
        <img className={styles.img} src={image.src} alt={label} />
      </div>
      <div className={styles.bar}>
        <span className={styles.title}>{label}</span>
        {images.length > 1 ? (
          <span className={styles.counter}>
            {current + 1} / {images.length}
          </span>
        ) : null}
      </div>
    </Modal>
  );
}
