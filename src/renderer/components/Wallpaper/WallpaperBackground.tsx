import { type CSSProperties, useEffect, useRef, useState } from "react";
import {
  wallpaperFileName,
  wallpaperKindFromPath,
  wallpaperMediaUrl,
} from "../../../shared/wallpaper";
import { useT } from "../../hooks/useT";
import { useUiStore } from "../../stores/uiStore";
import { prefersReducedMotion } from "../../utils/animation";
import styles from "./WallpaperBackground.module.css";

/**
 * 全窗口背景壁纸（docs/design/111）：图片 / 视频铺在应用最底层，
 * 上面盖一层随主题取色的遮罩（强度由设置里的 wallpaperDim 控制）。
 * 素材经主进程的 pidesk-media 协议提供，渲染层不直接读 file://。
 */
export function WallpaperBackground({
  path,
  revision,
  dim,
}: {
  path: string;
  revision: number;
  dim: number;
}) {
  const t = useT();
  const { showToast } = useUiStore();
  const kind = wallpaperKindFromPath(path);
  const src = wallpaperMediaUrl(path, revision);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState(false);
  const reported = useRef(false);
  const reportFailure = (): void => {
    if (reported.current) return;
    reported.current = true;
    setFailed(true);
    showToast(
      t("settings.personalization.wallpaper.loadFailed", { name: wallpaperFileName(path) }),
    );
  };

  useEffect(() => {
    if (kind !== "video") return;
    const video = videoRef.current;
    if (!video) return;
    const play = (): void => {
      // 尊重"减少动态"：只显示首帧，不自动播放
      if (prefersReducedMotion() || document.hidden) return;
      void video.play().catch(() => {});
    };
    const onVisibility = (): void => {
      if (document.hidden) video.pause();
      else play();
    };
    play();
    video.addEventListener("loadeddata", play);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      video.removeEventListener("loadeddata", play);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [kind]);

  if (!kind || failed) return null;

  return (
    <div className={styles.layer} aria-hidden="true">
      {kind === "video" ? (
        <video
          ref={videoRef}
          className={styles.media}
          src={src}
          muted
          loop
          playsInline
          preload="auto"
          onError={reportFailure}
        />
      ) : (
        <img
          className={styles.media}
          src={src}
          alt=""
          draggable={false}
          decoding="async"
          onError={reportFailure}
        />
      )}
      <div className={styles.veil} style={{ "--wallpaper-dim": dim } as CSSProperties} />
    </div>
  );
}
