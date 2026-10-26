import { CaretRight, FolderOpen, Package, Trash } from "@phosphor-icons/react";
import { useId, useState } from "react";
import type { TranslateFn } from "../../../shared/i18n";
import type {
  PiPackageEntry,
  PiPackageResourceItem,
  PiPackageResourceKind,
} from "../../../shared/ipc";
import { useCollapseAnimation } from "../../hooks/useCollapseAnimation";
import { useT } from "../../hooks/useT";
import { IconButton } from "../ui/IconButton";
import { Toggle } from "../ui/Toggle";
import styles from "./PackageCard.module.css";
import { ResourceList } from "./ResourceList";
import { RESOURCE_KIND_ORDER, resourceKindLabel } from "./resourceKinds";

interface PackageCardProps {
  entry: PiPackageEntry;
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

/** 单个 pi package：摘要行 + 展开后的分类资源明细。 */
export function PackageCard({
  entry,
  busy,
  onToggle,
  onRemove,
  onOpenPath,
  onToggleResource,
}: PackageCardProps) {
  const t = useT();
  const detailId = useId();
  const [expanded, setExpanded] = useState(false);
  const [activeKind, setActiveKind] = useState<PiPackageResourceKind>(
    () => RESOURCE_KIND_ORDER.find((kind) => entry.resources[kind] > 0) ?? "extensions",
  );
  const { ref, innerRef, rendered } = useCollapseAnimation<HTMLDivElement, HTMLDivElement>(
    expanded,
  );

  const chips = RESOURCE_KIND_ORDER.filter((kind) => entry.resources[kind] > 0);

  return (
    <article className={[styles.card, entry.enabled ? "" : styles.cardDisabled].join(" ")}>
      <div className={styles.row}>
        <button
          type="button"
          className={styles.main}
          aria-expanded={expanded}
          aria-controls={detailId}
          onClick={() => setExpanded((prev) => !prev)}
        >
          <span className={styles.icon}>
            <Package size={18} weight="regular" />
          </span>
          <span className={styles.text}>
            <span className={styles.titleRow}>
              <span className={styles.name}>{entry.name}</span>
              <span className={styles.badge}>{packageKindLabel(t, entry.kind)}</span>
              {entry.version ? <span className={styles.badge}>v{entry.version}</span> : null}
              {entry.enabled ? (
                <span className={styles.badgeAccent}>{t("extensions.enabled")}</span>
              ) : (
                <span className={styles.badge}>{t("extensions.disabled")}</span>
              )}
              {!entry.installed ? (
                <span className={styles.badgeWarn}>{t("extensions.dirMissing")}</span>
              ) : null}
            </span>
            <span className={styles.path} title={entry.source}>
              {entry.source}
            </span>
          </span>
          {chips.length > 0 ? (
            <span className={styles.chips}>
              {chips.map((kind) => (
                <span key={kind} className={styles.chip}>
                  {resourceKindLabel(t, kind)} {entry.resources[kind]}
                </span>
              ))}
            </span>
          ) : null}
          <span className={styles.chev} aria-hidden="true">
            <CaretRight size={14} weight="regular" />
          </span>
        </button>
        <div className={styles.actions}>
          <IconButton
            title={t("extensions.openInstallDir")}
            disabled={busy || !entry.installed}
            onClick={() => entry.installPath && onOpenPath(entry.installPath)}
          >
            <FolderOpen size={16} weight="regular" />
          </IconButton>
          <Toggle
            checked={entry.enabled}
            disabled={busy}
            aria-label={
              entry.enabled
                ? t("extensions.disablePackage", { name: entry.name })
                : t("extensions.enablePackage", { name: entry.name })
            }
            onChange={(next) => onToggle(entry, next)}
          />
          <IconButton
            title={t("extensions.uninstall")}
            disabled={busy}
            onClick={() => onRemove(entry)}
          >
            <Trash size={16} weight="regular" />
          </IconButton>
        </div>
      </div>
      <div className={styles.detailWrap} id={detailId} ref={ref}>
        {rendered ? (
          <div className={styles.detail} ref={innerRef}>
            <div className={styles.detailToolbar}>
              <div
                className={styles.kindTabs}
                role="tablist"
                aria-label={t("extensions.resources")}
              >
                {RESOURCE_KIND_ORDER.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    role="tab"
                    aria-selected={activeKind === kind}
                    className={styles.kindTab}
                    onClick={() => setActiveKind(kind)}
                  >
                    {resourceKindLabel(t, kind)}
                    <span className={styles.kindCount}>{entry.resources[kind]}</span>
                  </button>
                ))}
              </div>
              <span className={styles.detailHint}>{t("extensions.package.detailHint")}</span>
            </div>
            <ResourceList
              dotKind={activeKind}
              kindLabel={resourceKindLabel(t, activeKind)}
              items={entry.resourceItems[activeKind]}
              busy={busy}
              emptyText={t("extensions.package.emptyKind", {
                kind: resourceKindLabel(t, activeKind),
              })}
              onOpenPath={onOpenPath}
              onToggleResource={(item, enabled) =>
                onToggleResource(entry, activeKind, item, enabled)
              }
            />
          </div>
        ) : null}
      </div>
    </article>
  );
}

function packageKindLabel(t: TranslateFn, kind: PiPackageEntry["kind"]): string {
  if (kind === "npm" || kind === "git") return kind;
  return t("extensions.kind.local");
}
