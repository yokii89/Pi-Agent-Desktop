import {
  CaretDown,
  ChatCircle,
  File,
  Lightning,
  ListBullets,
  MagnifyingGlass,
  Trash,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useT } from "../../hooks/useT";
import { useUiStore } from "../../stores/uiStore";
import { Modal } from "../ui/Modal";
import styles from "./CommandPalette.module.css";
import { PaletteRow } from "./PaletteRow";
import type { PaletteScope } from "./types";
import { scopeToPrefix, usePaletteResults } from "./usePaletteResults";

const SCOPE_TABS: { scope: PaletteScope; labelKey: string; icon: typeof ListBullets }[] = [
  { scope: "all", labelKey: "palette.scope.all", icon: ListBullets },
  { scope: "commands", labelKey: "palette.scope.commands", icon: Lightning },
  { scope: "sessions", labelKey: "palette.scope.sessions", icon: ChatCircle },
  { scope: "files", labelKey: "palette.scope.files", icon: File },
];

/** 历史 chips 收起时可见条数（ZCode 同款，超出经展开按钮查看）。 */
const HISTORY_PREVIEW_LIMIT = 6;

/**
 * 命令面板（docs/design 30 §2.2）：Ctrl+Shift+P 弹出，边打字边出「命令 / 会话 / 文件」
 * 分区结果，↑↓ 导航、Enter 直达、Esc 关闭；空查询展示最近改动 / 最近会话 / 搜索历史。
 * UI 参考 ZCode CommandCenterDialog，改用本仓 tokens.css + CSS Modules + Phosphor，零新依赖。
 */
export function CommandPalette() {
  const t = useT();
  const { commandPaletteOpen } = useUiStore();
  const results = usePaletteResults(commandPaletteOpen);
  const inputRef = useRef<HTMLInputElement>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const {
    rawQuery,
    setRawQuery,
    scope,
    query,
    selectScope,
    sections,
    flatItems,
    activeIndex,
    moveActive,
    setActiveIndex,
    runItem,
    runActive,
    filesLoading,
    filesError,
    historyEntries,
    clearHistory,
    expandedSections,
    expandSection,
    close,
  } = results;

  useEffect(() => {
    if (!commandPaletteOpen) return;
    inputRef.current?.focus();
    setHistoryExpanded(false);
  }, [commandPaletteOpen]);

  if (!commandPaletteOpen) return null;

  const hasQuery = query.trim().length > 0;
  const hasResults = flatItems.length > 0;
  const showFilesError = filesError && hasQuery && (scope === "all" || scope === "files");
  const showEmpty = hasQuery && !hasResults && !filesLoading && !showFilesError;
  const showHistory = !hasQuery && historyEntries.length > 0;

  let runningIndex = -1;

  return (
    <Modal
      open={commandPaletteOpen}
      onClose={close}
      ariaLabel={t("palette.title")}
      panelClassName={styles.palette}
    >
      <div className={styles.searchBar}>
        <MagnifyingGlass size={16} weight="regular" className={styles.searchIcon} />
        <input
          ref={inputRef}
          className={styles.input}
          value={rawQuery}
          placeholder={t("palette.placeholder")}
          role="combobox"
          aria-expanded={hasResults}
          aria-controls="palette-listbox"
          aria-autocomplete="list"
          onChange={(event) => setRawQuery(event.target.value)}
          onKeyDown={(event) => {
            // 输入法组合期：Enter/↑↓/Esc 属于候选操作，不驱动面板导航
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              moveActive(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              moveActive(-1);
            } else if (event.key === "Enter") {
              event.preventDefault();
              runActive();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
        />
      </div>

      <div className={styles.scopeTabs} role="tablist" aria-label={t("palette.scope.tabs")}>
        {SCOPE_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = scope === tab.scope;
          return (
            <button
              key={tab.scope}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={-1}
              className={[styles.scopeTab, active ? styles.scopeTabActive : ""].join(" ")}
              onClick={() => {
                selectScope(tab.scope);
                inputRef.current?.focus();
              }}
            >
              <Icon size={12} weight="regular" />
              {t(tab.labelKey)}
            </button>
          );
        })}
      </div>

      <div
        id="palette-listbox"
        className={styles.list}
        role="listbox"
        aria-label={t("palette.title")}
        aria-activedescendant={hasResults ? `palette-opt-${activeIndex}` : undefined}
        tabIndex={-1}
      >
        {!hasResults && !showEmpty && !filesLoading && !showFilesError && (
          <p className={styles.placeholderHint}>{t("palette.placeholder.all")}</p>
        )}
        {filesLoading && !hasResults && (
          <p className={styles.placeholderHint}>{t("palette.filesLoading")}</p>
        )}
        {showFilesError && <p className={styles.errorHint}>{t("palette.filesError")}</p>}
        {showEmpty && <p className={styles.placeholderHint}>{t("palette.noResults")}</p>}

        {sections.map((section) => {
          if (section.items.length === 0) return null;
          const offset = runningIndex + 1;
          return (
            <div key={section.id} className={styles.section}>
              <div className={styles.sectionHeader}>{t(section.titleKey)}</div>
              {section.items.map((item, i) => {
                runningIndex += 1;
                const globalIndex = offset + i;
                return (
                  <PaletteRow
                    key={item.id}
                    item={item}
                    index={globalIndex}
                    active={globalIndex === activeIndex}
                    optionId={`palette-opt-${globalIndex}`}
                    onHover={setActiveIndex}
                    onSelect={runItem}
                  />
                );
              })}
              {section.totalMatches > section.items.length && !expandedSections.has(section.id) && (
                <button
                  type="button"
                  className={styles.moreRow}
                  onClick={() => {
                    expandSection(section.id);
                    inputRef.current?.focus();
                  }}
                >
                  {t("palette.showMore", { count: section.totalMatches - section.items.length })}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {showHistory && (
        <div className={styles.history}>
          <div className={styles.historyHeader}>
            <span>{t("palette.history")}</span>
            <button
              type="button"
              className={styles.historyClear}
              aria-label={t("palette.clearHistory")}
              onClick={clearHistory}
            >
              <Trash size={12} weight="regular" />
            </button>
          </div>
          <div
            className={[
              styles.historyChips,
              historyExpanded ? "" : styles.historyChipsCollapsed,
            ].join(" ")}
          >
            {(historyExpanded
              ? historyEntries
              : historyEntries.slice(0, HISTORY_PREVIEW_LIMIT)
            ).map((entry) => {
              const prefix = scopeToPrefix(entry.scope);
              return (
                <button
                  key={`${entry.scope}:${entry.query}`}
                  type="button"
                  className={styles.historyChip}
                  title={entry.query}
                  onClick={() => {
                    setRawQuery(prefix ? `${prefix}${entry.query}` : entry.query);
                    inputRef.current?.focus();
                  }}
                >
                  {prefix && <span className={styles.historyChipPrefix}>{prefix}</span>}
                  <span className={styles.historyChipText}>{entry.query}</span>
                </button>
              );
            })}
            {historyEntries.length > HISTORY_PREVIEW_LIMIT && (
              <button
                type="button"
                className={styles.historyToggle}
                aria-label={
                  historyExpanded ? t("palette.collapseHistory") : t("palette.expandHistory")
                }
                aria-expanded={historyExpanded}
                onClick={() => setHistoryExpanded((value) => !value)}
              >
                <CaretDown
                  size={12}
                  weight="regular"
                  className={historyExpanded ? styles.historyToggleOpen : ""}
                />
              </button>
            )}
          </div>
        </div>
      )}

      <div className={styles.footer}>
        <span className={styles.footerHint}>
          <kbd className={styles.kbd}>↑</kbd>
          <kbd className={styles.kbd}>↓</kbd>
          {t("palette.hint.navigate")}
        </span>
        <span className={styles.footerHint}>
          <kbd className={styles.kbd}>↵</kbd>
          {t("palette.hint.open")}
        </span>
        <span className={styles.footerHint}>
          <kbd className={styles.kbd}>Esc</kbd>
          {t("palette.hint.close")}
        </span>
      </div>
    </Modal>
  );
}
