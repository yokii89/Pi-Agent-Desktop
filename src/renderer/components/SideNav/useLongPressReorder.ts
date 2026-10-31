import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { dropTargetIndex, insertionIndexAt, type RowBand } from "../../utils/listReorder";

/** 长按判定时长：按住列表行不动到这个时长才进入拖动（短于此的按压仍是普通点击）。 */
const LONG_PRESS_MS = 320;
/** 长按判定前的位移容差：超过它就当成普通点击/划选，不再进入拖动。 */
const MOVE_SLOP_PX = 5;
/** 拖动松手后的这一次 click 要吞掉，避免把长按拖动读成「点击打开/展开」（click 紧跟 pointerup，窗口给足即可）。 */
const CLICK_SUPPRESS_MS = 200;
/** 贴边自动滚动：感应带宽度与每帧最大步长。 */
const AUTO_SCROLL_EDGE_PX = 28;
const AUTO_SCROLL_STEP_PX = 12;

/** 拖拽层渲染所需的状态（每帧只在视觉值变化时才更新，避免拖动期间白白重渲染）。 */
export interface ListDragView {
  id: string;
  label: string;
  /** 指针相对按下点的纵向位移：跟手浮层按它平移。 */
  dy: number;
  /** 按下时行的视口矩形（浮层的位置与宽度起点）。 */
  rect: { left: number; top: number; width: number; height: number };
  /** 落点线相对列表顶部的 Y；null = 落回原位，不画线。 */
  lineY: number | null;
}

interface PressSession {
  pointerId: number;
  startX: number;
  startY: number;
  id: string;
  label: string;
  /** 按下时在可拖行列表里的下标。 */
  index: number;
  item: HTMLElement;
  timer: number;
}

interface DragSession extends Omit<PressSession, "timer"> {
  clientX: number;
  clientY: number;
  /** 当前插入位（0..N，含被拖行本身）。 */
  insert: number;
  rect: ListDragView["rect"];
  dy: number;
  lineY: number | null;
}

export interface ListReorderHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLUListElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLUListElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLUListElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLUListElement>) => void;
  onLostPointerCapture: () => void;
  onPointerLeave: () => void;
}

/**
 * 列表的长按拖拽排序（侧栏项目 docs/design/108；项目内会话 docs/design/109）：
 * - 按住行 320ms 进入拖动（浮层跟手、其它行不动），落点用一条强调色横线表示；
 * - 进入拖动后松手不再算点击：浮层已经「拎起来」，顺带打开/展开会与拖动态自相矛盾；
 * - 未到 320ms 就松手、或长按前就移出容差的，仍然是普通点击；
 * - 指针贴侧栏上下缘时按帧自动滚动，落点跟着重算。
 *
 * 事件挂在列表 `<ul>` 上做委托：`handleSelector` 之外的目标（行内 ⋯ / 新建等按钮）
 * 天然不触发长按；只在进入拖动后才对列表设指针捕获——普通点击的焦点与 click 目标都不受影响。
 *
 * 契约：可拖行由 `itemSelector` 选出（不匹配的行既不参与长按也不参与落点，比如置顶会话），
 * 行上必须带 `data-reorder-id` / `data-reorder-label`；行的分组边界取最近的 `<li>`
 * （项目行 = 行 + 展开的子列表，落点线画在组边界上；会话行 = 行自身）。
 */
export function useLongPressReorder({
  containerRef,
  enabled,
  itemSelector,
  handleSelector,
  onReorder,
}: {
  containerRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  itemSelector: string;
  handleSelector: string;
  onReorder: (id: string, toIndex: number) => void;
}): {
  drag: ListDragView | null;
  handlers: ListReorderHandlers;
  /** 拖完松手时调用：吞掉紧随其后的 click 并返回 true。 */
  consumeDragClick: () => boolean;
} {
  const [drag, setDrag] = useState<ListDragView | null>(null);
  const pressRef = useRef<PressSession | null>(null);
  const dragRef = useRef<DragSession | null>(null);
  const suppressUntilRef = useRef(0);
  const rafRef = useRef(0);

  /** 可拖行（按 DOM 顺序）：既不参与长按的行不会出现在这里，插入位也只数它们。 */
  function draggableItems(): HTMLElement[] {
    const container = containerRef.current;
    return container ? [...container.querySelectorAll<HTMLElement>(itemSelector)] : [];
  }

  /** 按当前指针位置重算插入位与落点线；线的落点画在「组边界」上（展开的子列表不穿线）。 */
  function measure(session: DragSession): void {
    const container = containerRef.current;
    if (!container) return;
    const items = draggableItems();
    const bands: RowBand[] = [];
    for (const item of items) {
      const rect = item.getBoundingClientRect();
      bands.push({ top: rect.top, height: rect.height });
    }
    const insert = insertionIndexAt(bands, session.clientY);
    let lineY: number | null = null;
    if (dropTargetIndex(insert, session.index) !== session.index) {
      const containerRect = container.getBoundingClientRect();
      const groups = items.map((item) => item.closest<HTMLElement>("li") ?? item);
      const boundary =
        insert >= groups.length
          ? (groups[groups.length - 1]?.getBoundingClientRect().bottom ?? containerRect.top)
          : (groups[insert]?.getBoundingClientRect().top ?? containerRect.top);
      // -1 让 2px 的线落在组间 2px 空隙的正中；贴顶时不下探出列表
      lineY = Math.max(0, boundary - containerRect.top - 1);
    }
    const dy = session.clientY - session.startY;
    const changed = session.dy !== dy || session.lineY !== lineY;
    session.insert = insert;
    session.dy = dy;
    session.lineY = lineY;
    if (!changed) return;
    setDrag({ id: session.id, label: session.label, dy, rect: session.rect, lineY });
  }

  /** 贴边自动滚动：拖动期间按帧推进，滚动后落点跟着重算（指针不动、列表在动）。 */
  function autoScroll(): void {
    const session = dragRef.current;
    const container = containerRef.current;
    if (!session || !container) return;
    rafRef.current = window.requestAnimationFrame(autoScroll);
    // 侧栏根节点就是滚动容器（.nav 的 overflow-y: auto）
    const scroller = container.closest<HTMLElement>("nav");
    if (!scroller) return;
    const bounds = scroller.getBoundingClientRect();
    // 只在指针仍贴着侧栏时滚动：拖到中央区顶部/底部不该把侧栏带跑
    if (session.clientX < bounds.left - 24 || session.clientX > bounds.right + 24) return;
    const distanceAbove = bounds.top + AUTO_SCROLL_EDGE_PX - session.clientY;
    const distanceBelow = session.clientY - (bounds.bottom - AUTO_SCROLL_EDGE_PX);
    let delta = 0;
    if (distanceAbove > 0) {
      delta = -Math.min(
        AUTO_SCROLL_STEP_PX,
        Math.ceil((distanceAbove / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_STEP_PX),
      );
    } else if (distanceBelow > 0) {
      delta = Math.min(
        AUTO_SCROLL_STEP_PX,
        Math.ceil((distanceBelow / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_STEP_PX),
      );
    }
    if (delta === 0) return;
    const before = scroller.scrollTop;
    scroller.scrollTop = before + delta;
    if (scroller.scrollTop !== before) measure(session);
  }

  function finishDrag(): void {
    dragRef.current = null;
    setDrag(null);
    if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  }

  function cancelPress(): void {
    const session = pressRef.current;
    if (!session) return;
    window.clearTimeout(session.timer);
    pressRef.current = null;
  }

  /** 长按成立：量行矩形、接管指针、亮出跟手浮层。 */
  function arm(session: PressSession): void {
    pressRef.current = null;
    const container = containerRef.current;
    if (!container || !session.item.isConnected) return;
    const rect = session.item.getBoundingClientRect();
    const dragSession: DragSession = {
      pointerId: session.pointerId,
      startX: session.startX,
      startY: session.startY,
      clientX: session.startX,
      clientY: session.startY,
      id: session.id,
      label: session.label,
      index: session.index,
      item: session.item,
      insert: session.index,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      dy: 0,
      lineY: null,
    };
    try {
      container.setPointerCapture(session.pointerId);
    } catch {
      // 指针已经抬起（少数输入设备不发 pointerup）：按放弃处理，不留拖动态
      return;
    }
    dragRef.current = dragSession;
    setDrag({
      id: dragSession.id,
      label: dragSession.label,
      dy: 0,
      rect: dragSession.rect,
      lineY: null,
    });
    rafRef.current = window.requestAnimationFrame(autoScroll);
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLUListElement>): void => {
    if (!enabled || pressRef.current || dragRef.current) return;
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const target = event.target;
    const handle = target instanceof Element ? target.closest(handleSelector) : null;
    const item = handle?.closest<HTMLElement>(itemSelector);
    const container = containerRef.current;
    if (!item || !container) return;
    const index = draggableItems().indexOf(item);
    const id = item.dataset.reorderId;
    const label = item.dataset.reorderLabel;
    if (index < 0 || !id || !label) return;
    const session: PressSession = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      id,
      label,
      index,
      item,
      timer: 0,
    };
    session.timer = window.setTimeout(() => arm(session), LONG_PRESS_MS);
    pressRef.current = session;
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLUListElement>): void => {
    const session = dragRef.current;
    if (session) {
      if (event.pointerId !== session.pointerId) return;
      session.clientX = event.clientX;
      session.clientY = event.clientY;
      measure(session);
      return;
    }
    const press = pressRef.current;
    if (!press || event.pointerId !== press.pointerId) return;
    if (
      Math.abs(event.clientX - press.startX) > MOVE_SLOP_PX ||
      Math.abs(event.clientY - press.startY) > MOVE_SLOP_PX
    ) {
      cancelPress();
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLUListElement>): void => {
    const press = pressRef.current;
    if (press && event.pointerId === press.pointerId) {
      // 没到长按时长就松手：这是普通点击，交给 click 处理
      cancelPress();
      return;
    }
    const session = dragRef.current;
    if (!session || event.pointerId !== session.pointerId) return;
    session.clientX = event.clientX;
    session.clientY = event.clientY;
    measure(session);
    const target = dropTargetIndex(session.insert, session.index);
    finishDrag();
    // 进入过拖动态就算一次拖动：松手后紧跟的 click 不能当成点击
    suppressUntilRef.current = performance.now() + CLICK_SUPPRESS_MS;
    if (target !== session.index) onReorder(session.id, target);
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLUListElement>): void => {
    if (pressRef.current?.pointerId === event.pointerId) {
      cancelPress();
      return;
    }
    if (dragRef.current?.pointerId === event.pointerId) finishDrag();
  };

  const onLostPointerCapture = (): void => {
    // 正常松手的顺序是 pointerup → finishDrag → 这里已成空；捕获被意外剥夺时按放弃处理
    if (dragRef.current) finishDrag();
  };

  const onPointerLeave = (): void => {
    if (!dragRef.current) cancelPress();
  };

  const consumeDragClick = useCallback((): boolean => {
    if (performance.now() >= suppressUntilRef.current) return false;
    suppressUntilRef.current = 0;
    return true;
  }, []);

  // 列表卸载（侧栏折叠 / 切项目）时不能留下定时器与滚动帧
  useEffect(
    () => () => {
      if (pressRef.current) window.clearTimeout(pressRef.current.timer);
      pressRef.current = null;
      dragRef.current = null;
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    },
    [],
  );

  return {
    drag,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture,
      onPointerLeave,
    },
    consumeDragClick,
  };
}
