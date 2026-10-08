import { CaretDown } from "@phosphor-icons/react";
import type { TranslateFn } from "../../../shared/i18n";
import type {
  PiPackageResourceItem,
  PiPackageResourceItems,
  PiPackageResourceKind,
} from "../../../shared/ipc";
import { useCollapseAnimation } from "../../hooks/useCollapseAnimation";
import { useT } from "../../hooks/useT";
import { Toggle } from "../ui/Toggle";
import styles from "./PackageResources.module.css";

export const RESOURCE_KIND_ORDER: readonly PiPackageResourceKind[] = [
  "extensions",
  "skills",
  "prompts",
  "themes",
];

export function resourceKindLabel(t: TranslateFn, kind: PiPackageResourceKind): string {
  return t(`extensions.resourceKind.${kind}`);
}

interface PackageResourcesProps {
  items: PiPackageResourceItems;
  openKinds: ReadonlySet<PiPackageResourceKind>;
  busy: boolean;
  onOpenPath: (path: string) => void;
  onToggleKind: (kind: PiPackageResourceKind) => void;
  onToggleResource: (
    kind: PiPackageResourceKind,
    item: PiPackageResourceItem,
    enabled: boolean,
  ) => void;
}

/**
 * 包内资源明细：只渲染已展开的种类（chip / 分组标题切换），
 * 避免收起的「技能/主题」只露标题却点不动。
 */
export function PackageResources({
  items,
  openKinds,
  busy,
  onOpenPath,
  onToggleKind,
  onToggleResource,
}: PackageResourcesProps) {
  const visibleKinds = RESOURCE_KIND_ORDER.filter(
    (kind) => openKinds.has(kind) && items[kind].length > 0,
  );
  if (visibleKinds.length === 0) return null;

  return (
    <div className={styles.panel}>
      {visibleKinds.map((kind) => (
        <ResourceGroup
          key={kind}
          kind={kind}
          items={items[kind]}
          busy={busy}
          onOpenPath={onOpenPath}
          onToggleKind={onToggleKind}
          onToggleResource={onToggleResource}
        />
      ))}
    </div>
  );
}

interface ResourceGroupProps {
  kind: PiPackageResourceKind;
  items: PiPackageResourceItem[];
  busy: boolean;
  onOpenPath: (path: string) => void;
  onToggleKind: (kind: PiPackageResourceKind) => void;
  onToggleResource: (
    kind: PiPackageResourceKind,
    item: PiPackageResourceItem,
    enabled: boolean,
  ) => void;
}

function ResourceGroup({
  kind,
  items,
  busy,
  onOpenPath,
  onToggleKind,
  onToggleResource,
}: ResourceGroupProps) {
  const t = useT();
  const kindLabel = resourceKindLabel(t, kind);
  // 渲染即展开；收起动画结束后本组不再挂载（父层过滤 openKinds）
  const { ref, innerRef, rendered } = useCollapseAnimation<HTMLDivElement, HTMLUListElement>(true);

  return (
    <section className={styles.group}>
      <button
        type="button"
        className={styles.groupHead}
        aria-expanded
        title={t("extensions.collapseKind", { kind: kindLabel })}
        onClick={() => onToggleKind(kind)}
      >
        <span className={styles.caretSlot}>
          <CaretDown size={12} weight="regular" />
        </span>
        <span className={styles.groupTitle}>{kindLabel}</span>
        <span className={styles.groupCount}>{items.length}</span>
      </button>
      <div className={styles.groupBody} ref={ref}>
        {rendered ? (
          <ul className={styles.itemList} ref={innerRef}>
            {items.map((item) => (
              <li key={item.path} className={item.enabled ? "" : styles.itemOff}>
                <button
                  type="button"
                  className={styles.item}
                  title={item.relativePath}
                  onClick={() => onOpenPath(item.path)}
                >
                  <span className={styles.itemName}>{item.name}</span>
                  <span className={styles.itemPath}>{item.relativePath}</span>
                </button>
                <Toggle
                  checked={item.enabled}
                  disabled={busy}
                  aria-label={
                    item.enabled
                      ? t("extensions.disableResource", { kind: kindLabel, name: item.name })
                      : t("extensions.enableResource", { kind: kindLabel, name: item.name })
                  }
                  onChange={(next) => onToggleResource(kind, item, next)}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
