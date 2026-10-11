import { Check, Circle, Cloud, Folder, Plus } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { useT } from "../../hooks/useT";
import { useProjectStore } from "../../stores/projectStore";
import { GlideChevron } from "../ui/GlideChevron";
import { OptionList, type OptionRow } from "../ui/OptionList";
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

  // rows 与 actions 同序（分隔线不占行序），OptionList 的行序就是这里的下标
  const rows: OptionRow[] = [];
  const actions: Array<() => void> = [];
  for (const project of filteredProjects) {
    const isCurrent = project.id === currentProject?.id;
    rows.push({
      key: project.id,
      className: styles.row,
      selected: isCurrent,
      text: project.name,
      node: (
        <>
          <Folder size={16} weight="regular" />
          <span className={styles.rowLabel}>{project.name}</span>
          {isCurrent && <Check size={16} weight="regular" className={styles.check} />}
        </>
      ),
    });
    actions.push(() => selectProject(project.id));
  }
  rows.push({ key: "group-divider", node: null, separator: true });
  rows.push({
    key: "add-project",
    className: styles.row,
    node: (
      <>
        <Plus size={16} weight="regular" />
        <span>{t("session.workspace.openFolder")}</span>
      </>
    ),
  });
  actions.push(() => {
    void addProjectByPicker();
  });
  rows.push({
    key: "remote-project",
    className: styles.row,
    disabled: true,
    title: t("common.comingSoon"),
    node: (
      <>
        <Cloud size={16} weight="regular" className={styles.mutedIcon} />
        <span className={styles.mutedText}>{t("session.workspace.remote")}</span>
      </>
    ),
  });
  actions.push(() => undefined);
  rows.push({
    key: "no-project",
    className: styles.row,
    node: (
      <>
        <Circle size={16} weight="regular" className={styles.mutedIcon} />
        <span>{t("session.workspace.none")}</span>
      </>
    ),
  });
  actions.push(() => selectProject(null));

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
            <GlideChevron size={14} />
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
          <OptionList
            rows={rows}
            role="listbox"
            ariaLabel={t("session.workspace.select")}
            className={styles.list}
            onSelect={(index) => actions[index]?.()}
          />
          {filteredProjects.length === 0 && (
            <p className={styles.empty}>{t("session.workspace.empty")}</p>
          )}
        </div>
      </Popover>

      {cwd && <GitBranchChip cwd={cwd} direction="top" />}
    </div>
  );
}
