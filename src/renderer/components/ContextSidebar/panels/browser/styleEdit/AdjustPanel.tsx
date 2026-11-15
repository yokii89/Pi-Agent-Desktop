import { CaretDown, CaretRight, Code, Eraser, Plus } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useT } from "../../../../../hooks/useT";
import { useInspectorStore } from "../../../../../stores/inspectorStore";
import { useStyleEditStore } from "../../../../../stores/styleEditStore";
import { AddPropertyForm } from "./AddPropertyForm";
import { CssReferencePanel } from "./CssReferencePanel";
import { PropertyRow } from "./PropertyRow";
import styles from "./styleEdit.module.css";

export function AdjustPanel({ compact }: { compact: boolean }) {
  const t = useT();
  const edit = useStyleEditStore();
  const inspector = useInspectorStore();
  const [open, setOpen] = useState(false);
  const currentDeclarations =
    edit.currentNodeId === inspector.nodeId ? edit.currentDeclarations : [];
  const hasCurrent = currentDeclarations.length > 0;
  const canEdit =
    inspector.nodeId !== null && edit.currentNodeId === inspector.nodeId && !inspector.stale;

  useEffect(() => {
    if (edit.error) setOpen(true);
  }, [edit.error]);

  return (
    <section className={styles.cssDraft} aria-label={t("browser.styles.cssGroup")}>
      <header className={styles.cssDraftHeader}>
        <button
          type="button"
          className={styles.cssDraftToggle}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <CaretDown size={14} /> : <CaretRight size={14} />}
          <Code size={14} weight="regular" />
          <span>{t("browser.styles.cssGroup")}</span>
          {hasCurrent && <span className={styles.cssDraftCount}>{currentDeclarations.length}</span>}
        </button>
        {canEdit && (
          <button
            type="button"
            className={styles.iconBtn}
            title={t("browser.styles.add")}
            aria-label={t("browser.styles.add")}
            onClick={() => setOpen(true)}
          >
            <Plus size={14} weight="regular" />
          </button>
        )}
        {hasCurrent && (
          <button
            type="button"
            className={styles.iconBtn}
            title={t("browser.styles.clearCurrent")}
            aria-label={t("browser.styles.clearCurrent")}
            disabled={!canEdit}
            onClick={edit.clearCurrent}
          >
            <Eraser size={14} weight="regular" />
          </button>
        )}
      </header>
      {open && (
        <div className={styles.cssDraftBody}>
          {edit.error && <p className={styles.adjustError}>{edit.error}</p>}
          {hasCurrent && (
            <ul className={styles.adjustList}>
              {currentDeclarations.map((decl) => (
                <li key={decl.name}>
                  <PropertyRow
                    decl={decl}
                    compact={compact}
                    disabled={!canEdit}
                    onToggleEnabled={edit.toggleEnabled}
                    onToggleImportant={edit.toggleImportant}
                    onValueChange={edit.setValue}
                    onValueLive={edit.setValue}
                    onRemove={edit.removeDeclaration}
                  />
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <AddPropertyForm
              compact={compact}
              existingNames={currentDeclarations.map((decl) => decl.name)}
              onAdd={edit.upsertDeclaration}
            />
          )}
          <CssReferencePanel compact={compact} />
        </div>
      )}
    </section>
  );
}
