import { Plus, Stop, Terminal, X } from "@phosphor-icons/react";
import {
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
import {
  MAX_TERMINAL_TABS,
  type TerminalTab as TerminalTabData,
  useTerminalStore,
} from "../../stores/terminalStore";
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

/**
 * 中央工作区底部终端面板：拖拽把手 + Tab 工具条 + pty 终端视图。
 * 面板可见性由 uiStore（terminalPanelVisible）控制，终端进程生命周期由
 * terminalStore（tabs/pty）控制：隐藏面板不 kill 进程，kill 进程不隐藏面板。
 * 收起/展开走下拉曲线补间（docs/design/53）：高度 0 ↔ store 目标值，
 * 演完收起才 display:none，pty 与 xterm 缓冲全程保持存活。
 */
export function TerminalPanel({ hidden }: TerminalPanelProps) {
  const t = useT();
  const { tabs, activeTab, createTab, closeTab, renameTab, setActiveTab } = useTerminalStore();
  const { currentProject, ready } = useProjectStore();
  const { theme, fontMonoPreset, terminalPanelHeight, dispatch, shortcuts } = useUiStore();
  const rootRef = useRef<HTMLElement>(null);
  const terminalRef = useRef<PtyTerminalHandle | null>(null);
  const resizeRef = useRef<ResizeSession | null>(null);
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

  // 展开面板 / 切换 Tab 时聚焦终端输入区，可直接敲命令
  const activeTabId = activeTab?.id;
  useEffect(() => {
    if (!hidden && activeTabId) terminalRef.current?.focus();
  }, [hidden, activeTabId]);

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
        {activeTab ? (
          activeTab.exited ? (
            <div className={styles.exitState}>
              <p>
                {t("panels.terminal.exited", {
                  code: activeTab.exitCode ?? t("common.unknown"),
                })}
              </p>
              <Button onClick={newTerminal}>{t("panels.terminal.newTab")}</Button>
            </div>
          ) : (
            <PtyTerminal
              key={activeTab.id}
              ref={terminalRef}
              ariaLabel={t("terminal.instanceAria", { title: activeTab.title })}
              theme={theme}
              fontFamily={resolveFontMonoStack(fontMonoPreset)}
              subscribeData={(callback) => terminalService.subscribeData(activeTab.id, callback)}
              backlog={() => terminalService.peekBacklog(activeTab.id)}
              onData={(data) => terminalService.write(activeTab.id, data)}
              onResize={(cols, rows) => terminalService.resize(activeTab.id, cols, rows)}
            />
          )
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
