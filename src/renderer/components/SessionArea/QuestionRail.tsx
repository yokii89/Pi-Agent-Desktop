import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getI18nLocale } from "../../../shared/i18n";
import type { SessionEntry } from "../../stores/sessionTranscript";
import { useUiStore } from "../../stores/uiStore";
import { prefersReducedMotion } from "../../utils/animation";
import { QuestionRailMenu } from "./QuestionRailMenu";
import {
  createQuestionSegmentsSelector,
  pickActiveSegment,
  type QuestionRow,
  type QuestionSegment,
} from "./questionRailModel";

/** 跳转落点：目标行顶对齐视口顶部留 8px。 */
const JUMP_TOP_GAP_PX = 8;
/** content-visibility:auto 估计高→实高切换会让落点漂移，scrollend 后校正上限。 */
const MAX_CORRECTIONS = 3;
const DRIFT_TOLERANCE_PX = 2;
/** 部分滚动/瞬时路径不触发 scrollend。 */
const SCROLLEND_FALLBACK_MS = 1000;

interface QuestionRailProps {
  entries: readonly SessionEntry[];
  scrollRef: RefObject<HTMLDivElement | null>;
  /** 先脱离 follow，再 smooth/瞬时滚动。 */
  jumpToOffset: (px: number, behavior?: ScrollBehavior) => void;
}

/** 对话问题导航：追踪正文位置与校正跳转；目录交互由 QuestionRailMenu 承接。 */
export function QuestionRail({ entries, scrollRef, jumpToOffset }: QuestionRailProps) {
  const locale = getI18nLocale();
  const railStyle = useUiStore().questionRailStyle;
  const selectSegments = useMemo(createQuestionSegmentsSelector, []);
  const segments = selectSegments(entries, locale);
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  const [activeIndex, setActiveIndex] = useState(-1);
  const jumpCleanup = useRef<(() => void) | null>(null);
  const visible = segments.length >= 2;
  const anchors = useRef<{
    container: HTMLElement;
    segments: readonly QuestionSegment[];
    elements: Map<string, HTMLElement>;
  } | null>(null);

  const measureRows = useCallback((): QuestionRow[] => {
    const container = scrollRef.current;
    if (!container) return [];
    const currentSegments = segmentsRef.current;
    if (anchors.current?.container !== container || anchors.current.segments !== currentSegments) {
      anchors.current = {
        container,
        segments: currentSegments,
        elements: new Map(
          Array.from(
            container.querySelectorAll<HTMLElement>('[data-kind="user"][data-entry-id]'),
            (el) => [el.dataset.entryId ?? "", el],
          ),
        ),
      };
    }
    const elements = anchors.current.elements;
    const containerRect = container.getBoundingClientRect();
    const scrollTop = container.scrollTop;
    const rows: QuestionRow[] = [];
    for (const segment of currentSegments) {
      let el = elements.get(segment.id);
      // 只缓存节点，不缓存几何：折叠正文与 content-visibility 实现仍会改变位置。
      if (!el?.isConnected) {
        el =
          container.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(segment.id)}"]`) ??
          undefined;
        if (el) elements.set(segment.id, el);
      }
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const start = scrollTop + (rect.top - containerRect.top);
      rows.push({ index: segment.index, start, end: start + Math.max(1, rect.height) });
    }
    return rows;
  }, [scrollRef]);

  const updateActive = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    setActiveIndex(
      pickActiveSegment(measureRows(), container.scrollTop, container.clientHeight) ?? -1,
    );
  }, [measureRows, scrollRef]);

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
    if (container.firstElementChild) observer.observe(container.firstElementChild);
    updateActive();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      container.removeEventListener("scroll", schedule);
      observer.disconnect();
    };
  }, [visible, scrollRef, updateActive]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: segments 变化需要立即重测，不依赖异步 resize
  useEffect(() => {
    if (visible) updateActive();
  }, [segments, visible, updateActive]);

  const jumpToSegment = useCallback(
    (index: number) => {
      const container = scrollRef.current;
      const segment = segmentsRef.current[index];
      if (!container || !segment) return;
      jumpCleanup.current?.();
      jumpCleanup.current = null;
      const selector = `[data-entry-id="${CSS.escape(segment.id)}"]`;
      const measureDrift = (): number | null => {
        const el = container.querySelector<HTMLElement>(selector);
        if (!el) return null;
        return (
          el.getBoundingClientRect().top - container.getBoundingClientRect().top - JUMP_TOP_GAP_PX
        );
      };
      const firstDrift = measureDrift();
      if (firstDrift === null) return;
      const reduce = prefersReducedMotion();
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

  useEffect(() => () => jumpCleanup.current?.(), []);

  if (!visible) return null;
  return (
    <QuestionRailMenu
      segments={segments}
      activeIndex={activeIndex}
      railStyle={railStyle}
      onJump={jumpToSegment}
    />
  );
}
