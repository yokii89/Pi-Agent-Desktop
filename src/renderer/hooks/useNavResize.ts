import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { NAV_WIDTH_COLLAPSED } from "../../shared/navWidth";
import { clampNavWidthToGrid, navMaxWidth, readGridTracks } from "../utils/navGeometry";
import { panelGeometry, writePanelGeometry } from "../utils/panelGeometry";

/**
 * 拖拽判定阈值（px）：位移小于该值一律按「点击」处理，不改宽度。
 * 把手贴在侧栏右缘，点行、拖滚动条时很容易压在它上面，
 * 误触就把宽度改掉不可接受，所以「点击」必须是空操作（与右栏把手同一约定）。
 */
const DRAG_THRESHOLD = 4;

interface ResizeSession {
  startX: number;
  startWidth: number;
  /** 已经写进网格的宽度；拿不到指针坐标时（窗口失焦）用它收尾。 */
  lastWidth: number;
  /** 是否已越过 DRAG_THRESHOLD。未越过即为「点击」，松手不得提交任何宽度。 */
  moved: boolean;
}

interface NavResizeOptions {
  /** 左栏外壳元素（`.shell`，网格第一列的 grid item）；网格根取它的父元素。 */
  shellRef: React.RefObject<HTMLDivElement | null>;
  /** 展开态宽度（store 值，持久化在设置里）。 */
  width: number;
  /** 折叠态：轨道归 `NAV_WIDTH_COLLAPSED`，把手不参与拖拽。 */
  collapsed: boolean;
  /** 右侧上下文侧栏是否展开 + 其宽度：左栏上限要扣掉它，中央区才能保住最小宽。 */
  sidebarOpen: boolean;
  sidebarWidth: number;
  /** 松手时提交宽度（store → 设置回写链路），拖拽帧不提交。 */
  commit: (width: number) => void;
}

interface NavResize {
  /** 挂到左栏右缘的拖拽把手上。 */
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  /** 已越过阈值：把手改用强调态（光标由 body 接管）。 */
  dragging: boolean;
}

/**
 * 左侧导航栏拖拽调宽（docs/design/137）。
 *
 * 与右栏把手（`ContextSidebar`）刻意保持同一套语义：
 * - 阈值以内是点击，松手不提交任何宽度；
 * - 拖拽帧直写网格轨道（不 setState、不重渲染全局），松手一次性提交 store；
 * - 上限按「网格宽 - 右栏宽 - 中央区最小宽」算，与起始宽度无关；
 * - 窗口失焦 / 指针被其它层接管时兜底收尾，避免下一次按下按旧起点跳变。
 *
 * 落盘一律经 `utils/panelGeometry`（唯一写网格轨道的模块）：拖左栏时右栏正在补间的
 * 内联宽度不会被整体替换的 `grid-template-columns` 打回 CSS 兜底值。
 */
export function useNavResize(options: NavResizeOptions): NavResize {
  const { shellRef, width, collapsed, sidebarOpen, sidebarWidth, commit } = options;
  const resizeRef = useRef<ResizeSession | null>(null);
  const [dragging, setDragging] = useState(false);
  const detachRef = useRef<(() => void) | null>(null);

  const latest = useRef({ width, collapsed, sidebarOpen, sidebarWidth, commit });
  latest.current = { width, collapsed, sidebarOpen, sidebarWidth, commit };

  const gridOf = useCallback(
    (): HTMLElement | null => shellRef.current?.parentElement ?? null,
    [shellRef],
  );

  /**
   * 右侧栏视觉宽度：展开态取 store 值，收起态取 0；补间途中以 panelGeometry 的
   * 当前视觉值为准（它更大时就说明还在补间，轨道按视觉值夹取才不会放宽一帧）。
   * 走 ref 读取，因此引用恒定，不会让下面的 effect 每帧重装。
   */
  const asideWidth = useCallback((): number => {
    const { sidebarOpen: open, sidebarWidth: value } = latest.current;
    return Math.max(open ? value : 0, panelGeometry().sidebar);
  }, []);

  // store / 折叠态变化落到轨道：启动水合、设置同步拉取、折叠开关都走这里。
  // 首帧也由它写：两侧列同帧落定，不会先按 CSS 兜底宽度画一帧再跳。
  // 展开路径顺带夹一次：窗口在折叠期间变窄了，展开时不能再拿旧宽度撑破中央区。
  useLayoutEffect(() => {
    const grid = gridOf();
    if (!grid) return;
    if (collapsed) {
      writePanelGeometry(grid, { nav: NAV_WIDTH_COLLAPSED });
      return;
    }
    const next = clampNavWidthToGrid(width, grid.clientWidth, asideWidth());
    writePanelGeometry(grid, { nav: next });
    if (next !== width) latest.current.commit(next);
  }, [asideWidth, collapsed, gridOf, width]);

  /**
   * 可用空间变小后把宽度夹回合法区间：窗口变窄、右侧栏展开（中央区被让出 300px）
   * 都会让会话区不够用。夹取必须落到 DOM 再提交 store——宽度是内联写在轨道上的，
   * 只改 store 不会改变视觉。
   */
  const clampToAvailable = useCallback((): void => {
    const grid = gridOf();
    const { width: storeWidth, collapsed: isCollapsed } = latest.current;
    if (!grid || isCollapsed) return;
    if (storeWidth <= navMaxWidth(grid.clientWidth, asideWidth())) return;
    const next = clampNavWidthToGrid(storeWidth, grid.clientWidth, asideWidth());
    if (next === storeWidth) return;
    writePanelGeometry(grid, { nav: next });
    latest.current.commit(next);
  }, [asideWidth, gridOf]);

  useEffect(() => {
    const grid = gridOf();
    if (!grid) return;
    // 观察网格自身：窗口伸缩会改它的 clientWidth；右栏收展由下面的依赖触发
    const observer = new ResizeObserver(clampToAvailable);
    observer.observe(grid);
    window.addEventListener("resize", clampToAvailable);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", clampToAvailable);
    };
  }, [clampToAvailable, gridOf]);

  // 右栏宽度 / 开合变化也要复核一次：网格 clientWidth 不变，ResizeObserver 观察不到。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 两个 sidebar 值是「可用空间变化的触发信号」，实际宽度经 ref 读取
  useEffect(() => {
    clampToAvailable();
  }, [clampToAvailable, sidebarOpen, sidebarWidth]);

  const finish = (clientX: number | null): void => {
    const session = resizeRef.current;
    const grid = gridOf();
    if (!session || !grid) return;
    resizeRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    setDragging(false);
    if (!session.moved) return;
    const next =
      clientX === null
        ? session.lastWidth
        : clampNavWidthToGrid(
            session.startWidth + (clientX - session.startX),
            grid.clientWidth,
            asideWidth(),
          );
    writePanelGeometry(grid, { nav: next });
    latest.current.commit(next);
  };

  useEffect(
    () => () => {
      detachRef.current?.();
    },
    [],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const grid = gridOf();
    if (event.button !== 0 || !grid || latest.current.collapsed) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    // 起点取**视觉**宽度（readGridTracks 第 0 列），而不是 store：中途被打断的夹取、
    // 上一次还在收尾的拖拽都以屏幕上的值为准，点一下不会回跳
    const startWidth = readGridTracks(grid)[0] || latest.current.width;
    resizeRef.current = { startX: event.clientX, startWidth, lastWidth: startWidth, moved: false };

    // 窗口外的兜底收尾：指针被拖出应用窗口时把手收不到 pointerup，
    // 残留的拖拽会话会让下一次按下按旧起点跳变
    const onUp = (upEvent: Event): void => {
      detach();
      finish((upEvent as PointerEvent).clientX ?? null);
    };
    const onBlur = (): void => {
      detach();
      finish(null);
    };
    const detach = (): void => {
      detachRef.current = null;
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      window.removeEventListener("blur", onBlur);
    };
    detachRef.current = detach;
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    window.addEventListener("blur", onBlur);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const session = resizeRef.current;
    const grid = gridOf();
    if (!session || !grid) return;
    if (!session.moved) {
      if (Math.abs(event.clientX - session.startX) < DRAG_THRESHOLD) return;
      session.moved = true;
      setDragging(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    const next = clampNavWidthToGrid(
      session.startWidth + (event.clientX - session.startX),
      grid.clientWidth,
      asideWidth(),
    );
    session.lastWidth = next;
    writePanelGeometry(grid, { nav: next });
  };

  return { onPointerDown, onPointerMove, dragging };
}
