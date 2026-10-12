import {
  Plus,
  SquareSplitHorizontal,
  SquareSplitVertical,
  Stop,
  Terminal,
  X,
} from "@phosphor-icons/react";
import {
  Fragment,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { resolveFontMonoStack } from "../../../shared/fontPresets";
import { useT } from "../../hooks/useT";
import { terminalService } from "../../services/terminalService";
import { useProjectStore } from "../../stores/projectStore";
import type {
  TerminalSplitDirection,
  TerminalTab as TerminalTabData,
} from "../../stores/terminalPanes";
import { MAX_TERMINAL_TABS, useTerminalStore } from "../../stores/terminalStore";
import { useUiStore } from "../../stores/uiStore";
import { type GlideCancel, glide, mix } from "../../utils/glideMotion";
import { NAV_MOTION } from "../../utils/motionTokens";
import { Button } from "../ui/Button";
import { ContextMenu } from "../ui/ContextMenu";
import { IconButton } from "../ui/IconButton";
import type { MenuItem } from "../ui/Menu";
import { PtyTerminal, type PtyTerminalHandle } from "../ui/PtyTerminal";
import styles from "./TerminalPanel.module.css";
import { TerminalTab } from "./TerminalTab";

/** 面板高度边界：下限固定像素，上限为中央工作区高度的占比。 */
const MIN_HEIGHT = 160;
const MAX_HEIGHT_RATIO = 0.7;
/** 分屏比例边界：两侧各留出可读宽度，避免把另一侧压成 0。 */
const MIN_SPLIT_RATIO = 0.2;
const MAX_SPLIT_RATIO = 0.8;

interface TerminalPanelProps {
  /** true 时收起面板：补间到 0 后 display:none，pty 进程与 xterm 缓冲保持存活。 */
  hidden: boolean;
}

interface ResizeSession {
  startY: number;
  startHeight: number;
  maxHeight: number;
  /** 是否已真正拖动过：按下未动是「点击」，收尾不得提交任何高度。 */
  moved: boolean;
}

interface SplitResizeSession {
  /** 按下时的指针坐标（row 取 clientX、column 取 clientY）。 */
  start: number;
  startRatio: number;
  /** 分屏容器在拖拽轴上的总尺寸，比例按像素增量换算。 */
  span: number;
  moved: boolean;
}

/**
 * 中央工作区底部终端面板：拖拽把手 + Tab 工具条 + pty 终端视图。
 * 面板可见性由 uiStore（terminalPanelVisible）控制，终端进程生命周期由
 * terminalStore（tabs/pty）控制：隐藏面板不 kill 进程，kill 进程不隐藏面板。
 * 收起/展开走下拉曲线补间（docs/design/53）：高度 0 ↔ store 目标值，
 * 演完收起才 display:none，pty 与 xterm 缓冲全程保持存活。
 * 分屏（docs/design/57）：窗口内容渲染 terminalStore.panes 的 1..2 个窗格，
 * 比例走内联 flex-grow、分隔条拖拽改比例（双击复位），焦点窗格带描边。
 */
export function TerminalPanel({ hidden }: TerminalPanelProps) {
  const t = useT();
  const {
    tabs,
    activeTab,
    panes,
    focusedPane,
    split,
    createTab,
    closeTab,
    renameTab,
    setActiveTab,
    toggleSplit,
    focusPane,
  } = useTerminalStore();
  const { currentProject, ready } = useProjectStore();
  const { theme, fontMonoPreset, terminalPanelHeight, dispatch, shortcuts } = useUiStore();
  const rootRef = useRef<HTMLElement>(null);
  const resizeRef = useRef<ResizeSession | null>(null);
  // 窗格句柄按窗格位置存：焦点跟随 focusedPane，切换 Tab / 进入分屏后要能动到对应实例
  const paneRefs = useRef<(PtyTerminalHandle | null)[]>([]);
  const groupRef = useRef<HTMLDivElement>(null);
  const splitResizeRef = useRef<SplitResizeSession | null>(null);
  // 两个方向各记一份比例：换向时不把上一方向的比例带过去
  const [splitRatio, setSplitRatio] = useState<Record<TerminalSplitDirection, number>>({
    row: 0.5,
    column: 0.5,
  });
  const [splitDragging, setSplitDragging] = useState(false);
  // 拖拽中的高度走本地 state，pointerup 时一次性提交 store，避免拖拽帧反复重渲染全局
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  // 收展补间期间接管高度；null 时交回「拖拽 → store」的常规链路。
  // 首挂即展开（宿主首次显示时才挂载本面板），从 0 起跳。
  const [animHeight, setAnimHeight] = useState<number | null>(hidden ? null : 0);
  // 收起补间落定后才 display:none；补间期间必须保持渲染，否则无从播放
  const [displayNone, setDisplayNone] = useState(hidden);
  const cancelRef = useRef<GlideCancel | null>(null);
  const firstRun = useRef(true);
  const lastHidden = useRef(hidden);
  // Tab 右键菜单：定位 + 目标实例；重命名走 Tab 内联输入框
  const [menu, setMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  // 面板生命周期内只自动开第一个终端；之后关闭/退出由用户手动新建
  const autoCreatedRef = useRef(false);
  const creatingRef = useRef(false);

  // 首次展开（挂载）时自动开第一个终端；cwd 跟随当前项目，无项目时主进程落到主目录
  useEffect(() => {
    if (!ready || autoCreatedRef.current || creatingRef.current || tabs.length > 0) return;
    autoCreatedRef.current = true;
    creatingRef.current = true;
    createTab(currentProject?.dir).finally(() => {
      creatingRef.current = false;
    });
  }, [tabs.length, ready, createTab, currentProject?.dir]);

  // 展开面板 / 切换 Tab / 焦点窗格变化时聚焦对应窗格的输入区，可直接敲命令
  const activeTabId = activeTab?.id;
  useEffect(() => {
    if (!hidden && activeTabId) paneRefs.current[focusedPane]?.focus();
  }, [hidden, activeTabId, focusedPane]);

  // 收起/展开补间（docs/design/53）：走浮层同一条定帧时间轴，曲线用下拉曲线
  //（glide() 默认缓动 = GLIDE_MOTION.easeOut），时长沿用面板折叠档（NAV_MOTION）。
  // 补间期间 inline overflow:hidden 裁掉被压出面板的工具条，落定后摘除不留残留。
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const stopTween = (): void => {
      cancelRef.current?.();
      cancelRef.current = null;
      root.style.removeProperty("overflow");
    };

    const playTween = (direction: "enter" | "exit"): void => {
      const from = root.offsetHeight;
      const to = direction === "enter" ? terminalPanelHeight : 0;
      if (direction === "enter") setDisplayNone(false);
      setAnimHeight(from);
      if (from === to) {
        // 当前值已达目标（如刚挂载即收起）：直接落终态，不空转时间轴
        setAnimHeight(null);
        if (direction === "exit") setDisplayNone(true);
        return;
      }
      root.style.overflow = "hidden";
      cancelRef.current = glide({
        duration: direction === "enter" ? NAV_MOTION.collapseEnter : NAV_MOTION.collapseExit,
        onUpdate: (progress) => {
          setAnimHeight(Math.round(mix(from, to, progress)));
        },
        onComplete: () => {
          cancelRef.current = null;
          setAnimHeight(null);
          root.style.removeProperty("overflow");
          if (direction === "exit") setDisplayNone(true);
        },
      });
    };

    if (firstRun.current) {
      firstRun.current = false;
      lastHidden.current = hidden;
      // 宿主在首次显示时才挂载本面板：首挂即展开，从 0 演到目标高
      if (!hidden) playTween("enter");
      return;
    }
    if (lastHidden.current === hidden) return;
    lastHidden.current = hidden;
    stopTween();
    playTween(hidden ? "exit" : "enter");
  }, [hidden, terminalPanelHeight]);

  const newTerminal = (): void => {
    void createTab(currentProject?.dir);
  };

  const closeMenu = useCallback(() => setMenu(null), []);

  const openTabMenu = (tab: TerminalTabData, event: React.MouseEvent<HTMLElement>): void => {
    event.preventDefault();
    setMenu({ tabId: tab.id, x: event.clientX, y: event.clientY });
  };

  // 右键菜单条目：针对被右键的那个实例（不要求是当前激活 Tab）
  const menuItems: MenuItem[] = menu
    ? [
        {
          key: "rename",
          label: t("common.rename"),
          onSelect: () => {
            setRenamingTabId(menu.tabId);
            setMenu(null);
          },
        },
        {
          key: "new",
          label: t("panels.terminal.newTab"),
          onSelect: () => {
            newTerminal();
            setMenu(null);
          },
        },
        {
          key: "close",
          label: t("panels.terminal.closeTab"),
          onSelect: () => {
            closeTab(menu.tabId);
            setMenu(null);
          },
        },
      ]
    : [];

  const onResizeStart = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const root = rootRef.current;
    // 父元素即中央工作区 <main>，上限按其实时高度计算
    const workspace = root?.parentElement;
    if (event.button !== 0 || !root || !workspace) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = {
      startY: event.clientY,
      startHeight: root.getBoundingClientRect().height,
      maxHeight: Math.max(MIN_HEIGHT, Math.floor(workspace.clientHeight * MAX_HEIGHT_RATIO)),
      moved: false,
    };
  };

  const onResizeMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const session = resizeRef.current;
    if (!session) return;
    if (!session.moved) {
      // 真正开始拖拽才接管：停掉进行中的收展补间，从当前视觉值重新起算，
      // 补间可能已在按下后推进，沿用按下时的起点会跳一帧
      session.moved = true;
      cancelRef.current?.();
      cancelRef.current = null;
      session.startY = event.clientY;
      session.startHeight = rootRef.current?.offsetHeight ?? session.startHeight;
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    }
    const next = session.startHeight + (session.startY - event.clientY);
    setDragHeight(clampHeight(next, session.maxHeight));
  };

  const onResizeEnd = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const session = resizeRef.current;
    if (!session) return;
    resizeRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    // 点击把手是空操作：不把补间进行中的高度误提交进 store（与侧栏把手同一约定）
    if (!session.moved) return;
    const next = session.startHeight + (session.startY - event.clientY);
    setDragHeight(null);
    // 拖拽真正接管过才清补间余值，交回常规高度链路
    setAnimHeight(null);
    dispatch({ type: "setTerminalPanelHeight", height: clampHeight(next, session.maxHeight) });
  };

  // 点击窗格：把焦点（工具条高亮 / 结束进程的目标）与键盘输入都交给它。
  // 空白处点击不会落到 xterm 的 textarea 上，必须显式 focus 一次
  const focusPaneAt = (index: number): void => {
    focusPane(index);
    paneRefs.current[index]?.focus();
  };

  const onSplitResizeStart = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const group = groupRef.current;
    const direction = split;
    if (event.button !== 0 || !group || !direction) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = group.getBoundingClientRect();
    splitResizeRef.current = {
      start: direction === "row" ? event.clientX : event.clientY,
      startRatio: splitRatio[direction],
      span: direction === "row" ? rect.width : rect.height,
      moved: false,
    };
    setSplitDragging(true);
  };

  const onSplitResizeMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const session = splitResizeRef.current;
    const direction = split;
    if (!session || !direction || session.span <= 0) return;
    if (!session.moved) {
      session.moved = true;
      document.body.style.cursor = direction === "row" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    }
    const position = direction === "row" ? event.clientX : event.clientY;
    const ratio = clampSplitRatio(session.startRatio + (position - session.start) / session.span);
    setSplitRatio((prev) => (prev[direction] === ratio ? prev : { ...prev, [direction]: ratio }));
  };

  const onSplitResizeEnd = (): void => {
    if (!splitResizeRef.current) return;
    splitResizeRef.current = null;
    setSplitDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  const height = dragHeight ?? animHeight ?? terminalPanelHeight;

  return (
    <section
      ref={rootRef}
      className={[styles.panel, displayNone ? styles.panelHidden : ""].join(" ")}
      style={{ height }}
      aria-label={t("terminal.ariaPanel")}
    >
      <div
        className={[
          styles.resizeHandle,
          dragHeight !== null ? styles.resizeHandleDragging : "",
        ].join(" ")}
        title={t("terminal.resizeHandle")}
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
      />
      <div className={styles.toolbar}>
        <div className={styles.tabs}>
          <span className={styles.label}>
            <Terminal size={16} weight="regular" />
            {t("panels.terminal.title")}
          </span>
          {tabs.map((tab) => (
            <TerminalTab
              key={tab.id}
              tab={tab}
              active={tab.id === activeTab?.id}
              renaming={tab.id === renamingTabId}
              onSelect={() => setActiveTab(tab.id)}
              onClose={() => closeTab(tab.id)}
              onContextMenu={(event) => openTabMenu(tab, event)}
              onStartRename={() => setRenamingTabId(tab.id)}
              onRenameCommit={(title) => {
                renameTab(tab.id, title);
                setRenamingTabId(null);
              }}
              onRenameCancel={() => setRenamingTabId(null)}
            />
          ))}
          <IconButton
            className={styles.iconBtnCompact}
            title={
              tabs.length >= MAX_TERMINAL_TABS
                ? t("terminal.maxTabs", { count: MAX_TERMINAL_TABS })
                : t("terminal.newInstance")
            }
            disabled={tabs.length >= MAX_TERMINAL_TABS}
            onClick={newTerminal}
          >
            <Plus size={16} weight="regular" />
          </IconButton>
        </div>
        <div className={styles.actions}>
          <IconButton
            className={styles.iconBtnCompact}
            title={split === "row" ? t("terminal.unsplit") : t("terminal.splitRow")}
            active={split === "row"}
            disabled={!activeTab}
            onClick={() => void toggleSplit("row", currentProject?.dir)}
          >
            <SquareSplitHorizontal size={16} weight={split === "row" ? "fill" : "regular"} />
          </IconButton>
          <IconButton
            className={styles.iconBtnCompact}
            title={split === "column" ? t("terminal.unsplit") : t("terminal.splitColumn")}
            active={split === "column"}
            disabled={!activeTab}
            onClick={() => void toggleSplit("column", currentProject?.dir)}
          >
            <SquareSplitVertical size={16} weight={split === "column" ? "fill" : "regular"} />
          </IconButton>
          <IconButton
            className={styles.iconBtnCompact}
            title={activeTab ? t("terminal.killCurrent") : t("terminal.noneRunning")}
            disabled={!activeTab}
            onClick={() => activeTab && closeTab(activeTab.id)}
          >
            <Stop size={16} weight="regular" />
          </IconButton>
          <IconButton
            className={styles.iconBtnCompact}
            title={t("titleBar.hideTerminal", { shortcut: shortcuts.toggleTerminal })}
            onClick={() => dispatch({ type: "toggleTerminalPanel" })}
          >
            <X size={16} weight="regular" />
          </IconButton>
        </div>
      </div>
      <div className={styles.content}>
        {panes.length > 0 ? (
          <div
            ref={groupRef}
            className={[
              styles.paneGroup,
              split === "row" ? styles.splitRow : split === "column" ? styles.splitColumn : "",
            ].join(" ")}
          >
            {panes.map((paneId, index) => {
              const tab = tabs.find((item) => item.id === paneId) ?? null;
              return (
                <Fragment key={paneId}>
                  {index > 0 && (
                    <div
                      className={[
                        styles.splitHandle,
                        splitDragging ? styles.splitHandleDragging : "",
                      ].join(" ")}
                      title={t("terminal.splitHandle")}
                      onPointerDown={onSplitResizeStart}
                      onPointerMove={onSplitResizeMove}
                      onPointerUp={onSplitResizeEnd}
                      onPointerCancel={onSplitResizeEnd}
                    />
                  )}
                  <div
                    className={[
                      styles.pane,
                      split !== null && index === focusedPane ? styles.paneFocused : "",
                    ].join(" ")}
                    style={
                      split
                        ? { flexGrow: index === 0 ? splitRatio[split] : 1 - splitRatio[split] }
                        : undefined
                    }
                    onPointerDown={() => focusPaneAt(index)}
                  >
                    {tab?.exited ? (
                      <div className={styles.exitState}>
                        <p>
                          {t("panels.terminal.exited", {
                            code: tab.exitCode ?? t("common.unknown"),
                          })}
                        </p>
                        <Button onClick={newTerminal}>{t("panels.terminal.newTab")}</Button>
                      </div>
                    ) : tab ? (
                      <PtyTerminal
                        ref={(handle) => {
                          paneRefs.current[index] = handle;
                          return () => {
                            paneRefs.current[index] = null;
                          };
                        }}
                        ariaLabel={t("terminal.instanceAria", { title: tab.title })}
                        theme={theme}
                        fontFamily={resolveFontMonoStack(fontMonoPreset)}
                        subscribeData={(callback) =>
                          terminalService.subscribeData(tab.id, callback)
                        }
                        backlog={() => terminalService.peekBacklog(tab.id)}
                        onData={(data) => terminalService.write(tab.id, data)}
                        onResize={(cols, rows) => terminalService.resize(tab.id, cols, rows)}
                      />
                    ) : null}
                  </div>
                </Fragment>
              );
            })}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <p>{t("terminal.empty")}</p>
            <Button onClick={newTerminal}>{t("panels.terminal.newTab")}</Button>
          </div>
        )}
      </div>
      {menu && (
        <ContextMenu position={{ x: menu.x, y: menu.y }} items={menuItems} onClose={closeMenu} />
      )}
    </section>
  );
}

function clampHeight(value: number, maxHeight: number): number {
  return Math.min(maxHeight, Math.max(MIN_HEIGHT, Math.round(value)));
}

function clampSplitRatio(value: number): number {
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, value));
}
