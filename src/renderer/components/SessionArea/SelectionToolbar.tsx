import { ChatCircleDots, Copy } from "@phosphor-icons/react";
import { type RefObject, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useGlideOverlay } from "../../hooks/useGlideOverlay";
import { useT } from "../../hooks/useT";
import styles from "./SelectionToolbar.module.css";

/** 工具条与选区之间的间距。 */
const GAP = 8;
/** 视口边缘留白（与 Popover 同档）。 */
const VIEWPORT_MARGIN = 8;

interface SelectionToolbarProps {
  /** 会话流滚动容器：选区两端都落在它内才算数。 */
  containerRef: RefObject<HTMLDivElement | null>;
  /** 输入栏锁定（切换中 / 阻断浮层）时「添加到输入栏」不可用。 */
  quoteDisabled: boolean;
  /** 引用置灰原因（title 提示）。 */
  quoteDisabledHint: string;
  onCopy: (text: string) => void;
  onQuote: (text: string) => void;
}

/**
 * 划选即出的选区工具条（docs/design/81，替代 docs/design/12 的右键浮窗）：
 * 常驻挂载、由 `selectionchange` 驱动，位置与文案一律命令式写入，
 * 拖选过程中不产生一次 React 渲染。
 *
 * portal 到 body：`.view` 的 `container-type: inline-size` 会让它成为 fixed 的
 * 包含块，视口坐标得重新换算（ImageLightbox 的菜单同此）。
 */
export function SelectionToolbar({
  containerRef,
  quoteDisabled,
  quoteDisabledHint,
  onCopy,
  onQuote,
}: SelectionToolbarProps) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const overlay = useGlideOverlay(panelRef);
  const visible = useRef(false);
  /** 「由藏转显」那一帧的文本快照，仅作实时选区取不到时的兜底（见 run）。 */
  const textRef = useRef("");
  const frameRef = useRef(0);

  const hide = useCallback((): void => {
    const panel = panelRef.current;
    if (!visible.current || !panel) return;
    visible.current = false;
    overlay.exit(() => {
      panel.hidden = true;
    });
  }, [overlay]);

  const sync = useCallback((): void => {
    frameRef.current = 0;
    const panel = panelRef.current;
    const container = containerRef.current;
    if (!panel || !container) return;
    const selection = window.getSelection();
    if (!selection) return;
    // 全应用每次光标移动都会派发 selectionchange（输入栏敲字最频繁）：
    // 折叠且本来就没显示 → 一次属性读取就退，不进任何测量
    const collapsed = selection.isCollapsed;
    if (collapsed && !visible.current) return;
    const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    // 先判归属再谈内容：会话流之外的划选（文件面板预览、扩展视图）不该为它序列化选区
    const inStream =
      range !== null &&
      container.contains(range.startContainer) &&
      container.contains(range.endContainer);
    if (!inStream || collapsed) {
      hide();
      return;
    }
    const rect = range.getBoundingClientRect();
    const box = container.getBoundingClientRect();
    // 滚动 / 流式排版把选区顶出阅读区后，工具条跟着留在视口里没有意义
    if (rect.bottom < box.top || rect.top > box.bottom) {
      hide();
      return;
    }

    const fresh = !visible.current;
    if (fresh) {
      // 纯空白选区不出现。整段序列化只在「由藏转显」这一帧付一次，
      // 拖选过程中不重复取文本（动作时再读实时选区，见 run）
      const text = selection.toString();
      if (!text.trim()) return;
      textRef.current = text;
      visible.current = true;
      // 尺寸要在 un-hide 之后量（hidden 时 offsetWidth 为 0）；prime 只写 opacity/scale，
      // 不影响布局盒，所以仍赶在本帧绘制前把 left/top 落好
      panel.hidden = false;
      overlay.prime();
    }
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    let above = true;
    let top = rect.top - GAP - height;
    if (top < VIEWPORT_MARGIN) {
      top = rect.bottom + GAP;
      above = false;
    }
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;
    if (top + height > viewportH - VIEWPORT_MARGIN) {
      top = Math.max(VIEWPORT_MARGIN, viewportH - height - VIEWPORT_MARGIN);
    }
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(rect.left + rect.width / 2 - width / 2, viewportW - width - VIEWPORT_MARGIN),
    );
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
    // 缩放要从贴着选区的那条边长出，否则是"原地呼吸"而不是从选区推开
    panel.style.transformOrigin = above ? "bottom center" : "top center";
    if (fresh) overlay.enter();
  }, [containerRef, hide, overlay]);

  // 拖选期间 selectionchange 每次指针移动都触发，合帧到每帧至多算一次
  const schedule = useCallback((): void => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(sync);
  }, [sync]);

  useEffect(() => {
    const container = containerRef.current;
    const onWindowResize = (): void => schedule();
    document.addEventListener("selectionchange", schedule);
    container?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", onWindowResize);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      document.removeEventListener("selectionchange", schedule);
      container?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", onWindowResize);
    };
  }, [containerRef, schedule]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || !visible.current) return;
      // 工具条消费 Esc：阻断冒泡，避免同时触发「Esc 停止」（ContextMenu 同范式）
      event.stopPropagation();
      hide();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [hide]);

  const run = useCallback(
    (action: (text: string) => void): void => {
      // 动作时才取实时选区（根节点 mousedown 已 preventDefault，此刻选区仍在），
      // 被别处清掉时退回「由藏转显」那一帧的快照
      const live = window.getSelection();
      const text = live && !live.isCollapsed ? live.toString() : textRef.current;
      if (!text.trim()) return;
      action(text);
      hide();
      // 动作即本轮终点：留着高亮却没有工具条，读起来像卡住的浮层
      window.getSelection()?.removeAllRanges();
    },
    [hide],
  );

  return createPortal(
    <div
      ref={panelRef}
      className={styles.panel}
      data-overlay-panel=""
      role="toolbar"
      aria-label={t("session.selectBar.aria")}
      hidden
      onMouseDown={(event) => {
        // 默认行为会先把文档选区收拢掉，按钮拿不到快照之外的实时选区；
        // 顺带保住焦点——工具条不是键盘目的地
        event.preventDefault();
      }}
    >
      <div className={styles.actions}>
        <button type="button" className={styles.action} onClick={() => run(onCopy)}>
          <Copy size={16} weight="regular" />
          <span>{t("session.selectBar.copy")}</span>
        </button>
        <button
          type="button"
          className={styles.action}
          disabled={quoteDisabled}
          title={quoteDisabledHint || undefined}
          onClick={() => run(onQuote)}
        >
          <ChatCircleDots size={16} weight="regular" />
          <span>{t("session.selectBar.quote")}</span>
        </button>
      </div>
    </div>,
    document.body,
  );
}
