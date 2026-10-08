import { CircleNotch, Prohibit, PushPin, PushPinSlash } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
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
import { RevealOnRowHover } from "./RevealOnRowHover";
import { archiveItem, deleteItem, openFolderItem, RowMenu, renameItem } from "./RowMenu";
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
 * 侧栏历史会话条目（单行）：状态指示 + 标题 + 悬浮操作（更多 / 置顶）。
 * AI 输出中显示旋转指示，完成后（且用户不在该会话）变绿点提醒。
 *
 * 标题不再"悬浮滚动"，改为单行截断 + 悬浮（或键盘聚焦）后弹出详情卡展示全文与元信息，
 * 见 HistoryHoverCard。悬浮时整行轻微右移，作为"这条可点"的触觉提示。
 * 标题可用行内"更多"菜单重命名：标题原地变成输入框（Enter / 失焦提交，Escape 取消），
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
    sessionTitles,
    togglePin,
    endSessionProcess,
    archiveSession,
    getSessionIdForFile,
  } = useSessionMeta();
  const { showToast } = useUiStore();
  const title = sessionTitle(session, sessionTitles[session.file]);
  const pinned = pinnedFiles.includes(session.file);
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
          {(status === "running" || opening) && (
            <span
              className={styles.historyStatus}
              title={opening ? t("sidenav.session.opening") : t("sidenav.session.aiResponding")}
            >
              <CircleNotch size={16} weight="regular" className={styles.statusSpin} />
            </span>
          )}
          {status === "unread" && !opening && (
            <span className={styles.historyStatus} title={t("sidenav.session.aiDone")}>
              <span className={styles.doneDot} />
            </span>
          )}
          {/* 置顶常驻标识：置顶只改变排序，这是不悬浮时唯一可见的痕迹；运行/未读状态优先占用状态槽 */}
          {pinned && !status && !opening && (
            <span className={styles.historyStatus} title={t("sidenav.session.pinned")}>
              <PushPin size={16} weight="fill" />
            </span>
          )}
          <span className={styles.historyTitle}>{compactTitle ? truncateTitle(title) : title}</span>
          <ExtensionReloadNotice sessionFile={session.file} />
        </button>
      )}
      <div className={styles.historyDots}>
        <RowMenu
          label={t("sidenav.row.moreActionsFor", { name: title })}
          items={[
            renameItem(() => {
              // 进入输入态前先收起详情卡，否则它会挡住正在编辑的行
              setCardAnchor(null);
              setRenaming(true);
            }),
            // 没有工作目录的会话（旧格式 JSONL）没有可打开的目录：整行不展示
            openFolderItem(session.cwd, showToast),
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
            // 归档（pending 行返回 null）：收进设置 → 已归档对话，可随时恢复
            archiveItem(session.file, () => archiveSession(session.file)),
            deleteItem(t("sidenav.session.deleteTask"), () => {
              void removeSession(session.file);
            }),
          ]}
        />
        <RevealOnRowHover>
          <button
            type="button"
            className={styles.rowButton}
            title={pinned ? t("sidenav.session.unpin") : t("sidenav.session.pin")}
            aria-label={
              pinned
                ? t("sidenav.session.unpinLabel", { title })
                : t("sidenav.session.pinLabel", { title })
            }
            aria-pressed={pinned}
            onClick={() => {
              // 置顶会立刻重排列表，这一行可能挪走：先收起卡片，避免它停在旧位置
              setCardAnchor(null);
              togglePin(session.file);
            }}
          >
            {pinned ? (
              <PushPinSlash size={16} weight="regular" />
            ) : (
              <PushPin size={16} weight="regular" />
            )}
          </button>
        </RevealOnRowHover>
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
