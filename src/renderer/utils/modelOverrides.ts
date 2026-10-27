/**
 * 设置 →「模型能力」的纯逻辑（docs/design/49 起，docs/design/50 改版）：
 * 行模型、排序、过滤、窗口格式化。UI 只做渲染。
 * 行顺序 = 已修改 → 当前默认 → 清单原序（稳定）。
 */
import type {
  PiModelInputModality,
  PiModelOption,
  PiModelOverridesSnapshot,
} from "../../shared/ipc";

export interface ModelOverrideRow {
  provider: string;
  modelId: string;
  label: string;
  /** 当前生效（含覆盖）的输入模态；undefined = 未知。 */
  effectiveInput?: PiModelInputModality[];
  /** 当前生效（含覆盖）的窗口；undefined = 未知。 */
  effectiveWindow?: number;
  /** 当前生效（含覆盖）的单次输出上限；undefined = 未知。 */
  effectiveMaxTokens?: number;
  /** 覆盖值：undefined 键 = 默认（不显示在 selects 的覆盖态上）。 */
  overrideWindow?: number;
  overrideMaxTokens?: number;
  overrideInput?: PiModelInputModality[];
  hasOverride: boolean;
  /** 当前默认模型：行上打「当前」标记，回答"改这个会不会影响正在跑的会话"。 */
  isDefault: boolean;
}

function sameModalities(a?: PiModelInputModality[], b?: PiModelInputModality[]): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function sameRow(a: ModelOverrideRow, b: ModelOverrideRow): boolean {
  return (
    a.provider === b.provider &&
    a.modelId === b.modelId &&
    a.label === b.label &&
    a.effectiveWindow === b.effectiveWindow &&
    a.effectiveMaxTokens === b.effectiveMaxTokens &&
    a.overrideWindow === b.overrideWindow &&
    a.overrideMaxTokens === b.overrideMaxTokens &&
    a.hasOverride === b.hasOverride &&
    a.isDefault === b.isDefault &&
    sameModalities(a.effectiveInput, b.effectiveInput) &&
    sameModalities(a.overrideInput, b.overrideInput)
  );
}

/**
 * 未变化的行沿用上一轮的对象：保存一条覆盖会让 models / overrides 两个源都换新引用，
 * 不回收对象的话列表里每一行都“变了”，memo 失效、展开态每次保存白渲染两遍全表。
 */
export function reuseModelOverrideRows(
  next: ModelOverrideRow[],
  previous: ModelOverrideRow[],
): ModelOverrideRow[] {
  if (previous.length === 0) return next;
  const previousByKey = new Map<string, ModelOverrideRow>();
  for (const row of previous) previousByKey.set(`${row.provider}/${row.modelId}`, row);
  return next.map((row) => {
    const before = previousByKey.get(`${row.provider}/${row.modelId}`);
    return before && sameRow(before, row) ? before : row;
  });
}

/** 筛选项：全部 / 已修改 / 待确认（默认被判为纯文本且未修改）。 */
export type OverrideFilterMode = "all" | "modified" | "review";

export function buildModelOverrideRows(
  models: PiModelOption[],
  overrides: PiModelOverridesSnapshot,
  defaultModelKey: string | null,
): ModelOverrideRow[] {
  const rows = models.map((model, index) => {
    const override = overrides[model.provider]?.[model.modelId];
    return {
      row: {
        provider: model.provider,
        modelId: model.modelId,
        label: model.label,
        effectiveInput: model.input,
        effectiveWindow: model.contextWindow,
        effectiveMaxTokens: model.maxTokens,
        overrideWindow: override?.contextWindow,
        overrideMaxTokens: override?.maxTokens,
        overrideInput: override?.input,
        hasOverride: Boolean(override),
        isDefault: defaultModelKey === `${model.provider}/${model.modelId}`,
      } satisfies ModelOverrideRow,
      index,
    };
  });
  rows.sort((a, b) => {
    if (a.row.hasOverride !== b.row.hasOverride) return a.row.hasOverride ? -1 : 1;
    if (a.row.isDefault !== b.row.isDefault) return a.row.isDefault ? -1 : 1;
    return a.index - b.index;
  });
  return rows.map((item) => item.row);
}

/**
 * 「待确认」= 网关按模型名推断成纯文本、且用户还没改过。
 * 生效模态未知（undefined）时不算：不能凭缺失数据提示用户去确认。
 */
export function isReviewRow(row: ModelOverrideRow): boolean {
  if (row.overrideInput !== undefined) return false;
  return row.effectiveInput !== undefined && !row.effectiveInput.includes("image");
}

export function filterModelOverrideRows(
  rows: ModelOverrideRow[],
  query: string,
  mode: OverrideFilterMode,
): ModelOverrideRow[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (mode === "modified" && !row.hasOverride) return false;
    if (mode === "review" && !isReviewRow(row)) return false;
    if (!needle) return true;
    return row.modelId.toLowerCase().includes(needle) || row.label.toLowerCase().includes(needle);
  });
}

/** 窗口展示：≥1M 用 M，其余 k；未知给占位符。 */
export function formatModelWindow(tokens?: number): string {
  if (tokens === undefined || !Number.isFinite(tokens) || tokens <= 0) return "—";
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }
  return `${Math.round(tokens / 1000)}k`;
}

/** 输出上限展示：按 1024 进位（16384 → 16k、131072 → 128k）；未知给占位符。 */
export function formatModelMaxTokens(tokens?: number): string {
  if (tokens === undefined || !Number.isFinite(tokens) || tokens <= 0) return "—";
  if (tokens >= 1024 * 1024) {
    const millions = tokens / (1024 * 1024);
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }
  const thousands = tokens / 1024;
  return `${Number.isInteger(thousands) ? thousands : Number(thousands.toFixed(1))}k`;
}

/** 预设窗口档位（select 用；十进制值让展示与命中一致：128k 显示 128k）。 */
export const WINDOW_PRESETS = [64000, 128000, 200000, 256000, 512000, 1000000] as const;

/** 预设输出上限档位（tokens，含思考）：16k 是扩展历史默认值，32k 起给推理型模型留正文余量。 */
export const MAX_OUTPUT_PRESETS = [8192, 16384, 32768, 65536, 131072] as const;
