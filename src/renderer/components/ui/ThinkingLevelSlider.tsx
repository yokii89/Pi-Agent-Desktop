import { Question } from "@phosphor-icons/react";
import { useCallback, useLayoutEffect, useRef } from "react";
import type { ThinkingLevelId } from "../../../shared/ipc";
import { useT } from "../../hooks/useT";
import { type GlideCancel, glide, mix } from "../../utils/glideMotion";
import { GLIDE_MOTION } from "../../utils/motionTokens";
import styles from "./ThinkingLevelSlider.module.css";

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
}

/**
 * 思考等级滑轨浮层（复刻 docs/ui-design/prompt-bar-micro-interactions.html 的强度滑轨）：
 * 头部档位名 + 两端「更快 / 更准」+ 可拖拽/键盘操作的档位轨道。
 *
 * thumb 与进度条的位移在浮层定帧时间轴上补间（docs/design/51）：组件把 `--effort-x` /
 * `--effort-fill` 逐帧写到轨道节点，CSS 只描述静息几何与颜色，不写 transition。
 */
export function ThinkingLevelSlider({
  levels,
  value,
  onChange,
  title,
  valueLabel,
  hint,
  disabled: externalDisabled,
}: SliderProps) {
  const t = useT();
  const count = Math.max(1, levels.length);
  const index = Math.max(0, levels.indexOf(value));
  const maxed = index === count - 1 && count > 1;
  // 只有一个档位 = 模型不支持思考（pi 返回 ["off"]）：轨道只作状态展示
  const single = count <= 1;
  const disabled = externalDisabled === true || single;

  const trackRef = useRef<HTMLDivElement>(null);
  const tweenRef = useRef<GlideCancel>(() => {});
  /** 首次定位（面板每次打开都重新挂载）不吃动画，之后换档才补间。 */
  const primedRef = useRef(false);
  const visualRef = useRef({ x: 0, fill: 0 });

  const write = useCallback((): void => {
    const track = trackRef.current;
    if (!track) return;
    track.style.setProperty("--effort-x", `${visualRef.current.x.toFixed(2)}px`);
    track.style.setProperty("--effort-fill", `${visualRef.current.fill.toFixed(2)}px`);
  }, []);

  useLayoutEffect(() => {
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
        visualRef.current = { x, fill };
        write();
        return;
      }
      // 从当前视觉值接着演：连点换档不会闪回上一档
      const from = { ...visualRef.current };
      tweenRef.current = glide({
        duration: GLIDE_MOTION.glide,
        onUpdate: (p) => {
          visualRef.current = { x: mix(from.x, x, p), fill: mix(from.fill, fill, p) };
          write();
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
  }, [index, count, write]);

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
      const k = (event.clientX - rect.left - TRACK_EDGE) / Math.max(1, rect.width - TRACK_EDGE * 2);
      applyIndex(Math.round(k * (count - 1)));
    },
    [applyIndex, count],
  );

  return (
    <div
      className={styles.panel}
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
      <div className={styles.ends}>
        <span>{t("session.thinking.faster")}</span>
        <span>{t("session.thinking.smarter")}</span>
      </div>
      <div
        ref={trackRef}
        className={styles.track}
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
          // capture 住指针：拖出轨道仍持续命中
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // 个别指针类型不支持 capture，退化为仅点击生效
          }
          event.currentTarget.focus({ preventScroll: true });
          setFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (disabled) return;
          if (event.buttons & 1) setFromPointer(event);
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
      </div>
      {hint && <p className={styles.note}>{hint}</p>}
      {single && <p className={styles.note}>{t("session.thinking.unavailable")}</p>}
    </div>
  );
}
