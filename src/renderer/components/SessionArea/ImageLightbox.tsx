import { DownloadSimple } from "@phosphor-icons/react";
import { type MouseEvent, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../hooks/useT";
import { fsService } from "../../services/fsService";
import { useBrowserStore } from "../../stores/browserStore";
import { useUiStore } from "../../stores/uiStore";
import { prepareOverlayFreeze, releaseOverlayFreeze } from "../../utils/overlayFreeze";
import { ContextMenu } from "../ui/ContextMenu";
import type { MenuItem } from "../ui/Menu";
import { Modal } from "../ui/Modal";
import styles from "./ImageLightbox.module.css";

/** 抑制来源标识：与浏览器面板自身的浮层各自独立，可叠加。 */
const SUPPRESS_REASON = "imageLightbox";

export interface LightboxImage {
  src: string;
  name?: string;
}

/**
 * 附件缩略图 lightbox（docs/design/21 P1）：
 * Esc / 遮罩关闭；多图时 ←/→ 切换；动画由 Modal 遮罩承担，尊重 prefers-reduced-motion。
 * 图上右键 →「保存图片」写入系统「下载」目录，同名自动加序号。
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
  const store = useBrowserStore();
  const { showToast } = useUiStore();
  const [current, setCurrent] = useState(index);
  const [ready, setReady] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  // 浏览器页面是主进程的 WebContentsView，原生合成永远在渲染层之上，
  // --z-modal 再高也压不住它：必须先摘掉视图再画 Modal，否则浮层右半边会被页面盖住。
  // biome-ignore lint/correctness/useExhaustiveDependencies: setOverlayFreeze 稳定；只需在挂载时抑制一次
  useEffect(() => {
    let cancelled = false;
    void prepareOverlayFreeze(SUPPRESS_REASON, store.setOverlayFreeze).then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
      releaseOverlayFreeze(SUPPRESS_REASON, store.setOverlayFreeze);
    };
  }, []);

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
  if (!image || !ready) return null;
  const label = image.name ?? t("session.image.attachment");

  const openMenuAtCursor = (event: MouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setMenuPos({ x: event.clientX, y: event.clientY });
  };

  const saveCurrent = async (): Promise<void> => {
    try {
      const saved = await fsService.saveImageToDownloads(image.src, image.name);
      showToast(t("session.image.saved", { name: saved.name }), {
        label: t("session.image.revealFolder"),
        run: () => {
          void fsService.openPath(saved.dir).catch(() => undefined);
        },
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      showToast(t("session.image.saveFailed", { error: reason }));
    }
  };

  const menuItems: MenuItem[] = [
    {
      key: "save",
      label: t("session.image.save"),
      icon: <DownloadSimple size={16} weight="regular" />,
      onSelect: () => {
        void saveCurrent();
      },
    },
  ];

  return (
    <>
      <Modal open onClose={onClose} ariaLabel={label} panelClassName={styles.panel}>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: 图片是只读展示面，右键只是保存入口，不伪装成交互 role */}
        <div className={styles.stage} onContextMenu={openMenuAtCursor}>
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
      {/* 菜单 portal 到 body：Modal 遮罩的 backdrop-filter 会把 fixed 的包含块从视口改写成遮罩 */}
      {menuPos
        ? createPortal(
            <ContextMenu position={menuPos} items={menuItems} onClose={() => setMenuPos(null)} />,
            document.body,
          )
        : null}
    </>
  );
}
