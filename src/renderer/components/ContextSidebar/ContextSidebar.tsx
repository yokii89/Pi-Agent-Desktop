import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useT } from "../../hooks/useT";
import { useExtensionViewStore } from "../../stores/extensionViewStore";
import { useSessionMeta } from "../../stores/sessionStore";
import {
  RIGHT_SIDEBAR_DEFAULT_WIDTH,
  type RightSidebarTab,
  useUiStore,
} from "../../stores/uiStore";
import { prefersReducedMotion } from "../../utils/animation";
import { type GlideCancel, glide, mix } from "../../utils/glideMotion";
import { NAV_MOTION } from "../../utils/motionTokens";
import { PanelMount } from "../ExtensionView/PanelMount";
import { ReviewPanel } from "../ReviewWindow/ReviewPanel";
import styles from "./ContextSidebar.module.css";
import { BrowserPanel } from "./panels/BrowserPanel";
import { FilePanel } from "./panels/FilePanel";
import { SidebarActions } from "./SidebarActions";
import { SidebarLauncher } from "./SidebarLauncher";
import { SidebarTabBar } from "./SidebarTabBar";
import {
  addableFeatures,
  buildSidebarFeatures,
  extensionPanelIdOf,
  livePanelIdOf,
  type SidebarCatalogPanel,
  type SidebarFeature,
} from "./sidebarFeatures";

/** 侧栏宽度硬下限（px）：再窄页签与检查器都不可用，任何路径都不得低于它。 */
const MIN_WIDTH = 220;
/** 中央区最小宽（px）：侧栏上限 = 网格宽 - 左栏 - 该值，保证会话区始终可用。 */
const MIN_MAIN_WIDTH = 560;
/**
 * 拖拽判定阈值（px）：指针位移小于该值一律按「点击」处理，不改变宽度。
 * 把手就贴在侧栏左缘，想点面板时很容易压在它上面；误触就把宽度改掉（甚至压到根部）
 * 是不可接受的，所以「点击」必须是空操作。
 */
const DRAG_THRESHOLD = 4;

interface ResizeSession {
  startX: number;
  startWidth: number;
  /** 本次拖拽的宽度上限：与起始宽度无关，拖拽全程恒定。 */
  maxWidth: number;
  /** 已经写进 CSS 变量的宽度；拿不到指针坐标时（窗口失焦）用它收尾。 */
  lastWidth: number;
  /** 是否已越过 DRAG_THRESHOLD。未越过即为「点击」，松手不得提交任何宽度。 */
  moved: boolean;
}

/**
 * 侧栏宽度上限：网格总宽 - 左导航列宽 - 中央区最小宽。
 *
 * 不能用「侧栏左缘 x - 网格左缘 x」推导：那个值等于「左栏 + 中央区」，会随侧栏自身宽度变化，
 * 于是上一次拖宽的结果变成下一次交互的枷锁——按住把手（哪怕只是点一下）就被压回去，
 * 越宽压得越狠。改为与起始宽度无关的量后，同一会话内上限恒定。
 */
function computeMaxWidth(grid: HTMLElement): number {
  // 网格的实际列宽（如 "248px 892px 300px"）里第 0 列就是左导航，比读令牌更可靠（含折叠态）
  const [navTrack] = getComputedStyle(grid).gridTemplateColumns.split(" ");
  const navWidth = Number.parseFloat(navTrack ?? "");
  const available = grid.clientWidth - (Number.isFinite(navWidth) ? navWidth : 0) - MIN_MAIN_WIDTH;
  return Math.max(MIN_WIDTH, available);
}

/** 先夹上限再抬下限：MIN_WIDTH 必须是硬下限，窗口过窄时宁可挤压中央区也不塌成一条缝。 */
function clampWidth(value: number, maxWidth: number): number {
  return Math.max(MIN_WIDTH, Math.min(maxWidth, Math.round(value)));
}

/**
 * ④ 右侧上下文侧栏：启动页（一级界面）+ 可关闭页签。
 *
 * 默认展开并停在启动页；用户从功能卡或加号菜单打开功能后生成页签。关闭全部页签
 * 回到启动页。扩展 `panel` 贡献进入启动页与加号菜单，打开时才激活/占页签
 * （docs/design/66）。
 */
export function ContextSidebar() {
  const t = useT();
  const {
    rightSidebarOpen,
    rightSidebarTabs,
    rightSidebarTab,
    rightSidebarWidth,
    navCollapsed,
    browserEnabled,
    reviewMode,
    reviewWindowOpen,
    openSidebarTab,
    openReview,
    shortcuts,
    dispatch,
  } = useUiStore();
  const {
    panels: allPanels,
    visiblePanels,
    catalogPanelRows,
    activateViewOpen,
  } = useExtensionViewStore();
  const { ensureSession } = useSessionMeta();
  const rootRef = useRef<HTMLElement>(null);
  const resizeRef = useRef<ResizeSession | null>(null);
  const widthTweenRef = useRef<GlideCancel | null>(null);
  const lastWidthRef = useRef<number>(RIGHT_SIDEBAR_DEFAULT_WIDTH);
  // 拖拽中的宽度直接写网格根元素的 CSS 变量（不经 React 渲染），松手时一次性提交 store，
  // 避免拖拽帧反复重渲染全局（与终端面板高度拖拽同一策略）
  const [dragging, setDragging] = useState(false);
  const [maxWidth, setMaxWidth] = useState<number | null>(null);

  const features = useMemo(
    () =>
      buildSidebarFeatures({
        tabs: rightSidebarTabs,
        browserEnabled,
        reviewWindowOpen,
        shortcuts: { openFiles: shortcuts.openFiles, openReview: shortcuts.openReview },
        catalogRows: catalogPanelRows,
        visiblePanels,
        allPanels,
        t,
      }),
    [
      rightSidebarTabs,
      browserEnabled,
      reviewWindowOpen,
      shortcuts.openFiles,
      shortcuts.openReview,
      catalogPanelRows,
      visiblePanels,
      allPanels,
      t,
    ],
  );
  const addable = useMemo(() => addableFeatures(features), [features]);

  /** 页签仍开着时以 store 为准；极端状态下 tabs 非空但 active 为空，退回第一枚避免页签失联。 */
  const activeTab =
    rightSidebarTab !== null && rightSidebarTabs.includes(rightSidebarTab)
      ? rightSidebarTab
      : (rightSidebarTabs[0] ?? null);
  const activePanelId = activeTab ? extensionPanelIdOf(activeTab) : null;
  const activePanel = activePanelId
    ? (visiblePanels.find((panel) => livePanelIdOf(panel) === activePanelId) ?? null)
    : null;
  const activeCatalogPanel = activePanelId
    ? (catalogPanelRows.find((row) => row.id === activePanelId) ?? null)
    : null;
  const activePanelElsewhere = activePanelId
    ? (allPanels.find((panel) => livePanelIdOf(panel) === activePanelId) ?? null)
    : null;
  const activeFeature = activeTab
    ? (features.find((feature) => feature.id === activeTab) ?? null)
    : null;

  const activateCatalogPanel = useCallback(
    (row: SidebarCatalogPanel): void => {
      if (row.state === "activating") return;
      void activateViewOpen({
        contributionKey: row.contributionKey,
        prepareSession: () => ensureSession("view-action"),
      });
    },
    [activateViewOpen, ensureSession],
  );

  const openFeature = useCallback(
    (feature: SidebarFeature): void => {
      if (feature.id === "review") {
        openReview();
        return;
      }
      openSidebarTab(feature.id);
      if (feature.source === "extension" && feature.catalog && !feature.live) {
        activateCatalogPanel(feature.catalog);
      }
    },
    [activateCatalogPanel, openReview, openSidebarTab],
  );

  const closeTab = useCallback(
    (tab: RightSidebarTab): void => {
      dispatch({ type: "closeSidebarTab", tab });
    },
    [dispatch],
  );

  // 扩展 live 消失时不自动关页签：SDK 断线重连会短暂经过「无 live」状态，
  // 自动关闭会与重连抢跑并把 panelId 记进抑制列表。页签保留为占位，
  // 由用户点 × 或面板底部「结束面板」收尾。

  const resetDragStyles = (): void => {
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    setDragging(false);
  };

  /** 收尾：只有真正拖动过才提交宽度；「点击把手」到此为止，不动宽度也不动过渡。 */
  const finishResize = (clientX: number | null): void => {
    const session = resizeRef.current;
    const grid = rootRef.current?.parentElement;
    if (!session || !grid) return;
    resizeRef.current = null;
    if (!session.moved) return;
    resetDragStyles();
    dispatch({
      type: "setRightSidebarWidth",
      width:
        clientX === null
          ? session.lastWidth
          : clampWidth(session.startWidth + (session.startX - clientX), session.maxWidth),
    });
  };

  const onResizeStart = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const root = rootRef.current;
    const grid = root?.parentElement;
    if (event.button !== 0 || !root || !grid) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    // 放大/还原补间途中按下把手：先落定视觉宽度，再以它作为拖拽起点（纯点击也不回跳）
    if (widthTweenRef.current) {
      widthTweenRef.current();
      widthTweenRef.current = null;
      dispatch({
        type: "setRightSidebarWidth",
        width: clampWidth(root.getBoundingClientRect().width, computeMaxWidth(grid)),
      });
    }
    const startWidth = root.getBoundingClientRect().width;
    resizeRef.current = {
      startX: event.clientX,
      startWidth,
      maxWidth: computeMaxWidth(grid),
      lastWidth: startWidth,
      moved: false,
    };

    // 窗口外的兜底收尾：指针被拖出应用窗口（或中途被其它层接管）时把手收不到 pointerup，
    // 残留的拖拽会话会让下一次按下按旧起点跳变，这里保证无论如何都会收尾一次。
    const finish = (upEvent: Event): void => {
      detach();
      finishResize((upEvent as PointerEvent).clientX ?? null);
    };
    const onWindowBlur = (): void => {
      detach();
      finishResize(null);
    };
    const detach = (): void => {
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", finish, true);
      window.removeEventListener("blur", onWindowBlur);
    };
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", finish, true);
    window.addEventListener("blur", onWindowBlur);
  };

  const onResizeMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const session = resizeRef.current;
    const grid = rootRef.current?.parentElement;
    if (!session || !grid) return;
    if (!session.moved) {
      // 越过阈值才算拖拽：此时才接管光标，点击不会留下任何痕迹
      if (Math.abs(event.clientX - session.startX) < DRAG_THRESHOLD) return;
      session.moved = true;
      setDragging(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    const next = clampWidth(
      session.startWidth + (session.startX - event.clientX),
      session.maxWidth,
    );
    session.lastWidth = next;
    grid.style.setProperty("--context-sidebar-width", `${next}px`);
  };

  // 可用空间变小后把宽度夹回合法区间：窗口变窄、或左导航从折叠态展开（中央区被让出 192px）
  // 都会让中央区不够用。期望的行为是先收侧栏（浏览器页面也会随之收窄，见 BrowserPanel）。
  // biome-ignore lint/correctness/useExhaustiveDependencies: navCollapsed 是「可用空间变化的触发信号」，实际宽度从网格算出
  useEffect(() => {
    const clampToAvailable = (): void => {
      const grid = rootRef.current?.parentElement;
      if (!grid) return;
      const nextMax = computeMaxWidth(grid);
      setMaxWidth((prev) => (prev === nextMax ? prev : nextMax));
      if (rightSidebarWidth > nextMax) {
        dispatch({ type: "setRightSidebarWidth", width: nextMax });
      }
    };
    const grid = rootRef.current?.parentElement;
    if (!grid) return;
    clampToAvailable();
    const observer = new ResizeObserver(clampToAvailable);
    observer.observe(grid);
    window.addEventListener("resize", clampToAvailable);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", clampToAvailable);
    };
  }, [rightSidebarWidth, navCollapsed, dispatch]);

  // 记录「放大前」的宽度，供还原按钮使用；已处于最大宽度时不覆盖
  useEffect(() => {
    if (maxWidth !== null && rightSidebarWidth < maxWidth - 1) {
      lastWidthRef.current = rightSidebarWidth;
    }
  }, [rightSidebarWidth, maxWidth]);

  // 收展钩子也写同一个 CSS 变量；侧栏开始收起时先停掉宽度补间，避免两边抢写
  useLayoutEffect(() => {
    if (!rightSidebarOpen) {
      widthTweenRef.current?.();
      widthTweenRef.current = null;
    }
  }, [rightSidebarOpen]);
  useEffect(
    () => () => {
      widthTweenRef.current?.();
      widthTweenRef.current = null;
    },
    [],
  );

  const animateWidth = useCallback((from: number, to: number, done: () => void): void => {
    const grid = rootRef.current?.parentElement;
    if (!grid) return;
    widthTweenRef.current?.();
    widthTweenRef.current = null;
    // 中途被打断（连点放大）时从当前视觉值接管，不能退回 store 里的旧宽度
    const visual = Number.parseFloat(grid.style.getPropertyValue("--context-sidebar-width"));
    const start = Number.isFinite(visual) ? visual : from;
    if (prefersReducedMotion()) {
      grid.style.setProperty("--context-sidebar-width", `${to}px`);
      done();
      return;
    }
    widthTweenRef.current = glide({
      // 与侧栏收展同一条下拉曲线 / 同一档时长（docs/design/53）
      duration: NAV_MOTION.collapseEnter,
      onUpdate: (progress) => {
        grid.style.setProperty(
          "--context-sidebar-width",
          `${Math.round(mix(start, to, progress))}px`,
        );
      },
      onComplete: () => {
        widthTweenRef.current = null;
        grid.style.setProperty("--context-sidebar-width", `${to}px`);
        done();
      },
    });
  }, []);

  const maximized = maxWidth !== null && rightSidebarWidth >= maxWidth - 1;
  const toggleMaximize = useCallback((): void => {
    if (maxWidth === null) return;
    if (maximized) {
      const target = clampWidth(lastWidthRef.current, maxWidth);
      animateWidth(rightSidebarWidth, target, () => {
        dispatch({ type: "setRightSidebarWidth", width: target });
      });
      return;
    }
    lastWidthRef.current = rightSidebarWidth;
    animateWidth(rightSidebarWidth, maxWidth, () => {
      dispatch({ type: "setRightSidebarWidth", width: maxWidth });
    });
  }, [animateWidth, dispatch, maxWidth, maximized, rightSidebarWidth]);

  return (
    <aside ref={rootRef} className={styles.sidebar} aria-label={t("panels.context.sidebarLabel")}>
      <div
        className={[styles.resizeHandle, dragging ? styles.resizeHandleDragging : ""].join(" ")}
        title={t("panels.context.resizeWidth")}
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
      />
      <header className={styles.sidebarHeader}>
        {activeTab ? (
          <SidebarTabBar
            tabs={rightSidebarTabs}
            activeTab={activeTab}
            features={features}
            onSelect={openSidebarTab}
            onClose={closeTab}
          />
        ) : (
          <div className={styles.headerSpacer} />
        )}
        <SidebarActions
          className={styles.headerActions}
          features={addable}
          onSelectFeature={openFeature}
          nativeOverlayActive={activeTab === "browser" && browserEnabled}
          maximized={maximized}
          onToggleMaximize={toggleMaximize}
          onCollapse={() => dispatch({ type: "toggleRightSidebar" })}
        />
      </header>
      <div className={styles.body}>
        {activeTab === null ? (
          <SidebarLauncher features={features} onOpenFeature={openFeature} />
        ) : (
          <>
            {/* 文件面板跨页签保活：可见壳用 display:contents 保持布局不变，隐藏时仅
                display:none——预览/搜索/回退历史在切到浏览器等页签期间不丢。
                关闭文件页签才卸载。 */}
            {rightSidebarTabs.includes("files") && (
              <div className={activeTab === "files" ? styles.panelAlive : styles.panelAliveHidden}>
                <FilePanel active={activeTab === "files"} />
              </div>
            )}
            {activeTab === "review" && reviewMode === "docked" && <ReviewPanel />}
            {activeTab === "browser" && browserEnabled && <BrowserPanel />}
            {activePanel && <PanelMount entry={activePanel} />}
            {!activePanel && activeCatalogPanel && (
              <CatalogPanelBody
                row={activeCatalogPanel}
                onOpen={() => activateCatalogPanel(activeCatalogPanel)}
              />
            )}
            {!activePanel && !activeCatalogPanel && activePanelId && (
              <UnavailablePanel
                title={
                  activeFeature?.tabTitle ??
                  activeFeature?.title ??
                  t("panels.context.extensionFallback")
                }
                hint={
                  activePanelElsewhere
                    ? t("panels.context.otherSession")
                    : t("panels.context.panelUnavailable")
                }
              />
            )}
          </>
        )}
      </div>
    </aside>
  );
}

/** Catalog-only / 断线页签的占位体：明确「未连接」，不伪装成 live。 */
function CatalogPanelBody({ row, onOpen }: { row: SidebarCatalogPanel; onOpen: () => void }) {
  const t = useT();
  const activating = row.state === "activating";
  return (
    <div className={styles.catalogPanelPending} role="status">
      <p className={styles.catalogPanelTitle}>{row.title}</p>
      <p className={styles.catalogPanelHint}>
        {activating
          ? t("panels.context.extStarting")
          : row.state === "failed"
            ? (row.error ?? t("panels.context.activateFailed"))
            : (row.description ?? t("panels.context.extDisconnected"))}
      </p>
      {!activating && (
        <button type="button" className={styles.catalogPanelAction} onClick={onOpen}>
          {row.state === "failed" ? t("common.retry") : t("panels.context.openPanel")}
        </button>
      )}
    </div>
  );
}

function UnavailablePanel({ title, hint }: { title: string; hint: string }) {
  return (
    <div className={styles.catalogPanelPending} role="status">
      <p className={styles.catalogPanelTitle}>{title}</p>
      <p className={styles.catalogPanelHint}>{hint}</p>
    </div>
  );
}
