/**
 * table 节点的纯语义（docs/design/19 §3.2.1）。
 *
 * 刻意只包含布局与文本化计算：表格**只呈现**，不排序、不筛选、不分页——
 * 过滤条件属于扩展侧业务状态，变化后由扩展重算整树并 update。
 */

import { t } from "../../../shared/i18n";
import type { ViewTableColumn, ViewTableRow } from "../../../shared/view";

/** 缺省权重：未声明 `width` 的列按 1 份参与等分。 */
const DEFAULT_WEIGHT = 1;

/**
 * 列宽权重 → 百分比列宽（`table-layout: fixed` + colgroup）。
 * 权重总和为 0（全 0 / 空列）时退回等分，避免除零产生 NaN 布局。
 */
export function resolveColumnWeights(columns: readonly ViewTableColumn[]): number[] {
  if (columns.length === 0) return [];
  const weights = columns.map((column) =>
    typeof column.width === "number" && Number.isFinite(column.width) && column.width > 0
      ? column.width
      : DEFAULT_WEIGHT,
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return columns.map(() => 100 / columns.length);
  return weights.map((weight) => (weight / total) * 100);
}

export type TableAlign = "left" | "center" | "right";

/** 非法/缺省一律 left：布局输入不接受任意值。 */
export function resolveAlign(column: ViewTableColumn): TableAlign {
  return column.align === "center" || column.align === "right" ? column.align : "left";
}

export interface TableWindow {
  rows: ViewTableRow[];
  /** 被 `maxRows` 截断掉的行数；0 = 未截断。 */
  hidden: number;
  total: number;
}

/**
 * `maxRows` 是作者声明的渲染上限，在 Host 协议硬上限（`maxTableRows`）之后生效：
 * 截断不静默，表尾必须报「显示 N / 共 M」，否则面板会假装队列很短。
 */
export function windowTableRows(
  rows: readonly ViewTableRow[],
  maxRows: number | undefined,
): TableWindow {
  const total = rows.length;
  if (typeof maxRows !== "number" || !Number.isFinite(maxRows) || maxRows < 0) {
    return { rows: [...rows], hidden: 0, total };
  }
  const shown = rows.slice(0, maxRows);
  return { rows: shown, hidden: total - shown.length, total };
}

/**
 * 单元格文本化：`null` / 缺列渲染为空（由 CSS 撑出占位，避免行塌陷），
 * 数字与布尔按字面量文本化——需要本地化标签时扩展侧应自己传 `string`。
 */
export function formatCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return String(value);
}

/** 表尾截断统计文案。 */
export function truncationLabel(shown: number, total: number): string {
  return t("ui.view.tableTruncation", { shown, total });
}
