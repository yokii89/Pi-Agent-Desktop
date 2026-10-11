import { prefersReducedMotion } from "./animation";
import { GLIDE_MOTION } from "./motionTokens";

/**
 * 浮层与分段控件共用的定帧补间驱动，封顶 60fps
 * （docs/design/51 复刻 `docs/ui-design/glide-select-bezier.html`，
 *  docs/design/52 复刻 `docs/ui-design/rubber-segment-rubber-band.html`）。
 *
 * 为什么不是 CSS transition：CSS 只有"时长"没有"帧率"，封顶不了——120/144Hz 屏上
 * 同一段动效会跑成 120–144 次重绘，观感更碎、功耗更高。锁 60 之后，
 * 60Hz 屏上逐帧推进（等于不封顶），高刷屏上稳定压在 60。
 * 为什么不是 GSAP：`gsap.ticker.fps()` 是**全局**时间轴，一动就连带
 * 侧栏折叠、行菜单悬浮揭示等已验收的动效一起改档（docs/design/45/46）。
 * 这条独立时间轴按固定步长推进，与 GSAP 互不影响；
 * 换帧率只改 GLIDE_MOTION.fps 一处，时长（pop/glide/…）不受影响。
 */

/** 一次补间的取消句柄；被打断时由新补间接管当前值，旧句柄只负责停表。 */
export type GlideCancel = () => void;

/** 三次贝塞尔求值：CSS `cubic-bezier(x1,y1,x2,y2)` 的 y(x)，牛顿迭代 + 二分兜底。 */
export function makeCubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): (t: number) => number {
  const a = (p: number, q: number) => 1 - 3 * q + 3 * p;
  const b = (p: number, q: number) => 3 * q - 6 * p;
  const c = (p: number) => 3 * p;
  const evaluate = (t: number, p: number, q: number) => ((a(p, q) * t + b(p, q)) * t + c(p)) * t;
  const slope = (t: number, p: number, q: number) => 3 * a(p, q) * t * t + 2 * b(p, q) * t + c(p);

  return (x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;

    let t = x;
    for (let i = 0; i < 8; i++) {
      const error = evaluate(t, x1, x2) - x;
      if (Math.abs(error) < 1e-6) return evaluate(t, y1, y2);
      const d = slope(t, x1, x2);
      if (Math.abs(d) < 1e-6) break;
      t -= error / d;
    }

    // 曲线在 x1/x2 接近 0 或 1 时斜率会退化，牛顿跑出场外就退回二分，保证单调有界
    let low = 0;
    let high = 1;
    t = x;
    for (let i = 0; i < 20 && Math.abs(evaluate(t, x1, x2) - x) > 1e-6; i++) {
      if (evaluate(t, x1, x2) > x) high = t;
      else low = t;
      t = (low + high) / 2;
    }
    return evaluate(t, y1, y2);
  };
}

/** 参考稿那条曲线：菜单弹出、药丸滑行、箭头翻转共用。 */
export const glideEase = makeCubicBezier(...GLIDE_MOTION.easeOut);

/** 线性插值，配合 eased progress 用。 */
export const mix = (from: number, to: number, progress: number): number =>
  from + (to - from) * progress;

const linear = (t: number): number => t;

/**
 * 阻尼弹簧的整定映射，对齐上游 motion 库的 `{ type: "spring", duration, bounce }`：
 * 阻尼比 ζ = 1 - bounce，固有频率 ω 取「duration 秒内衰减到 0.1%」。
 * bounce 为 0 时 ζ = 1，落在临界阻尼分支（到位但不外弹）。
 */
export function springParams(duration: number, bounce: number): { zeta: number; omega: number } {
  const zeta = Math.min(1, Math.max(0.05, 1 - bounce));
  return { zeta, omega: -Math.log(0.001) / (zeta * duration) };
}

/**
 * 阻尼振子闭式解：给定相对目标的初始偏移 y0 与初速度 v0，返回 t 秒时的 [位置, 速度]。
 * 解析式而不是逐帧积分，所以补间被高刷屏/掉帧怎么取帧都一样，落点不漂。
 */
export function springAt(
  y0: number,
  v0: number,
  to: number,
  duration: number,
  bounce: number,
  t: number,
): [number, number] {
  const { zeta, omega } = springParams(duration, bounce);
  const s = zeta * omega;

  if (zeta >= 1 - 1e-6) {
    const a = y0;
    const b = v0 + s * a;
    const e = Math.exp(-s * t);
    return [to + (a + b * t) * e, (b - s * (a + b * t)) * e];
  }

  const d = omega * Math.sqrt(1 - zeta * zeta);
  const a = y0;
  const b = (v0 + s * a) / d;
  const e = Math.exp(-s * t);
  const cos = Math.cos(d * t);
  const sin = Math.sin(d * t);
  return [to + e * (a * cos + b * sin), e * ((-s * a + d * b) * cos + (-s * b - d * a) * sin)];
}

/** 弹簧跑完名义整定时长后再多演一成，才认为振子已经停住（对齐参考稿的 dur × 1.12）。 */
const SPRING_SETTLE_SPAN = 1.12;

/**
 * 在同一条定帧时间轴（封顶 60fps）上跑一段阻尼弹簧。
 *
 * `onUpdate` 收到解析速度（值/秒），被打断时把它原样交给下一段补间，
 * 否则半途换向会出现肉眼可见的速度台阶。`velocity` 是接管到的初速度。
 */
export function glideSpring(options: {
  from: number;
  to: number;
  duration: number;
  bounce?: number;
  velocity?: number;
  onUpdate: (value: number, velocity: number) => void;
  onComplete?: () => void;
}): GlideCancel {
  const { from, to, duration } = options;
  const bounce = options.bounce ?? 0;
  const velocity = options.velocity ?? 0;
  const span = duration * SPRING_SETTLE_SPAN;

  return glide({
    duration: span,
    ease: linear,
    onUpdate: (progress) => {
      // progress 已经是真实时间占比（ease 为线性），换算成秒喂给闭式解
      if (progress >= 1) {
        options.onUpdate(to, 0);
        return;
      }
      const [value, valueVelocity] = springAt(
        from - to,
        velocity,
        to,
        duration,
        bounce,
        progress * span,
      );
      options.onUpdate(value, valueVelocity);
    },
    onComplete: options.onComplete,
  });
}

interface GlideEntry {
  elapsed: number;
  duration: number;
  ease: (t: number) => number;
  onUpdate: (easedProgress: number) => void;
  onComplete?: () => void;
}

const FRAME_SECONDS = 1 / GLIDE_MOTION.fps;
/**
 * 60Hz 屏上一帧恰好 1/60s，浮点误差会把它判成"不足一步"而整条轴掉到 30fps，
 * 所以阈值留 4ms 余量。平均帧率仍由真实时间决定（每步固定消耗一个 FRAME_SECONDS），
 * 容差只影响落相位，不会让补间跑快。
 */
const FRAME_TOLERANCE = 0.004;
/** 单帧最多补 3 步：窗口被遮挡或后台恢复时，不按真实流逝时间一次把补间推完。 */
const MAX_CATCH_UP = 3;

const entries = new Set<GlideEntry>();
let rafId: number | null = null;
let lastNow = 0;
let carry = 0;

function advance(entry: GlideEntry): void {
  entry.elapsed += FRAME_SECONDS;
  // 30 × (1/30) 在浮点下略小于 1，不留容差就会多等一整帧才收尾
  if (entry.elapsed >= entry.duration - 1e-6) {
    entries.delete(entry);
    entry.onUpdate(1);
    entry.onComplete?.();
    return;
  }
  entry.onUpdate(entry.ease(entry.elapsed / entry.duration));
}

function pump(now: number): void {
  // 上限 100ms：rAF 被节流（窗口遮挡、后台标签）时不让补间一次跳完
  carry += Math.min(0.1, (now - lastNow) / 1000);
  lastNow = now;

  let steps = 0;
  while (carry >= FRAME_SECONDS - FRAME_TOLERANCE && steps < MAX_CATCH_UP) {
    carry -= FRAME_SECONDS;
    steps++;
    // 快照后再推进：onUpdate 里可能同步开启/取消别的补间
    for (const entry of [...entries]) advance(entry);
  }
  if (steps === MAX_CATCH_UP) carry = 0;

  if (entries.size === 0) stop();
  else rafId = requestAnimationFrame(pump);
}

function start(): void {
  if (rafId !== null) return;
  lastNow = performance.now();
  carry = 0;
  rafId = requestAnimationFrame(pump);
}

function stop(): void {
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = null;
}

/**
 * 在浮层的定帧时间轴（封顶 60fps）上补间一段进度。
 *
 * `onUpdate` 收到的是**已缓动**的 0→1；调用方用 `mix()` 映射到自己的属性
 * （translateY、scale、rotate…）。同一元素重复触发时，新补间要从"当前视觉值"
 * 起步，否则药丸会在半途被拉回上一段的目标行。
 * 命中 `prefers-reduced-motion` 时直接落终态并立即回调。
 */
export function glide(options: {
  duration: number;
  onUpdate: (easedProgress: number) => void;
  onComplete?: () => void;
  ease?: (t: number) => number;
}): GlideCancel {
  const { duration, onUpdate, onComplete } = options;

  if (duration <= 0 || prefersReducedMotion()) {
    onUpdate(1);
    onComplete?.();
    return () => {};
  }

  const entry: GlideEntry = {
    elapsed: 0,
    duration,
    ease: options.ease ?? glideEase,
    onUpdate,
    onComplete,
  };
  entries.add(entry);
  start();

  return () => {
    entries.delete(entry);
    if (entries.size === 0) stop();
  };
}

/** 当前在跑的补间数量（仅用于自测/量帧，不参与渲染逻辑）。 */
export function activeGlideCount(): number {
  return entries.size;
}
