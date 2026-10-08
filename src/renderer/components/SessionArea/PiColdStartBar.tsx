import { useEffect, useRef, useState } from "react";
import { useT } from "../../hooks/useT";
import { type Gsap, loadGsap, prefersReducedMotion } from "../../utils/animation";
import { COLD_START_MOTION } from "../../utils/motionTokens";
import styles from "./PiColdStartBar.module.css";

/** 分段 key（位置即身份，静态列表）：预生成稳定字符串，避开 index key。 */
const SEGMENT_KEYS = Array.from(
  { length: COLD_START_MOTION.segments },
  (_, index) => `cold-start-segment-${index}`,
);

interface PiColdStartBarProps {
  /** 冷启动进行中（active 桶 startPending 且本气泡是最后一条用户消息）。 */
  active: boolean;
  /** 收尾动画（补到 100% + 淡出）播完后回调，父级据此卸载本组件。 */
  onFinished: () => void;
}

/**
 * 冷启动进度条（docs/会话进程懒加载方案 Phase 2）：嵌入触发冷启动的最后一条
 * 用户气泡内，是 spawn 窗口期（约 1–4s）唯一的过程反馈——此间 phase 仍为 idle、
 * 侧栏无旋转。active 期间分段轨道爬行到 90% 封顶；进程就绪（active 翻 false）
 * 补到 100% 并淡出，onFinished 后由父级卸载，气泡高度自然回退。
 * 启动失败由父级直接停渲染（桶回 idle 时 processAlive=false），不走收尾动画。
 */
export function PiColdStartBar({ active, onFinished }: PiColdStartBarProps) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  const activeRef = useRef(active);
  activeRef.current = active;
  /** 爬行 effect 异步加载 GSAP 期间就绪翻 false 时，置位交给加载完的回调执行。 */
  const finishRef = useRef<() => void>(() => {});
  const [reducedMotion] = useState(prefersReducedMotion);

  // reduced-motion：不播动画，就绪即卸载（验收 §8 静态文案降级项）
  useEffect(() => {
    if (reducedMotion && !active) onFinishedRef.current();
  }, [active, reducedMotion]);

  useEffect(() => {
    if (reducedMotion) return;
    const root = rootRef.current;
    const track = trackRef.current;
    if (!root || !track) return;

    const segments = Array.from(track.children) as HTMLElement[];
    const proxy = { progress: 0 };
    let litCount = -1;
    const paint = (): void => {
      const count = Math.min(
        COLD_START_MOTION.segments,
        Math.floor((proxy.progress / 100) * COLD_START_MOTION.segments),
      );
      if (count === litCount) return;
      litCount = count;
      for (let i = 0; i < segments.length; i += 1) {
        segments[i].classList.toggle(styles.segmentActive, i < count);
      }
    };

    let cancelled = false;
    let gsapInstance: Gsap | null = null;
    let finishRequested = false;
    /** Tween / Timeline 公共能力只有 kill；收尾 timeline 与爬行 tween 混存。 */
    const tweens: Array<{ kill(): void }> = [];

    const runFinish = (loaded: Gsap): void => {
      const timeline = loaded.timeline({ onComplete: () => onFinishedRef.current() });
      tweens.push(timeline);
      timeline
        .to(proxy, {
          progress: 100,
          duration: COLD_START_MOTION.complete,
          ease: "none",
          onUpdate: paint,
        })
        .to(root, {
          opacity: 0,
          duration: COLD_START_MOTION.fadeOut,
          ease: COLD_START_MOTION.easeOut,
        });
    };

    const finish = (): void => {
      if (finishRequested) return;
      finishRequested = true;
      // GSAP 尚未加载完（极端快速就绪）：ready 后由加载回调补执行
      if (gsapInstance) runFinish(gsapInstance);
    };
    finishRef.current = finish;

    void loadGsap().then((loaded) => {
      if (cancelled) return;
      gsapInstance = loaded;
      if (finishRequested) {
        runFinish(loaded);
        return;
      }
      tweens.push(
        loaded.to(proxy, {
          progress: 90,
          duration: COLD_START_MOTION.crawl,
          ease: COLD_START_MOTION.easeCrawl,
          onUpdate: paint,
        }),
      );
      // 挂载同帧进程已就绪的竞态：跳过爬行直接收尾
      if (!activeRef.current) finish();
    });

    return () => {
      cancelled = true;
      for (const tween of tweens) tween.kill();
    };
  }, [reducedMotion]);

  // 进程就绪：补到 100% + 淡出后卸载，不跳版（§4.2）
  useEffect(() => {
    if (!reducedMotion && !active) finishRef.current();
  }, [active, reducedMotion]);

  if (reducedMotion) {
    return (
      <div className={styles.bar} role="status">
        <span className={styles.label}>{t("session.coldStart.process")}</span>
      </div>
    );
  }

  return (
    <div ref={rootRef} className={styles.bar} role="status">
      <div ref={trackRef} className={styles.track} aria-hidden>
        {SEGMENT_KEYS.map((key) => (
          <span key={key} className={styles.segment} />
        ))}
      </div>
      <span className={styles.label}>{t("session.coldStart.process")}</span>
    </div>
  );
}
