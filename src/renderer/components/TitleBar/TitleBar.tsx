import {
  CaretLineLeft,
  CaretLineRight,
  SidebarSimple,
  TerminalWindow,
} from "@phosphor-icons/react";
import { useT } from "../../hooks/useT";
import { windowService } from "../../services/windowService";
import { useExtensionViewStore } from "../../stores/extensionViewStore";
import { useSessionMeta } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { HeaderMount } from "../ExtensionView/HeaderMount";
import { SessionHeader } from "../SessionArea/SessionHeader";
import { IconButton } from "../ui/IconButton";
import { NavHistory } from "./NavHistory";
import styles from "./TitleBar.module.css";
import { WindowControls } from "./WindowControls";

function toggleMaximizeSelf(event: React.MouseEvent<HTMLElement>): void {
  if (event.target === event.currentTarget) {
    void windowService.toggleMaximize();
  }
}

function TitleBarLeft() {
  const t = useT();
  const { navCollapsed, dispatch, shortcuts } = useUiStore();
  const { headerLeft } = useExtensionViewStore();

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 标题栏空白双击最大化
    <div
      className={[styles.left, navCollapsed ? styles.leftCollapsed : ""].filter(Boolean).join(" ")}
      onDoubleClick={toggleMaximizeSelf}
    >
      <IconButton
        title={t("titleBar.toggleSidebar", { shortcut: shortcuts.toggleSidebar })}
        onClick={() => dispatch({ type: "toggleNavCollapsed" })}
      >
        <SidebarSimple size={20} weight="regular" />
      </IconButton>
      {/* 折叠态左列只有 56px：历史先让位 */}
      {navCollapsed ? null : <NavHistory />}
      {headerLeft ? <HeaderMount entry={headerLeft} /> : null}
    </div>
  );
}

function TitleBarCenter() {
  const { rightSidebarOpen, page } = useUiStore();
  const { phase } = useSessionMeta();
  const { headerCenter } = useExtensionViewStore();
  // 空态/扩展页不占中间槽：工作区与分支仍在空态输入栏，避免顶栏信息过载
  const showSessionMeta = page === "session" && phase !== "empty";
  const className = [
    styles.center,
    rightSidebarOpen ? "" : styles.centerUnderChrome,
    showSessionMeta ? styles.centerSession : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 标题栏空白双击最大化
    <div className={className} onDoubleClick={toggleMaximizeSelf}>
      {showSessionMeta && <SessionHeader />}
      {headerCenter ? <HeaderMount entry={headerCenter} /> : null}
    </div>
  );
}

function TitleBarRight() {
  const { headerRight } = useExtensionViewStore();

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 标题栏空白双击最大化
    <div className={styles.right} onDoubleClick={toggleMaximizeSelf}>
      {headerRight ? <HeaderMount entry={headerRight} /> : null}
    </div>
  );
}

/**
 * chrome：面板开关 + 窗控。绝对定位叠在顶栏右端，宽度不参与任何列轨道，
 * 因此右侧栏收起（aside=0）时窗控仍然常驻，也不会把中/右分界挤偏。
 */
function TitleBarChrome() {
  const t = useT();
  const { rightSidebarOpen, toggleRightSidebar, terminalPanelVisible, dispatch, shortcuts } =
    useUiStore();

  return (
    <div className={styles.chrome}>
      {/* 终端面板开关：与 toggleTerminal 快捷键共用，仅切可见性不动 pty */}
      <IconButton
        title={
          terminalPanelVisible
            ? t("titleBar.hideTerminal", { shortcut: shortcuts.toggleTerminal })
            : t("titleBar.showTerminal", { shortcut: shortcuts.toggleTerminal })
        }
        active={terminalPanelVisible}
        onClick={() => dispatch({ type: "toggleTerminalPanel" })}
      >
        <TerminalWindow size={20} weight={terminalPanelVisible ? "fill" : "regular"} />
      </IconButton>
      <IconButton
        title={rightSidebarOpen ? t("titleBar.collapseSidebar") : t("titleBar.expandSidebar")}
        onClick={toggleRightSidebar}
      >
        {rightSidebarOpen ? (
          <CaretLineRight size={20} weight="regular" />
        ) : (
          <CaretLineLeft size={20} weight="regular" />
        )}
      </IconButton>
      <WindowControls />
    </div>
  );
}

/**
 * ① 顶栏：彻底拆成三段，分别放进与正文 nav|main|aside **同一条** grid 轨道
 * （grid-area: titleL/titleC/titleR，见 App.module.css）。列宽变化时与下方
 * 面板同帧收放，不存在两套栅格各自 transition 造成的错位/弹跳。
 * 窗控与开关走绝对定位的 chrome，不占列宽。
 */
export function TitleBar() {
  return (
    <>
      <TitleBarLeft />
      <TitleBarCenter />
      <TitleBarRight />
      <TitleBarChrome />
    </>
  );
}
