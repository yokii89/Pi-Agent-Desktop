import { CaretDown, CaretRight, MagnifyingGlass, Plus, X } from "@phosphor-icons/react";
import { useState } from "react";
import type { InspectorStyleRule } from "../../../../../../shared/ipc";
import { useT } from "../../../../../hooks/useT";
import { useInspectorStore } from "../../../../../stores/inspectorStore";
import { useStyleEditStore } from "../../../../../stores/styleEditStore";
import inspectorStyles from "../BrowserInspector.module.css";
import { adjustedNameSet, isComputedAdjusted } from "./propertyCatalog";
import styles from "./styleEdit.module.css";

const ORIGIN_LABEL_KEY: Record<InspectorStyleRule["origin"], string> = {
  "user-agent": "browser.styles.origin.ua",
  user: "browser.styles.origin.author",
  inspected: "browser.styles.origin.inspected",
};

function nameKey(name: string): string {
  const trimmed = name.trim();
  return trimmed.startsWith("--") ? trimmed : trimmed.toLowerCase();
}

export function CssReferencePanel({ compact }: { compact: boolean }) {
  const t = useT();
  const inspector = useInspectorStore();
  const edit = useStyleEditStore();
  const [computedOpen, setComputedOpen] = useState(false);
  const [matchedOpen, setMatchedOpen] = useState(false);
  const [computedFilter, setComputedFilter] = useState("");
  const [ruleOpen, setRuleOpen] = useState<Record<string, boolean>>({});
  const data = inspector.styles;
  if (!data || data.nodeId !== inspector.nodeId) return null;

  const currentDeclarations =
    edit.currentNodeId === inspector.nodeId ? edit.currentDeclarations : [];
  const adjusted = adjustedNameSet(
    currentDeclarations.filter((decl) => decl.enabled).map((decl) => decl.name),
  );
  const existingNames = new Set(currentDeclarations.map((decl) => nameKey(decl.name)));
  const filterKey = computedFilter.trim().toLowerCase();
  const visibleComputed = data.computed.filter(
    (property) =>
      !filterKey ||
      property.name.toLowerCase().includes(filterKey) ||
      property.value.toLowerCase().includes(filterKey),
  );

  return (
    <>
      <div className={styles.readonlySection}>
        <button
          type="button"
          className={styles.sectionHead}
          aria-expanded={computedOpen}
          onClick={() => setComputedOpen((value) => !value)}
        >
          {computedOpen ? <CaretDown size={12} /> : <CaretRight size={12} />}
          <span className={styles.sectionTitle}>computed</span>
          <span className={styles.sectionMeta}>
            {filterKey
              ? t("browser.styles.computedFiltered", {
                  shown: visibleComputed.length,
                  total: data.computed.length,
                })
              : t("browser.styles.computedMeta", { count: data.computed.length })}
          </span>
        </button>
        {computedOpen && (
          <>
            <div className={styles.computedFilterRow}>
              <MagnifyingGlass size={12} weight="regular" className={styles.computedFilterIcon} />
              <input
                type="search"
                className={styles.computedFilter}
                value={computedFilter}
                placeholder={t("browser.styles.computedFilterPlaceholder")}
                aria-label={t("browser.styles.computedFilterPlaceholder")}
                onChange={(event) => setComputedFilter(event.target.value)}
              />
              {computedFilter && (
                <button
                  type="button"
                  className={styles.computedFilterClear}
                  title={t("browser.styles.computedFilterClear")}
                  aria-label={t("browser.styles.computedFilterClear")}
                  onClick={() => setComputedFilter("")}
                >
                  <X size={12} weight="regular" />
                </button>
              )}
            </div>
            {visibleComputed.length === 0 ? (
              <p className={styles.emptyNote}>{t("browser.styles.computedFilterEmpty")}</p>
            ) : (
              <ul className={styles.readonlyList}>
                {visibleComputed.map((property) => {
                  const highlighted = isComputedAdjusted(property.name, adjusted);
                  const taken = existingNames.has(nameKey(property.name));
                  return (
                    <li
                      key={property.name}
                      className={[
                        styles.readonlyRow,
                        highlighted ? styles.readonlyRowAdjusted : "",
                      ].join(" ")}
                    >
                      <span className={styles.readonlyName} data-selectable-text>
                        {property.name}:
                      </span>
                      <span className={styles.readonlyValue} data-selectable-text>
                        {property.value}
                      </span>
                      <button
                        type="button"
                        className={styles.promoteBtn}
                        title={
                          taken ? t("browser.styles.alreadyAdjusted") : t("browser.styles.promote")
                        }
                        aria-label={
                          taken ? t("browser.styles.alreadyAdjusted") : t("browser.styles.promote")
                        }
                        disabled={
                          taken ||
                          inspector.nodeId === null ||
                          edit.currentNodeId !== inspector.nodeId ||
                          inspector.stale !== null ||
                          edit.applying
                        }
                        onClick={() => edit.upsertDeclaration(property.name, property.value)}
                      >
                        <Plus size={12} weight="regular" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
      {!compact && (
        <div className={styles.readonlySection}>
          <button
            type="button"
            className={styles.sectionHead}
            aria-expanded={matchedOpen}
            onClick={() => setMatchedOpen((value) => !value)}
          >
            {matchedOpen ? <CaretDown size={12} /> : <CaretRight size={12} />}
            <span className={styles.sectionTitle}>matched</span>
            <span className={styles.sectionMeta}>
              {t("browser.styles.matchedMeta", { count: data.matched.length })}
            </span>
          </button>
          {matchedOpen &&
            (data.matched.length === 0 ? (
              <p className={styles.emptyNote}>{t("browser.styles.matchedEmpty")}</p>
            ) : (
              data.matched.map((rule, index) => {
                const key = `${String(index)}:${rule.selector}:${rule.inheritedFrom ?? ""}`;
                const expanded = ruleOpen[key] ?? index < 2;
                return (
                  <div key={key} className={inspectorStyles.group}>
                    <button
                      type="button"
                      className={inspectorStyles.groupHead}
                      aria-expanded={expanded}
                      onClick={() => setRuleOpen((current) => ({ ...current, [key]: !expanded }))}
                    >
                      {expanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
                      <span
                        className={inspectorStyles.groupSelector}
                        title={rule.selector}
                        data-selectable-text
                      >
                        {rule.selector}
                      </span>
                      {rule.inheritedFrom && (
                        <span className={inspectorStyles.inheritedTag}>
                          {t("browser.styles.inheritedFrom", { from: rule.inheritedFrom })}
                        </span>
                      )}
                      <span className={inspectorStyles.originTag}>
                        {t(ORIGIN_LABEL_KEY[rule.origin])}
                      </span>
                    </button>
                    {expanded && (
                      <ul className={styles.readonlyList}>
                        {rule.properties.map((property) => (
                          <li key={property.name} className={styles.readonlyRow}>
                            <span
                              className={[
                                styles.readonlyName,
                                property.important ? inspectorStyles.propertyImportant : "",
                              ].join(" ")}
                              data-selectable-text
                            >
                              {property.name}:
                            </span>
                            <span className={styles.readonlyValue} data-selectable-text>
                              {property.value}
                              {property.important ? " !important" : ""}
                            </span>
                            {property.source && (
                              <span className={styles.sectionMeta}>
                                {property.source}
                                {property.line !== null ? `:${property.line}` : ""}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })
            ))}
        </div>
      )}
    </>
  );
}
