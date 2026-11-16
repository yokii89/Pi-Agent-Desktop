import {
  type CSSProperties,
  memo,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { RailStyle } from "../../../shared/railStyles";
import { useGlideOverlay } from "../../hooks/useGlideOverlay";
import { useT } from "../../hooks/useT";
import { QUESTION_NAV_MOTION } from "../../utils/motionTokens";
import { OptionList, type OptionListHandle } from "../ui/OptionList";
import styles from "./QuestionRail.module.css";
import { type QuestionSegment, segmentVisualState } from "./questionRailModel";

const MARKER_CLASS: Record<RailStyle, string> = {
  line: styles.mLine,
  dot: styles.mDot,
  tick: styles.mTick,
  pill: styles.mPill,
  diamond: styles.mDiamond,
  bar: styles.mBar,
  ring: styles.mRing,
};

interface QuestionRailMenuProps {
  segments: readonly QuestionSegment[];
  activeIndex: number;
  railStyle: RailStyle;
  onJump: (index: number) => void;
}

/** 左侧刻度与完整问题目录；开合、焦点与悬停生命周期不参与正文的滚动定位。 */
export const QuestionRailMenu = memo(function QuestionRailMenu({
  segments,
  activeIndex,
  railStyle,
  onJump,
}: QuestionRailMenuProps) {
  const t = useT();
  const id = useId();
  const navRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<OptionListHandle>(null);
  const overlay = useGlideOverlay(panelRef, QUESTION_NAV_MOTION.overlay);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const opened = useRef(false);
  const fresh = useRef(true);
  const focusOnOpen = useRef<number | null>(null);
  const triggerIndex = useRef(0);
  const suppressHover = useRef(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const current = useRef({ activeIndex, segments });
  current.current = { activeIndex, segments };

  const clearTimers = useCallback(() => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
  }, []);

  const close = useCallback(() => {
    clearTimers();
    if (!opened.current) return;
    if (panelRef.current?.contains(document.activeElement)) {
      trackRef.current
        ?.querySelector<HTMLButtonElement>(`[data-seg-index="${triggerIndex.current}"]`)
        ?.focus({ preventScroll: true });
    }
    opened.current = false;
    setOpen(false);
  }, [clearTimers]);

  const show = useCallback(
    (keyboardIndex: number | null = null) => {
      clearTimers();
      focusOnOpen.current = keyboardIndex;
      if (keyboardIndex !== null) triggerIndex.current = keyboardIndex;
      else triggerIndex.current = Math.max(0, current.current.activeIndex);
      if (opened.current) {
        if (keyboardIndex !== null) listRef.current?.focusRow(keyboardIndex);
        return;
      }
      opened.current = true;
      setMounted(true);
      setOpen(true);
    },
    [clearTimers],
  );

  const scheduleClose = useCallback(() => {
    clearTimers();
    closeTimer.current = setTimeout(() => {
      if (!navRef.current?.contains(document.activeElement)) close();
    }, QUESTION_NAV_MOTION.closeDelay);
  }, [clearTimers, close]);

  useLayoutEffect(() => {
    if (!mounted) return;
    if (open) {
      if (fresh.current) {
        overlay.prime();
        fresh.current = false;
        const index = Math.max(0, current.current.activeIndex);
        const row = panelRef.current?.querySelector<HTMLElement>(`[data-glide-index="${index}"]`);
        const list = row?.parentElement;
        if (row && list)
          list.scrollTop = Math.max(
            0,
            row.offsetTop - list.clientHeight / 2 + row.offsetHeight / 2,
          );
      }
      overlay.enter();
      if (focusOnOpen.current !== null) {
        listRef.current?.focusRow(focusOnOpen.current);
        focusOnOpen.current = null;
      }
    } else {
      overlay.exit(() => {
        fresh.current = true;
        setMounted(false);
      });
    }
    return overlay.cancel;
  }, [open, mounted, overlay]);

  // 左栏隐藏或窗口变矮时同步收口；限高取实际会话区域，长目录在内部滚动。
  useLayoutEffect(() => {
    const nav = navRef.current;
    const view = nav?.parentElement;
    if (!nav || !view) return;
    const resize = () => {
      nav.style.setProperty(
        "--question-directory-max-height",
        `${Math.max(0, view.clientHeight - 32)}px`,
      );
      if (nav.getClientRects().length === 0) close();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(view);
    return () => observer.disconnect();
  }, [close]);

  useEffect(() => {
    const track = trackRef.current;
    const button = track?.querySelector<HTMLElement>(`[data-seg-index="${activeIndex}"]`);
    if (!track || !button) return;
    if (button.offsetTop < track.scrollTop) track.scrollTop = button.offsetTop;
    else if (button.offsetTop + button.offsetHeight > track.scrollTop + track.clientHeight) {
      track.scrollTop = button.offsetTop + button.offsetHeight - track.clientHeight;
    }
  }, [activeIndex]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !navRef.current?.contains(event.target)) close();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      suppressHover.current = true;
      close();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", onEscape, true);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", onEscape, true);
      window.removeEventListener("blur", close);
    };
  }, [open, close]);

  useEffect(() => clearTimers, [clearTimers]);

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case "ArrowDown":
        listRef.current?.moveCursor(1);
        break;
      case "ArrowUp":
        listRef.current?.moveCursor(-1);
        break;
      case "Home":
        listRef.current?.toEdge("first");
        break;
      case "End":
        listRef.current?.toEdge("last");
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const markerClass = MARKER_CLASS[railStyle] ?? styles.mLine;
  return (
    <nav
      ref={navRef}
      className={styles.rail}
      data-style={railStyle}
      aria-label={t("session.rail.label")}
      onPointerEnter={(event) => {
        clearTimers();
        if (event.pointerType !== "touch" && !suppressHover.current) {
          openTimer.current = setTimeout(() => show(), QUESTION_NAV_MOTION.openDelay);
        }
      }}
      onPointerLeave={() => {
        suppressHover.current = false;
        scheduleClose();
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <div ref={trackRef} className={styles.track}>
        {segments.map((segment) => {
          const visual = segmentVisualState(
            segment.index,
            activeIndex >= 0 ? activeIndex : undefined,
          );
          return (
            <button
              key={segment.id}
              type="button"
              className={styles.seg}
              data-seg-index={segment.index}
              aria-label={`${t("session.rail.jumpTo", { index: segment.index + 1 })}: ${segment.preview}`}
              aria-current={segment.index === activeIndex ? "location" : undefined}
              aria-haspopup="menu"
              aria-expanded={open}
              aria-controls={mounted ? id : undefined}
              tabIndex={segment.index === Math.max(0, activeIndex) ? 0 : -1}
              onClick={(event) => {
                triggerIndex.current = segment.index;
                show(event.detail === 0 ? segment.index : null);
              }}
              onKeyDown={(event) => {
                if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                event.preventDefault();
                show(segment.index);
              }}
            >
              <span
                className={`${styles.marker} ${markerClass} ${visual.focus ? styles.markerFocus : ""}`}
                style={{ opacity: visual.opacity, "--seg-scale": visual.scaleX } as CSSProperties}
              />
            </button>
          );
        })}
      </div>
      {mounted && (
        <div className={styles.directoryAnchor}>
          <div ref={panelRef} className={styles.directory} id={id} data-overlay-panel inert={!open}>
            <OptionList
              ref={listRef}
              role="menu"
              ariaLabel={t("session.rail.label")}
              className={styles.directoryList}
              rememberPosition={false}
              preventFocusOnPointer
              rows={segments.map((segment) => ({
                key: segment.id,
                text: segment.preview,
                title: segment.preview,
                className: `${styles.directoryRow} ${segment.index === activeIndex ? styles.directoryCurrent : ""}`,
                node: (
                  <>
                    <span className={styles.directoryMark} aria-hidden="true" />
                    <span
                      className={styles.directoryLabel}
                      aria-current={segment.index === activeIndex ? "location" : undefined}
                    >
                      {segment.preview}
                    </span>
                  </>
                ),
              }))}
              onKeyDown={onListKeyDown}
              onSelect={(index) => {
                suppressHover.current = true;
                close();
                onJump(index);
              }}
            />
          </div>
        </div>
      )}
    </nav>
  );
});
