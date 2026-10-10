import { Prohibit, PushPin } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionSummary } from "../../../shared/ipc";
import { useT } from "../../hooks/useT";
import { procStore, refreshSessionProcesses } from "../../stores/procStore";
import { useSessionMeta } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { sessionTitle, truncateTitle } from "../../utils/sessionTitle";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { ExtensionReloadNotice } from "./ExtensionReloadNotice";
import { HistoryHoverCard } from "./HistoryHoverCard";
import type { HistoryItemStatus } from "./HistoryList";
import {
  archiveItem,
  copyTaskIdItem,
  deleteItem,
  exportItem,
  markUnreadItem,
  openFolderItem,
  pinGlobalItem,
  pinWorkspaceItem,
  RowMenu,
  renameItem,
} from "./RowMenu";
import { RunningDots } from "./RunningDots";
import styles from "./SideNav.module.css";
import { TreeGuideLines } from "./TreeGuideLines";

/** 悬浮多久才弹详情卡：鼠标只是扫过列表时不弹，停住看才弹。 */
const HOVER_CARD_DELAY = 320;

interface HistoryItemProps {
  session: SessionSummary;
  /** 是否为当前恢复的会话（选中态）。 */
  active: boolean;
  disabled: boolean;
  /** 正在打开该会话（磁盘/进程路径进行中）；条目仍可点，后一次点击覆盖前一次。 */
  opening?: boolean;
  /** 运行状态：AI 输出中（旋转指示）或完成未读（绿点）。 */
  status?: HistoryItemStatus;
  /** 会话所属空间（项目）名；不属于任何项目时为 null。 */
  spaceName: string | null;
  /** 树状引导线缩进层级；不传则不画引导线（顶层"任务"列表）。 */
  treeDepth?: number;
  /** 是否为同级最后一项（决定引导线分支钩的长度）。 */
  treeLast?: boolean;
  /** 项目子列表形态：标题按字数截断（顶层"任务"列表保持按宽度截断）。 */
  compactTitle?: boolean;
  /** 该会话是否有存活 pi 实例（「结束进程」菜单可见性）。 */
  processAlive?: boolean;
  /** 该会话是否正在 running（结束确认文案区分）。 */
  running?: boolean;
  onOpen: () => void;
}

/**
 * 侧栏历史会话条目（单行）：标题 + 右缘状态槽 + 悬浮操作（仅 ⋯，docs/design/45）。
 * 状态槽（与 ⋯ 互斥，悬浮/聚焦时让位）：
 * - AI 输出中 → 3×3 点阵呼吸动画；打开会话进行中同款；
 * - 完成未读 → 蓝点；
 * - 置顶（全局或工作区）→ 图钉。
 *
 * 标题不再"悬浮滚动"，改为单行截断 + 悬浮（或键盘聚焦）后弹出详情卡展示全文与元信息，
 * 见 HistoryHoverCard。悬浮时整行轻微右移，作为"这条可点"的触觉提示。
 * ⋯ 菜单内重命名：标题原地变成输入框（Enter / 失焦提交，Escape 取消），
 * 与终端 Tab 的重命名交互保持一致。
 */
export function HistoryItem({
  session,
  active,
  disabled,
  opening = false,
  status,
  spaceName,
  treeDepth,
  treeLast = false,
  compactTitle = false,
  processAlive = false,
  running = false,
  onOpen,
}: HistoryItemProps) {
  const t = useT();
  const {
    removeSession,
    renameSession,
    pinnedFiles,
    globalPinnedFiles,
    sessionTitles,
    unreadFiles,
    togglePin,
    toggleGlobalPin,
    markSessionUnread,
    endSessionProcess,
    archiveSession,
    getSessionIdForFile,
  } = useSessionMeta();
  const { page, showToast } = useUiStore();
  const title = sessionTitle(session, sessionTitles[session.file]);
  const pinned = pinnedFiles.includes(session.file);
  const globalPinned = globalPinnedFiles.includes(session.file);
  const unread = unreadFiles.has(session.file);
  const busy = status === "running" || opening;
  const [renaming, setRenaming] = useState(false);
  const [confirmEndOpen, setConfirmEndOpen] = useState(false);
  /** 打开结束确认时拉到的后台进程数（0 = 不出现「保留」双选）。 */
  const [endBgCount, setEndBgCount] = useState(0);

  const rowRef = useRef<HTMLDivElement>(null);
  // 非空即代表详情卡开着，值是需要对齐的那一行的视口矩形
  const [cardAnchor, setCardAnchor] = useState<DOMRect | null>(null);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    let timer: number | null = null;
    const clearTimer = (): void => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };
    const show = (delay: number): void => {
      clearTimer();
      timer = window.setTimeout(() => setCardAnchor(row.getBoundingClientRect()), delay);
    };
    const hide = (): void => {
      clearTimer();
      setCardAnchor(null);
    };
    const onEnter = (): void => show(HOVER_CARD_DELAY);
    const onFocusIn = (): void => show(0);
    // 键盘聚焦是明确意图，无需等待；focusout 要排除行内按钮之间的焦点转移
    const onFocusOut = (event: FocusEvent): void => {
      if (!row.contains(event.relatedTarget as Node | null)) hide();
    };
    // 滚动后锚点行已经不在原位置，卡片必须收起，否则会飘在错误的位置上
    row.addEventListener("mouseenter", onEnter);
    row.addEventListener("mouseleave", hide);
    row.addEventListener("focusin", onFocusIn);
    row.addEventListener("focusout", onFocusOut);
    window.addEventListener("scroll", hide, true);
    return () => {
      clearTimer();
      row.removeEventListener("mouseenter", onEnter);
      row.removeEventListener("mouseleave", hide);
      row.removeEventListener("focusin", onFocusIn);
      row.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("scroll", hide, true);
    };
  }, []);

  /** 提交重命名：空白标题等于恢复默认标题（由 store 处理）。 */
  const commitRename = (value: string): void => {
    setRenaming(false);
    renameSession(session.file, value);
  };

  /** 收起悬浮详情卡（菜单开合、置顶重排、进入重命名等改变行状态的动线都先收起它）。 */
  const closeHoverCard = useCallback((): void => {
    setCardAnchor(null);
  }, []);

  return (
    <div
      ref={rowRef}
      className={[styles.historyItem, active ? styles.historyItemActive : ""].join(" ")}
      data-side-row=""
    >
      {treeDepth !== undefined && <TreeGuideLines depth={treeDepth} last={treeLast} />}
      {renaming ? (
        // 重命名态的输入框不能挂在 <button> 里（非法嵌套），所以整块替换按钮
        <input
          className={styles.renameInput}
          defaultValue={title}
          maxLength={60}
          aria-label={t("sidenav.session.renameLabel", { title })}
          // 挂载即聚焦并全选，直接输入新名字
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
        <button type="button" className={styles.historyMain} disabled={disabled} onClick={onOpen}>
          <span className={styles.historyTitle}>{compactTitle ? truncateTitle(title) : title}</span>
          <ExtensionReloadNotice sessionFile={session.file} />
        </button>
      )}
      <div className={styles.historyDots}>
        {/* 状态槽与 ⋯ 同位叠加：悬浮/聚焦/菜单常驻时状态让位（设计图 1/3/4，见 CSS） */}
        {busy || unread || pinned || globalPinned ? (
          <span
            className={styles.statusLayer}
            title={
              busy
                ? opening
                  ? t("sidenav.session.opening")
                  : t("sidenav.session.aiResponding")
                : unread
                  ? t("sidenav.session.aiDone")
                  : t("sidenav.session.pinned")
            }
          >
            {busy ? (
              <RunningDots />
            ) : unread ? (
              <span className={styles.doneDot} />
            ) : (
              <PushPin size={16} weight="fill" />
            )}
          </span>
        ) : null}
        <RowMenu
          label={t("sidenav.row.moreActionsFor", { name: title })}
          // 菜单打开即收起详情卡：卡片会压住菜单（设计图 2 的菜单更高，重叠更明显）
          onOpenChange={closeHoverCard}
          items={[
            copyTaskIdItem(session.id, showToast),
            renameItem(() => {
              // 进入输入态前先收起详情卡，否则它会挡住正在编辑的行
              setCardAnchor(null);
              setRenaming(true);
            }),
            // 没有工作目录的会话（旧格式 JSONL）没有可打开的目录：整行不展示
            openFolderItem(session.cwd, showToast),
            // 未落盘的新会话没有可导出的 JSONL：整行不展示
            exportItem(session.file, title, showToast),
            pinGlobalItem(globalPinned, () => {
              // 全局置顶会立刻把条目挪进「置顶」分区：先收起卡片，避免它停在旧位置
              setCardAnchor(null);
              toggleGlobalPin(session.file);
            }),
            pinWorkspaceItem(pinned, () => {
              setCardAnchor(null);
              togglePin(session.file);
            }),
            // 「结束进程」：仅该会话有存活 pi 实例时显示；结束 ≠ 删除，JSONL 保留
            processAlive
              ? {
                  key: "endProcess",
                  label: t("sidenav.session.endProcess"),
                  icon: <Prohibit size={16} weight="regular" />,
                  onSelect: () => {
                    setCardAnchor(null);
                    setConfirmEndOpen(true);
                    // 确认文案要复述后台进程数（docs/design/37 §4.3）
                    const sid = getSessionIdForFile(session.file);
                    if (sid) {
                      void refreshSessionProcesses(sid).then(() => {
                        setEndBgCount(procStore.aliveCount(sid));
                      });
                    } else {
                      setEndBgCount(0);
                    }
                  },
                }
              : null,
            // 已未读的条目不必再标；正在浏览的会话标记后会被清除副作用立刻消化，禁用并提示
            unread
              ? null
              : markUnreadItem({
                  disabled: active && page === "session",
                  onSelect: () => markSessionUnread(session.file),
                }),
            // 归档（分隔线之下，危险色；pending 行返回 null）：收进设置 → 已归档对话，可随时恢复
            archiveItem(session.file, () => archiveSession(session.file)),
            deleteItem(t("sidenav.session.deleteTask"), () => {
              void removeSession(session.file);
            }),
          ]}
        />
      </div>
      {cardAnchor && (
        <HistoryHoverCard
          session={session}
          title={title}
          spaceName={spaceName}
          anchor={cardAnchor}
        />
      )}
      <ConfirmDialog
        open={confirmEndOpen}
        title={t("sidenav.session.endProcess")}
        message={
          <>
            <p>
              {running
                ? t("sidenav.session.endConfirm.running")
                : t("sidenav.session.endConfirm.idle")}
            </p>
            {endBgCount > 0 ? (
              <p>{t("proc.endConfirm.withBackground", { count: endBgCount })}</p>
            ) : null}
          </>
        }
        confirmLabel={
          endBgCount > 0 ? t("proc.endConfirm.endTogether") : t("sidenav.session.endProcess")
        }
        secondaryLabel={endBgCount > 0 ? t("proc.endConfirm.keepBackground") : undefined}
        tone="danger"
        onConfirm={() => {
          setConfirmEndOpen(false);
          setEndBgCount(0);
          endSessionProcess(session.file);
        }}
        onSecondary={
          endBgCount > 0
            ? () => {
                setConfirmEndOpen(false);
                setEndBgCount(0);
                endSessionProcess(session.file, { keepBackground: true });
              }
            : undefined
        }
        onCancel={() => {
          setConfirmEndOpen(false);
          setEndBgCount(0);
        }}
      />
    </div>
  );
}
