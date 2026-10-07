import {
  DotsThree,
  Folder,
  FolderOpen,
  PlusCircle,
  PushPin,
  PushPinSlash,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { useT } from "../../hooks/useT";
import { windowService } from "../../services/windowService";
import { useSessionMeta } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { sessionTitle } from "../../utils/sessionTitle";
import { archiveItem, deleteItem, openFolderItem, renameItem } from "../SideNav/RowMenu";
import { Menu } from "../ui/Menu";
import { GitBranchChip } from "./GitBranchChip";
import styles from "./SessionHeader.module.css";

function basename(dir: string): string {
  const parts = dir.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? dir;
}

/** 拖拽区上的双击最大化：仅非交互表面（条底/空白），按钮与输入框仍走自身点击。 */
function isTitlebarSurface(target: EventTarget): boolean {
  return target instanceof Element && !target.closest("button, input, [role='menu']");
}

/**
 * 顶栏中间槽的会话身份条（docs/用户对话栏/7.1）：标题 + 工作目录 + Git 分支 + 更多。
 * 挂在 TitleBarCenter，不在会话区再叠一条 chrome。
 * 无工作目录时只展示标题；标题可双击（或经更多菜单）重命名。
 *
 * 产品约束：会话进行中不提供「切换工作区」——pi 进程已绑定 cwd，中途换目录会与
 * 实际执行上下文脱节；工作区芯片仅作只读锚点（悬浮看完整路径）。
 */
export function SessionHeader() {
  const t = useT();
  const {
    activeSessionFile,
    allSessions,
    sessionTitles,
    sessionWorkingDir,
    renameSession,
    removeSession,
    togglePin,
    pinnedFiles,
    newSession,
    firstUserText,
    archiveSession,
  } = useSessionMeta();
  const { showToast, shortcuts } = useUiStore();
  const [renaming, setRenaming] = useState(false);

  const summary = useMemo(
    () => allSessions.find((s) => s.file === activeSessionFile) ?? null,
    [allSessions, activeSessionFile],
  );

  const firstUser = firstUserText;

  const customTitle = activeSessionFile ? sessionTitles[activeSessionFile] : undefined;
  const title = summary ? sessionTitle(summary, customTitle) : firstUser || t("session.newSession");

  const pinned = activeSessionFile ? pinnedFiles.includes(activeSessionFile) : false;

  const commitRename = (value: string): void => {
    setRenaming(false);
    if (activeSessionFile) renameSession(activeSessionFile, value);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 标题栏空白双击最大化（与 TitleBarCenter 一致）
    <div
      className={styles.bar}
      onDoubleClick={(event) => {
        if (isTitlebarSurface(event.target)) void windowService.toggleMaximize();
      }}
    >
      <div className={styles.meta}>
        {renaming ? (
          <input
            className={styles.titleEdit}
            defaultValue={title}
            maxLength={60}
            aria-label={t("session.header.renameAria", { title })}
            ref={(el) => {
              if (!el) return;
              el.focus();
              el.select();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitRename(event.currentTarget.value);
              else if (event.key === "Escape") setRenaming(false);
            }}
            onBlur={(event) => commitRename(event.currentTarget.value)}
          />
        ) : (
          <button
            type="button"
            className={styles.titleButton}
            title={activeSessionFile ? t("session.header.titleHint", { title }) : title}
            onDoubleClick={() => {
              if (activeSessionFile) setRenaming(true);
            }}
          >
            {title}
          </button>
        )}

        {sessionWorkingDir && (
          <span className={styles.chip} title={sessionWorkingDir}>
            <Folder size={13} weight="regular" />
            <span className={styles.chipLabel}>{basename(sessionWorkingDir)}</span>
          </span>
        )}

        {sessionWorkingDir && (
          <GitBranchChip cwd={sessionWorkingDir} direction="bottom" variant="meta" />
        )}
      </div>

      <div className={styles.right}>
        <Menu
          align="right"
          direction="bottom"
          trigger={({ open, onClick }) => (
            <button
              type="button"
              className={[styles.more, open ? styles.moreOpen : ""].join(" ")}
              title={t("session.header.moreActions")}
              aria-label={t("session.header.moreActionsAria", { title })}
              aria-haspopup="menu"
              onClick={onClick}
            >
              <DotsThree size={18} weight="regular" />
            </button>
          )}
          items={[
            // 尚未认领 JSONL 文件的新会话没有可持久化的标题键
            activeSessionFile ? renameItem(() => setRenaming(true)) : null,
            openFolderItem(sessionWorkingDir, showToast),
            sessionWorkingDir
              ? {
                  key: "copy-path",
                  label: t("session.header.copyPath"),
                  icon: <FolderOpen size={16} weight="regular" />,
                  onSelect: () => {
                    void navigator.clipboard
                      .writeText(sessionWorkingDir)
                      .then(() => showToast(t("session.copiedWorkdir")))
                      .catch(() => showToast(t("session.copyFailed")));
                  },
                }
              : null,
            activeSessionFile
              ? {
                  key: "pin",
                  label: pinned ? t("session.header.unpin") : t("session.header.pin"),
                  icon: pinned ? (
                    <PushPinSlash size={16} weight="regular" />
                  ) : (
                    <PushPin size={16} weight="regular" />
                  ),
                  onSelect: () => togglePin(activeSessionFile),
                }
              : null,
            {
              key: "new",
              label: t("session.newSession"),
              icon: <PlusCircle size={16} weight="regular" />,
              hint: shortcuts.newTask,
              onSelect: () => newSession(),
            },
            // 归档当前会话（pending 占位返回 null）：与侧栏行菜单同一语义（docs/design/32）
            activeSessionFile
              ? archiveItem(activeSessionFile, () => {
                  if (activeSessionFile) archiveSession(activeSessionFile);
                })
              : null,
            activeSessionFile
              ? deleteItem(t("session.header.deleteTask"), () => {
                  void removeSession(activeSessionFile);
                })
              : null,
          ].filter((item): item is NonNullable<typeof item> => item !== null)}
        />
      </div>
    </div>
  );
}
