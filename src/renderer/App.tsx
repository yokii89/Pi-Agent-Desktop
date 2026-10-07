import React, { type CSSProperties, useEffect, useRef, useState } from "react";
import { t } from "../shared/i18n";
import styles from "./App.module.css";
import { CommandPalette } from "./components/CommandPalette/CommandPalette";
import { ContextSidebar } from "./components/ContextSidebar/ContextSidebar";
import { ExtensionsPage } from "./components/Extensions/ExtensionsPage";
import { ExtensionViewHost } from "./components/ExtensionView/ExtensionViewHost";
import { McpPage } from "./components/Mcp/McpPage";
import { RollbackPromptHost } from "./components/Review/RollbackPromptHost";
import { ReviewWindow } from "./components/ReviewWindow/ReviewWindow";
import { ScheduledTasksPage } from "./components/ScheduledTasks/ScheduledTasksPage";
import { SessionArea } from "./components/SessionArea/SessionArea";
import { SettingsDialog } from "./components/Settings/SettingsDialog";
import { SideNav } from "./components/SideNav/SideNav";
import { TerminalPanel } from "./components/TerminalPanel/TerminalPanel";
import { TitleBar } from "./components/TitleBar/TitleBar";
import { Toast } from "./components/ui/Toast";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { useNotificationSounds } from "./hooks/useNotificationSounds";
import { procService } from "./services/procService";
import { BrowserProvider } from "./stores/browserStore";
import { ComposerProvider } from "./stores/composerStore";
import { ExtensionViewProvider, useExtensionViewStore } from "./stores/extensionViewStore";
import { InspectorProvider } from "./stores/inspectorStore";
import { bindProcStream } from "./stores/procStore";
import { ProjectProvider } from "./stores/projectStore";
import { ReviewProvider } from "./stores/reviewStore";
import { SchedulerProvider, useSchedulerStore } from "./stores/schedulerStore";
import { SessionProvider, useSessionMeta } from "./stores/sessionStore";
import { StyleEditProvider } from "./stores/styleEditStore";
import { TerminalProvider } from "./stores/terminalStore";
import { UiProvider, useUiStore } from "./stores/uiStore";
import { bindUpdateStatusStream } from "./stores/updateStore";

function CentralPage() {
  const { page } = useUiStore();
  switch (page) {
    case "extensions":
      return <ExtensionsPage />;
    case "scheduled":
      return <ScheduledTasksPage />;
    case "mcp":
      return <McpPage />;
    default:
      return <SessionArea />;
  }
}

/**
 * 定时任务 → 侧栏桥：调度器派发新会话是主进程侧落盘，侧栏历史不会自发重扫；
 * 检测到新「已派发」运行记录时拉一次 listAll，让侧栏立刻出现这条会话。
 */
function SchedulerSessionBridge() {
  const { runs } = useSchedulerStore();
  const { refreshSidebarSessions } = useSessionMeta();
  const seenRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const seen = seenRef.current;
    const fresh = runs.filter((run) => run.status === "dispatched" && !seen.has(run.id));
    if (fresh.length === 0) return;
    for (const run of fresh) seen.add(run.id);
    void refreshSidebarSessions();
  }, [runs, refreshSidebarSessions]);
  return null;
}

/**
 * 把 active SessionId 同步给 ExtensionViewStore（多会话过滤扩展 View）。
 * 单独桥接组件：sessionStore 不依赖 extensionViewStore，避免 Provider/HMR 环。
 */
function ExtensionViewSessionBridge() {
  const { activeSessionId } = useSessionMeta();
  const { bindActiveViewSession } = useExtensionViewStore();
  useEffect(() => {
    bindActiveViewSession(activeSessionId);
  }, [activeSessionId, bindActiveViewSession]);
  return null;
}

/** 系统提示音：在 SessionProvider 内挂载，旁路订阅会话/终端/扩展事件（docs/design/18）。 */
function NotificationSoundsBridge() {
  useNotificationSounds();
  return null;
}

/** 应用更新状态流：订阅主进程 push，供设置导航角标与 About 面板共用（docs/design/35）。 */
function UpdateStatusBridge() {
  useEffect(() => bindUpdateStatusStream(), []);
  return null;
}

/** 后台进程登记流（docs/design/37）：独立 push 通道，按 sessionId 分桶。 */
function ProcStreamBridge() {
  const { showToast } = useUiStore();
  useEffect(() => {
    const off = bindProcStream();
    // §5.4 P0：上次非正常退出时提示可能残留服务
    void procService.residualNotice().then((hit) => {
      if (hit) showToast(t("proc.residual.warning"));
    });
    return off;
  }, [showToast]);
  return null;
}

/** 简单错误边界：扩展 View store 异常时不拖垮整个会话区/输入栏。 */
class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: "#f5a8a8", fontFamily: "sans-serif" }}>
          <p>{t("common.appError.title")}</p>
          <p style={{ opacity: 0.7, fontSize: 12 }}>{String(this.state.error.message)}</p>
          <button type="button" onClick={() => this.setState({ error: null })}>
            {t("common.appError.retry")}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * 底部终端面板宿主：首次展开后保持挂载，隐藏只是 display:none，
 * 保证 xterm 缓冲与 pty 会话不因收起面板而丢失（可见性 ≠ 进程生命周期）。
 */
function TerminalPanelHost() {
  const { terminalPanelVisible } = useUiStore();
  const [mounted, setMounted] = useState(terminalPanelVisible);
  useEffect(() => {
    if (terminalPanelVisible) setMounted(true);
  }, [terminalPanelVisible]);
  if (!mounted) return null;
  return <TerminalPanel hidden={!terminalPanelVisible} />;
}

function AppLayout() {
  const { navCollapsed, rightSidebarOpen, rightSidebarWidth, reviewWindowOpen } = useUiStore();
  useGlobalShortcuts();

  return (
    <div
      className={[
        styles.app,
        navCollapsed ? styles.navCollapsed : "",
        rightSidebarOpen ? "" : styles.sidebarClosed,
      ]
        .filter(Boolean)
        .join(" ")}
      // 用拖拽后的宽度覆盖 --context-sidebar-width，三栏网格与侧栏自身宽度一并生效
      style={{ "--context-sidebar-width": `${rightSidebarWidth}px` } as CSSProperties}
    >
      <TitleBar />
      <SideNav />
      <main className={styles.main}>
        <div className={styles.pageArea}>
          <CentralPage />
        </div>
        <TerminalPanelHost />
      </main>
      {rightSidebarOpen && <ContextSidebar />}
      <SettingsDialog />
      <AppErrorBoundary>
        <ExtensionViewHost />
      </AppErrorBoundary>
      <CommandPalette />
      {reviewWindowOpen && <ReviewWindow />}
      <Toast />
    </div>
  );
}

/** 应用根组件：Provider 组合 + 三栏布局骨架（左导航 → 中央会话 → 右侧上下文）。 */
export function App() {
  return (
    <UiProvider>
      <ProjectProvider>
        <ComposerProvider>
          {/* 边界放在 ExtensionViewProvider 外：Provider 自身崩溃时输入区仍可恢复 */}
          <AppErrorBoundary>
            <ExtensionViewProvider>
              <SessionProvider>
                <ExtensionViewSessionBridge />
                <NotificationSoundsBridge />
                <SchedulerProvider>
                  <SchedulerSessionBridge />
                  <ReviewProvider>
                    <RollbackPromptHost />
                    <TerminalProvider>
                      <BrowserProvider>
                        <InspectorProvider>
                          <StyleEditProvider>
                            <UpdateStatusBridge />
                            <ProcStreamBridge />
                            <AppLayout />
                          </StyleEditProvider>
                        </InspectorProvider>
                      </BrowserProvider>
                    </TerminalProvider>
                  </ReviewProvider>
                </SchedulerProvider>
              </SessionProvider>
            </ExtensionViewProvider>
          </AppErrorBoundary>
        </ComposerProvider>
      </ProjectProvider>
    </UiProvider>
  );
}
