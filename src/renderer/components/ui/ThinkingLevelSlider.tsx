import { Question } from "@phosphor-icons/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ThinkingLevelId } from "../../../shared/ipc";
import { useT } from "../../hooks/useT";
import { prefersReducedMotion } from "../../utils/animation";
import { type GlideCancel, glide, mix } from "../../utils/glideMotion";
import { GLIDE_MOTION } from "../../utils/motionTokens";
import styles from "./ThinkingLevelSlider.module.css";
import { createThinkingMatrixRenderer, type ThinkingMatrixRenderer } from "./thinkingLevelMatrix";

/** 轨道两端留白：thumb（14px 宽）两侧各留半枚身位再加呼吸，复刻设计稿的 EDGE=11。 */
const TRACK_EDGE = 11;
/** thumb 半宽：进度条充到 thumb 中心后再探出半个身位，顶档才整条充满。 */
const THUMB_HALF = 7;

interface SliderProps {
  levels: readonly ThinkingLevelId[];
  value: ThinkingLevelId;
  onChange: (level: ThinkingLevelId) => void;
  /** 头部标题（输入栏「思考等级」/ 设置页「思考档位」）。 */
  title: string;
  /** 头部当前值文案（输入栏档位名 / 设置页「N 档」）。 */
  valueLabel: string;
  /** 轨道下方的补充说明（设置页给档位数的解释）；输入栏不用。 */
  hint?: string;
  /** 外部禁用（保存中）；单档模型本身的禁用由 levels.length 推导。 */
  disabled?: boolean;
  /** 输入栏使用像素矩阵与彗星动效；设置页保留紧凑滑轨。 */
  variant?: "compact" | "input";
}

/**
 * 思考等级滑轨：输入栏浮层用像素矩阵/彗星轨迹，模型设置页保留紧凑档位滑轨。
 * 两种外观共用同一组可用档位、指针与键盘操作，具体能力由调用方的 levels 决定。
 *
 * 输入栏的画布只在浮层挂载期间运行，定帧上限来自 GLIDE_MOTION.fps；
 * prefers-reduced-motion 命中时只绘制当前档位的静态状态。
 */
export function ThinkingLevelSlider({
  levels,
  value,
  onChange,
  title,
  valueLabel,
  hint,
  disabled: externalDisabled,
  variant = "compact",
}: SliderProps) {
  const t = useT();
  const inputVariant = variant === "input";
  const count = Math.max(1, levels.length);
  const index = Math.max(0, levels.indexOf(value));
  const normalized = count > 1 ? index / (count - 1) : 0;
  const maxed = index === count - 1 && count > 1;
  // 只有一个档位 = 模型不支持思考（pi 返回 ["off"]）：轨道只作状态展示
  const single = count <= 1;
  const disabled = externalDisabled === true || single;

  const trackRef = useRef<HTMLDivElement>(null);
  const matrixCanvasRef = useRef<HTMLCanvasElement>(null);
  const raysCanvasRef = useRef<HTMLCanvasElement>(null);
  const cometCanvasRef = useRef<HTMLCanvasElement>(null);
  const tweenRef = useRef<GlideCancel>(() => {});
  const matrixRendererRef = useRef<ThinkingMatrixRenderer | null>(null);
  /** 首次定位（面板每次打开都重新挂载）不吃动画，之后换档才补间。 */
  const primedRef = useRef(false);
  const compactVisualRef = useRef({ x: 0, fill: 0 });
  const inputValueRef = useRef(normalized);
  const targetValueRef = useRef(normalized);
  const reducedMotionRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  const writeCompact = useCallback((): void => {
    const track = trackRef.current;
    if (!track) return;
    track.style.setProperty("--effort-x", `${compactVisualRef.current.x.toFixed(2)}px`);
    track.style.setProperty("--effort-fill", `${compactVisualRef.current.fill.toFixed(2)}px`);
  }, []);

  const writeInput = useCallback((next: number): void => {
    const track = trackRef.current;
    if (!track) return;
    track.style.setProperty("--effort-pct", `${(4 + next * 92).toFixed(3)}%`);
  }, []);

  useLayoutEffect(() => {
    targetValueRef.current = normalized;
    if (!inputVariant) return;
    if (reducedMotionRef.current) {
      inputValueRef.current = normalized;
      writeInput(normalized);
      matrixRendererRef.current?.render(0, normalized);
      return;
    }
    // 首帧先把彗星放到当前档位；之后的换档由定帧循环接管，避免弹层初开时从左端闪过。
    writeInput(inputValueRef.current);
  }, [inputVariant, normalized, writeInput]);

  useEffect(() => {
    if (!inputVariant) return;
    const track = trackRef.current;
    const matrixCanvas = matrixCanvasRef.current;
    const raysCanvas = raysCanvasRef.current;
    const cometCanvas = cometCanvasRef.current;
    if (!track || !matrixCanvas || !raysCanvas || !cometCanvas) return;

    const renderer = createThinkingMatrixRenderer(matrixCanvas, raysCanvas, cometCanvas);
    if (!renderer) return;
    matrixRendererRef.current = renderer;
    reducedMotionRef.current = prefersReducedMotion();
    renderer.resize();
    writeInput(inputValueRef.current);
    renderer.render(0, inputValueRef.current);

    let time = 0;
    let last = performance.now();
    let raf = 0;
    let lastSize = `${track.clientWidth}:${track.clientHeight}`;
    const frame = 1 / GLIDE_MOTION.fps;

    const tick = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000);
      if (dt >= frame - 0.004) {
        last = now;
        time += dt;
        const difference = targetValueRef.current - inputValueRef.current;
        if (Math.abs(difference) > 0.0005) {
          inputValueRef.current += difference * Math.min(1, dt * 14);
        } else {
          inputValueRef.current = targetValueRef.current;
        }
        writeInput(inputValueRef.current);
        renderer.render(time, inputValueRef.current);
      }
      raf = requestAnimationFrame(tick);
    };

    const resizeObserver = new ResizeObserver(() => {
      const nextSize = `${track.clientWidth}:${track.clientHeight}`;
      if (nextSize === lastSize) return;
      lastSize = nextSize;
      renderer.resize();
      renderer.render(time, inputValueRef.current);
    });
    resizeObserver.observe(track);

    const root = document.documentElement;
    const themeObserver = new MutationObserver(() => {
      renderer.refreshPalette();
      renderer.render(time, inputValueRef.current);
    });
    themeObserver.observe(root, { attributes: true, attributeFilter: ["data-theme", "style"] });

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotionPreferenceChange = (): void => {
      reducedMotionRef.current = media.matches;
      if (media.matches) {
        inputValueRef.current = targetValueRef.current;
        writeInput(inputValueRef.current);
        renderer.render(time, inputValueRef.current);
        if (raf !== 0) cancelAnimationFrame(raf);
        raf = 0;
      } else if (raf === 0 && !single) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };
    media.addEventListener("change", onMotionPreferenceChange);

    if (!reducedMotionRef.current && !single) raf = requestAnimationFrame(tick);

    return () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      media.removeEventListener("change", onMotionPreferenceChange);
      matrixRendererRef.current = null;
    };
  }, [inputVariant, single, writeInput]);

  useLayoutEffect(() => {
    if (inputVariant) return;
    const track = trackRef.current;
    if (!track) return;

    const place = (animate: boolean): void => {
      const width = track.clientWidth;
      if (width <= 0) return;
      const inner = Math.max(0, width - TRACK_EDGE * 2);
      const x = TRACK_EDGE + inner * (index / Math.max(1, count - 1));
      // 顶档整条充满（与设计稿 fillAt 一致），其余档充到 thumb 中心 + 半宽
      const fill = index === count - 1 ? width : x + THUMB_HALF;
      tweenRef.current();
      if (!animate || !primedRef.current) {
        primedRef.current = true;
        compactVisualRef.current = { x, fill };
        writeCompact();
        return;
      }
      // 从当前视觉值接着演：连点换档不会闪回上一档
      const from = { ...compactVisualRef.current };
      tweenRef.current = glide({
        duration: GLIDE_MOTION.glide,
        onUpdate: (p) => {
          compactVisualRef.current = { x: mix(from.x, x, p), fill: mix(from.fill, fill, p) };
          writeCompact();
        },
      });
    };

    place(primedRef.current);
    let lastWidth = track.clientWidth;
    const observer = new ResizeObserver(() => {
      // observe() 本身必发一次初始回调：宽度没变就不是真 resize，
      // 不能走 place(false)——否则换档刚启动的补间会被立刻写成终值（表现为瞬跳）
      const width = track.clientWidth;
      if (width === lastWidth) return;
      lastWidth = width;
      place(false);
    });
    observer.observe(track);
    return () => {
      tweenRef.current();
      observer.disconnect();
    };
  }, [index, count, inputVariant, writeCompact]);

  const applyIndex = useCallback(
    (next: number): void => {
      const level = levels[Math.min(count - 1, Math.max(0, next))];
      if (level && level !== value) onChange(level);
    },
    [levels, count, value, onChange],
  );

  const setFromPointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      const rect = event.currentTarget.getBoundingClientRect();
      const offset = event.clientX - rect.left;
      const ratio = inputVariant
        ? offset / Math.max(1, rect.width)
        : (offset - TRACK_EDGE) / Math.max(1, rect.width - TRACK_EDGE * 2);
      applyIndex(Math.round(ratio * (count - 1)));
    },
    [applyIndex, count, inputVariant],
  );

  return (
    <div
      className={[styles.panel, inputVariant ? styles.inputPanel : ""].filter(Boolean).join(" ")}
      data-max={maxed ? "" : undefined}
      data-single={single ? "" : undefined}
    >
      <div className={styles.head}>
        <span className={styles.title}>{title}</span>
        <span className={styles.level}>{valueLabel}</span>
        <span className={styles.help} title={t("session.thinking.help")}>
          <Question size={14} weight="regular" />
        </span>
      </div>
      {!inputVariant && (
        <div className={styles.ends}>
          <span>{t("session.thinking.faster")}</span>
          <span>{t("session.thinking.smarter")}</span>
        </div>
      )}
      <div
        ref={trackRef}
        className={[
          styles.track,
          inputVariant ? styles.inputTrack : "",
          dragging ? styles.dragging : "",
        ]
          .filter(Boolean)
          .join(" ")}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={title}
        aria-disabled={disabled || undefined}
        aria-valuemin={0}
        aria-valuemax={count - 1}
        aria-valuenow={index}
        aria-valuetext={valueLabel}
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) return;
          setDragging(inputVariant);
          // capture 住指针：拖出轨道仍持续命中
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // 个别指针类型不支持 capture，退化为仅点击生效
          }
          event.currentTarget.focus({ preventScroll: true });
          setFromPointer(event);
        }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onPointerMove={(event) => {
          if (disabled) return;
          if (event.buttons & 1) setFromPointer(event);
        }}
        onWheel={(event) => {
          if (!inputVariant || disabled) return;
          event.preventDefault();
          applyIndex(index + (event.deltaY < 0 ? 1 : -1));
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          const step =
            event.key === "ArrowRight" || event.key === "ArrowUp"
              ? 1
              : event.key === "ArrowLeft" || event.key === "ArrowDown"
                ? -1
                : 0;
          if (step) {
            event.preventDefault();
            applyIndex(index + step);
          } else if (event.key === "Home") {
            event.preventDefault();
            applyIndex(0);
          } else if (event.key === "End") {
            event.preventDefault();
            applyIndex(count - 1);
          }
        }}
      >
        {inputVariant ? (
          <>
            <span className={styles.matrixViewport} aria-hidden="true">
              <canvas ref={matrixCanvasRef} className={styles.matrixCanvas} />
            </span>
            <span className={styles.raysCanvas} aria-hidden="true">
              <canvas ref={raysCanvasRef} className={styles.raysArtwork} />
            </span>
            <span className={styles.cometHandle} aria-hidden="true">
              <canvas ref={cometCanvasRef} className={styles.cometCanvas} />
            </span>
          </>
        ) : (
          <>
            <span className={styles.fill} aria-hidden="true" />
            {levels.map((level, i) => (
              <i
                key={level}
                className={styles.dot}
                aria-hidden="true"
                style={{
                  left: `calc(${TRACK_EDGE}px + (100% - ${TRACK_EDGE * 2}px) * ${
                    count > 1 ? i / (count - 1) : 0
                  })`,
                }}
              />
            ))}
            <span className={styles.thumb} aria-hidden="true" />
          </>
        )}
      </div>
      {hint && <p className={styles.note}>{hint}</p>}
      {single && <p className={styles.note}>{t("session.thinking.unavailable")}</p>}
    </div>
  );
}
