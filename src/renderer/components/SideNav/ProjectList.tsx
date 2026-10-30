import { CaretDown, CaretRight, Folder, FolderOpen, Plus, PlusCircle } from "@phosphor-icons/react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { PideskProject } from "../../../shared/ipc";
import { useCollapseAnimation } from "../../hooks/useCollapseAnimation";
import { useT } from "../../hooks/useT";
import { useProjectStore } from "../../stores/projectStore";
import { useSessionMeta } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { loadGsap, prefersReducedMotion } from "../../utils/animation";
import { NAV_MOTION } from "../../utils/motionTokens";
import type { ProjectSessionGroup } from "../../utils/sessionGroups";
import { HistoryList } from "./HistoryList";
import { RevealOnRowHover } from "./RevealOnRowHover";
import { deleteItem, openFolderItem, RowMenu } from "./RowMenu";
import { noteNewPendingSessions } from "./revealPending";
import { SectionHeader } from "./SectionHeader";
import styles from "./SideNav.module.css";

interface ProjectListProps {
  groups: ProjectSessionGroup[];
}

/**
 * 侧边栏项目列表：项目 = 本地目录。整行为展开/收起名下历史会话的开关（同时切换项目上下文），
 * 悬浮行显示操作（更多 / 新建会话）；展开态在应用生命周期内保持，分区默认展开（展示全部项目），
 * 单个项目默认收起，但新会话落进该项目时自动展开。
 */
export const ProjectList = memo(function ProjectList({ groups }: ProjectListProps) {
  const t = useT();
  const { currentProject, selectProject, addProjectByPicker, removeProject } = useProjectStore();
  const { newSession } = useSessionMeta();
  const { showToast } = useUiStore();
  const [expanded, setExpanded] = useState(true);
  const collapse = useCollapseAnimation<HTMLDivElement, HTMLUListElement>(expanded);
  // 白名单记录被手动展开的项目；项目默认收起（首次打开软件不展开历史会话）
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());
  const seenPendingRef = useRef(new Set<string>());

  // 发送瞬间的乐观行按 cwd 落进归属项目；那一档项目是收起的话行在数据里也看不见，所以自动揭开
  useEffect(() => {
    const revealed: string[] = [];
    for (const group of groups) {
      if (noteNewPendingSessions(group.sessions, seenPendingRef.current)) {
        revealed.push(group.project.id);
      }
    }
    if (revealed.length === 0) return;
    setExpanded(true);
    setExpandedIds((prev) => {
      const next = new Set(prev);
      for (const id of revealed) next.add(id);
      return next;
    });
  }, [groups]);

  // 回调必须引用稳定：ProjectRow 是 memo 组件，回调换身份会让所有项目行跟着重渲染
  const toggleProject = useCallback((id: string): void => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const openProject = useCallback(
    (id: string): void => {
      selectProject(id);
      toggleProject(id);
    },
    [selectProject, toggleProject],
  );

  const newSessionIn = useCallback(
    (id: string): void => {
      selectProject(id);
      newSession();
    },
    [newSession, selectProject],
  );

  const removeProjectById = useCallback(
    (id: string): void => {
      removeProject(id);
    },
    [removeProject],
  );

  return (
    <section>
      <SectionHeader
        label={t("sidenav.projects")}
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
        action={
          <button
            type="button"
            className={styles.rowButton}
            title={t("sidenav.projects.add")}
            aria-label={t("sidenav.projects.add")}
            onClick={() => void addProjectByPicker()}
          >
            <Plus size={16} weight="regular" />
          </button>
        }
      />
      {collapse.rendered && (
        <div ref={collapse.ref} className={styles.collapseRoot}>
          <ul ref={collapse.innerRef} className={styles.list}>
            {groups.map(({ project, sessions }) => (
              <ProjectRow
                key={project.id}
                project={project}
                sessions={sessions}
                open={expandedIds.has(project.id)}
                active={currentProject?.id === project.id}
                onToggle={openProject}
                onNewSession={newSessionIn}
                onRemove={removeProjectById}
                showToast={showToast}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
});

interface ProjectRowProps {
  project: PideskProject;
  sessions: ProjectSessionGroup["sessions"];
  open: boolean;
  active: boolean;
  onToggle: (id: string) => void;
  onNewSession: (id: string) => void;
  onRemove: (id: string) => void;
  showToast: (message: string) => void;
}

/**
 * 单个项目行：折叠状态由父级持有（分区收起再展开时保留各项目的展开态），
 * 本组件单独 memo——切换某个项目只重渲染这一行，其余项目（含已展开的历史列表）不动。
 */
const ProjectRow = memo(function ProjectRow({
  project,
  sessions,
  open,
  active,
  onToggle,
  onNewSession,
  onRemove,
  showToast,
}: ProjectRowProps) {
  const t = useT();
  return (
    <li>
      <div
        className={[styles.projectRow, active ? styles.projectRowActive : ""].join(" ")}
        data-side-row=""
        data-side-hover=""
      >
        {/* 整行可点的展开/收起开关：透明按钮拉伸铺满行，
            操作按钮（更多/新建）浮在其上层，点击不会落到开关上 */}
        <button
          type="button"
          className={styles.projectRowHit}
          aria-expanded={open}
          aria-label={
            open
              ? t("sidenav.projects.collapseSessions", { name: project.name })
              : t("sidenav.projects.expandSessions", { name: project.name })
          }
          title={project.dir}
          onClick={() => onToggle(project.id)}
        />
        <div className={styles.projectMain}>
          <FolderGlyph open={open} active={active} />
          <span className={styles.itemText}>{project.name}</span>
        </div>
        <div className={styles.projectActions}>
          <RowMenu
            label={t("sidenav.row.moreActionsFor", { name: project.name })}
            items={[
              openFolderItem(project.dir, showToast),
              deleteItem(t("sidenav.projects.delete"), () => onRemove(project.id)),
            ]}
          />
          <RevealOnRowHover>
            <button
              type="button"
              className={styles.rowButton}
              title={t("sidenav.projects.newSession")}
              aria-label={t("sidenav.projects.newSessionIn", { name: project.name })}
              onClick={() => onNewSession(project.id)}
            >
              <PlusCircle size={16} weight="regular" />
            </button>
          </RevealOnRowHover>
        </div>
        {/* 展开箭头固定在行最右缘：与操作按钮构成右缘信息区，各项目行横向对齐 */}
        <span className={styles.projectCaret} aria-hidden="true">
          {open ? (
            <CaretDown size={16} weight="regular" />
          ) : (
            <CaretRight size={16} weight="regular" />
          )}
        </span>
      </div>
      <ProjectSessions open={open} sessions={sessions} projectId={project.id} />
    </li>
  );
});

/**
 * 项目图标：展开态决定 Folder / FolderOpen（收起后必须回到闭合图标，否则与箭头语义打架），
 * 当前项目用 fill 强调——底色已由选中药丸表达，图标不能同时兼任两个含义。
 * 开合时用一次缩放回弹强调"打开/收起"这个动作。
 */
function FolderGlyph({ open, active }: { open: boolean; active: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const firstRun = useRef(true);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (prefersReducedMotion()) return;
    let cancelled = false;
    void loadGsap().then((gsap) => {
      if (cancelled || !element.isConnected) return;
      gsap.fromTo(
        element,
        { scale: 0.78, rotate: open ? -12 : 0 },
        { scale: 1, rotate: 0, duration: NAV_MOTION.press, ease: NAV_MOTION.easeBack },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const weight: "fill" | "regular" = active ? "fill" : "regular";
  return (
    <span ref={ref} className={styles.projectGlyph}>
      {open ? <FolderOpen size={20} weight={weight} /> : <Folder size={20} weight={weight} />}
    </span>
  );
}

/** 项目名下的会话子列表：独立一份折叠动画，与项目分区折叠互不干扰。 */
function ProjectSessions({
  open,
  sessions,
  projectId,
}: {
  open: boolean;
  sessions: ProjectSessionGroup["sessions"];
  projectId: string;
}) {
  const t = useT();
  const collapse = useCollapseAnimation<HTMLDivElement, HTMLUListElement>(open);

  if (!collapse.rendered) return null;

  return (
    <div className={styles.nestedWrap}>
      <HistoryList
        containerRef={collapse.ref}
        innerRef={collapse.innerRef}
        sessions={sessions}
        projectId={projectId}
        emptyText={t("sidenav.projects.noHistory")}
        className={styles.nestedList}
        withTreeGuides
      />
    </div>
  );
}
