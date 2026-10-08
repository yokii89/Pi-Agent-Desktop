import { Browsers, FileCode, GitPullRequest, PuzzlePiece, X } from "@phosphor-icons/react";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useT } from "../../hooks/useT";
import { extensionPanelTabId, useExtensionViewStore } from "../../stores/extensionViewStore";
import { useSessionMeta } from "../../stores/sessionStore";
import type { RightSidebarTab } from "../../stores/uiStore";
import { useUiStore } from "../../stores/uiStore";
import { PanelMount } from "../ExtensionView/PanelMount";
import { ReviewPanel } from "../ReviewWindow/ReviewPanel";
import { IconButton } from "../ui/IconButton";
import styles from "./ContextSidebar.module.css";
import { BrowserPanel } from "./panels/BrowserPanel";
import { FilePanel } from "./panels/FilePanel";

/** 侧栏宽度硬下限（px）：再窄 tab 与检查器都不可用，任何路径都不得低于它。 */
const MIN_WIDTH = 220;
/** 中央区最小宽（px）：侧栏上限 = 网格宽 - 左栏 - 该值，保证会话区始终可用。 */
const MIN_MAIN_WIDTH = 560;
/**
 * 拖拽判定阈值（px）：指针位移小于该值一律按「点击」处理，不改变宽度。
 * 把手就贴在侧栏左缘，想点面板时很容易压在它上面；误触就把宽度改掉（甚至压到根部）
 * 是不可接受的，所以「点击」必须是空操作。
 */
const DRAG_THRESHOLD = 4;
/**
 * 纯图标退出滞回（px）：已收成纯图标后，要多出这些空档才重新展开文案。
 * 没有滞回时临界宽度上「带文案 / 不带文案」的判定会贴着 0 来回改，header 闪烁。
 */
const ICON_ONLY_EXIT_MARGIN = 16;

interface SidebarTabDef {
  id: Exclude<RightSidebarTab, `ext:${string}`>;
  labelKey: string;
  icon: typeof FileCode;
}

const TABS: SidebarTabDef[] = [
  { id: "files", labelKey: "panels.context.files", icon: FileCode },
  { id: "browser", labelKey: "panels.context.browser", icon: Browsers },
];

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

function panelTabKey(panelId: string): RightSidebarTab {
  return extensionPanelTabId(panelId);
}

/**
 * ④ 右侧上下文侧栏：审查（停靠态）/ 文件 / 浏览器 + 扩展 View panel（P1）。
 * 审查有停靠/浮窗两种形态（ReviewSurfaceMode），tab 栏的审查按钮随形态切换可见性。
 * 扩展 panel 以动态 Tab 挂在系统 Tab 之后；关闭面板 = dismiss，收起侧栏 ≠ dismiss。
 */
export function ContextSidebar() {
  const t = useT();
  const {
    rightSidebarOpen,
    rightSidebarTab,
    rightSidebarWidth,
    navCollapsed,
    browserEnabled,
    reviewMode,
    reviewWindowOpen,
    toggleReview,
    dispatch,
  } = useUiStore();
  const { visiblePanels: panels, catalogPanelRows, activateViewOpen } = useExtensionViewStore();
  const { ensureSession } = useSessionMeta();
  const rootRef = useRef<HTMLElement>(null);
  const tabScrollerRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<ResizeSession | null>(null);
  // 拖拽中的宽度直接写网格根元素的 CSS 变量（不经 React 渲染），松手时一次性提交 store，
  // 避免拖拽帧反复重渲染全局（与终端面板高度拖拽同一策略）
  const [dragging, setDragging] = useState(false);
  /** 窄栏纯图标：按「带文案是否放得下」实测，而不是写死侧栏宽度阈值（扩展 Tab 一多就会漏）。 */
  const [iconOnly, setIconOnly] = useState(false);

  const systemTabs = browserEnabled ? TABS : TABS.filter((tab) => tab.id !== "browser");
  /** 审查在当前形态下是否可见：停靠态看侧栏 tab，浮窗态看浮窗开关。 */
  const reviewActive =
    reviewMode === "docked" ? rightSidebarOpen && rightSidebarTab === "review" : reviewWindowOpen;
  const activePanel = rightSidebarTab.startsWith("ext:")
    ? (panels.find((p) => panelTabKey(p.panelId ?? `ext-${p.id}`) === rightSidebarTab) ?? null)
    : null;
  /** Catalog-only panel 占位 Tab（未连接）；id 形如 `cat:<panelId>`。 */
  const activeCatalogPanel = rightSidebarTab.startsWith("cat:")
    ? (catalogPanelRows.find((r) => `cat:${r.id}` === rightSidebarTab) ?? null)
    : null;

  // Tab 清单身份：扩展/Catalog 面板会增删，量宽必须跟着重跑
  const tabListKey = [
    systemTabs.map((tab) => tab.id).join(","),
    panels.map((panel) => panel.id).join(","),
    catalogPanelRows.map((row) => row.key).join(","),
  ].join("|");

  // 单行 tab 永不换行：带文案放得下就展示文案，放不下收成纯图标。
  // 用 scrollWidth 实测而不是固定阈值——扩展 Tab 多寡决定所需宽度，280px 之类写死值会漏。
  // biome-ignore lint/correctness/useExhaustiveDependencies: tabListKey 是「清单变化的触发信号」，宽度从 DOM 实测
  useLayoutEffect(() => {
    const el = tabScrollerRef.current;
    if (!el) return;
    const measure = (): void => {
      // 强制展开完整形态（文案 + 标准 padding）量「带标签」自然宽，
      // 避免在 iconOnly 态量出偏小的宽度而在临界点来回改判
      el.classList.add(styles.measuring);
      const fullWidth = el.scrollWidth;
      const available = el.clientWidth;
      el.classList.remove(styles.measuring);
      setIconOnly((prev) => {
        // 进入纯图标：文案放不下；退出：留出滞回量才重新展开，避免临界宽度闪烁
        const next = prev ? fullWidth + ICON_ONLY_EXIT_MARGIN > available : fullWidth > available;
        return prev === next ? prev : next;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [tabListKey]);

  // 扩展 panel 关闭后，若当前正停在该 Tab，切回文件
  useEffect(() => {
    if (!rightSidebarTab.startsWith("ext:") && !rightSidebarTab.startsWith("cat:")) return;
    if (rightSidebarTab.startsWith("ext:")) {
      if (panels.some((p) => panelTabKey(p.panelId ?? `ext-${p.id}`) === rightSidebarTab)) return;
    }
    if (rightSidebarTab.startsWith("cat:")) {
      if (catalogPanelRows.some((r) => `cat:${r.id}` === rightSidebarTab)) return;
    }
    dispatch({ type: "setRightSidebar", open: true, tab: "files" });
  }, [panels, catalogPanelRows, rightSidebarTab, dispatch]);

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
      const maxWidth = computeMaxWidth(grid);
      if (rightSidebarWidth > maxWidth) {
        dispatch({ type: "setRightSidebarWidth", width: maxWidth });
      }
    };
    const grid = rootRef.current?.parentElement;
    if (!grid) return;
    clampToAvailable();
    window.addEventListener("resize", clampToAvailable);
    return () => {
      window.removeEventListener("resize", clampToAvailable);
    };
  }, [rightSidebarWidth, navCollapsed, dispatch]);

  return (
    <aside ref={rootRef} className={styles.sidebar} aria-label={t("panels.context.sidebarLabel")}>
      <div
        className={[styles.resizeHandle, dragging ? styles.resizeHandleDragging : ""].join(" ")}
        title={t("panels.context.resizeWidth")}
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
      />
      <div className={styles.tabBar}>
        {/* 可滚动单行 tab 区：放不下先收文案成纯图标，仍放不下则横向滚动；
            关闭按钮留在滚动区外，始终可见 */}
        <div
          ref={tabScrollerRef}
          className={[styles.tabScroller, iconOnly ? styles.iconOnly : ""].join(" ")}
          role="tablist"
          aria-label={t("panels.context.tabList")}
        >
          {/* 审查入口：toggleReview 随形态行事——停靠态 = 切换 review 面板 tab，
              浮窗态 = 开/关浮窗。高亮 = 审查在当前形态下可见。
              tablist 里的非 role=tab 按钮，语义用 aria-pressed 表达。 */}
          <button
            type="button"
            title={t("panels.context.review")}
            aria-label={t("panels.context.review")}
            aria-pressed={reviewActive}
            className={[styles.tab, reviewActive ? styles.tabActive : ""].join(" ")}
            onClick={toggleReview}
          >
            <GitPullRequest size={16} weight="regular" />
            <span className={styles.tabLabel}>{t("panels.context.review")}</span>
          </button>
          {systemTabs.map((tab) => {
            const active = tab.id === rightSidebarTab;
            const Icon = tab.icon;
            const label = t(tab.labelKey);
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                title={label}
                aria-label={label}
                className={[styles.tab, active ? styles.tabActive : ""].join(" ")}
                onClick={() => dispatch({ type: "setRightSidebar", open: true, tab: tab.id })}
              >
                <Icon size={16} weight="regular" />
                <span className={styles.tabLabel}>{label}</span>
              </button>
            );
          })}
          {panels.map((panel) => {
            const tabId = panelTabKey(panel.panelId ?? `ext-${panel.id}`);
            const active = tabId === rightSidebarTab;
            const label = panel.title || t("panels.context.extensionFallback");
            return (
              <button
                key={panel.id}
                type="button"
                role="tab"
                aria-selected={active}
                title={label}
                aria-label={label}
                className={[styles.tab, active ? styles.tabActive : ""].join(" ")}
                onClick={() => dispatch({ type: "setRightSidebar", open: true, tab: tabId })}
              >
                <PuzzlePiece size={16} weight="regular" />
                <span className={styles.tabLabel}>{label}</span>
              </button>
            );
          })}
          {/* Catalog-only panel（docs/design/19 §10.1）：未连接占位，点击 view:open 激活 */}
          {catalogPanelRows.map((row) => {
            const tabId = `cat:${row.id}` as RightSidebarTab;
            const active = tabId === rightSidebarTab;
            const activating = row.state === "activating";
            return (
              <button
                key={row.key}
                type="button"
                role="tab"
                aria-selected={active}
                title={row.description ? `${row.title} — ${row.description}` : row.title}
                aria-label={row.title}
                disabled={activating}
                className={[
                  styles.tab,
                  active ? styles.tabActive : "",
                  activating ? styles.tabPending : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => {
                  dispatch({ type: "setRightSidebar", open: true, tab: tabId });
                  if (row.state === "activating") return;
                  void activateViewOpen({
                    contributionKey: row.contributionKey,
                    prepareSession: () => ensureSession("view-action"),
                  });
                }}
              >
                <PuzzlePiece size={16} weight="regular" />
                <span className={styles.tabLabel}>
                  {activating ? t("panels.context.connecting") : row.title}
                </span>
              </button>
            );
          })}
        </div>
        <IconButton
          title={t("panels.context.collapseSidebar")}
          onClick={() => dispatch({ type: "toggleRightSidebar" })}
        >
          <X size={16} weight="regular" />
        </IconButton>
      </div>
      <div className={styles.body}>
        {/* 文件面板跨 Tab 保活：可见壳用 display:contents 保持布局不变，隐藏时仅
            display:none——预览/搜索/回退历史在切到浏览器等 Tab 期间不丢，
            HTML「源码 ⇄ 浏览器渲染」的往返动线依赖这一点 */}
        <div className={rightSidebarTab === "files" ? styles.panelAlive : styles.panelAliveHidden}>
          <FilePanel active={rightSidebarTab === "files"} />
        </div>
        {rightSidebarTab === "review" && reviewMode === "docked" && <ReviewPanel />}
        {rightSidebarTab === "browser" && browserEnabled && <BrowserPanel />}
        {activePanel && <PanelMount entry={activePanel} />}
        {activeCatalogPanel && (
          <div className={styles.catalogPanelPending} role="status">
            <p className={styles.catalogPanelTitle}>{activeCatalogPanel.title}</p>
            <p className={styles.catalogPanelHint}>
              {activeCatalogPanel.state === "activating"
                ? t("panels.context.extStarting")
                : activeCatalogPanel.state === "failed"
                  ? (activeCatalogPanel.error ?? t("panels.context.activateFailed"))
                  : (activeCatalogPanel.description ?? t("panels.context.extDisconnected"))}
            </p>
            {activeCatalogPanel.state !== "activating" && (
              <button
                type="button"
                className={styles.catalogPanelAction}
                onClick={() => {
                  void activateViewOpen({
                    contributionKey: activeCatalogPanel.contributionKey,
                    prepareSession: () => ensureSession("view-action"),
                  });
                }}
              >
                {t("panels.context.openPanel")}
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
