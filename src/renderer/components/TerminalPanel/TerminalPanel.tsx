import { Plus, Stop, Terminal, X } from "@phosphor-icons/react";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
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
  /** true 时仅隐藏面板（display:none）：pty 进程与 xterm 缓冲保持存活。 */
  hidden: boolean;
}

interface ResizeSession {
  startY: number;
  startHeight: number;
  maxHeight: number;
}

/**
 * 中央工作区底部终端面板：拖拽把手 + Tab 工具条 + pty 终端视图。
 * 面板可见性由 uiStore（terminalPanelVisible）控制，终端进程生命周期由
 * terminalStore（tabs/pty）控制：隐藏面板不 kill 进程，kill 进程不隐藏面板。
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
    };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  };

  const onResizeMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const session = resizeRef.current;
    if (!session) return;
    const next = session.startHeight + (session.startY - event.clientY);
    setDragHeight(clampHeight(next, session.maxHeight));
  };

  const onResizeEnd = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const session = resizeRef.current;
    if (!session) return;
    resizeRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    const next = session.startHeight + (session.startY - event.clientY);
    setDragHeight(null);
    dispatch({ type: "setTerminalPanelHeight", height: clampHeight(next, session.maxHeight) });
  };

  const height = dragHeight ?? terminalPanelHeight;

  return (
    <section
      ref={rootRef}
      className={[styles.panel, hidden ? styles.panelHidden : ""].join(" ")}
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
            title={activeTab ? t("terminal.killCurrent") : t("terminal.noneRunning")}
            disabled={!activeTab}
            onClick={() => activeTab && closeTab(activeTab.id)}
          >
            <Stop size={16} weight="regular" />
          </IconButton>
          <IconButton
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
