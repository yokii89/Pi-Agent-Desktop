import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { SPLASH_MONO_STACK, type SplashConfig } from "../../../shared/splash";
import { browserService } from "../../services/browserService";
import { prefersReducedMotion } from "../../utils/animation";
import { PiMark } from "./PiMark";
import styles from "./SplashScreen.module.css";

interface SplashScreenProps {
  config: SplashConfig;
  onDone: () => void;
}

/** 首屏兜底黑幕由 index.html 提供；遮罩一挂载就接管，避免闪出主界面。 */
function removeBootCurtain(): void {
  document.getElementById("boot-curtain")?.remove();
}

/**
 * 启动动画：黑幕 → 标识/三行文字 → 收字距 → 扫光 → 后撤淡出。
 * 动画走 CSS 过渡 + setTimeout（启动首帧不加载 GSAP）；时长按 speed 同步缩放。
 */
export function SplashScreen({ config, onDone }: SplashScreenProps) {
  const [visible, setVisible] = useState(false);
  const [tighten, setTighten] = useState(false);
  const [sweep, setSweep] = useState(false);
  const [handoff, setHandoff] = useState(false);
  const doneRef = useRef(false);
  // 父级重渲染可能换掉 onDone 引用；时间线只认 config，不能因此重启
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useLayoutEffect(() => {
    removeBootCurtain();
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    void browserService.setOverlaySuppressed(true, "splash");
    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      void browserService.setOverlaySuppressed(false, "splash");
    };
  }, []);

  useEffect(() => {
    const speed = Math.min(3, Math.max(0.35, config.speed || 1));
    const ms = (base: number) => Math.round(base / speed);
    const timers: number[] = [];
    const at = (delay: number, run: () => void): void => {
      timers.push(window.setTimeout(run, delay));
    };
    const finish = (): void => {
      if (doneRef.current) return;
      doneRef.current = true;
      onDoneRef.current();
    };

    if (prefersReducedMotion()) {
      // 减少动效：直接显示，短暂停留后立即揭幕（CSS 同时禁用过渡）
      setVisible(true);
      at(900, () => setHandoff(true));
      at(1200, finish);
    } else {
      at(ms(820), () => setVisible(true));
      at(ms(1060), () => setTighten(true));
      at(ms(1940), () => setSweep(true));
      at(ms(3090), () => setHandoff(true));
      at(ms(3870), finish);
    }

    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [config]);

  const style = {
    "--splash-dur": String(1 / Math.min(3, Math.max(0.35, config.speed || 1))),
    "--splash-logo-size": `${config.logoSize}px`,
    "--splash-font": config.fontStack,
    "--splash-mono": SPLASH_MONO_STACK,
  } as CSSProperties;

  return (
    <div
      className={[styles.root, handoff ? styles.rootHandoff : ""].join(" ").trim()}
      style={style}
      aria-hidden="true"
      data-splash=""
    >
      <div className={[styles.inner, visible ? styles.innerIn : ""].join(" ").trim()}>
        {config.logoImage ? (
          <img className={styles.logoImg} src={config.logoImage} alt="" draggable={false} />
        ) : (
          <PiMark className={styles.logoMark} />
        )}
        {config.textZh ? <div className={styles.zh}>{config.textZh}</div> : null}
        {config.textEn ? (
          <div className={[styles.en, tighten ? styles.enTighten : ""].join(" ").trim()}>
            {config.textEn}
          </div>
        ) : null}
        {config.textSub ? <div className={styles.sub}>{config.textSub}</div> : null}
      </div>
      <div className={[styles.sweep, sweep ? styles.sweepGo : ""].join(" ").trim()} />
    </div>
  );
}
