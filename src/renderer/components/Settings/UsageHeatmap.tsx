import { useMemo } from "react";
import { getI18nLocale } from "../../../shared/i18n";
import type { UsageDaySlice, UsageReport } from "../../../shared/usage";
import { computeUsageHeatScale, usageBucketKey, usageHeatLevel } from "../../../shared/usage";
import { useT } from "../../hooks/useT";
import { formatCost, formatTokens } from "../../utils/formatTokens";
import styles from "./UsageHeatmap.module.css";

/**
 * 年度用量热力图（GitHub contributions 风格，纯 CSS grid、零依赖）：
 * 列 = 周（周一起），行 = 周一..周日；色阶 = 当日 output 四分位档
 * （shared/usage 的 computeUsageHeatScale——cacheRead 会淹没真实工作量）。
 * 只做展示；数据查询与项目筛选由 UsagePanel 提供。窗口固定为过去 52 个
 * 整周 + 当前周（可不满），当前周内今天之后的格子不渲染。
 */

/** 展示的完整周数（不含当前周）；加上当前周共 53 列。 */
const PAST_WEEKS = 52;

/**
 * 相邻月份标签至少间隔的列数（1 列 = 格宽 + 间距 = 12px）。
 * 「9月」与「10月」若只隔 1–2 列（月末周一起算时很常见）会字形重叠，
 * 宁可跳过一枚标签也不叠字。4 列 ≈ 48px，足以容纳「10月」/「Oct」。
 */
const MIN_MONTH_LABEL_GAP = 4;

/** 色阶档位 → CSS Modules 类名（避免动态键访问丢类）。 */
const LEVEL_CLASSES = [styles.l0, styles.l1, styles.l2, styles.l3, styles.l4];

interface HeatCell {
  /** 本地日历日桶键 YYYY-MM-DD。 */
  key: string;
  output: number;
  slice: UsageDaySlice | undefined;
  level: 0 | 1 | 2 | 3 | 4;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 该日所在周的周一（本地时区；按日历日回退，不受 DST 影响）。 */
function mondayOf(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

export function UsageHeatmap({ report }: { report: UsageReport }) {
  const t = useT();
  // 月份/日期标签随语言变化；uiStore 切语言会触发重渲染，此处重读运行时值
  const locale = getI18nLocale();

  const { cells, monthLabels } = useMemo(() => {
    const byKey = new Map(report.byDay.map((slice) => [slice.key, slice]));
    const today = startOfToday();
    const start = mondayOf(addDays(today, -PAST_WEEKS * 7));

    const list: HeatCell[] = [];
    const outputs: number[] = [];
    for (let i = 0; ; i += 1) {
      const date = addDays(start, i);
      if (date.getTime() > today.getTime()) break;
      const key = usageBucketKey(date.getTime(), "day");
      const slice = byKey.get(key);
      if (slice && slice.output > 0) outputs.push(slice.output);
      list.push({ key, output: slice?.output ?? 0, slice, level: 0 });
    }
    const scale = computeUsageHeatScale(outputs);
    for (const cell of list) {
      cell.level = usageHeatLevel(scale, cell.output);
    }

    // 月份标签标在月份首次出现的列；末列（当前周，可能只有一两天）不标，避免溢出。
    // 与上一枚已渲染标签间隔不足 MIN_MONTH_LABEL_GAP 时跳过，防止字体重叠。
    const monthFormatter = new Intl.DateTimeFormat(locale, { month: "short" });
    const labels: { column: number; label: string }[] = [];
    const columns = Math.ceil(list.length / 7);
    let prevMonth = -1;
    for (let c = 0; c < columns - 1; c += 1) {
      const monday = addDays(start, c * 7);
      if (monday.getMonth() !== prevMonth) {
        const last = labels[labels.length - 1];
        if (last === undefined || c - last.column >= MIN_MONTH_LABEL_GAP) {
          labels.push({ column: c, label: monthFormatter.format(monday) });
        }
      }
      prevMonth = monday.getMonth();
    }
    return { cells: list, monthLabels: labels };
  }, [report, locale]);

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }),
    [locale],
  );

  function cellTitle(cell: HeatCell): string {
    const date = dateFormatter.format(usageBucketKeyToDate(cell.key));
    if (!cell.slice || cell.slice.totalTokens === 0) {
      return t("settings.usage.heatmap.tooltipEmpty", { date });
    }
    return t("settings.usage.heatmap.tooltip", {
      date,
      output: formatTokens(cell.slice.output),
      input: formatTokens(cell.slice.input),
      cache: formatTokens(cell.slice.cacheRead + cell.slice.cacheWrite),
      sessions: String(cell.slice.sessions),
      cost: formatCost(cell.slice.cost),
    });
  }

  return (
    <div className={styles.heatmap}>
      <div className={styles.monthRow} aria-hidden="true">
        {monthLabels.map((m) => (
          <span key={`${m.column}-${m.label}`} style={{ gridColumn: m.column + 2 }}>
            {m.label}
          </span>
        ))}
      </div>
      <div className={styles.body}>
        <div className={styles.weekCol} aria-hidden="true">
          <span>{t("settings.usage.weekday.mon")}</span>
          <span />
          <span>{t("settings.usage.weekday.wed")}</span>
          <span />
          <span>{t("settings.usage.weekday.fri")}</span>
          <span />
          <span />
        </div>
        <div className={styles.cells}>
          {cells.map((cell) => (
            <span
              key={cell.key}
              className={`${styles.cell} ${LEVEL_CLASSES[cell.level]}`}
              title={cellTitle(cell)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** 色阶图例（少 → 多）。独立导出以便放在项目筛选工具栏右侧，节省纵向空间。 */
export function UsageHeatLegend() {
  const t = useT();
  return (
    <div className={styles.legend} aria-hidden="true">
      <span>{t("settings.usage.legend.less")}</span>
      {LEVEL_CLASSES.map((cls) => (
        <i key={cls} className={cls} />
      ))}
      <span>{t("settings.usage.legend.more")}</span>
    </div>
  );
}

/** 桶键 YYYY-MM-DD → 本地零点 Date（仅用于 tooltip 文案）。 */
function usageBucketKeyToDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}
