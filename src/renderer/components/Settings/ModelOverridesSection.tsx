import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TranslateFn } from "../../../shared/i18n";
import type { PiModelOverridePatch } from "../../../shared/ipc";
import { useGlidePill } from "../../hooks/useGlidePill";
import { useT } from "../../hooks/useT";
import type { ModelOverrideRow } from "../../utils/modelOverrides";
import {
  filterModelOverrideRows,
  formatModelMaxTokens,
  formatModelWindow,
  isReviewRow,
  MAX_OUTPUT_PRESETS,
  type OverrideFilterMode,
  WINDOW_PRESETS,
} from "../../utils/modelOverrides";
import { AiModelIcon } from "../AiIcons/AiModelIcon";
import { GlideChevron } from "../ui/GlideChevron";
import glideStyles from "../ui/GlideList.module.css";
import { Popover } from "../ui/Popover";
import { Segmented } from "../ui/Segmented";
import styles from "./Settings.module.css";

/** 覆盖列表默认展示行数（其余折叠）。 */
const COLLAPSED_ROWS = 10;

interface ModelOverridesSectionProps {
  /** 未经过滤的全部行（排序已在 utils 内完成）。 */
  rows: ModelOverrideRow[];
  loading: boolean;
  savingKey: string | null;
  onSave: (row: ModelOverrideRow, patch: PiModelOverridePatch) => Promise<void>;
}

/**
 * 设置 →「模型能力」（docs/design/50）：四列表格 + 值即控件。
 *
 * 行上不放常驻下拉：常态只有「模型 / 窗口 / 输出上限 / 多模态」四个值，点值才弹 popover 改。
 * 来源靠字段自身着色（蓝 = 已修改，灰 = 沿用默认），而不是行级的一列文字——
 * 同一行可能窗口是用户设的、多模态仍是目录猜的。
 */
export const ModelOverridesSection = memo(function ModelOverridesSection({
  rows,
  loading,
  savingKey,
  onSave,
}: ModelOverridesSectionProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<OverrideFilterMode>("all");
  const [expanded, setExpanded] = useState(false);

  const counts = useMemo(
    () => ({
      all: rows.length,
      modified: rows.filter((row) => row.hasOverride).length,
      review: rows.filter(isReviewRow).length,
    }),
    [rows],
  );

  const visible = useMemo(() => filterModelOverrideRows(rows, query, mode), [rows, query, mode]);
  const shown = expanded ? visible : visible.slice(0, COLLAPSED_ROWS);

  const modes: { key: OverrideFilterMode; label: string }[] = [
    { key: "all", label: t("settings.models.overrides.filterAll") },
    { key: "modified", label: t("settings.models.overrides.filterModified") },
    { key: "review", label: t("settings.models.overrides.filterReview") },
  ];

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{t("settings.models.overrides.title")}</h2>
      <p className={styles.ovHint}>{t("settings.models.overrides.sectionHint")}</p>

      <div className={styles.ovToolbar}>
        <Segmented
          ariaLabel={t("settings.models.overrides.filterLabel")}
          className={styles.ovSegStrip}
          size="sm"
          value={mode}
          items={modes.map((item) => ({
            value: item.key,
            label: (
              <>
                {item.label}
                <span className={styles.ovSegNum}>{counts[item.key]}</span>
              </>
            ),
          }))}
          onChange={(next) => {
            setMode(next);
            setExpanded(false);
          }}
        />
        <input
          className={[styles.authInput, styles.ovSearch].join(" ")}
          type="text"
          placeholder={t("settings.models.overrides.searchPlaceholder")}
          value={query}
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            setExpanded(false);
          }}
        />
      </div>

      {rows.length > 0 ? (
        <div className={styles.ovTbl}>
          <div className={[styles.ovRow, styles.ovRowHead].join(" ")}>
            <span>{t("settings.models.overrides.modelField")}</span>
            <span>{t("settings.models.overrides.windowField")}</span>
            <span>{t("settings.models.overrides.maxTokensField")}</span>
            <span>{t("settings.models.overrides.inputField")}</span>
          </div>
          {shown.map((row) => (
            <OverrideRow
              key={`${row.provider}/${row.modelId}`}
              row={row}
              saving={savingKey === `${row.provider}/${row.modelId}`}
              onSave={onSave}
              t={t}
            />
          ))}
          {shown.length === 0 && (
            <p className={styles.ovEmpty}>{t("settings.models.overrides.noMatch")}</p>
          )}
        </div>
      ) : (
        <p className={styles.ovEmpty}>
          {loading ? t("settings.models.loading") : t("settings.models.overrides.empty")}
        </p>
      )}

      {visible.length > COLLAPSED_ROWS && (
        <button
          type="button"
          className={styles.ovMore}
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded
            ? t("settings.models.overrides.collapse")
            : t("settings.models.overrides.showAll", { count: visible.length })}
        </button>
      )}
    </section>
  );
});

/**
 * 单行：模型名 + 三个「值即控件」单元格（+ 已修改时的行尾恢复按钮）。
 *
 * memo 是必需的：保存一条覆盖会把 savingKey 置上再清掉，父级因此提交两次；
 * 展开后 112 行 × 3 个 Popover 全量重渲染约 50ms/次（实测，doc 70 调优）。
 */
const OverrideRow = memo(function OverrideRow({
  row,
  saving,
  onSave,
  t,
}: {
  row: ModelOverrideRow;
  saving: boolean;
  onSave: ModelOverridesSectionProps["onSave"];
  t: TranslateFn;
}) {
  const windowOverridden = row.overrideWindow !== undefined;
  const maxTokensOverridden = row.overrideMaxTokens !== undefined;
  const inputOverridden = row.overrideInput !== undefined;

  return (
    <div className={[styles.ovRow, row.hasOverride ? styles.ovRowOv : ""].join(" ")}>
      <span className={styles.ovName}>
        <AiModelIcon provider={row.provider} modelId={row.modelId} size={16} />
        <span className={styles.ovId} title={row.modelId}>
          {row.modelId}
        </span>
        {row.isDefault && (
          <span className={styles.ovCurrent}>{t("settings.models.overrides.currentBadge")}</span>
        )}
      </span>

      <span className={styles.ovCell}>
        <Popover
          direction="bottom"
          trigger={({ onClick }) => (
            <button
              type="button"
              className={[styles.ovVal, windowOverridden ? styles.ovValOn : ""].join(" ")}
              disabled={saving}
              aria-label={t("settings.models.overrides.windowLabel", { model: row.modelId })}
              onClick={onClick}
            >
              {formatModelWindow(row.effectiveWindow)}
              <GlideChevron size={16} className={styles.ovValCaret} />
            </button>
          )}
        >
          {(close) => (
            <WindowEditor
              row={row}
              saving={saving}
              t={t}
              onSubmit={async (patch) => {
                await onSave(row, patch);
                close();
              }}
            />
          )}
        </Popover>
        {windowOverridden && (
          <button
            type="button"
            className={styles.ovReset}
            disabled={saving}
            aria-label={t("settings.models.overrides.resetWindowAria", { model: row.modelId })}
            onClick={() => void onSave(row, { contextWindow: null })}
          >
            <ArrowCounterClockwise size={16} weight="regular" />
          </button>
        )}
      </span>

      <span className={styles.ovCell}>
        <Popover
          direction="bottom"
          trigger={({ onClick }) => (
            <button
              type="button"
              className={[styles.ovVal, maxTokensOverridden ? styles.ovValOn : ""].join(" ")}
              disabled={saving}
              aria-label={t("settings.models.overrides.maxTokensLabel", { model: row.modelId })}
              onClick={onClick}
            >
              {formatModelMaxTokens(row.effectiveMaxTokens)}
              <GlideChevron size={16} className={styles.ovValCaret} />
            </button>
          )}
        >
          {(close) => (
            <MaxTokensEditor
              row={row}
              saving={saving}
              t={t}
              onSubmit={async (patch) => {
                await onSave(row, patch);
                close();
              }}
            />
          )}
        </Popover>
        {maxTokensOverridden && (
          <button
            type="button"
            className={styles.ovReset}
            disabled={saving}
            aria-label={t("settings.models.overrides.resetMaxTokensAria", { model: row.modelId })}
            onClick={() => void onSave(row, { maxTokens: null })}
          >
            <ArrowCounterClockwise size={16} weight="regular" />
          </button>
        )}
      </span>

      <span className={styles.ovCell}>
        <Popover
          direction="bottom"
          trigger={({ onClick }) => (
            <button
              type="button"
              className={[styles.ovVal, inputOverridden ? styles.ovValOn : ""].join(" ")}
              disabled={saving}
              aria-label={t("settings.models.overrides.inputLabel", { model: row.modelId })}
              onClick={onClick}
            >
              {row.effectiveInput?.includes("image")
                ? t("settings.models.overrides.inputImages")
                : t("settings.models.overrides.inputText")}
              <GlideChevron size={16} className={styles.ovValCaret} />
            </button>
          )}
        >
          {(close) => (
            <InputEditor
              row={row}
              saving={saving}
              t={t}
              onSubmit={async (patch) => {
                await onSave(row, patch);
                close();
              }}
            />
          )}
        </Popover>
        {inputOverridden && (
          <button
            type="button"
            className={styles.ovReset}
            disabled={saving}
            aria-label={t("settings.models.overrides.resetInputAria", { model: row.modelId })}
            onClick={() => void onSave(row, { input: null })}
          >
            <ArrowCounterClockwise size={16} weight="regular" />
          </button>
        )}
      </span>
    </div>
  );
});

/**
 * 弹层胶囊组的「高亮药丸」（docs/design/51）：同一套 cubic-bezier 曲线 + 定帧时间轴（封顶
 * 60fps），横排胶囊走 horizontal 模式——药丸按整段矩形补间、盖在选项上做半透明高亮。
 * 打开时瞬移到当前值所在档位，悬停 / Tab 在选项之间滑行；选中态的 accent 底仍由
 * .ovPillOn 承担，药丸只负责「正指向哪一个」。
 */
function useChipPill(selectedIndex: number, onPick: (index: number) => void) {
  const listRef = useRef<HTMLDivElement>(null);
  const pill = useGlidePill(listRef, { horizontal: true, onPick });
  useLayoutEffect(() => {
    pill.jumpTo(selectedIndex >= 0 ? selectedIndex : null);
  }, [selectedIndex, pill]);
  return { listRef, pill };
}

/** popover 脚注：只说「沿用默认 X」或给一个「用默认值」的动作，不出现配置文件键名。 */
function PopoverFoot({
  overridden,
  defaultValue,
  onUseDefault,
  saving,
  t,
}: {
  overridden: boolean;
  defaultValue: string;
  onUseDefault: () => void;
  saving: boolean;
  t: TranslateFn;
}) {
  return (
    <>
      <hr className={styles.ovPopHr} />
      <div className={styles.ovPopFoot}>
        <span>
          {overridden
            ? t("settings.models.overrides.filterModified")
            : t("settings.models.overrides.usingDefault", { value: defaultValue })}
        </span>
        {overridden && (
          <button type="button" disabled={saving} onClick={onUseDefault}>
            {t("settings.models.overrides.useDefault")}
          </button>
        )}
      </div>
    </>
  );
}

function WindowEditor({
  row,
  saving,
  t,
  onSubmit,
}: {
  row: ModelOverrideRow;
  saving: boolean;
  t: TranslateFn;
  onSubmit: (patch: PiModelOverridePatch) => Promise<void>;
}) {
  // WINDOW_PRESETS 是字面量元组，判"是否预设档位"要先放宽成 number[]
  const presets: readonly number[] = WINDOW_PRESETS;
  const custom = row.overrideWindow !== undefined && !presets.includes(row.overrideWindow);
  const [draft, setDraft] = useState(custom ? String(row.overrideWindow) : "");
  const [error, setError] = useState<string | null>(null);
  // 自定义值没有对应胶囊：药丸藏起，悬停时再出现
  const selectedPreset =
    row.overrideWindow !== undefined ? presets.indexOf(row.overrideWindow) : -1;
  const { listRef, pill } = useChipPill(selectedPreset, (index) => {
    if (index >= 0 && index < WINDOW_PRESETS.length) {
      void onSubmit({ contextWindow: WINDOW_PRESETS[index] });
    }
  });

  const commit = (): void => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const value = Number(trimmed);
    if (!Number.isSafeInteger(value) || value <= 0) {
      setError(t("settings.models.overrides.invalidWindow"));
      return;
    }
    void onSubmit({ contextWindow: value });
  };

  return (
    <div className={styles.ovPop}>
      <p className={styles.ovPopTitle}>{t("settings.models.overrides.windowField")}</p>
      <div ref={listRef} className={styles.ovPills} {...pill.listProps}>
        <span ref={pill.pillRef} className={glideStyles.pill} aria-hidden="true" />
        {WINDOW_PRESETS.map((preset, index) => (
          <button
            key={preset}
            type="button"
            data-glide-index={index}
            className={[styles.ovPill, row.overrideWindow === preset ? styles.ovPillOn : ""].join(
              " ",
            )}
            disabled={saving}
            onClick={(event) => {
              // 擦选松手已由药丸代为实现，同一次点击在这里跳过
              if (pill.consumeClick(event.detail)) return;
              void onSubmit({ contextWindow: preset });
            }}
          >
            {formatModelWindow(preset)}
          </button>
        ))}
      </div>
      <input
        className={styles.ovPopInput}
        type="number"
        min={1}
        step={1000}
        placeholder={t("settings.models.overrides.customWindowPlaceholder")}
        value={draft}
        disabled={saving}
        autoComplete="off"
        aria-invalid={error !== null}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
      {error && <p className={styles.ovPopError}>{error}</p>}
      <PopoverFoot
        overridden={row.overrideWindow !== undefined}
        defaultValue={formatModelWindow(row.effectiveWindow)}
        saving={saving}
        t={t}
        onUseDefault={() => void onSubmit({ contextWindow: null })}
      />
    </div>
  );
}

function MaxTokensEditor({
  row,
  saving,
  t,
  onSubmit,
}: {
  row: ModelOverrideRow;
  saving: boolean;
  t: TranslateFn;
  onSubmit: (patch: PiModelOverridePatch) => Promise<void>;
}) {
  const presets: readonly number[] = MAX_OUTPUT_PRESETS;
  const custom = row.overrideMaxTokens !== undefined && !presets.includes(row.overrideMaxTokens);
  const [draft, setDraft] = useState(custom ? String(row.overrideMaxTokens) : "");
  const [error, setError] = useState<string | null>(null);
  const selectedPreset =
    row.overrideMaxTokens !== undefined ? presets.indexOf(row.overrideMaxTokens) : -1;
  const { listRef, pill } = useChipPill(selectedPreset, (index) => {
    if (index >= 0 && index < MAX_OUTPUT_PRESETS.length) {
      void onSubmit({ maxTokens: MAX_OUTPUT_PRESETS[index] });
    }
  });

  const commit = (): void => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const value = Number(trimmed);
    if (!Number.isSafeInteger(value) || value <= 0) {
      setError(t("settings.models.overrides.invalidMaxTokens"));
      return;
    }
    void onSubmit({ maxTokens: value });
  };

  return (
    <div className={styles.ovPop}>
      <p className={styles.ovPopTitle}>{t("settings.models.overrides.maxTokensField")}</p>
      <p className={styles.ovPopHint}>{t("settings.models.overrides.maxTokensHint")}</p>
      <div ref={listRef} className={styles.ovPills} {...pill.listProps}>
        <span ref={pill.pillRef} className={glideStyles.pill} aria-hidden="true" />
        {MAX_OUTPUT_PRESETS.map((preset, index) => (
          <button
            key={preset}
            type="button"
            data-glide-index={index}
            className={[
              styles.ovPill,
              row.overrideMaxTokens === preset ? styles.ovPillOn : "",
            ].join(" ")}
            disabled={saving}
            onClick={(event) => {
              // 擦选松手已由药丸代为实现，同一次点击在这里跳过
              if (pill.consumeClick(event.detail)) return;
              void onSubmit({ maxTokens: preset });
            }}
          >
            {formatModelMaxTokens(preset)}
          </button>
        ))}
      </div>
      <input
        className={styles.ovPopInput}
        type="number"
        min={1}
        step={1024}
        placeholder={t("settings.models.overrides.customMaxTokensPlaceholder")}
        value={draft}
        disabled={saving}
        autoComplete="off"
        aria-invalid={error !== null}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
      {error && <p className={styles.ovPopError}>{error}</p>}
      <PopoverFoot
        overridden={row.overrideMaxTokens !== undefined}
        defaultValue={formatModelMaxTokens(row.effectiveMaxTokens)}
        saving={saving}
        t={t}
        onUseDefault={() => void onSubmit({ maxTokens: null })}
      />
    </div>
  );
}

function InputEditor({
  row,
  saving,
  t,
  onSubmit,
}: {
  row: ModelOverrideRow;
  saving: boolean;
  t: TranslateFn;
  onSubmit: (patch: PiModelOverridePatch) => Promise<void>;
}) {
  const images = row.overrideInput?.includes("image") ?? false;
  // 未覆盖时两个胶囊都不算选中：药丸藏起，悬停时再出现
  const selectedInput = images ? 0 : row.overrideInput !== undefined ? 1 : -1;
  const { listRef, pill } = useChipPill(selectedInput, (index) => {
    void onSubmit(index === 0 ? { input: ["text", "image"] } : { input: ["text"] });
  });
  return (
    <div className={styles.ovPop}>
      <p className={styles.ovPopTitle}>{t("settings.models.overrides.inputField")}</p>
      <div ref={listRef} className={styles.ovPills} {...pill.listProps}>
        <span ref={pill.pillRef} className={glideStyles.pill} aria-hidden="true" />
        <button
          type="button"
          data-glide-index={0}
          className={[styles.ovPill, images ? styles.ovPillOn : ""].join(" ")}
          disabled={saving}
          onClick={(event) => {
            // 擦选松手已由药丸代为实现，同一次点击在这里跳过
            if (pill.consumeClick(event.detail)) return;
            void onSubmit({ input: ["text", "image"] });
          }}
        >
          {t("settings.models.overrides.inputImages")}
        </button>
        <button
          type="button"
          data-glide-index={1}
          className={[
            styles.ovPill,
            row.overrideInput !== undefined && !images ? styles.ovPillOn : "",
          ].join(" ")}
          disabled={saving}
          onClick={(event) => {
            if (pill.consumeClick(event.detail)) return;
            void onSubmit({ input: ["text"] });
          }}
        >
          {t("settings.models.overrides.inputText")}
        </button>
      </div>
      <PopoverFoot
        overridden={row.overrideInput !== undefined}
        defaultValue={
          row.effectiveInput?.includes("image")
            ? t("settings.models.overrides.inputImages")
            : t("settings.models.overrides.inputText")
        }
        saving={saving}
        t={t}
        onUseDefault={() => void onSubmit({ input: null })}
      />
    </div>
  );
}
