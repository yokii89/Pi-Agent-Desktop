import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getI18nLocale } from "../../../shared/i18n";
import type { RailStyle } from "../../../shared/railStyles";
import { useT } from "../../hooks/useT";
import type { SessionEntry } from "../../stores/sessionTranscript";
import { useUiStore } from "../../stores/uiStore";
import styles from "./QuestionRail.module.css";
import {
  buildQuestionSegments,
  pickActiveSegment,
  type QuestionRow,
  segmentVisualState,
} from "./questionRailModel";

/**
 * 对话问题导航分段栏（借鉴 ZCode `ConversationTurnNavigator`，docs/design/34）：
 * 每条用户问题一条短横线，悬停弹预览气泡、点击跳转，激活分段随滚动位置高亮并按
 * 距离分 4 档缩放。挂在 SessionView 的 .view（position:relative + container-type:
 * inline-size）下、absolute 左缘——不放进 .scroll/.entry 内部（overflow 与 paint
 * containment 都会裁剪气泡与横向放大）。纯逻辑见 questionRailModel.ts。
 */

/** 跳转落点：目标行顶对齐视口顶部留 8px。 */
const JUMP_TOP_GAP_PX = 8;
/** content-visibility:auto 估计高→实高切换会让落点漂移，scrollend 后校正上限。 */
const MAX_CORRECTIONS = 3;
/** 漂移小于该值视为已对准，不再校正（px）。 */
const DRIFT_TOLERANCE_PX = 2;
/** scrollend 兜底超时（部分滚动/瞬时路径不触发 scrollend）。 */
const SCROLLEND_FALLBACK_MS = 1000;
/** 悬停气泡开 / 关延迟（ms），对齐 ZCode HoverCard。 */
const OPEN_DELAY_MS = 120;
const CLOSE_DELAY_MS = 80;
/** hover / 键盘焦点段的透明度下限（在分档透明度之上再强调）。 */
const INTERACTION_OPACITY_FLOOR = 0.9;

/** 标记样式 id → 形状变体类（设置 → 个性化）；缩放轴由各类自决。 */
const MARKER_CLASS: Record<RailStyle, string> = {
  line: styles.mLine,
  dot: styles.mDot,
  tick: styles.mTick,
  pill: styles.mPill,
  diamond: styles.mDiamond,
  bar: styles.mBar,
  ring: styles.mRing,
};

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (): void => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** querySelector 属性值转义（entry id 形如 `entry-12`，仍走标准转义求稳）。 */
function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && CSS.escape
    ? CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&");
}

interface QuestionRailProps {
  entries: readonly SessionEntry[];
  /** 会话滚动容器（.scroll），跳转与激活跟踪都基于它。 */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** useStickToBottom 的定位跳转（先脱离 follow，再 smooth/瞬时滚动）。 */
  jumpToOffset: (px: number, behavior?: ScrollBehavior) => void;
}

export function QuestionRail({ entries, scrollRef, jumpToOffset }: QuestionRailProps) {
  const t = useT();
  // 语言切换只改预览里的图片计数文案；locale 进依赖让 segments 随之重算
  const locale = getI18nLocale();
  const railStyle = useUiStore().questionRailStyle;
  const markerClass = MARKER_CLASS[railStyle] ?? styles.mLine;
  const prefersReducedMotion = usePrefersReducedMotion();
  const reducedRef = useRef(prefersReducedMotion);
  useEffect(() => {
    reducedRef.current = prefersReducedMotion;
  }, [prefersReducedMotion]);

  // 用户问题的签名：只在用户条目集合/文本/图片数变化时重算 segments，避免助手流式
  // 增量（entries 引用每帧变化）反复重建、连带重挂 ResizeObserver。
  const userSignature = useMemo(() => {
    let signature = "";
    for (const entry of entries) {
      if (entry.kind !== "user") continue;
      signature += `${entry.id}:${entry.text.length}:${entry.images?.length ?? 0}\u0000`;
    }
    return signature;
  }, [entries]);

  // userSignature 已捕获用户条目全量变化；entries 引用每帧变，直接依赖会击穿 memo
  // biome-ignore lint/correctness/useExhaustiveDependencies: 故意以 userSignature/locale 作触发依赖，替代每帧变的 entries
  const segments = useMemo(() => buildQuestionSegments(entries), [userSignature, locale]);
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  const navRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [interactionIndex, setInteractionIndex] = useState<number | undefined>(undefined);
  const [bubble, setBubble] = useState<{ index: number; top: number } | null>(null);

  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const jumpCleanup = useRef<(() => void) | null>(null);

  const visible = segments.length >= 2;

  // --- 激活跟踪：实测每个用户行在内容中的位置，交给纯函数裁决 ---
  const measureRows = useCallback((): QuestionRow[] => {
    const container = scrollRef.current;
    if (!container) return [];
    const containerRect = container.getBoundingClientRect();
    const rows: QuestionRow[] = [];
    for (const segment of segmentsRef.current) {
      const el = container.querySelector<HTMLElement>(`[data-entry-id="${cssEscape(segment.id)}"]`);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const start = container.scrollTop + (rect.top - containerRect.top);
      rows.push({
        index: segment.index,
        start,
        end: start + Math.max(1, rect.height),
      });
    }
    return rows;
  }, [scrollRef]);

  const updateActive = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const active = pickActiveSegment(measureRows(), container.scrollTop, container.clientHeight);
    setActiveIndex(active === undefined ? -1 : active);
  }, [measureRows, scrollRef]);

  // rail 自挂 scroll 监听（rAF 节流）+ ResizeObserver：滚动、流式增长、cv 实现都重测
  useEffect(() => {
    if (!visible) return;
    const container = scrollRef.current;
    if (!container) return;
    let frame = 0;
    const schedule = (): void => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        updateActive();
      });
    };
    container.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    const content = container.firstElementChild;
    if (content) observer.observe(content);
    updateActive();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      container.removeEventListener("scroll", schedule);
      observer.disconnect();
    };
  }, [visible, scrollRef, updateActive]);

  // segments 变化（新用户问题）立即重测一次，不必等下一次滚动/resize
  // biome-ignore lint/correctness/useExhaustiveDependencies: segments 仅作重测触发器，体内未直接引用
  useEffect(() => {
    if (visible) updateActive();
  }, [segments, visible, updateActive]);

  // 激活分段在 rail 内保持可见（分段多时 rail 内部可滚）
  useEffect(() => {
    if (!visible || activeIndex < 0) return;
    const track = trackRef.current;
    const button = track?.querySelector<HTMLElement>(`[data-seg-index="${activeIndex}"]`);
    if (!track || !button) return;
    const top = button.offsetTop;
    const bottom = top + button.offsetHeight;
    if (top < track.scrollTop) track.scrollTop = Math.max(0, top - 4);
    else if (bottom > track.scrollTop + track.clientHeight) {
      track.scrollTop = bottom - track.clientHeight + 4;
    }
  }, [activeIndex, visible]);

  // --- 悬停预览气泡：120ms 开 / 80ms 关，rail 滚动或指针离开即关 ---
  const clearTimers = useCallback(() => {
    if (openTimer.current !== null) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const closeBubbleNow = useCallback(() => {
    clearTimers();
    setBubble(null);
  }, [clearTimers]);

  const scheduleOpen = useCallback((index: number, button: HTMLElement) => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (openTimer.current !== null) clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      const nav = navRef.current;
      if (!nav) return;
      const navRect = nav.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      setBubble({
        index,
        top: buttonRect.top - navRect.top + buttonRect.height / 2,
      });
    }, OPEN_DELAY_MS);
  }, []);

  const scheduleClose = useCallback(() => {
    if (openTimer.current !== null) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setBubble(null);
    }, CLOSE_DELAY_MS);
  }, []);

  // --- 点击跳转 + scrollend 后按实测位置校正 ≤3 轮 ---
  const jumpToSegment = useCallback(
    (index: number) => {
      const container = scrollRef.current;
      const segment = segmentsRef.current[index];
      if (!container || !segment) return;
      if (jumpCleanup.current) {
        jumpCleanup.current();
        jumpCleanup.current = null;
      }
      const selector = `[data-entry-id="${cssEscape(segment.id)}"]`;
      // 目标行顶相对视口顶与期望 8px 的偏差（>0 表示还需下滚）
      const measureDrift = (): number | null => {
        const el = container.querySelector<HTMLElement>(selector);
        if (!el) return null;
        const containerRect = container.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        return elRect.top - containerRect.top - JUMP_TOP_GAP_PX;
      };
      const firstDrift = measureDrift();
      if (firstDrift === null) return;
      const reduce = reducedRef.current;
      jumpToOffset(container.scrollTop + firstDrift, reduce ? "auto" : "smooth");
      if (reduce) return;

      let remaining = MAX_CORRECTIONS;
      let timer = 0;
      const arm = (): void => {
        container.addEventListener("scrollend", onSettled, { once: true });
        timer = window.setTimeout(onSettled, SCROLLEND_FALLBACK_MS);
      };
      const onSettled = (): void => {
        container.removeEventListener("scrollend", onSettled);
        if (timer) {
          clearTimeout(timer);
          timer = 0;
        }
        if (remaining <= 0) {
          jumpCleanup.current = null;
          return;
        }
        const drift = measureDrift();
        if (drift === null || Math.abs(drift) <= DRIFT_TOLERANCE_PX) {
          jumpCleanup.current = null;
          return;
        }
        remaining -= 1;
        jumpToOffset(container.scrollTop + drift, "auto");
        arm();
      };
      jumpCleanup.current = () => {
        container.removeEventListener("scrollend", onSettled);
        if (timer) clearTimeout(timer);
      };
      arm();
    },
    [scrollRef, jumpToOffset],
  );

  // 卸载清理：气泡定时器与跳转校正监听
  useEffect(
    () => () => {
      if (jumpCleanup.current) jumpCleanup.current();
      if (openTimer.current !== null) clearTimeout(openTimer.current);
      if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    },
    [],
  );

  const handleSegmentKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const next = index + (event.key === "ArrowDown" ? 1 : -1);
      if (next < 0 || next >= segmentsRef.current.length) return;
      trackRef.current?.querySelector<HTMLElement>(`[data-seg-index="${next}"]`)?.focus();
    },
    [],
  );

  if (!visible) return null;

  const focusIndex = activeIndex >= 0 ? activeIndex : undefined;
  const bubbleSegment = bubble ? segments[bubble.index] : undefined;

  return (
    <nav
      ref={navRef}
      className={styles.rail}
      data-style={railStyle}
      aria-label={t("session.rail.label")}
      onPointerLeave={() => {
        setInteractionIndex(undefined);
        scheduleClose();
      }}
    >
      <div
        ref={trackRef}
        className={styles.track}
        onScroll={closeBubbleNow}
        onPointerLeave={closeBubbleNow}
      >
        {segments.map((segment) => {
          const visual = segmentVisualState(segment.index, focusIndex);
          const emphasized = segment.index === interactionIndex;
          const active = segment.index === activeIndex;
          return (
            // biome-ignore lint/a11y/useAriaPropsSupportedByRole: 规格要求按钮带 aria-posinset/setsize 播报位置
            <button
              key={segment.id}
              type="button"
              className={styles.seg}
              data-seg-index={segment.index}
              aria-label={t("session.rail.jumpTo", {
                index: segment.index + 1,
              })}
              aria-posinset={segment.index + 1}
              aria-setsize={segments.length}
              aria-current={active ? "location" : undefined}
              onPointerEnter={(event) => {
                setInteractionIndex(segment.index);
                scheduleOpen(segment.index, event.currentTarget);
              }}
              onPointerLeave={() => {
                setInteractionIndex(undefined);
                scheduleClose();
              }}
              onFocus={(event) => {
                setInteractionIndex(segment.index);
                scheduleOpen(segment.index, event.currentTarget);
              }}
              onBlur={() => {
                setInteractionIndex(undefined);
                scheduleClose();
              }}
              onClick={() => jumpToSegment(segment.index)}
              onKeyDown={(event) => handleSegmentKeyDown(event, segment.index)}
            >
              <span
                className={`${styles.marker} ${markerClass} ${
                  visual.focus || emphasized ? styles.markerFocus : ""
                }`}
                style={
                  {
                    opacity: emphasized
                      ? Math.max(visual.opacity, INTERACTION_OPACITY_FLOOR)
                      : visual.opacity,
                    "--seg-scale": visual.scaleX,
                  } as CSSProperties
                }
              />
            </button>
          );
        })}
      </div>
      {bubble && bubbleSegment && (
        <div className={styles.bubble} style={{ top: bubble.top }}>
          {bubbleSegment.preview}
        </div>
      )}
    </nav>
  );
}
