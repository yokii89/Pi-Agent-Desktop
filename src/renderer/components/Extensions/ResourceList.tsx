import { useState } from "react";
import type { PiPackageResourceKind } from "../../../shared/ipc";
import { useCollapseAnimation } from "../../hooks/useCollapseAnimation";
import { useT } from "../../hooks/useT";
import { Toggle } from "../ui/Toggle";
import styles from "./ResourceList.module.css";

export interface ResourceListItem {
  name: string;
  path: string;
  relativePath: string;
  enabled: boolean;
}

interface ResourceListProps {
  /** 文件点颜色；共享技能传 skills。 */
  dotKind: PiPackageResourceKind;
  /** 开关文案里的资源类型名；共享技能要显示「共享技能」。 */
  kindLabel: string;
  items: readonly ResourceListItem[];
  busy: boolean;
  emptyText: string;
  onOpenPath: (path: string) => void;
  onToggleResource: (item: ResourceListItem, enabled: boolean) => void;
  /** 超过该数量时折叠剩余项；省略则全部展示。 */
  initialVisible?: number;
}

function dotClass(dotKind: PiPackageResourceKind): string {
  if (dotKind === "extensions") return styles.ts;
  if (dotKind === "themes") return styles.json;
  return styles.md;
}

/** 单类资源列表：包内明細与本地资源目录共用。 */
export function ResourceList({
  dotKind,
  kindLabel,
  items,
  busy,
  emptyText,
  onOpenPath,
  onToggleResource,
  initialVisible,
}: ResourceListProps) {
  const t = useT();
  const [showAll, setShowAll] = useState(false);
  const limit = initialVisible ?? items.length;
  const hasMore = items.length > limit;
  const head = hasMore ? items.slice(0, limit) : items;
  const tail = hasMore ? items.slice(limit) : [];
  const { ref, innerRef, rendered } = useCollapseAnimation<HTMLDivElement, HTMLUListElement>(
    showAll && hasMore,
  );

  if (items.length === 0) return <p className={styles.empty}>{emptyText}</p>;

  const renderItem = (item: ResourceListItem) => (
    <li key={item.path} className={[styles.row, item.enabled ? "" : styles.off].join(" ")}>
      <button
        type="button"
        className={styles.main}
        title={item.path}
        onClick={() => onOpenPath(item.path)}
      >
        <span className={[styles.dot, dotClass(dotKind)].join(" ")} aria-hidden="true" />
        <span className={styles.name}>{item.name}</span>
        <span className={styles.path}>{item.relativePath}</span>
      </button>
      <Toggle
        checked={item.enabled}
        disabled={busy}
        aria-label={
          item.enabled
            ? t("extensions.disableResource", { kind: kindLabel, name: item.name })
            : t("extensions.enableResource", { kind: kindLabel, name: item.name })
        }
        onChange={(next) => onToggleResource(item, next)}
      />
    </li>
  );

  return (
    <div className={styles.list}>
      <ul className={styles.grid}>{head.map(renderItem)}</ul>
      {hasMore ? (
        <>
          <div className={styles.moreBody} ref={ref}>
            {rendered ? (
              <ul className={styles.grid} ref={innerRef}>
                {tail.map(renderItem)}
              </ul>
            ) : null}
          </div>
          <button type="button" className={styles.moreBtn} onClick={() => setShowAll((v) => !v)}>
            {showAll ? t("extensions.showLess") : t("extensions.showMore", { count: tail.length })}
          </button>
        </>
      ) : null}
    </div>
  );
}
