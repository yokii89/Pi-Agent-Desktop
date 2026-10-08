import type {
  PiPackageEntry,
  PiPackageResourceItem,
  PiPackageResourceKind,
} from "../../../shared/ipc";
import { PackageCard } from "./PackageCard";
import styles from "./PackageCard.module.css";

interface PackageListProps {
  entries: PiPackageEntry[];
  emptyText: string;
  busy: boolean;
  onToggle: (entry: PiPackageEntry, enabled: boolean) => void;
  onRemove: (entry: PiPackageEntry) => void;
  onOpenPath: (path: string) => void;
  onToggleResource: (
    entry: PiPackageEntry,
    kind: PiPackageResourceKind,
    item: PiPackageResourceItem,
    enabled: boolean,
  ) => void;
}

/** 包列表；空列表渲染说明文案。 */
export function PackageList({
  entries,
  emptyText,
  busy,
  onToggle,
  onRemove,
  onOpenPath,
  onToggleResource,
}: PackageListProps) {
  if (entries.length === 0) {
    return <div className={styles.empty}>{emptyText}</div>;
  }
  return (
    <div className={styles.list}>
      {entries.map((entry) => (
        <PackageCard
          key={`${entry.source}`}
          entry={entry}
          busy={busy}
          onToggle={onToggle}
          onRemove={onRemove}
          onOpenPath={onOpenPath}
          onToggleResource={onToggleResource}
        />
      ))}
    </div>
  );
}
