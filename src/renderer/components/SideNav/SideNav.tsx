import {
  ClockCounterClockwise,
  Folder,
  GearSix,
  Plugs,
  PlusCircle,
  PuzzlePiece,
  Timer,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { useSelectionPill } from "../../hooks/useSelectionPill";
import { useT } from "../../hooks/useT";
import { useExtensionViewStore } from "../../stores/extensionViewStore";
import { useProjectStore } from "../../stores/projectStore";
import { useSessionMeta } from "../../stores/sessionStore";
import { type PageId, useUiStore } from "../../stores/uiStore";
import { loadGsap, prefersReducedMotion } from "../../utils/animation";
import { buildSessionTree, excludeArchivedSessions } from "../../utils/sessionGroups";
import { SidebarMount } from "../ExtensionView/SidebarMount";
import { IconButton } from "../ui/IconButton";
import { PinnedList } from "./PinnedList";
import { ProjectList } from "./ProjectList";
import styles from "./SideNav.module.css";
import { TaskList } from "./TaskList";
import { UpdateButton } from "./UpdateButton";

/** ② 左侧导航：品牌、新建任务、扩展、项目树、任务（无项目归属的历史）、设置入口；支持折叠为图标列。 */
export function SideNav() {
  const t = useT();
  const { navCollapsed, page, navigate, dispatch, settingsOpen, openSettings, shortcuts } =
    useUiStore();
  const { newSession, allSessions, pinnedFiles, globalPinnedFiles, archivedFiles } =
    useSessionMeta();
  const { projects } = useProjectStore();
  const { sidebars: visibleSidebars } = useExtensionViewStore();

  // 选中药丸（docs/design/54）：选中真值 = page / settingsOpen / activeSessionFile
  // 推导出的 data-side-active 标记，标记换行时药丸沿下拉曲线滑过去。
  const [navEl, setNavEl] = useState<HTMLElement | null>(null);
  const { pillRef } = useSelectionPill(navEl);

  // History → Project 归属：全局置顶条目提出进「置顶」分区；有工作目录且命中项目的进项目，
  // 其余进"任务"（无重复）；组内置顶由 buildSessionTree 提到各自列表最前；
  // 已归档条目不进主列表（docs/design/32）
  const tree = useMemo(
    () =>
      buildSessionTree(
        excludeArchivedSessions(allSessions, archivedFiles),
        projects,
        pinnedFiles,
        globalPinnedFiles,
      ),
    [allSessions, archivedFiles, projects, pinnedFiles, globalPinnedFiles],
  );

  // 启动空闲时预热 GSAP chunk：首次展开项目的图标回弹、行内操作揭示不再等下载。
  // 仍是动态 import 的独立 chunk（不塞回主 bundle），只是把下载时机提前到空闲期。
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const id = window.requestIdleCallback(() => void loadGsap(), { timeout: 2500 });
    return () => window.cancelIdleCallback(id);
  }, []);

  if (navCollapsed) {
    return (
      <nav className={[styles.nav, styles.collapsed].join(" ")} aria-label={t("sidenav.aria.main")}>
        <div className={styles.brandMini}>P</div>
        <IconButton
          title={t("sidenav.newTask.title", { shortcut: shortcuts.newTask })}
          onClick={newSession}
        >
          <PlusCircle size={20} weight="regular" />
        </IconButton>
        <IconButton
          title={t("sidenav.extensions")}
          active={page === "extensions"}
          onClick={() => navigate("extensions")}
        >
          <PuzzlePiece size={20} weight="regular" />
        </IconButton>
        <IconButton
          title={t("sidenav.mcp")}
          active={page === "mcp"}
          onClick={() => navigate("mcp")}
        >
          <Plugs size={20} weight="regular" />
        </IconButton>
        <IconButton
          title={t("sidenav.scheduled")}
          active={page === "scheduled"}
          onClick={() => navigate("scheduled")}
        >
          <Timer size={20} weight="regular" />
        </IconButton>
        <IconButton
          title={t("sidenav.projects")}
          onClick={() => dispatch({ type: "toggleNavCollapsed" })}
        >
          <Folder size={20} weight="regular" />
        </IconButton>
        <IconButton
          title={t("sidenav.tasks")}
          onClick={() => dispatch({ type: "toggleNavCollapsed" })}
        >
          <ClockCounterClockwise size={20} weight="regular" />
        </IconButton>
        <div className={styles.spacer} />
        <UpdateButton collapsed />
        <IconButton title={t("sidenav.settings")} active={settingsOpen} onClick={openSettings}>
          <GearSix size={20} weight="regular" />
        </IconButton>
      </nav>
    );
  }

  return (
    <nav ref={setNavEl} className={styles.nav} aria-label={t("sidenav.aria.main")}>
      {/* 选中药丸：选项/项目/历史记录共用的一块选中底色，由 useSelectionPill 沿下拉曲线滑行 */}
      <span ref={pillRef} className={styles.selectionPill} aria-hidden="true" />
      <div className={styles.brand}>
        <span className={styles.brandName}>PiDesk</span>
        <span className={styles.beta}>{t("common.beta")}</span>
      </div>

      <button type="button" className={styles.newTask} data-side-hover="" onClick={newSession}>
        <PlusCircle size={20} weight="regular" />
        {t("sidenav.newTask")}
      </button>

      <button
        type="button"
        className={[styles.navItem, page === "extensions" ? styles.navItemActive : ""].join(" ")}
        data-side-active={page === "extensions" ? "page" : undefined}
        data-side-hover=""
        onClick={() => navigate("extensions" satisfies PageId)}
      >
        <PuzzlePiece size={20} weight="regular" />
        {t("sidenav.extensions")}
      </button>

      <button
        type="button"
        className={[styles.navItem, page === "mcp" ? styles.navItemActive : ""].join(" ")}
        data-side-active={page === "mcp" ? "page" : undefined}
        data-side-hover=""
        onClick={() => navigate("mcp" satisfies PageId)}
      >
        <Plugs size={20} weight="regular" />
        {t("sidenav.mcp")}
      </button>

      <button
        type="button"
        className={[styles.navItem, page === "scheduled" ? styles.navItemActive : ""].join(" ")}
        data-side-active={page === "scheduled" ? "page" : undefined}
        data-side-hover=""
        onClick={() => navigate("scheduled" satisfies PageId)}
      >
        <Timer size={20} weight="regular" />
        {t("sidenav.scheduled")}
      </button>

      <div className={styles.divider} />
      {tree.globalPinned.length > 0 ? (
        <>
          <PinnedList sessions={tree.globalPinned} />
          <div className={styles.divider} />
        </>
      ) : null}
      <ProjectList groups={tree.projectGroups} />

      <div className={styles.divider} />
      <TaskList tasks={tree.tasks} />

      {visibleSidebars.length > 0 ? (
        <>
          <div className={styles.divider} />
          <div className={styles.extSlots}>
            {visibleSidebars.map((entry) => (
              <SidebarMount key={entry.id} entry={entry} />
            ))}
          </div>
        </>
      ) : null}

      <div className={styles.spacer} />

      <div className={styles.footer}>
        <button
          type="button"
          className={[styles.navItem, settingsOpen ? styles.navItemActive : ""].join(" ")}
          data-side-active={settingsOpen ? "page" : undefined}
          data-side-hover=""
          onClick={openSettings}
        >
          <GearSix size={20} weight="regular" />
          {t("sidenav.settings")}
        </button>
        <UpdateButton />
      </div>
    </nav>
  );
}
