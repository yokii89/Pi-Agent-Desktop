import { useEffect, useRef, useState } from "react";
import { useT } from "../../hooks/useT";
import { type Gsap, loadGsap, prefersReducedMotion } from "../../utils/animation";
import { RUN_ACTIVITY_MOTION } from "../../utils/motionTokens";
import styles from "./RunActivityLabel.module.css";

/** 运行态的文字微光：首字等待与后续活动共用一个落点，计时不参与读屏播报。 */
export function RunActivityLabel({ waitingForFirstToken }: { waitingForFirstToken: boolean }) {
  const t = useT();
  const labelRef = useRef<HTMLSpanElement>(null);
  const [waitVisible, setWaitVisible] = useState(false);

  useEffect(() => {
    if (!waitingForFirstToken) {
      setWaitVisible(false);
      return;
    }
    // 沿用首字占位延迟，快速响应不闪一下「等待模型响应」。
    const timer = window.setTimeout(
      () => setWaitVisible(true),
      RUN_ACTIVITY_MOTION.waitDelay * 1000,
    );
    return () => window.clearTimeout(timer);
  }, [waitingForFirstToken]);

  useEffect(() => {
    const label = labelRef.current;
    if (!label) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false;
    let gsap: Gsap | null = null;
    let tween: ReturnType<Gsap["fromTo"]> | null = null;

    const syncMotion = (): void => {
      if (prefersReducedMotion()) {
        tween?.revert();
        tween = null;
        label.classList.remove(styles.shimmer);
        return;
      }
      if (!gsap) return;
      if (!tween) {
        label.classList.add(styles.shimmer);
        tween = gsap.fromTo(
          label,
          { backgroundPositionX: "140%" },
          {
            backgroundPositionX: "-40%",
            duration: RUN_ACTIVITY_MOTION.sweep,
            ease: RUN_ACTIVITY_MOTION.ease,
            repeat: -1,
          },
        );
      }
      tween.paused(document.hidden);
    };

    media.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncMotion);
    void loadGsap()
      .then((loaded) => {
        if (disposed) return;
        gsap = loaded;
        syncMotion();
      })
      .catch(() => {
        // 动效 chunk 加载失败时保留静态文字，状态仍可读。
      });

    return () => {
      disposed = true;
      media.removeEventListener("change", syncMotion);
      document.removeEventListener("visibilitychange", syncMotion);
      tween?.revert();
      label.classList.remove(styles.shimmer);
    };
  }, []);

  return (
    <span ref={labelRef} className={styles.label} role="status">
      {t(waitingForFirstToken && waitVisible ? "session.firstToken" : "session.piState.running")}
    </span>
  );
}
