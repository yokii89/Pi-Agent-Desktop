import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { collectMatchRanges } from "../utils/previewFind";
import { revealInNearestScroller } from "../utils/revealInScroller";

/** CSS Custom Highlight 的登记名：全部命中一档，当前命中一档（见 FilePanel.module.css）。 */
const HIGHLIGHT_ALL = "pidesk-find";
const HIGHLIGHT_ACTIVE = "pidesk-find-active";

/** 引擎是否支持 CSS Custom Highlight API（不支持时查找仍可计数跳转，只是不上色）。 */
const canHighlight = (): boolean => typeof CSS !== "undefined" && "highlights" in CSS;

interface PreviewFindState {
  open: boolean;
  query: string;
  /** 命中总数。 */
  count: number;
  /** 当前命中序号（1-based，显示用）；无命中为 0。 */
  current: number;
  openFind: () => void;
  close: () => void;
  setQuery: (value: string) => void;
  /** 前后跳转；delta 为正表示向下。 */
  step: (delta: number) => void;
}

/**
 * 文件面板内的 Ctrl+F 查找：命中用 CSS Custom Highlight 上色（不改 DOM），
 * 当前命中滚进视野并单独高亮一档。
 *
 * `contentKey` 是内容身份（预览路径 + md 预览/源码切换）：它变化时清空查询重新找。
 * 内容异步到位（Markdown、shiki 高亮）靠 MutationObserver 兜底重算——此时 Range 会失效，
 * 不重算就会停在「有命中数、画面上没高亮」的状态。
 */
export function usePreviewFind(
  containerRef: RefObject<HTMLElement | null>,
  contentKey: string | null,
): PreviewFindState {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [count, setCount] = useState(0);
  const [index, setIndex] = useState(0);
  const rangesRef = useRef<Range[]>([]);
  const indexRef = useRef(0);
  indexRef.current = index;

  const clearHighlights = useCallback((): void => {
    if (!canHighlight()) return;
    CSS.highlights.delete(HIGHLIGHT_ALL);
    CSS.highlights.delete(HIGHLIGHT_ACTIVE);
  }, []);

  /** 按容器当前 DOM 重算命中，并把当前命中滚进视野。 */
  const rescan = useCallback((): void => {
    const container = containerRef.current;
    const ranges = container && query ? collectMatchRanges(container, query) : [];
    rangesRef.current = ranges;
    if (ranges.length === 0) {
      clearHighlights();
      setCount(0);
      setIndex(0);
      return;
    }
    const next = Math.min(indexRef.current, ranges.length - 1);
    indexRef.current = next;
    if (canHighlight()) {
      CSS.highlights.set(HIGHLIGHT_ALL, new Highlight(...ranges));
      CSS.highlights.set(HIGHLIGHT_ACTIVE, new Highlight(ranges[next]));
    }
    setCount(ranges.length);
    setIndex(next);
    revealActive(ranges[next]);
  }, [clearHighlights, containerRef, query]);

  // 查询变化 / 内容变化：重算命中
  // biome-ignore lint/correctness/useExhaustiveDependencies: contentKey 是「内容换了要重算」的信号，效果体内不直接读它
  useEffect(() => {
    if (!open || !query) {
      rangesRef.current = [];
      clearHighlights();
      setCount(0);
      setIndex(0);
      return;
    }
    const frame = requestAnimationFrame(rescan);
    return () => cancelAnimationFrame(frame);
  }, [open, query, contentKey, rescan, clearHighlights]);

  // 内容异步到位（Markdown / 语法高亮 / PDF 文本层）后 Range 会失效：观察子树重算，合帧
  useEffect(() => {
    const container = containerRef.current;
    if (!open || !container) return;
    let frame = 0;
    const observer = new MutationObserver(() => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        rescan();
      });
    });
    observer.observe(container, { childList: true, characterData: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [open, containerRef, rescan]);

  // 关闭 / 换面板：撤掉高亮与观察者状态
  useEffect(
    () => () => {
      clearHighlights();
    },
    [clearHighlights],
  );

  // 换文件（含 md 预览/源码切换）时收起查找条：上一次的查询对新文件没有意义
  // biome-ignore lint/correctness/useExhaustiveDependencies: contentKey 是重置信号，效果体内不读取
  useEffect(() => {
    setOpen(false);
    setQuery("");
  }, [contentKey]);

  /** 跳到第 nextIndex 个命中：更新当前档高亮 + 滚进视野。 */
  const focusIndex = useCallback((nextIndex: number): void => {
    const ranges = rangesRef.current;
    if (ranges.length === 0) return;
    const next = ((nextIndex % ranges.length) + ranges.length) % ranges.length;
    indexRef.current = next;
    if (canHighlight()) CSS.highlights.set(HIGHLIGHT_ACTIVE, new Highlight(ranges[next]));
    setIndex(next);
    revealActive(ranges[next]);
  }, []);

  const step = useCallback(
    (delta: number): void => {
      focusIndex(indexRef.current + delta);
    },
    [focusIndex],
  );

  const openFind = useCallback((): void => setOpen(true), []);
  const close = useCallback((): void => {
    setOpen(false);
    setQuery("");
  }, []);

  return {
    open,
    query,
    count,
    current: count > 0 ? index + 1 : 0,
    openFind,
    close,
    setQuery,
    step,
  };
}

/** 把命中的起点滚进最近的可滚动容器（Markdown 正文 / PDF 画布是嵌套滚动盒）。 */
function revealActive(range: Range): void {
  const anchor = range.endContainer.parentElement ?? range.startContainer.parentElement;
  if (anchor) revealInNearestScroller(anchor);
}
