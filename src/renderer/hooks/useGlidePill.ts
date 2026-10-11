import {
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { type GlideCancel, glide, mix } from "../utils/glideMotion";
import { GLIDE_MOTION } from "../utils/motionTokens";

/** 参与高亮滑行的行：必须带 data-glide-index（值即行序）。 */
const ROW_SELECTOR = "[data-glide-index]";

interface ScrubSession {
  /** 落点行序，用于判断"回到原行松开"（此时浏览器仍会派发 click）。 */
  fromIndex: number;
  moved: boolean;
}

export interface GlidePillApi {
  /** 挂到列表容器（需 position: relative 且自身或其后代负责滚动）。 */
  listProps: {
    onPointerOver: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerLeave: () => void;
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    /** 键盘 Tab / 方向键把焦点移到某行时，高亮跟着走。 */
    onFocus: (event: ReactFocusEvent<HTMLElement>) => void;
  };
  /** 挂到药丸元素（`<span className={styles.pill} aria-hidden />`）。 */
  pillRef: RefObject<HTMLSpanElement | null>;
  /** 受控高亮：键盘导航或外部激活态变化时把药丸移到第 index 行。 */
  highlight: (index: number | null, instant?: boolean) => void;
  /** 列表刚打开时把药丸**瞬移**到当前行，否则会看到它从第 0 行滑过去，像选错了项。 */
  jumpTo: (index: number | null) => void;
  /** 当前被指向的行序（悬停、聚焦与键盘光标共用这一个真相，不再另存一份 state）。 */
  current: () => number | null;
  /**
   * 行自身 onClick 的第一句：擦选已经代它激活过时返回 true，调用方应当跳过。
   * `event.detail === 0` 是键盘合成的 click，永远不跳过。
   */
  consumeClick: (detail: number) => boolean;
}

interface GlidePillOptions {
  /** 擦选（按住拖动换行后松开）落在某行时的激活回调。 */
  onPick?: (index: number) => void;
  /** 指针离开列表后是否保留高亮（默认保留，对齐参考稿 rememberPosition）。 */
  rememberPosition?: boolean;
}

/**
 * 下拉列表的「高亮药丸」：整段滚动动画只由一处 `translateY` 补间完成（docs/design/51）。
 *
 * 为什么不逐行切背景：连续擦选时逐行的淡入淡出会糊成一片闪动，
 * 药丸把「哪一行被指向」变成一个连续的空间位移，只有合成层参与，不触发布局。
 * 行位置按实测 `offsetTop/offsetHeight` 而不是 `index * rowHeight`——
 * 真实条目有图标、尾巴提示和分隔线，高度并不统一。
 */
export function useGlidePill(
  listRef: RefObject<HTMLElement | null>,
  { onPick, rememberPosition = true }: GlidePillOptions = {},
): GlidePillApi {
  const pillRef = useRef<HTMLSpanElement>(null);
  const state = useRef({ y: 0, height: 0, opacity: 0, index: null as number | null });
  const moveTween = useRef<GlideCancel>(() => {});
  const fadeTween = useRef<GlideCancel>(() => {});
  const scrub = useRef<ScrubSession | null>(null);
  const picked = useRef(false);
  /** 当前登记在 window 上的拖拽监听：函数每次渲染都是新标识，必须原样摘除。 */
  const attached = useRef<{
    move: (e: PointerEvent) => void;
    up: (e: PointerEvent) => void;
  } | null>(null);
  const options = useRef({ onPick, rememberPosition });
  options.current = { onPick, rememberPosition };

  const apply = (): void => {
    const pill = pillRef.current;
    if (!pill) return;
    const { y, height, opacity } = state.current;
    pill.style.transform = `translateY(${y.toFixed(2)}px)`;
    pill.style.height = `${height.toFixed(2)}px`;
    pill.style.opacity = String(opacity);
  };

  const rowByIndex = (index: number | null): HTMLElement | null => {
    const list = listRef.current;
    if (!list || index === null) return null;
    return list.querySelector<HTMLElement>(`${ROW_SELECTOR}[data-glide-index="${index}"]`);
  };

  const hide = (): void => {
    moveTween.current();
    fadeTween.current();
    const current = state.current;
    current.index = null;
    if (current.opacity <= 0) return;
    const from = current.opacity;
    fadeTween.current = glide({
      duration: GLIDE_MOTION.pillFade,
      onUpdate: (p) => {
        current.opacity = mix(from, 0, p);
        apply();
      },
    });
  };

  const moveTo = (row: HTMLElement | null, instant: boolean): void => {
    if (!row) {
      hide();
      return;
    }
    const current = state.current;
    const index = Number(row.dataset.glideIndex);
    const targetY = row.offsetTop;
    const targetHeight = row.offsetHeight;
    // 首次出现（或外部要求瞬移）直接落位：从上一段目标滑过来会被看成选错了行
    const jump = instant || current.index === null || current.opacity < 1;

    moveTween.current();
    fadeTween.current();
    current.index = index;

    if (jump) {
      current.y = targetY;
      current.height = targetHeight;
      apply();
    } else {
      const fromY = current.y;
      const fromHeight = current.height;
      moveTween.current = glide({
        duration: GLIDE_MOTION.glide,
        onUpdate: (p) => {
          current.y = mix(fromY, targetY, p);
          current.height = mix(fromHeight, targetHeight, p);
          apply();
        },
      });
    }

    if (current.opacity < 1) {
      const from = current.opacity;
      fadeTween.current = glide({
        duration: GLIDE_MOTION.pillFade,
        onUpdate: (p) => {
          current.opacity = mix(from, 1, p);
          apply();
        },
      });
    }
  };

  /**
   * 命中测试走 elementFromPoint 而不是 (clientY - top) / step：
   * 列表内部滚动、行高不齐、分隔线占了额外高度，算术命中会整段偏一格。
   */
  const rowAt = (x: number, y: number): HTMLElement | null => {
    const list = listRef.current;
    const hit = document.elementFromPoint(x, y);
    if (!list || !hit) return null;
    const row = hit.closest<HTMLElement>(ROW_SELECTOR);
    return row && list.contains(row) ? row : null;
  };

  const detachScrub = useCallback((): void => {
    if (!attached.current) return;
    window.removeEventListener("pointermove", attached.current.move);
    window.removeEventListener("pointerup", attached.current.up);
    window.removeEventListener("pointercancel", attached.current.up);
    attached.current = null;
  }, []);

  const onScrubUp = (event: PointerEvent): void => {
    const session = scrub.current;
    if (!session) return;
    scrub.current = null;
    detachScrub();

    const row = rowAt(event.clientX, event.clientY);
    if (!row || !session.moved) return;
    if (row instanceof HTMLButtonElement && row.disabled) return;
    const index = Number(row.dataset.glideIndex);
    // 绕回原行松开时浏览器仍会派发 click，这里标记一次让行自己跳过
    picked.current = index === session.fromIndex;
    options.current.onPick?.(index);
  };

  const onScrubMove = (event: PointerEvent): void => {
    if (!scrub.current) return;
    const row = rowAt(event.clientX, event.clientY);
    // 指针短暂滑出列表（行间距、滚动条）时保持上一行，别让高亮一闪一闪
    if (!row) return;
    const index = Number(row.dataset.glideIndex);
    if (index === state.current.index) return;
    scrub.current.moved = true;
    moveTo(row, false);
  };

  useEffect(
    () => () => {
      moveTween.current();
      fadeTween.current();
      detachScrub();
    },
    [detachScrub],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0 || scrub.current) return;
    const row = rowAt(event.clientX, event.clientY);
    picked.current = false;
    moveTo(row, true);
    scrub.current = { fromIndex: row ? Number(row.dataset.glideIndex) : -1, moved: false };
    detachScrub();
    attached.current = { move: onScrubMove, up: onScrubUp };
    window.addEventListener("pointermove", attached.current.move);
    window.addEventListener("pointerup", attached.current.up);
    window.addEventListener("pointercancel", attached.current.up);
  };

  const follow = (target: EventTarget | null, instant: boolean): void => {
    const row = target instanceof Element ? target.closest<HTMLElement>(ROW_SELECTOR) : null;
    if (!row) return;
    if (!instant && Number(row.dataset.glideIndex) === state.current.index) return;
    moveTo(row, instant);
  };

  return {
    listProps: {
      onPointerOver: (event) => {
        if (event.pointerType === "touch" || scrub.current) return;
        follow(event.target, false);
      },
      onFocus: (event) => {
        if (scrub.current) return;
        follow(event.target, false);
      },
      onPointerLeave: () => {
        if (!scrub.current && !options.current.rememberPosition) hide();
      },
      onPointerDown,
    },
    pillRef,
    highlight: (index, instant = false) => moveTo(rowByIndex(index), instant),
    jumpTo: (index) => moveTo(rowByIndex(index), true),
    current: () => state.current.index,
    consumeClick: (detail) => {
      if (detail === 0 || !picked.current) return false;
      picked.current = false;
      return true;
    },
  };
}
