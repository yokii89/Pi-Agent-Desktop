import { MusicNotes } from "@phosphor-icons/react";
import { type SyntheticEvent, useCallback, useEffect, useRef, useState } from "react";
import type { FsPreviewMediaResult } from "../../../../shared/ipc";
import { useT } from "../../../hooks/useT";
import { pathBasename } from "../../../utils/fileOpen";
import { Select } from "../../ui/Select";
import panelStyles from "./FilePanel.module.css";
import styles from "./MediaPreview.module.css";

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => ({
  value: String(rate),
  label: `${rate}×`,
}));

function durationText(seconds: number): string {
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** 本地音视频播放器：隐藏时暂停，卸载时释放媒体源，不自动开始或恢复播放。 */
export function MediaPreview({
  result,
  path,
  active,
  onOpenInSystem,
}: {
  result: FsPreviewMediaResult;
  path: string;
  active: boolean;
  onOpenInSystem: () => void;
}) {
  const t = useT();
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const [activated, setActivated] = useState(() => active && !document.hidden);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [duration, setDuration] = useState<number | null>(null);
  const [resolution, setResolution] = useState<string | null>(null);
  const [rate, setRate] = useState("1");
  const attachMedia = useCallback((element: HTMLMediaElement | null): void => {
    mediaRef.current = element;
  }, []);

  const failed = status === "failed";

  useEffect(() => {
    const media = mediaRef.current;
    if (!media || failed || !activated) return;
    // effect 自己恢复源，React StrictMode 的清理重放也能重新加载。
    media.src = result.url;
    media.load();
    return () => {
      media.pause();
      media.removeAttribute("src");
      media.load();
    };
  }, [result.url, failed, activated]);

  useEffect(() => {
    const syncVisibility = (): void => {
      if (!active || document.hidden) mediaRef.current?.pause();
      else setActivated(true);
    };
    // 首次可见前不读取元信息；已激活后只暂停，保留进度与解码器以便用户继续。
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    return () => document.removeEventListener("visibilitychange", syncVisibility);
  }, [active]);

  const readMetadata = (event: SyntheticEvent<HTMLMediaElement>): void => {
    const media = event.currentTarget;
    if (media.readyState < HTMLMediaElement.HAVE_METADATA) return;
    setDuration(Number.isFinite(media.duration) && media.duration >= 0 ? media.duration : null);
    if (media instanceof HTMLVideoElement && media.videoWidth > 0) {
      setResolution(`${media.videoWidth}×${media.videoHeight}`);
    }
    setStatus("ready");
  };

  const mediaProps = {
    ref: attachMedia,
    controls: true,
    preload: "metadata" as const,
    "aria-label": pathBasename(path),
    onLoadedMetadata: readMetadata,
    onDurationChange: readMetadata,
    onRateChange: (event: SyntheticEvent<HTMLMediaElement>): void => {
      setRate(String(event.currentTarget.playbackRate));
    },
    onPlay: (event: SyntheticEvent<HTMLMediaElement>): void => {
      if (!active || document.hidden) event.currentTarget.pause();
    },
    onError: (): void => setStatus("failed"),
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.summary} data-selectable-text="">
        {result.mediaKind === "audio" && <MusicNotes size={24} weight="regular" />}
        <span className={styles.name}>{pathBasename(path)}</span>
        {(duration !== null || resolution !== null) && (
          <span className={styles.metadata}>
            {[
              duration !== null
                ? t("panels.files.media.duration", { duration: durationText(duration) })
                : null,
              resolution,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
      </div>
      {status !== "failed" && (
        <>
          {result.mediaKind === "video" ? (
            <video {...mediaProps} className={styles.video} playsInline />
          ) : (
            <audio {...mediaProps} className={styles.audio} />
          )}
          <div className={styles.toolbar}>
            <span className={styles.metadata} role="status">
              {status === "loading" ? t("panels.files.loading") : null}
            </span>
            <Select
              value={rate}
              options={PLAYBACK_RATES}
              ariaLabel={t("panels.files.media.playbackRate")}
              className={styles.rate}
              disabled={status !== "ready"}
              align="right"
              onChange={(value) => {
                if (mediaRef.current) mediaRef.current.playbackRate = Number(value);
              }}
            />
          </div>
        </>
      )}
      {status === "failed" && (
        <div className={panelStyles.binaryWrap} data-selectable-text="">
          <p className={panelStyles.binaryMeta} role="status">
            {t("panels.files.media.failed")}
          </p>
          <button type="button" className={panelStyles.binaryAction} onClick={onOpenInSystem}>
            {t("panels.files.openInSystem")}
          </button>
        </div>
      )}
    </div>
  );
}
