import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useT } from "../../hooks/useT";
import { type GlideCancel, glide, makeCubicBezier, mix } from "../../utils/glideMotion";
import { GLIDE_MOTION, SEND_MOTION } from "../../utils/motionTokens";
import styles from "./SendButton.module.css";

/**
 * 发送箭头与停止方块的 7 个顶点（24×24 viewBox，取自设计稿 Hugeicons 几何）：
 * 同一组顶点在两形状间插值，"发送"与"停止"互相变成对方而不是硬切图标。
 */
const ARROW_UP = [12, 4.5, 18.5, 11, 14.25, 11, 14.25, 19.5, 9.75, 19.5, 9.75, 11, 5.5, 11];
const SQUARE = [12, 6, 18, 6, 18, 12, 18, 18, 6, 18, 6, 12, 6, 6];

const morphEase = makeCubicBezier(...SEND_MOTION.ease);

function pathAt(a: readonly number[], b: readonly number[], t: number): string {
  let d = "";
  for (let i = 0; i < a.length; i += 2) {
    d += `${i ? "L" : "M"}${mix(a[i], b[i], t).toFixed(2)} ${mix(a[i + 1], b[i + 1], t).toFixed(2)}`;
  }
  return `${d}Z`;
}

interface SendButtonProps {
  running: boolean;
  canSend: boolean;
  onSend: () => void;
  onStop: () => void;
}

/**
 * 输入栏的发送/停止一体键（复刻设计稿 send 键）：idle 是上箭头，running 形变为停止方块，
 * 中途叠加 sin(πt) 的挤压与倾斜（方向随形变翻转）。形变走浮层定帧时间轴
 * （docs/design/51，帧率见 GLIDE_MOTION.fps），reduced-motion 直接落终态。
 * 按压回弹同轴（--send-press，scale 由 CSS 静态消费）。
 */
export function SendButton({ running, canSend, onSend, onStop }: SendButtonProps) {
  const t = useT();
  const btnRef = useRef<HTMLButtonElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);

  /** 形变进度：0 = 箭头，1 = 方块。 */
  const vRef = useRef(0);
  const dirRef = useRef(-1);
  const tweenRef = useRef<GlideCancel>(() => {});
  const pressRef = useRef(0);
  const pressTween = useRef<GlideCancel>(() => {});
  /** null = 尚未挂载：首挂直接落位，不演开场形变。 */
  const prevRunning = useRef<boolean | null>(null);

  const apply = useCallback((v: number): void => {
    vRef.current = v;
    const path = pathRef.current;
    const svg = svgRef.current;
    if (!path || !svg) return;
    path.setAttribute("d", pathAt(ARROW_UP, SQUARE, v));
    const goo = Math.sin(v * Math.PI);
    const sx = 1 - SEND_MOTION.squash * goo;
    svg.style.transform = goo
      ? `rotate(${(dirRef.current * SEND_MOTION.tilt * goo).toFixed(3)}deg) scale(${sx.toFixed(4)}, ${(1 / sx).toFixed(4)})`
      : "";
  }, []);

  useLayoutEffect(() => {
    const prev = prevRunning.current;
    prevRunning.current = running;
    const target = running ? 1 : 0;
    if (prev === null || prev === running) {
      apply(target);
      return;
    }
    // 中途打断从当前视觉值接着演：连发/急停不闪回
    dirRef.current = running ? 1 : -1;
    tweenRef.current();
    const from = vRef.current;
    tweenRef.current = glide({
      duration: SEND_MOTION.morph,
      ease: morphEase,
      onUpdate: (p) => apply(mix(from, target, p)),
    });
  }, [running, apply]);

  const setPress = useCallback((next: boolean): void => {
    pressTween.current();
    const from = pressRef.current;
    pressTween.current = glide({
      duration: GLIDE_MOTION.press,
      onUpdate: (p) => {
        pressRef.current = mix(from, next ? 1 : 0, p);
        btnRef.current?.style.setProperty("--send-press", pressRef.current.toFixed(3));
      },
    });
  }, []);

  useEffect(
    () => () => {
      tweenRef.current();
      pressTween.current();
    },
    [],
  );

  const armed = running || canSend;

  return (
    <button
      ref={btnRef}
      type="button"
      className={[styles.button, running ? styles.running : ""].join(" ")}
      title={running ? t("session.input.stop") : t("session.input.send")}
      aria-label={running ? t("session.input.stop") : t("session.input.send")}
      disabled={!armed}
      onClick={() => (running ? onStop() : onSend())}
      onPointerDown={(event) => {
        if (event.button === 0 && armed) setPress(true);
      }}
      onPointerUp={() => setPress(false)}
      onPointerLeave={() => setPress(false)}
      onPointerCancel={() => setPress(false)}
    >
      <svg
        ref={svgRef}
        className={styles.glyph}
        viewBox="0 0 24 24"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path ref={pathRef} />
      </svg>
    </button>
  );
}
