import { type RefObject, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SessionSummary } from "../../../shared/ipc";
import { useT } from "../../hooks/useT";
import { useBlockingSessionIds } from "../../stores/extensionViewStore";
import { useProjectStore } from "../../stores/projectStore";
import type { SessionAttentionKind } from "../../stores/sessionBuckets";
import { useSessionMeta } from "../../stores/sessionStore";
import { moveToIndex } from "../../utils/listReorder";
import { findOwningProject } from "../../utils/sessionGroups";
import { HistoryItem } from "./HistoryItem";
import styles from "./SideNav.module.css";
import { TreeGuideLines } from "./TreeGuideLines";
import { useLongPressReorder } from "./useLongPressReorder";
import { useOpenHistory } from "./useOpenHistory";

/**
 * 单条历史记录的状态槽（docs/design/82）：
 * 运行点阵 / 等待你回答 / AI 完成 / 未正常结束 / 手动未读。
 */
export type HistoryItemStatus = "running" | "awaiting" | SessionAttentionKind | null;

/** 默认展示的会话条数，超出部分折叠进"显示更多"。 */
const VISIBLE_LIMIT = 5;

interface HistoryListProps {
  sessions: SessionSummary[];
  /** 归属项目 id；顶层"任务"传 null（打开历史时回到无项目态）。 */
  projectId: string | null;
  emptyText: string;
  /** 顶层列表与项目子列表的缩进样式不同。 */
  className: string;
  /** 折叠动画用的外层容器（高度补间的目标）；作为折叠子列表渲染时必传。 */
  containerRef?: RefObject<HTMLDivElement | null>;
  /** 折叠动画用的内层测量容器；与 containerRef 成对出现。 */
  innerRef?: RefObject<HTMLUListElement | null>;
  /** 是否绘制树状引导线（仅项目子列表）。 */
  withTreeGuides?: boolean;
  /**
   * 长按拖拽排序（docs/design/109）：只有项目分组传入。回调收到**整组未置顶会话**的新顺序
   * （含被"显示更多"折叠起来的条目）；工作区置顶的会话不参与排序，固定在最前。
   */
  reorder?: {
    onReorder: (files: string[]) => void;
  };
}

/**
 * 历史会话列表（项目子列表与顶层"任务"共用）：超出条数折叠，可"显示更多 / 收起"。
 *
 * 两种形态：
 * - 传入 containerRef/innerRef 时，底层容器换成 <div>（<ul> 内直接放 <div> 是非法嵌套），
 *   由 useCollapseAnimation 对 containerRef 做高度补间；
 * - 否则渲染为普通 <ul>，由父级决定是否需要折叠。
 *
 * 排序（docs/design/109）：项目分组内可长按拖动未置顶的可见行换位；落点线画在行边界。
 * 行菜单另有「上移 / 下移」作为键盘入口。拖拽写回整组顺序，交给 sessionOrder 持久化。
 */
export function HistoryList({
  sessions,
  projectId,
  emptyText,
  className,
  containerRef,
  innerRef,
  withTreeGuides = false,
  reorder,
}: HistoryListProps) {
  const t = useT();
  const [showAll, setShowAll] = useState(false);
  const { open, openingFile } = useOpenHistory();
  const {
    activeSessionFile,
    attentionFiles,
    isFileProcessAlive,
    isFileRunning,
    getSessionIdForFile,
    pinnedFiles,
  } = useSessionMeta();
  const blockingSessionIds = useBlockingSessionIds();
  const { projects } = useProjectStore();

  const visible = showAll ? sessions : sessions.slice(0, VISIBLE_LIMIT);
  // 可排序块 = 可见的未置顶会话；工作区置顶的条目固定在组首，不参与拖动与落点
  const reorderable = reorder !== undefined;
  const visibleUnpinned = reorderable
    ? visible.filter((session) => !pinnedFiles.includes(session.file))
    : [];
  /** 整组未置顶会话的文件顺序（含折叠起来没渲染的条目）。 */
  const unpinnedFiles = (): string[] =>
    sessions
      .filter((session) => !pinnedFiles.includes(session.file))
      .map((session) => session.file);

  const ownRef = useRef<HTMLUListElement>(null);
  const { drag, handlers, consumeDragClick } = useLongPressReorder({
    containerRef: innerRef ?? ownRef,
    enabled: reorderable && visibleUnpinned.length > 1,
    itemSelector: "[data-history-row]",
    handleSelector: "[data-reorder-handle]",
    onReorder: (id, toIndex) => {
      if (!reorder) return;
      const files = unpinnedFiles();
      const from = files.indexOf(id);
      if (from < 0) return;
      // 可见块是整组未置顶顺序的前缀：可见行里的插入位就是整组数组里的下标
      reorder.onReorder(moveToIndex(files, from, toIndex));
    },
  });

  /** 行菜单的上移 / 下移：与拖动共用同一条写回路径，边界按可见的未置顶块算。 */
  const moveBy = (file: string, direction: -1 | 1): void => {
    if (!reorder) return;
    const files = unpinnedFiles();
    const from = files.indexOf(file);
    const block = visibleUnpinned.map((session) => session.file);
    const blockIndex = block.indexOf(file);
    const target = blockIndex + direction;
    if (from < 0 || blockIndex < 0 || target < 0 || target >= block.length) return;
    reorder.onReorder(moveToIndex(files, from, target));
  };

  // 所属空间名给悬浮详情卡用：项目子列表由归属 id 直取；顶层列表（任务 / 置顶）
  // 按会话 cwd 现查（置顶分区的条目来自任意分组，必须逐条解析）
  const spaceNameOf = (session: SessionSummary): string | null => {
    if (projectId) return projects.find((project) => project.id === projectId)?.name ?? null;
    return findOwningProject(session.cwd, projects)?.name ?? null;
  };

  // 运行态优先：等待回答（扩展表单阻塞）优先于点阵；其余看收口写入的待读标记
  const statusOf = (file: string): HistoryItemStatus => {
    if (isFileRunning(file)) {
      const sessionId = getSessionIdForFile(file);
      if (sessionId && blockingSessionIds.has(sessionId)) return "awaiting";
      return "running";
    }
    return attentionFiles.get(file) ?? null;
  };

  const rows = (
    <>
      {visible.map((session, index) => {
        const pinned = pinnedFiles.includes(session.file);
        // 只有可见的未置顶行参与排序；块里不足两条时连菜单项都不出现
        const canReorder = reorderable && !pinned && visibleUnpinned.length > 1;
        const blockIndex = canReorder
          ? visibleUnpinned.findIndex((item) => item.file === session.file)
          : -1;
        return (
          <li key={session.file}>
            <HistoryItem
              session={session}
              active={activeSessionFile === session.file}
              disabled={false}
              status={statusOf(session.file)}
              spaceName={spaceNameOf(session)}
              treeDepth={withTreeGuides ? 0 : undefined}
              /* 树线 └ 只画在真实末条上：收起态的"可见末条"下面还有"显示更多"行，
                 分支未结束，须画贯穿线（├）让树线延续下去 */
              treeLast={index === sessions.length - 1}
              opening={openingFile === session.file}
              processAlive={isFileProcessAlive(session.file)}
              running={isFileRunning(session.file)}
              reorderable={canReorder}
              dragging={drag?.id === session.file}
              consumeDragClick={consumeDragClick}
              reorderMove={
                canReorder
                  ? {
                      canMoveUp: blockIndex > 0,
                      canMoveDown: blockIndex >= 0 && blockIndex < visibleUnpinned.length - 1,
                      onMove: (direction) => moveBy(session.file, direction),
                    }
                  : undefined
              }
              onOpen={() => open(session, projectId)}
            />
          </li>
        );
      })}
      {sessions.length === 0 && (
        <li>
          <div className={styles.guideRow}>
            {withTreeGuides && <TreeGuideLines depth={0} last />}
            <span className={styles.historyMeta}>{emptyText}</span>
          </div>
        </li>
      )}
      {sessions.length > VISIBLE_LIMIT && (
        <li>
          <div className={styles.guideRow}>
            {/* 收起态分支在此收 └；展开态末条已是 └，"收起"行不再续线 */}
            {withTreeGuides && !showAll && <TreeGuideLines depth={0} last />}
            <button type="button" className={styles.showMore} onClick={() => setShowAll((v) => !v)}>
              {showAll
                ? t("common.collapse")
                : t("common.showMore", { count: sessions.length - VISIBLE_LIMIT })}
            </button>
          </div>
        </li>
      )}
    </>
  );

  const dropLine =
    drag?.lineY != null ? (
      <li
        className={styles.historyDropLine}
        data-history-drop-line=""
        style={{ top: drag.lineY }}
        aria-hidden="true"
      />
    ) : null;

  const ghost =
    drag &&
    createPortal(
      <div
        className={styles.dragGhost}
        data-history-ghost=""
        style={{
          left: drag.rect.left + 8,
          top: drag.rect.top,
          width: Math.max(0, drag.rect.width - 16),
          transform: `translateY(${drag.dy}px)`,
        }}
        aria-hidden="true"
      >
        <span className={[styles.itemText, styles.dragGhostLabel].join(" ")}>{drag.label}</span>
      </div>,
      document.body,
    );

  const ulClass = reorderable ? [className, styles.reorderList].join(" ") : className;
  const listProps = { className: ulClass, "data-reordering": drag ? "" : undefined, ...handlers };

  // 折叠形态：外层 <div> 承载高度补间，内层 <ul> 才是真正的列表
  if (containerRef && innerRef) {
    return (
      <>
        <div ref={containerRef} className={styles.collapseRoot}>
          <ul ref={innerRef} {...listProps}>
            {rows}
            {dropLine}
          </ul>
        </div>
        {ghost}
      </>
    );
  }

  return (
    <>
      <ul ref={ownRef} {...listProps}>
        {rows}
        {dropLine}
      </ul>
      {ghost}
    </>
  );
}
