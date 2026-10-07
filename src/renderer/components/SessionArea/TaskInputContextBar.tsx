import { CaretDown, Check, Circle, Cloud, Folder, Plus } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { useT } from "../../hooks/useT";
import { useProjectStore } from "../../stores/projectStore";
import { Popover } from "../ui/Popover";
import { GitBranchChip } from "./GitBranchChip";
import styles from "./TaskInputContextBar.module.css";

/**
 * 空态输入栏顶栏：工作区芯片 + Git 分支芯片（docs/用户对话栏/1–3）。
 * 会话态不显示本栏——项目/分支信息进 SessionHeader（docs/用户对话栏/7.1）。
 */
export function TaskInputContextBar() {
  const t = useT();
  const { projects, currentProject, selectProject, addProjectByPicker } = useProjectStore();
  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const cwd = currentProject?.dir ?? null;

  const filteredProjects = useMemo(() => {
    const q = workspaceQuery.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) => p.name.toLowerCase().includes(q) || p.dir.toLowerCase().includes(q),
    );
  }, [projects, workspaceQuery]);

  return (
    <div className={styles.bar}>
      <Popover
        direction="top"
        align="left"
        trigger={({ onClick }) => (
          <button type="button" className={styles.chip} onClick={onClick}>
            <Folder size={16} weight="regular" />
            <span className={styles.chipLabel}>
              {currentProject?.name ?? t("session.workspace.select")}
            </span>
            <CaretDown size={14} weight="regular" />
          </button>
        )}
      >
        <div className={styles.panel}>
          <div className={styles.searchRow}>
            <input
              className={styles.search}
              placeholder={t("session.workspace.search")}
              value={workspaceQuery}
              onChange={(e) => setWorkspaceQuery(e.target.value)}
            />
          </div>
          <div className={styles.list}>
            {filteredProjects.map((project) => (
              <button
                key={project.id}
                type="button"
                className={styles.row}
                onClick={() => selectProject(project.id)}
              >
                <Folder size={16} weight="regular" />
                <span className={styles.rowLabel}>{project.name}</span>
                {project.id === currentProject?.id && (
                  <Check size={16} weight="regular" className={styles.check} />
                )}
              </button>
            ))}
            {filteredProjects.length === 0 && (
              <p className={styles.empty}>{t("session.workspace.empty")}</p>
            )}
          </div>
          <div className={styles.divider} />
          <button
            type="button"
            className={styles.row}
            onClick={() => {
              void addProjectByPicker();
            }}
          >
            <Plus size={16} weight="regular" />
            <span>{t("session.workspace.openFolder")}</span>
          </button>
          <button type="button" className={styles.row} disabled title={t("common.comingSoon")}>
            <Cloud size={16} weight="regular" className={styles.mutedIcon} />
            <span className={styles.mutedText}>{t("session.workspace.remote")}</span>
          </button>
          <button type="button" className={styles.row} onClick={() => selectProject(null)}>
            <Circle size={16} weight="regular" className={styles.mutedIcon} />
            <span>{t("session.workspace.none")}</span>
          </button>
        </div>
      </Popover>

      {cwd && <GitBranchChip cwd={cwd} direction="top" />}
    </div>
  );
}
