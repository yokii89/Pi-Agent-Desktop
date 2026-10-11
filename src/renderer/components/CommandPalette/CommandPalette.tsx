import {
  CaretDown,
  ChatCircle,
  File,
  Lightning,
  ListBullets,
  MagnifyingGlass,
  Trash,
} from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useGlidePill } from "../../hooks/useGlidePill";
import { useT } from "../../hooks/useT";
import { useUiStore } from "../../stores/uiStore";
import glideStyles from "../ui/GlideList.module.css";
import { Modal } from "../ui/Modal";
import { Segmented } from "../ui/Segmented";
import styles from "./CommandPalette.module.css";
import { PaletteRow } from "./PaletteRow";
import type { PaletteItem, PaletteScope } from "./types";
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

  // 高亮药丸（docs/design/51 同一套定帧时间轴 + easeOut 贝塞尔）：↑↓ 与悬停时在选项之间
  // 滑行，按住拖动（擦选）松手直接激活落点行。指向行只有一个写入方：悬停经 onActiveChange
  // 回写 activeIndex，下面的 effect 只在 activeIndex 真被键盘改动时才 highlight——
  // 两边各写一次会互相取消补间（doc 51 §七 频闪教训）。
  const listRef = useRef<HTMLDivElement>(null);
  const pillIndex = useRef(-1);
  const pill = useGlidePill(listRef, {
    onPick: (index) => {
      const item = flatItems[index];
      if (item) runItem(item);
    },
    onActiveChange: (index) => {
      if (index === null || index === pillIndex.current) return;
      pillIndex.current = index;
      setActiveIndex(index);
    },
  });

  // 打开与结果换血（打字 / 切作用域 / 展开更多 / 结果清单更新）后药丸**瞬移**落位：
  // 旧几何位置在新列表里已是别的条目，滑过去会被读成「选错了行」。
  // 换查询/作用域回首项；其余换血把当前选中项原地落位（展开「显示更多」时该行的
  // offsetTop 会移动）。复位在 usePaletteResults 里与输入同 commit 生效，这里读到的一定是新值。
  const pillEpochRef = useRef<PaletteItem[] | null>(null);
  const pillNavKeyRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const navKey = `${rawQuery}\u0000${scope}`;
    const navChanged = pillNavKeyRef.current !== null && pillNavKeyRef.current !== navKey;
    pillNavKeyRef.current = navKey;
    const epoch = commandPaletteOpen ? flatItems : null;
    const prevEpoch = pillEpochRef.current;
    pillEpochRef.current = epoch;
    if (epoch === null || epoch === prevEpoch || flatItems.length === 0) return;
    const target =
      prevEpoch === null || navChanged ? 0 : Math.min(activeIndex, flatItems.length - 1);
    pillIndex.current = target;
    pill.jumpTo(target);
  }, [commandPaletteOpen, flatItems, rawQuery, scope, activeIndex, pill]);

  // 键盘导航（↑↓）：药丸在选项之间滑行（GLIDE_MOTION.glide + easeOut，定帧时间轴封顶 60fps）。
  // 越过列表长度的索引等 hook 夹紧后再说，别把药丸指去不存在的行。
  useEffect(() => {
    if (!commandPaletteOpen || activeIndex >= flatItems.length) return;
    if (activeIndex === pillIndex.current) return;
    pillIndex.current = activeIndex;
    pill.highlight(activeIndex);
  }, [commandPaletteOpen, flatItems, activeIndex, pill]);

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

      <div className={styles.scopeTabs}>
        <Segmented
          className={styles.scopeSeg}
          semantics="tab"
          focusMode="none"
          scrollable
          equal={false}
          size="sm"
          ariaLabel={t("palette.scope.tabs")}
          value={scope}
          items={SCOPE_TABS.map((tab) => {
            const Icon = tab.icon;
            return {
              value: tab.scope,
              label: t(tab.labelKey),
              icon: <Icon size={12} weight="regular" />,
            };
          })}
          onChange={(next) => {
            selectScope(next);
            inputRef.current?.focus();
          }}
        />
      </div>

      <div
        ref={listRef}
        id="palette-listbox"
        className={styles.list}
        role="listbox"
        aria-label={t("palette.title")}
        aria-activedescendant={hasResults ? `palette-opt-${activeIndex}` : undefined}
        tabIndex={-1}
        {...pill.listProps}
      >
        <span ref={pill.pillRef} className={glideStyles.pill} aria-hidden="true" />
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
                    onSelect={(picked, detail) => {
                      // 擦选松手已由药丸代为实现，同一次点击在这里跳过
                      if (pill.consumeClick(detail)) return;
                      runItem(picked);
                    }}
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
