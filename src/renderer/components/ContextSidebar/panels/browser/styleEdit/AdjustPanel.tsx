import { Eraser } from "@phosphor-icons/react";
import { useT } from "../../../../../hooks/useT";
import { useInspectorStore } from "../../../../../stores/inspectorStore";
import { useStyleEditStore } from "../../../../../stores/styleEditStore";
import { AddPropertyForm } from "./AddPropertyForm";
import { PropertyRow } from "./PropertyRow";
import styles from "./styleEdit.module.css";

/**
 * 「临时调整」属性列表（CSS 模式主编辑面）。
 * 目标栏由 StylesTab 统一挂在模式切换之上；这里只负责声明行 + 添加属性。
 */

export function AdjustPanel({ compact }: { compact: boolean }) {
  const t = useT();
  const edit = useStyleEditStore();
  const inspector = useInspectorStore();
  const hasCurrent = edit.currentDeclarations.length > 0;
  const canEdit = inspector.nodeId !== null && !inspector.stale;

  return (
    <div>
      <section
        className={[
          styles.adjustCard,
          edit.totalEnabled > 0 ? styles.adjustCardLive : "",
          edit.navCleared ? styles.adjustCardMuted : "",
        ].join(" ")}
        aria-label={t("browser.styles.adjust")}
      >
        <header className={styles.adjustHead}>
          <span className={styles.adjustTitle}>{t("browser.styles.adjust")}</span>
          <span className={styles.adjustMeta}>
            {hasCurrent
              ? t("browser.styles.currentCount", { count: edit.currentDeclarations.length })
              : canEdit
                ? t("browser.styles.editHere")
                : t("browser.styles.pickFirst")}
            {edit.otherNodeCount > 0
              ? ` · ${t("browser.styles.otherNodes", { count: edit.otherNodeCount })}`
              : ""}
          </span>
          {hasCurrent && (
            <div className={styles.adjustHeadActions}>
              <button
                type="button"
                className={styles.iconBtn}
                title={t("browser.styles.clearCurrent")}
                onClick={edit.clearCurrent}
              >
                <Eraser size={13} weight="regular" />
              </button>
            </div>
          )}
        </header>

        <p className={styles.adjustNote}>{t("browser.styles.adjustNote")}</p>

        {edit.error && <p className={styles.adjustError}>{edit.error}</p>}

        {hasCurrent && (
          <ul className={styles.adjustList}>
            {edit.currentDeclarations.map((decl) => (
              <li key={decl.name}>
                <PropertyRow
                  decl={decl}
                  compact={compact}
                  onToggleEnabled={edit.toggleEnabled}
                  onToggleImportant={edit.toggleImportant}
                  onValueChange={(name, value) => edit.setValue(name, value, true)}
                  onValueLive={(name, value) => edit.setValue(name, value, true)}
                  onRemove={edit.removeDeclaration}
                />
              </li>
            ))}
          </ul>
        )}

        {canEdit && (
          <AddPropertyForm
            compact={compact}
            existingNames={edit.currentDeclarations.map((decl) => decl.name)}
            onAdd={edit.upsertDeclaration}
          />
        )}

        {!canEdit && !hasCurrent && (
          <p className={styles.emptyNote}>{t("browser.styles.emptyAdjust")}</p>
        )}
      </section>
    </div>
  );
}
