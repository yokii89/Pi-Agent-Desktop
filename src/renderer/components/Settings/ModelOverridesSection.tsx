import { ArrowCounterClockwise, CaretDown } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import type { TranslateFn } from "../../../shared/i18n";
import type { PiModelOverridePatch } from "../../../shared/ipc";
import { useT } from "../../hooks/useT";
import type { ModelOverrideRow } from "../../utils/modelOverrides";
import {
  filterModelOverrideRows,
  formatModelWindow,
  isReviewRow,
  type OverrideFilterMode,
  WINDOW_PRESETS,
} from "../../utils/modelOverrides";
import { Popover } from "../ui/Popover";
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
 * 设置 →「模型能力」（docs/design/50）：三列表格 + 值即控件。
 *
 * 行上不放常驻下拉：常态只有「模型 / 窗口 / 多模态」三个值，点值才弹 popover 改。
 * 来源靠字段自身着色（蓝 = 已修改，灰 = 沿用默认），而不是行级的一列文字——
 * 同一行可能窗口是用户设的、多模态仍是目录猜的。
 */
export function ModelOverridesSection({
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
        <div className={styles.ovSeg}>
          {modes.map((item) => (
            <button
              key={item.key}
              type="button"
              className={[styles.ovSegBtn, mode === item.key ? styles.ovSegBtnOn : ""].join(" ")}
              aria-pressed={mode === item.key}
              onClick={() => {
                setMode(item.key);
                setExpanded(false);
              }}
            >
              {item.label}
              <span className={styles.ovSegNum}>{counts[item.key]}</span>
            </button>
          ))}
        </div>
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
}

/** 单行：模型名 + 两个「值即控件」单元格（+ 已修改时的行尾恢复按钮）。 */
function OverrideRow({
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
  const inputOverridden = row.overrideInput !== undefined;

  return (
    <div className={[styles.ovRow, row.hasOverride ? styles.ovRowOv : ""].join(" ")}>
      <span className={styles.ovName}>
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
              <CaretDown size={16} weight="regular" className={styles.ovValCaret} />
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
              className={[styles.ovVal, inputOverridden ? styles.ovValOn : ""].join(" ")}
              disabled={saving}
              aria-label={t("settings.models.overrides.inputLabel", { model: row.modelId })}
              onClick={onClick}
            >
              {row.effectiveInput?.includes("image")
                ? t("settings.models.overrides.inputImages")
                : t("settings.models.overrides.inputText")}
              <CaretDown size={16} weight="regular" className={styles.ovValCaret} />
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
      <div className={styles.ovPills}>
        {WINDOW_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={[styles.ovPill, row.overrideWindow === preset ? styles.ovPillOn : ""].join(
              " ",
            )}
            disabled={saving}
            onClick={() => void onSubmit({ contextWindow: preset })}
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
  return (
    <div className={styles.ovPop}>
      <p className={styles.ovPopTitle}>{t("settings.models.overrides.inputField")}</p>
      <div className={styles.ovPills}>
        <button
          type="button"
          className={[styles.ovPill, images ? styles.ovPillOn : ""].join(" ")}
          disabled={saving}
          onClick={() => void onSubmit({ input: ["text", "image"] })}
        >
          {t("settings.models.overrides.inputImages")}
        </button>
        <button
          type="button"
          className={[
            styles.ovPill,
            row.overrideInput !== undefined && !images ? styles.ovPillOn : "",
          ].join(" ")}
          disabled={saving}
          onClick={() => void onSubmit({ input: ["text"] })}
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
