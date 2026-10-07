import { CaretDown, CaretRight, Folder, FolderOpen, Plus, PlusCircle } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
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
import { SectionHeader } from "./SectionHeader";
import styles from "./SideNav.module.css";

interface ProjectListProps {
  groups: ProjectSessionGroup[];
}

/**
 * 侧边栏项目列表：项目 = 本地目录。整行为展开/收起名下历史会话的开关（同时切换项目上下文），
 * 悬浮行显示操作（更多 / 新建会话）；展开态在应用生命周期内保持，分区默认展开（展示全部项目）。
 */
export function ProjectList({ groups }: ProjectListProps) {
  const t = useT();
  const { currentProject, selectProject, addProjectByPicker, removeProject } = useProjectStore();
  const { newSession } = useSessionMeta();
  const { showToast } = useUiStore();
  const [expanded, setExpanded] = useState(true);
  const collapse = useCollapseAnimation<HTMLDivElement, HTMLUListElement>(expanded);
  // 白名单记录被手动展开的项目；项目默认收起（首次打开软件不展开历史会话）
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());

  const toggleProject = (id: string): void => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

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
            {groups.map(({ project, sessions }) => {
              const active = currentProject?.id === project.id;
              const isOpen = expandedIds.has(project.id);
              return (
                <li key={project.id}>
                  <div
                    className={[styles.projectRow, active ? styles.projectRowActive : ""].join(" ")}
                    data-side-row=""
                  >
                    {/* 整行可点的展开/收起开关：透明按钮拉伸铺满行，
                        操作按钮（更多/新建）浮在其上层，点击不会落到开关上 */}
                    <button
                      type="button"
                      className={styles.projectRowHit}
                      aria-expanded={isOpen}
                      aria-label={
                        isOpen
                          ? t("sidenav.projects.collapseSessions", { name: project.name })
                          : t("sidenav.projects.expandSessions", { name: project.name })
                      }
                      title={project.dir}
                      onClick={() => {
                        selectProject(project.id);
                        toggleProject(project.id);
                      }}
                    />
                    <div className={styles.projectMain}>
                      <FolderGlyph active={active} />
                      <span className={styles.itemText}>{project.name}</span>
                    </div>
                    <div className={styles.projectActions}>
                      <RowMenu
                        label={t("sidenav.row.moreActionsFor", { name: project.name })}
                        items={[
                          openFolderItem(project.dir, showToast),
                          deleteItem(t("sidenav.projects.delete"), () => removeProject(project.id)),
                        ]}
                      />
                      <RevealOnRowHover>
                        <button
                          type="button"
                          className={styles.rowButton}
                          title={t("sidenav.projects.newSession")}
                          aria-label={t("sidenav.projects.newSessionIn", { name: project.name })}
                          onClick={() => {
                            selectProject(project.id);
                            newSession();
                          }}
                        >
                          <PlusCircle size={16} weight="regular" />
                        </button>
                      </RevealOnRowHover>
                    </div>
                    {/* 展开箭头固定在行最右缘：与操作按钮构成右缘信息区，各项目行横向对齐 */}
                    <span className={styles.projectCaret} aria-hidden="true">
                      {isOpen ? (
                        <CaretDown size={16} weight="regular" />
                      ) : (
                        <CaretRight size={16} weight="regular" />
                      )}
                    </span>
                  </div>
                  <ProjectSessions open={isOpen} sessions={sessions} projectId={project.id} />
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

/** 项目图标：选中时切换 Folder → FolderOpen，并用一次缩放回弹强调"打开"这个动作。 */
function FolderGlyph({ active }: { active: boolean }) {
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
        { scale: 0.78, rotate: active ? -12 : 0 },
        { scale: 1, rotate: 0, duration: NAV_MOTION.press, ease: NAV_MOTION.easeBack },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [active]);

  return (
    <span ref={ref} className={styles.projectGlyph}>
      {active ? <FolderOpen size={20} weight="regular" /> : <Folder size={20} weight="regular" />}
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
        compactTitle
      />
    </div>
  );
}
