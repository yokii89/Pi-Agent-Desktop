import { useState } from "react";
import type { SessionSummary } from "../../../shared/ipc";
import { useCollapseAnimation } from "../../hooks/useCollapseAnimation";
import { useT } from "../../hooks/useT";
import { HistoryList } from "./HistoryList";
import { SectionHeader } from "./SectionHeader";
import styles from "./SideNav.module.css";

interface TaskListProps {
  tasks: SessionSummary[];
}

/** 侧边栏顶层"任务"：不属于任何项目的历史会话（无工作目录或映射不到项目）。分区默认收起。 */
export function TaskList({ tasks }: TaskListProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const collapse = useCollapseAnimation<HTMLDivElement, HTMLUListElement>(expanded);

  return (
    <section>
      <SectionHeader
        label={t("sidenav.tasks")}
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
      />
      {collapse.rendered && (
        <HistoryList
          containerRef={collapse.ref}
          innerRef={collapse.innerRef}
          sessions={tasks}
          projectId={null}
          emptyText={t("sidenav.tasks.empty")}
          className={styles.list}
        />
      )}
    </section>
  );
}
