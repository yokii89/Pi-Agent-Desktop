import { CaretDown, CaretRight, FolderOpen, Trash } from "@phosphor-icons/react";
import { useCallback, useMemo, useState } from "react";
import type { TranslateFn } from "../../../shared/i18n";
import type {
  PiPackageEntry,
  PiPackageResourceItem,
  PiPackageResourceKind,
} from "../../../shared/ipc";
import { useT } from "../../hooks/useT";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Toggle } from "../ui/Toggle";
import styles from "./PackageCard.module.css";
import { PackageResources, resourceKindLabel } from "./PackageResources";

const CHIP_ORDER: readonly PiPackageResourceKind[] = ["extensions", "skills", "prompts", "themes"];

function packageKindLabel(t: TranslateFn, kind: PiPackageEntry["kind"]): string {
  if (kind === "npm" || kind === "git") return kind;
  return t("extensions.kind.local");
}

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

/** 单个 pi package 卡片：名称 / 来源 / 资源计数（可点开展开明细）/ 启停 / 卸载 / 打开目录。 */
export function PackageCard({
  entry,
  busy,
  onToggle,
  onRemove,
  onOpenPath,
  onToggleResource,
}: PackageCardProps) {
  const t = useT();
  const [openKinds, setOpenKinds] = useState<ReadonlySet<PiPackageResourceKind>>(() => new Set());

  const chips = useMemo(
    () =>
      CHIP_ORDER.filter((kind) => entry.resources[kind] > 0).map((kind) => ({
        kind,
        count: entry.resources[kind],
      })),
    [entry.resources],
  );

  const toggleKind = useCallback((kind: PiPackageResourceKind) => {
    setOpenKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }, []);

  const anyOpen = openKinds.size > 0;

  const expandAll = useCallback(() => {
    setOpenKinds(new Set(CHIP_ORDER.filter((kind) => entry.resources[kind] > 0)));
  }, [entry.resources]);

  const collapseAll = useCallback(() => {
    setOpenKinds(new Set());
  }, []);

  return (
    <article className={[styles.card, entry.enabled ? "" : styles.cardDisabled].join(" ")}>
      <div className={styles.main}>
        <div className={styles.rowTop}>
          {chips.length > 0 ? (
            <button
              type="button"
              className={styles.expandBtn}
              aria-expanded={anyOpen}
              title={anyOpen ? t("extensions.collapseDetails") : t("extensions.expandDetails")}
              onClick={() => (anyOpen ? collapseAll() : expandAll())}
            >
              {anyOpen ? (
                <CaretDown size={14} weight="regular" />
              ) : (
                <CaretRight size={14} weight="regular" />
              )}
            </button>
          ) : (
            <span className={styles.expandSpacer} aria-hidden="true" />
          )}
          <span className={styles.name}>{entry.name}</span>
          <span className={styles.badge}>{packageKindLabel(t, entry.kind)}</span>
          {entry.version ? <span className={styles.badge}>v{entry.version}</span> : null}
          {!entry.installed ? (
            <span className={[styles.badge, styles.badgeWarn].join(" ")}>
              {t("extensions.dirMissing")}
            </span>
          ) : null}
        </div>
        {entry.description ? <p className={styles.desc}>{entry.description}</p> : null}
        <div className={styles.meta}>
          <span className={styles.source}>{entry.source}</span>
        </div>
        {chips.length > 0 ? (
          <div className={styles.chips}>
            {chips.map((chip) => {
              const active = openKinds.has(chip.kind);
              const kindLabel = resourceKindLabel(t, chip.kind);
              return (
                <button
                  key={chip.kind}
                  type="button"
                  className={[styles.chip, active ? styles.chipActive : ""].join(" ")}
                  aria-expanded={active}
                  title={t("extensions.expandKind", { kind: kindLabel })}
                  onClick={() => toggleKind(chip.kind)}
                >
                  {kindLabel} {chip.count}
                </button>
              );
            })}
          </div>
        ) : null}
        {chips.length > 0 ? (
          <PackageResources
            items={entry.resourceItems}
            openKinds={openKinds}
            busy={busy}
            onOpenPath={onOpenPath}
            onToggleKind={toggleKind}
            onToggleResource={(kind, item, enabled) => onToggleResource(entry, kind, item, enabled)}
          />
        ) : null}
      </div>
      <div className={styles.actions}>
        {entry.installPath ? (
          <IconButton
            title={t("extensions.openInstallDir")}
            disabled={busy || !entry.installed}
            onClick={() => entry.installPath && onOpenPath(entry.installPath)}
          >
            <FolderOpen size={16} weight="regular" />
          </IconButton>
        ) : null}
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
        <Button disabled={busy} onClick={() => onRemove(entry)}>
          <Trash size={16} weight="regular" /> {t("extensions.uninstall")}
        </Button>
      </div>
    </article>
  );
}
