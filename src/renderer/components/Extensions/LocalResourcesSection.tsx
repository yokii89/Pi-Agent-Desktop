import { CaretRight, Folder, FolderOpen } from "@phosphor-icons/react";
import { useId, useState } from "react";
import type {
  PiLocalResourceDir,
  PiLocalResourceItem,
  PiPackageResourceKind,
} from "../../../shared/ipc";
import { useCollapseAnimation } from "../../hooks/useCollapseAnimation";
import { useT } from "../../hooks/useT";
import { IconButton } from "../ui/IconButton";
import styles from "./LocalResourcesSection.module.css";
import { ResourceList } from "./ResourceList";

interface LocalResourcesSectionProps {
  dirs: PiLocalResourceDir[];
  busy: boolean;
  onOpenPath: (path: string) => void;
  onToggleResource: (dir: PiLocalResourceDir, item: PiLocalResourceItem, enabled: boolean) => void;
}

function localKindKey(kind: PiLocalResourceDir["kind"]): string {
  return `extensions.localKind.${kind}`;
}

function dotKindFor(dir: PiLocalResourceDir): PiPackageResourceKind {
  return dir.kind === "sharedSkills" ? "skills" : dir.kind;
}

/** 本地资源：已创建目录可展开管理，未创建目录收进一个折叠组。 */
export function LocalResourcesSection({
  dirs,
  busy,
  onOpenPath,
  onToggleResource,
}: LocalResourcesSectionProps) {
  const t = useT();
  if (dirs.length === 0) return null;

  const existing = dirs.filter((dir) => dir.exists);
  const missing = dirs.filter((dir) => !dir.exists);

  return (
    <section>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>
          {t("extensions.localResources")}
          <span className={styles.scopeBadge}>{t("extensions.scope.user")}</span>
        </h2>
        <span className={styles.sectionNote}>{t("extensions.section.localNote")}</span>
      </div>
      <div className={styles.surface}>
        {existing.length === 0 ? <p className={styles.none}>{t("extensions.localNone")}</p> : null}
        {existing.map((dir) => (
          <LocalFolderRow
            key={dir.kind}
            dir={dir}
            busy={busy}
            onOpenPath={onOpenPath}
            onToggleResource={onToggleResource}
          />
        ))}
        {missing.length > 0 ? <MissingDirsGroup dirs={missing} /> : null}
      </div>
    </section>
  );
}

function LocalFolderRow({
  dir,
  busy,
  onOpenPath,
  onToggleResource,
}: {
  dir: PiLocalResourceDir;
  busy: boolean;
  onOpenPath: (path: string) => void;
  onToggleResource: (dir: PiLocalResourceDir, item: PiLocalResourceItem, enabled: boolean) => void;
}) {
  const t = useT();
  const detailId = useId();
  const [expanded, setExpanded] = useState(false);
  const { ref, innerRef, rendered } = useCollapseAnimation<HTMLDivElement, HTMLDivElement>(
    expanded,
  );
  const kindLabel = t(localKindKey(dir.kind));
  const enabledCount = dir.items.filter((item) => item.enabled).length;
  const stateText =
    dir.items.length === 0
      ? t("extensions.localEmptyState")
      : t("extensions.localState", { enabled: enabledCount, total: dir.items.length });

  return (
    <>
      <div className={styles.folderRow}>
        <button
          type="button"
          className={styles.folderMain}
          aria-expanded={expanded}
          aria-controls={detailId}
          onClick={() => setExpanded((prev) => !prev)}
        >
          <span className={styles.folderIcon}>
            <Folder size={16} weight="regular" />
          </span>
          <span className={styles.text}>
            <span className={styles.titleRow}>
              <span className={styles.name}>{kindLabel}</span>
              <span className={styles.count}>{dir.items.length}</span>
            </span>
            <span className={styles.path} title={dir.path}>
              {dir.path}
            </span>
          </span>
          <span className={styles.state}>{stateText}</span>
          <span className={styles.chev} aria-hidden="true">
            <CaretRight size={14} weight="regular" />
          </span>
        </button>
        <IconButton title={t("extensions.openFolder")} onClick={() => onOpenPath(dir.path)}>
          <FolderOpen size={16} weight="regular" />
        </IconButton>
      </div>
      <div className={styles.detailWrap} id={detailId} ref={ref}>
        {rendered ? (
          <div className={styles.detail} ref={innerRef}>
            <ResourceList
              dotKind={dotKindFor(dir)}
              kindLabel={kindLabel}
              items={dir.items}
              busy={busy}
              emptyText={t("extensions.localEmpty")}
              onOpenPath={onOpenPath}
              onToggleResource={(item, enabled) => onToggleResource(dir, item, enabled)}
              initialVisible={8}
            />
          </div>
        ) : null}
      </div>
    </>
  );
}

function MissingDirsGroup({ dirs }: { dirs: PiLocalResourceDir[] }) {
  const t = useT();
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const { ref, innerRef, rendered } = useCollapseAnimation<HTMLDivElement, HTMLUListElement>(
    expanded,
  );

  return (
    <div className={styles.missing}>
      <button
        type="button"
        className={styles.missingHead}
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span className={styles.chev} aria-hidden="true">
          <CaretRight size={14} weight="regular" />
        </span>
        <span>{t("extensions.localMissing.title")}</span>
        <span className={styles.count}>{dirs.length}</span>
        <span className={styles.missingNote}>{t("extensions.localMissing.note")}</span>
      </button>
      <div className={styles.missingBody} id={listId} ref={ref}>
        {rendered ? (
          <ul className={styles.missingList} ref={innerRef}>
            {dirs.map((dir) => (
              <li key={dir.kind} className={styles.missingItem}>
                <span className={styles.missingKind}>{t(localKindKey(dir.kind))}</span>
                <span className={styles.missingPath} title={dir.path}>
                  {dir.path}
                </span>
                <span className={styles.missingBadge}>{t("extensions.localMissing.badge")}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
