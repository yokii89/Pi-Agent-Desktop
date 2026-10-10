import { type RefObject, useState } from "react";
import type { SessionSummary } from "../../../shared/ipc";
import { useT } from "../../hooks/useT";
import { useProjectStore } from "../../stores/projectStore";
import { useSessionMeta } from "../../stores/sessionStore";
import { findOwningProject } from "../../utils/sessionGroups";
import { HistoryItem } from "./HistoryItem";
import styles from "./SideNav.module.css";
import { TreeGuideLines } from "./TreeGuideLines";
import { useOpenHistory } from "./useOpenHistory";

/** 单条历史记录的运行状态：AI 输出中（旋转指示）或完成未读（绿点）。 */
export type HistoryItemStatus = "running" | "unread" | null;

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
  /** 项目子列表形态：条目标题按字数截断（顶层"任务"列表按宽度截断）。 */
  compactTitle?: boolean;
}

/**
 * 历史会话列表（项目子列表与顶层"任务"共用）：超出条数折叠，可"显示更多 / 收起"。
 *
 * 两种形态：
 * - 传入 containerRef/innerRef 时，底层容器换成 <div>（<ul> 内直接放 <div> 是非法嵌套），
 *   由 useCollapseAnimation 对 containerRef 做高度补间；
 * - 否则渲染为普通 <ul>，由父级决定是否需要折叠。
 */
export function HistoryList({
  sessions,
  projectId,
  emptyText,
  className,
  containerRef,
  innerRef,
  withTreeGuides = false,
  compactTitle = false,
}: HistoryListProps) {
  const t = useT();
  const [showAll, setShowAll] = useState(false);
  const { open, openingFile } = useOpenHistory();
  const { activeSessionFile, unreadFiles, isFileProcessAlive, isFileRunning } = useSessionMeta();
  const { projects } = useProjectStore();

  const visible = showAll ? sessions : sessions.slice(0, VISIBLE_LIMIT);
  // 所属空间名给悬浮详情卡用：项目子列表由归属 id 直取；顶层列表（任务 / 置顶）
  // 按会话 cwd 现查（置顶分区的条目来自任意分组，必须逐条解析）
  const spaceNameOf = (session: SessionSummary): string | null => {
    if (projectId) return projects.find((project) => project.id === projectId)?.name ?? null;
    return findOwningProject(session.cwd, projects)?.name ?? null;
  };

  // 运行中优先于完成未读（多会话：按 file 独立判定，不依赖 active）
  const statusOf = (file: string): HistoryItemStatus => {
    if (isFileRunning(file)) return "running";
    if (unreadFiles.has(file)) return "unread";
    return null;
  };

  const rows = (
    <>
      {visible.map((session, index) => (
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
            compactTitle={compactTitle}
            opening={openingFile === session.file}
            processAlive={isFileProcessAlive(session.file)}
            running={isFileRunning(session.file)}
            onOpen={() => open(session, projectId)}
          />
        </li>
      ))}
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

  // 折叠形态：外层 <div> 承载高度补间，内层 <ul> 才是真正的列表
  if (containerRef && innerRef) {
    return (
      <div ref={containerRef} className={styles.collapseRoot}>
        <ul ref={innerRef} className={className}>
          {rows}
        </ul>
      </div>
    );
  }

  return <ul className={className}>{rows}</ul>;
}
