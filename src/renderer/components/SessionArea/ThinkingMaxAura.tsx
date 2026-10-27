import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "../../utils/animation";
import { GLIDE_MOTION } from "../../utils/motionTokens";
import styles from "./ThinkingMaxAura.module.css";

/** 同时在场的粒子上限与生成节奏（复刻设计稿 spSpawn/spTick 常量）。 */
const MAX_PARTICLES = 30;
const SPAWN_INTERVAL = 0.14;
/** 激活瞬间的铺场粒子数。 */
const BURST = 26;
/** 顶/底边缘的淡出带高度（px）。 */
const EDGE_FADE = 14;
/** 打字能量：每次输入 +0.22、上限 1.6（复刻设计稿 typing.energy），驱动粒子提速与增亮。 */
const STROKE_ENERGY = 0.22;
const ENERGY_MAX = 1.6;

interface Particle {
  x: number;
  y: number;
  r: number;
  vy: number;
  sway: number;
  phase: number;
  life: number;
  span: number;
}

/**
 * 思考等级顶档的输入栏特效（复刻 docs/ui-design/prompt-bar-micro-interactions.html 顶档粒子）：
 * 从输入卡底部上浮、随打字节奏加速增亮的主题色（--color-spark，由 accent 推导）粒子。左下角的静态起辉是
 * `.inputBox[data-max]::before`（TaskInput.module.css），不在这里。
 *
 * 生命周期即挂载：active 时才渲染，卸载即清场。高刷屏按 GLIDE_MOTION.fps 封顶重绘
 * （整卡画布逐帧 clear+重画，不封顶会在 120Hz+ 屏上白烧三倍绘制）。
 * `prefers-reduced-motion` 直接不出粒子（与设计稿一致，起辉不受影响）。
 */
export function ThinkingMaxAura() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (prefersReducedMotion()) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // 计算值里的 var() 已替换但 color-mix 不求值，canvas 的色解析器接受这个函数串，无需在 JS 里换算
    let spark = getComputedStyle(canvas).getPropertyValue("--color-spark").trim();
    if (!spark) return;

    let width = 0;
    let height = 0;
    let raf = 0;
    let last = performance.now();
    let due = 0;
    let speed = 1;
    let pulse = 0;
    let energy = 0;
    let strokes = 0;
    const parts: Particle[] = [];

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const spawn = (burst: boolean): void => {
      parts.push({
        x: Math.random() * width,
        y: burst ? height * (0.2 + Math.random() * 0.8) : height + 3,
        r: 0.9 + Math.random() * 1.1,
        vy: -(7 + Math.random() * 9),
        sway: (Math.random() - 0.5) * 10,
        phase: Math.random() * Math.PI * 2,
        life: burst ? Math.random() * 1.2 : 0,
        span: 2.4 + Math.random() * 2.4,
      });
    };

    // 高刷屏封顶：dt 累积到一帧步长才模拟+重绘，模拟用的 dt 仍是真实流逝时间
    const frame = 1 / GLIDE_MOTION.fps;

    const tick = (now: number): void => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      if (dt < frame - 0.004) return;
      last = now;

      energy *= Math.exp(-dt / 0.8);
      pulse *= Math.exp(-dt / 0.16);
      if (strokes > 0) {
        strokes = 0;
        pulse = 1;
      }
      speed += (1 + energy * 6 - speed) * (1 - Math.exp(-dt / 0.15));
      due += dt;
      while (due > SPAWN_INTERVAL) {
        due -= SPAWN_INTERVAL;
        if (parts.length < MAX_PARTICLES) spawn(false);
      }

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = spark;
      ctx.shadowColor = spark;
      ctx.shadowBlur = 6 + energy * 10 + pulse * 6;
      for (let i = parts.length - 1; i >= 0; i -= 1) {
        const p = parts[i];
        p.life += dt;
        if (p.life > p.span) {
          parts.splice(i, 1);
          continue;
        }
        const k = p.life / p.span;
        const twinkle = 0.7 + 0.3 * Math.sin((now / 160) * (1 + energy) + p.phase);
        p.y += p.vy * dt * speed;
        if (p.y < -4) {
          p.y = height + 3;
          p.x = Math.random() * width;
        }
        const edge = Math.min(
          1,
          Math.max(0, p.y / EDGE_FADE),
          Math.max(0, (height - p.y) / EDGE_FADE),
        );
        ctx.globalAlpha =
          Math.min(1, Math.sin(k * Math.PI) * (0.9 + energy * 0.25) * twinkle) * edge;
        ctx.beginPath();
        ctx.arc(
          p.x + Math.sin((now / 900) * (1 + energy * 0.8) + p.phase) * p.sway,
          p.y,
          p.r * twinkle * (1 + energy * 0.35),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    // 打字能量挂输入卡本体：composer 是 contenteditable，input 事件沿容器冒泡
    const host = canvas.parentElement;
    const onInput = (): void => {
      energy = Math.min(ENERGY_MAX, energy + STROKE_ENERGY);
      strokes = Math.min(4, strokes + 1);
    };
    host?.addEventListener("input", onInput, true);

    // 粒子色随主题变：data-theme 换两套令牌，style 是 applyAccentColor 写的主题色内联覆盖。
    // 根元素的内联 style 也会被字号/字体设置改写，先比对这些廉价的内联值，
    // 变了才读计算样式——否则每次无关写入都强制一次样式重算。
    const root = document.documentElement;
    const accentKey = (): string =>
      `${root.dataset.theme ?? ""}|${root.style.getPropertyValue("--color-accent")}`;
    let lastAccentKey = accentKey();
    const themeObserver = new MutationObserver(() => {
      const nextKey = accentKey();
      if (nextKey === lastAccentKey) return;
      lastAccentKey = nextKey;
      const next = getComputedStyle(canvas).getPropertyValue("--color-spark").trim();
      if (next) spark = next;
    });
    themeObserver.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme", "style"],
    });

    let lastWidth = canvas.width;
    let lastHeight = canvas.height;
    const observer = new ResizeObserver(() => {
      // observe() 的初始回调不算 resize（同 ThinkingLevelSlider 的防瞬跳守卫）
      if (canvas.width === lastWidth && canvas.height === lastHeight) return;
      lastWidth = canvas.width;
      lastHeight = canvas.height;
      resize();
    });

    resize();
    for (let i = 0; i < BURST; i += 1) spawn(true);
    observer.observe(canvas);
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      themeObserver.disconnect();
      host?.removeEventListener("input", onInput, true);
      ctx.clearRect(0, 0, width, height);
    };
  }, []);

  // 裸 canvas 无Fallback内容，辅助技术本就不读；不加 aria-hidden（biome 视 canvas 为可聚焦元素）
  return <canvas ref={canvasRef} className={styles.canvas} />;
}
