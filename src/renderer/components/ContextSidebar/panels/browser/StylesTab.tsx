import { CaretDown, CaretRight, MagnifyingGlass, Plus, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { InspectorStyleRule } from "../../../../../shared/ipc";
import { useT } from "../../../../hooks/useT";
import { useBrowserStore } from "../../../../stores/browserStore";
import { useInspectorStore } from "../../../../stores/inspectorStore";
import { useStyleEditStore } from "../../../../stores/styleEditStore";
import styles from "./BrowserInspector.module.css";
import { AdjustPanel } from "./styleEdit/AdjustPanel";
import { DesignPanel } from "./styleEdit/designPanel/DesignPanel";
import { adjustedNameSet, isComputedAdjusted } from "./styleEdit/propertyCatalog";
import editStyles from "./styleEdit/styleEdit.module.css";
import { TargetBar } from "./styleEdit/TargetBar";

/**
 * 「样式」tab（docs/design/06 / 22 + 设计面板封装）：
 * 顶部「设计 | CSS」切换——设计 = Figma 式分组控件（拾取后自动填入，手调热更）；
 * CSS = 临时调整属性列表 + computed / matched。
 * **不做层叠胜出判定**——matched 顺序不代表优先级。
 */

type StylesMode = "design" | "css";

const ORIGIN_LABEL_KEY: Record<InspectorStyleRule["origin"], string> = {
  "user-agent": "browser.styles.origin.ua",
  user: "browser.styles.origin.author",
  inspected: "browser.styles.origin.inspected",
};

export function StylesTab({ compact }: { compact: boolean }) {
  const t = useT();
  const { styles: data, loading, stale, nodeId, refresh } = useInspectorStore();
  const edit = useStyleEditStore();
  const browser = useBrowserStore();
  const [mode, setMode] = useState<StylesMode>("design");
  const [computedOpen, setComputedOpen] = useState(true);
  const [matchedOpen, setMatchedOpen] = useState(edit.totalEnabled === 0);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [computedFilter, setComputedFilter] = useState("");

  const setFocusNode = edit.setFocusNode;
  useEffect(() => {
    setFocusNode(nodeId);
  }, [setFocusNode, nodeId]);

  const subscribeApplied = edit.subscribeApplied;
  useEffect(() => subscribeApplied(() => refresh()), [subscribeApplied, refresh]);

  const adjusted = adjustedNameSet(
    edit.currentDeclarations.filter((decl) => decl.enabled).map((decl) => decl.name),
  );
  const existingNames = new Set(
    edit.currentDeclarations.map((decl) => {
      const name = decl.name.trim();
      return name.startsWith("--") ? name : name.toLowerCase();
    }),
  );

  const matchedTouchedRef = useRef(false);
  const prevEnabledRef = useRef(edit.totalEnabled);
  useEffect(() => {
    if (matchedTouchedRef.current) return;
    if (prevEnabledRef.current === 0 && edit.totalEnabled > 0) {
      setMatchedOpen(false);
    }
    prevEnabledRef.current = edit.totalEnabled;
  }, [edit.totalEnabled]);

  const filterKey = computedFilter.trim().toLowerCase();
  const computedVisible = useMemo(() => {
    const list = data?.computed ?? [];
    if (!filterKey) return list;
    return list.filter(
      (property) =>
        property.name.toLowerCase().includes(filterKey) ||
        property.value.toLowerCase().includes(filterKey),
    );
  }, [data?.computed, filterKey]);

  const cssBody = (() => {
    if (loading && !data)
      return <p className={editStyles.emptyNote}>{t("browser.styles.loading")}</p>;
    if (!data) {
      return (
        <p className={editStyles.emptyNote}>
          {stale ? t("browser.styles.stale") : t("browser.styles.noSelectionHint")}
        </p>
      );
    }
    return (
      <>
        <p className={editStyles.hintNote}>{t("browser.styles.computedHint")}</p>

        <div className={editStyles.readonlySection}>
          <button
            type="button"
            className={editStyles.sectionHead}
            aria-expanded={computedOpen}
            onClick={() => setComputedOpen((prev) => !prev)}
          >
            {computedOpen ? <CaretDown size={12} /> : <CaretRight size={12} />}
            <span className={editStyles.sectionTitle}>computed</span>
            <span className={editStyles.sectionMeta}>
              {filterKey
                ? t("browser.styles.computedFiltered", {
                    shown: computedVisible.length,
                    total: data.computed.length,
                  })
                : t("browser.styles.computedMeta", { count: data.computed.length })}
            </span>
          </button>
          {computedOpen && (
            <>
              <div className={editStyles.computedFilterRow}>
                <MagnifyingGlass
                  size={12}
                  weight="regular"
                  className={editStyles.computedFilterIcon}
                />
                <input
                  type="search"
                  className={editStyles.computedFilter}
                  value={computedFilter}
                  placeholder={t("browser.styles.computedFilterPlaceholder")}
                  aria-label={t("browser.styles.computedFilterPlaceholder")}
                  onChange={(event) => setComputedFilter(event.target.value)}
                />
                {computedFilter && (
                  <button
                    type="button"
                    className={editStyles.computedFilterClear}
                    title={t("browser.styles.computedFilterClear")}
                    onClick={() => setComputedFilter("")}
                  >
                    <X size={12} weight="regular" />
                  </button>
                )}
              </div>
              {computedVisible.length === 0 ? (
                <p className={editStyles.emptyNote}>{t("browser.styles.computedFilterEmpty")}</p>
              ) : (
                <ul className={editStyles.readonlyList}>
                  {computedVisible.map((property) => {
                    const hot = isComputedAdjusted(property.name, adjusted);
                    const promoteKey = property.name.startsWith("--")
                      ? property.name
                      : property.name.toLowerCase();
                    const taken = existingNames.has(promoteKey);
                    return (
                      <li
                        key={property.name}
                        className={[
                          editStyles.readonlyRow,
                          hot ? editStyles.readonlyRowAdjusted : "",
                        ].join(" ")}
                      >
                        <span className={editStyles.readonlyName}>{property.name}:</span>
                        <span className={editStyles.readonlyValue}>{property.value}</span>
                        <button
                          type="button"
                          className={editStyles.promoteBtn}
                          title={
                            taken
                              ? t("browser.styles.alreadyAdjusted")
                              : t("browser.styles.promote")
                          }
                          disabled={taken || edit.currentNodeId === null || Boolean(stale)}
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

        {compact ? (
          <p className={editStyles.hintNote}>{t("browser.styles.narrowMatched")}</p>
        ) : (
          <div className={editStyles.readonlySection}>
            <button
              type="button"
              className={editStyles.sectionHead}
              aria-expanded={matchedOpen}
              onClick={() => {
                matchedTouchedRef.current = true;
                setMatchedOpen((prev) => !prev);
              }}
            >
              {matchedOpen ? <CaretDown size={12} /> : <CaretRight size={12} />}
              <span className={editStyles.sectionTitle}>matched</span>
              <span className={editStyles.sectionMeta}>
                {t("browser.styles.matchedMeta", { count: data.matched.length })}
              </span>
            </button>
            {matchedOpen &&
              (data.matched.length === 0 ? (
                <p className={editStyles.emptyNote}>{t("browser.styles.matchedEmpty")}</p>
              ) : (
                data.matched.map((rule, index) => {
                  const key = `${index}:${rule.selector}:${rule.inheritedFrom ?? ""}`;
                  const open = overrides[key] ?? index < 2;
                  return (
                    <div key={key} className={styles.group}>
                      <button
                        type="button"
                        className={styles.groupHead}
                        aria-expanded={open}
                        onClick={() => setOverrides((prev) => ({ ...prev, [key]: !open }))}
                      >
                        {open ? <CaretDown size={12} /> : <CaretRight size={12} />}
                        <span className={styles.groupSelector} title={rule.selector}>
                          {rule.selector}
                        </span>
                        {rule.inheritedFrom && (
                          <span className={styles.inheritedTag}>
                            {t("browser.styles.inheritedFrom", { from: rule.inheritedFrom })}
                          </span>
                        )}
                        <span className={styles.originTag}>{t(ORIGIN_LABEL_KEY[rule.origin])}</span>
                      </button>
                      {open && (
                        <ul className={editStyles.readonlyList}>
                          {rule.properties.map((property) => (
                            <li key={property.name} className={editStyles.readonlyRow}>
                              <span
                                className={[
                                  editStyles.readonlyName,
                                  property.important ? styles.propertyImportant : "",
                                ].join(" ")}
                              >
                                {property.name}:
                              </span>
                              <span className={editStyles.readonlyValue}>
                                {property.value}
                                {property.important ? " !important" : ""}
                              </span>
                              {property.source && (
                                <span className={styles.groupMeta}>
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
  })();

  const targetLabel = data?.label || edit.currentSelector || browser.lastPicked?.label || "";
  const onCopyCss = async (): Promise<void> => {
    let host = t("browser.styles.localPage");
    try {
      host = new URL(browser.url || "http://localhost").host || host;
    } catch {
      host = browser.url || host;
    }
    const css = await edit.exportCss(host);
    if (css) browser.copyText(css, t("browser.styles.copyCssLabel"));
  };

  return (
    <div>
      <TargetBar
        label={targetLabel}
        selector={
          edit.currentSelector ||
          (browser.lastPicked?.kind === "element" ? browser.lastPicked.selector : "") ||
          ""
        }
        totalEnabled={edit.totalEnabled}
        navCleared={edit.navCleared}
        applying={edit.applying}
        onCopyCss={() => void onCopyCss()}
        onClearAll={edit.clearAll}
        onDismissNav={edit.dismissNavCleared}
      />

      <div
        className={editStyles.modeSwitch}
        role="tablist"
        aria-label={t("browser.design.modeLabel")}
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "design"}
          className={[editStyles.modeTab, mode === "design" ? editStyles.modeTabOn : ""].join(" ")}
          onClick={() => setMode("design")}
        >
          {t("browser.design.mode.design")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "css"}
          className={[editStyles.modeTab, mode === "css" ? editStyles.modeTabOn : ""].join(" ")}
          onClick={() => setMode("css")}
        >
          {t("browser.design.mode.css")}
        </button>
      </div>

      {mode === "design" ? (
        <DesignPanel disabled={Boolean(stale) || edit.currentNodeId === null} />
      ) : (
        <>
          <AdjustPanel compact={compact} />
          {cssBody}
        </>
      )}
    </div>
  );
}
