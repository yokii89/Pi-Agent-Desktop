import { createContext, useContext, useEffect, useState } from "react";
import { useT } from "../../hooks/useT";
import { fsService } from "../../services/fsService";
import { resolveMarkdownImageSource } from "../../utils/markdownImageSource";
import { ImageLightbox } from "../SessionArea/ImageLightbox";
import styles from "./MarkdownImage.module.css";

/** 图片链接保留链接动作，避免在 a 内再嵌套预览按钮。 */
export const MarkdownImageLinkContext = createContext(false);

// 只合并在途读取：生成工具可能覆写同一路径，不能跨消息永久缓存旧图。
const pendingImages = new Map<string, Promise<string | null>>();

function loadLocalImage(path: string): Promise<string | null> {
  const pending = pendingImages.get(path);
  if (pending) return pending;
  const promise = fsService
    .read(path)
    .then((result) => (result.kind === "image" ? result.dataUrl : null))
    .catch(() => null)
    .finally(() => pendingImages.delete(path));
  pendingImages.set(path, promise);
  return promise;
}

interface MarkdownImageProps {
  src?: string;
  alt?: string;
  title?: string;
  sourcePath?: string | null;
  baseDir?: string | null;
  preview?: boolean;
}

/** Markdown 插图：独立处理文件读取、加载失败与预览，正文流只负责排版。 */
export function MarkdownImage({ src = "", sourcePath, baseDir, ...props }: MarkdownImageProps) {
  const source = resolveMarkdownImageSource(src, sourcePath, baseDir);
  const localPath = source?.kind === "local" ? source.path : null;
  const url = source?.kind === "url" ? source.url : null;
  return <ResolvedImage key={localPath ?? url ?? src} localPath={localPath} url={url} {...props} />;
}

function ResolvedImage({
  localPath,
  url,
  alt = "",
  title,
  preview = false,
}: Omit<MarkdownImageProps, "src" | "sourcePath" | "baseDir"> & {
  localPath: string | null;
  url: string | null;
}) {
  const t = useT();
  const linked = useContext(MarkdownImageLinkContext);
  const [src, setSrc] = useState(url);
  const [failed, setFailed] = useState(!localPath && !url);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const label = alt || title || localPath?.split(/[/\\]/).at(-1) || t("session.image.inline");

  useEffect(() => {
    if (!localPath) return;
    let cancelled = false;
    void loadLocalImage(localPath).then((value) => {
      if (cancelled) return;
      setSrc(value);
      setFailed(!value);
    });
    return () => {
      cancelled = true;
    };
  }, [localPath]);

  if (failed) {
    return <span className={styles.failed}>{t("common.imageLoadFailed", { src: label })}</span>;
  }
  if (!src) return <span className={styles.loading}>{t("common.loading")}</span>;

  const image = (
    <img
      className={styles.image}
      src={src}
      alt={alt}
      title={title}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
    />
  );
  if (!preview || linked) return image;
  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        aria-label={t("session.image.preview", { name: label })}
        title={title ?? t("session.image.preview", { name: label })}
        disabled={!loaded}
        onClick={() => setOpen(true)}
      >
        {image}
      </button>
      {open && (
        <ImageLightbox images={[{ src, name: label }]} index={0} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
