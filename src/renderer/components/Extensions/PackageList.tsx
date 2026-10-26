import { ArrowSquareOut, Package, Plus } from "@phosphor-icons/react";
import type {
  PiPackageEntry,
  PiPackageResourceItem,
  PiPackageResourceKind,
} from "../../../shared/ipc";
import { useT } from "../../hooks/useT";
import { Button } from "../ui/Button";
import { PackageCard } from "./PackageCard";
import styles from "./PackageList.module.css";

interface PackageListProps {
  entries: PiPackageEntry[];
  scope: "user" | "project";
  busy: boolean;
  onToggle: (entry: PiPackageEntry, enabled: boolean) => void;
  onRemove: (entry: PiPackageEntry) => void;
  onOpenPath: (path: string) => void;
  onInstall: () => void;
  onOpenGallery: () => void;
  onToggleResource: (
    entry: PiPackageEntry,
    kind: PiPackageResourceKind,
    item: PiPackageResourceItem,
    enabled: boolean,
  ) => void;
}

/** 包列表；空列表按作用域给出安装引导。 */
export function PackageList({
  entries,
  scope,
  busy,
  onToggle,
  onRemove,
  onOpenPath,
  onInstall,
  onOpenGallery,
  onToggleResource,
}: PackageListProps) {
  const t = useT();

  if (entries.length === 0) {
    return (
      <div className={styles.emptyCard}>
        <span className={styles.emptyIcon}>
          <Package size={20} weight="regular" />
        </span>
        <h3 className={styles.emptyTitle}>
          {scope === "project" ? t("extensions.emptyProjectTitle") : t("extensions.emptyUserTitle")}
        </h3>
        <p className={styles.emptyText}>
          {scope === "project" ? t("extensions.emptyProject") : t("extensions.emptyUser")}
        </p>
        <div className={styles.emptyActions}>
          <Button variant="primary" onClick={onInstall}>
            <Plus size={16} weight="regular" /> {t("extensions.install")}
          </Button>
          {scope === "user" ? (
            <Button onClick={onOpenGallery}>
              <ArrowSquareOut size={16} weight="regular" /> {t("extensions.gallery")}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.list}>
      {entries.map((entry) => (
        <PackageCard
          key={entry.source}
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
