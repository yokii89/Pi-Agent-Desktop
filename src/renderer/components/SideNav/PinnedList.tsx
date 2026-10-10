import { useState } from "react";
import type { SessionSummary } from "../../../shared/ipc";
import { useCollapseAnimation } from "../../hooks/useCollapseAnimation";
import { useT } from "../../hooks/useT";
import { HistoryList } from "./HistoryList";
import { SectionHeader } from "./SectionHeader";
import styles from "./SideNav.module.css";

interface PinnedListProps {
  sessions: SessionSummary[];
}

/**
 * 侧边栏顶层「置顶」：全局置顶会话（已从原分组提出，docs/design/45），
 * 固定在列表区最顶部、默认展开；空列表由调用方决定不渲染本分区。
 */
export function PinnedList({ sessions }: PinnedListProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(true);
  const collapse = useCollapseAnimation<HTMLDivElement, HTMLUListElement>(expanded);

  return (
    <section>
      <SectionHeader
        label={t("sidenav.pinned")}
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
      />
      {collapse.rendered && (
        <HistoryList
          containerRef={collapse.ref}
          innerRef={collapse.innerRef}
          sessions={sessions}
          projectId={null}
          emptyText={t("sidenav.pinned.empty")}
          className={styles.list}
        />
      )}
    </section>
  );
}
