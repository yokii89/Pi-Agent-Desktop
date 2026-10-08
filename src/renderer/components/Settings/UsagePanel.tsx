import { ArrowClockwise } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { UsageDaySlice, UsageGranularity, UsageReport } from "../../../shared/usage";
import { usageBucketKey } from "../../../shared/usage";
import { useT } from "../../hooks/useT";
import { usageService } from "../../services/usageService";
import { formatCost, formatTokens } from "../../utils/formatTokens";
import { IconButton } from "../ui/IconButton";
import { SettingsSection } from "./SettingRow";
import settingsStyles from "./Settings.module.css";
import { UsageHeatLegend, UsageHeatmap } from "./UsageHeatmap";
import styles from "./UsagePanel.module.css";

/**
 * 设置页「用量统计」面板：汇总卡片 + 近期趋势（纯 CSS 堆叠柱）+「全部」档
 * 年度热力图（当日 output 色阶，可按项目筛选）+ 按项目 / 按模型明细。
 * 数据经 usageService.query 扫描 pi 会话 JSONL 聚合而来，只读不落库。
 */

type UsageRange = "today" | "7d" | "30d" | "all";

const DAY_MS = 86_400_000;
const RANGES: readonly UsageRange[] = ["today", "7d", "30d", "all"];
const RANGE_KEYS: Record<UsageRange, string> = {
  today: "settings.usage.range.today",
  "7d": "settings.usage.range.7d",
  "30d": "settings.usage.range.30d",
  all: "settings.usage.range.all",
};
/** 项目筛选下拉的「全部项目」哨兵值（select 的 value 需要非空字符串）。 */
const PROJECT_ALL = "__all__";
/** 补零桶的防御上限（月粒度下 100 年也到不了）。 */
const MAX_BUCKETS = 1200;

/** 本地时区当天 00:00（「今日」档的统计起点，按本地日历日切分）。 */
function localMidnight(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function rangeSince(range: UsageRange, now: number): number | null {
  if (range === "today") return localMidnight(now);
  if (range === "7d") return now - 7 * DAY_MS;
  if (range === "30d") return now - 30 * DAY_MS;
  return null;
}

function parseBucketKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function nextBucketKey(key: string, granularity: UsageGranularity): string {
  const d = parseBucketKey(key);
  const next =
    granularity === "month"
      ? new Date(d.getFullYear(), d.getMonth() + 1, 1)
      : new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return usageBucketKey(next.getTime(), granularity);
}

function emptySlice(key: string): UsageDaySlice {
  return {
    key,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: 0,
    sessions: 0,
  };
}

/**
 * 主进程只返回有数据的桶；图表按粒度枚举起点→今天的全部桶补零，
 * 否则零用量日会整体塌缩，趋势图失真。
 */
function buildChartSlices(report: UsageReport): UsageDaySlice[] {
  if (report.byDay.length === 0) return [];
  const { granularity } = report;
  const byKey = new Map(report.byDay.map((slice) => [slice.key, slice]));
  const startKey =
    report.since !== null ? usageBucketKey(report.since, granularity) : report.byDay[0].key;
  const endKey = usageBucketKey(Date.now(), granularity);
  const out: UsageDaySlice[] = [];
  let cursor = startKey;
  for (let guard = 0; guard < MAX_BUCKETS; guard += 1) {
    out.push(byKey.get(cursor) ?? emptySlice(cursor));
    if (cursor === endKey) break;
    cursor = nextBucketKey(cursor, granularity);
  }
  return out;
}

/** 横轴端点标签：day 显示 MM-DD，month 显示 YYYY-MM。 */
function axisLabel(key: string | undefined, granularity: UsageGranularity): string {
  if (!key) return "";
  return granularity === "day" ? key.slice(5) : key;
}

function modelLabel(provider: string, modelId: string, unknownText: string): string {
  const p = provider === "unknown" ? unknownText : provider;
  const m = modelId === "unknown" ? unknownText : modelId;
  return `${p} / ${m}`;
}

/**
 * 模块级回显缓存：设置浮窗每次切分区都会重挂载本面板，先回显上次的报表与
 * 范围避免闪加载态，后台再静默刷新到最新。
 */
let cachedReport: UsageReport | null = null;
let cachedRange: UsageRange | null = null;
let cachedHeatProject: string | null = null;
let cachedHeatReport: UsageReport | null = null;

export function UsagePanel() {
  const t = useT();
  const [range, setRange] = useState<UsageRange>(cachedRange ?? "30d");
  const [report, setReport] = useState<UsageReport | null>(cachedReport);
  const [pending, setPending] = useState(cachedReport === null);
  const [failed, setFailed] = useState(false);
  // 热力图仅「全部」档渲染：独立查询（day 粒度 + 项目筛选），与主报表互不影响
  const [heatProject, setHeatProject] = useState<string | null>(cachedHeatProject);
  const [heatReport, setHeatReport] = useState<UsageReport | null>(cachedHeatReport);
  const [heatPending, setHeatPending] = useState(cachedHeatReport === null);
  const [heatReloadTick, setHeatReloadTick] = useState(0);

  const load = useCallback(() => {
    let cancelled = false;
    setPending(true);
    void (async () => {
      const result = await usageService.query({ since: rangeSince(range, Date.now()) });
      if (cancelled) return;
      setReport(result);
      setFailed(result === null);
      setPending(false);
      if (result !== null) {
        cachedReport = result;
        cachedRange = range;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range]);

  useEffect(() => load(), [load]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: heatReloadTick 是手动刷新的触发器，不在闭包内读取
  useEffect(() => {
    if (range !== "all") return;
    let cancelled = false;
    setHeatPending(true);
    void (async () => {
      const result = await usageService.query({
        since: null,
        project: heatProject,
        granularity: "day",
      });
      if (cancelled) return;
      setHeatReport(result);
      setHeatPending(false);
      if (result !== null) {
        cachedHeatProject = heatProject;
        cachedHeatReport = result;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range, heatProject, heatReloadTick]);

  // 筛选中的项目可能已消失（会话文件删除后不再进报表），回退到全部项目
  useEffect(() => {
    if (range !== "all" || report === null || heatProject === null) return;
    if (!report.byProject.some((p) => p.key === heatProject)) setHeatProject(null);
  }, [range, report, heatProject]);

  const granularity = report?.granularity ?? "day";
  const chartSlices = useMemo(() => (report ? buildChartSlices(report) : []), [report]);
  const maxTotal = useMemo(
    () => Math.max(1, ...chartSlices.map((slice) => slice.totalTokens)),
    [chartSlices],
  );
  const hasData = report !== null && report.totals.assistantMessages > 0;
  // 只有「无任何旧内容可占位」时才显示加载/错误态；切档期间旧报表原地保留，
  // 新数据到达后整体原子替换，避免整块卸载重挂造成的闪烁。
  const showLoading = report === null && pending;
  const showError = report === null && !pending && failed;
  const showEmpty = report !== null && !hasData;
  const showBody = report !== null && hasData;

  return (
    <div className={settingsStyles.panel}>
      <h2 className={settingsStyles.panelTitle}>{t("settings.section.usage")}</h2>

      <div className={styles.toolbar}>
        <div className={settingsStyles.segmented}>
          {RANGES.map((value) => (
            <button
              key={value}
              type="button"
              className={[
                settingsStyles.segment,
                range === value ? settingsStyles.segmentActive : "",
              ].join(" ")}
              onClick={() => setRange(value)}
            >
              {t(RANGE_KEYS[value])}
            </button>
          ))}
        </div>
        <IconButton
          title={t("settings.usage.refresh")}
          onClick={() => {
            load();
            setHeatReloadTick((v) => v + 1);
          }}
          disabled={pending}
        >
          <ArrowClockwise size={16} weight="regular" />
        </IconButton>
      </div>

      {showLoading && <p className={styles.stateText}>{t("settings.usage.loading")}</p>}
      {showError && <p className={styles.stateText}>{t("settings.usage.error")}</p>}
      {showEmpty && (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>{t("settings.usage.empty.title")}</p>
          <p className={styles.emptyText}>{t("settings.usage.empty.description")}</p>
        </div>
      )}

      {showBody && report && (
        <div className={pending ? styles.bodyPending : styles.body}>
          <div className={styles.cards}>
            <div className={styles.card}>
              <span className={styles.cardLabel}>{t("settings.usage.totalTokens")}</span>
              <span className={styles.cardValue}>{formatTokens(report.totals.totalTokens)}</span>
              <span className={styles.cardSub}>
                {t("settings.usage.input")} {formatTokens(report.totals.input)} ·{" "}
                {t("settings.usage.output")} {formatTokens(report.totals.output)} ·{" "}
                {t("settings.usage.cache")}{" "}
                {formatTokens(report.totals.cacheRead + report.totals.cacheWrite)}
              </span>
            </div>
            <div className={styles.card}>
              <span className={styles.cardLabel}>{t("settings.usage.sessions")}</span>
              <span className={styles.cardValue}>{report.totals.sessions}</span>
              <span className={styles.cardSub}>
                {t("settings.usage.messages")} {report.totals.assistantMessages}
              </span>
            </div>
            <div className={styles.card}>
              <span className={styles.cardLabel}>{t("settings.usage.cost")}</span>
              <span
                className={styles.cardValue}
                title={report.totals.cost > 0 ? undefined : t("settings.usage.costUnreported")}
              >
                {formatCost(report.totals.cost)}
              </span>
              <span className={styles.cardSub} />
            </div>
          </div>

          {range === "all" ? (
            <SettingsSection>
              <div className={styles.heatmapToolbar}>
                <select
                  className={settingsStyles.selectLike}
                  value={heatProject ?? PROJECT_ALL}
                  aria-label={t("settings.usage.heatmap.projectLabel")}
                  onChange={(event) =>
                    setHeatProject(event.target.value === PROJECT_ALL ? null : event.target.value)
                  }
                >
                  <option value={PROJECT_ALL}>{t("settings.usage.heatmap.projectAll")}</option>
                  {report.byProject.map((project) => (
                    <option key={project.key} value={project.key}>
                      {project.name}
                    </option>
                  ))}
                </select>
                <UsageHeatLegend />
              </div>
              {heatReport === null && heatPending && (
                <p className={styles.stateText}>{t("settings.usage.loading")}</p>
              )}
              {heatReport === null && !heatPending && (
                <p className={styles.stateText}>{t("settings.usage.error")}</p>
              )}
              {heatReport !== null && (
                <div className={heatPending ? styles.bodyPending : styles.body}>
                  <UsageHeatmap report={heatReport} />
                </div>
              )}
            </SettingsSection>
          ) : (
            <SettingsSection title={t("settings.usage.trend")}>
              {granularity === "month" && (
                <p className={styles.granularityHint}>{t("settings.usage.trend.monthly")}</p>
              )}
              <div className={styles.chart}>
                <div className={styles.bars}>
                  {chartSlices.map((slice) => {
                    const total = slice.totalTokens;
                    const inputH = ((total - slice.output) / maxTotal) * 100;
                    const outputH = (slice.output / maxTotal) * 100;
                    const title = t("settings.usage.trendTooltip", {
                      label: slice.key,
                      input: formatTokens(slice.input + slice.cacheRead + slice.cacheWrite),
                      output: formatTokens(slice.output),
                      cache: formatTokens(slice.cacheRead + slice.cacheWrite),
                    });
                    return (
                      <div key={slice.key} className={styles.barSlot} title={title}>
                        {total > 0 && inputH > 0 && (
                          <span className={styles.segInput} style={{ height: `${inputH}%` }} />
                        )}
                        {total > 0 && outputH > 0 && (
                          <span className={styles.segOutput} style={{ height: `${outputH}%` }} />
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className={styles.axis}>
                  <span>{axisLabel(chartSlices[0]?.key, granularity)}</span>
                  <span className={styles.legend}>
                    <i className={styles.dotInput} />
                    {t("settings.usage.input")}
                    <i className={styles.dotOutput} />
                    {t("settings.usage.output")}
                  </span>
                  <span>{axisLabel(chartSlices.at(-1)?.key, granularity)}</span>
                </div>
              </div>
            </SettingsSection>
          )}

          <SettingsSection title={t("settings.usage.byProject")}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t("settings.usage.project")}</th>
                  <th className={styles.num}>{t("settings.usage.tokens")}</th>
                  <th className={styles.num}>{t("settings.usage.input")}</th>
                  <th className={styles.num}>{t("settings.usage.output")}</th>
                  <th className={styles.num}>{t("settings.usage.cache")}</th>
                  <th className={styles.num}>{t("settings.usage.cost")}</th>
                  <th className={styles.num}>{t("settings.usage.sessions")}</th>
                </tr>
              </thead>
              <tbody>
                {report.byProject.map((row) => (
                  <tr key={row.key}>
                    <td
                      className={styles.modelCell}
                      title={row.cwd ?? t("settings.usage.project.noCwd", { dir: row.name })}
                    >
                      {row.name}
                    </td>
                    <td className={styles.num}>{formatTokens(row.totalTokens)}</td>
                    <td className={styles.num}>{formatTokens(row.input)}</td>
                    <td className={styles.num}>{formatTokens(row.output)}</td>
                    <td
                      className={styles.num}
                      title={`${t("settings.usage.cacheRead")} ${row.cacheRead} / ${t("settings.usage.cacheWrite")} ${row.cacheWrite}`}
                    >
                      {formatTokens(row.cacheRead + row.cacheWrite)}
                    </td>
                    <td
                      className={styles.num}
                      title={row.cost > 0 ? undefined : t("settings.usage.costUnreported")}
                    >
                      {formatCost(row.cost)}
                    </td>
                    <td className={styles.num}>{row.sessions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SettingsSection>

          <SettingsSection title={t("settings.usage.byModel")}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t("settings.usage.model")}</th>
                  <th className={styles.num}>{t("settings.usage.tokens")}</th>
                  <th className={styles.num}>{t("settings.usage.input")}</th>
                  <th className={styles.num}>{t("settings.usage.output")}</th>
                  <th className={styles.num}>{t("settings.usage.cache")}</th>
                  <th className={styles.num}>{t("settings.usage.cost")}</th>
                  <th className={styles.num}>{t("settings.usage.sessions")}</th>
                </tr>
              </thead>
              <tbody>
                {report.byModel.map((row) => {
                  const cacheTotal = row.cacheRead + row.cacheWrite;
                  return (
                    <tr key={`${row.provider}/${row.modelId}`}>
                      <td className={styles.modelCell}>
                        {modelLabel(row.provider, row.modelId, t("settings.usage.model.unknown"))}
                      </td>
                      <td className={styles.num}>{formatTokens(row.totalTokens)}</td>
                      <td className={styles.num}>{formatTokens(row.input)}</td>
                      <td className={styles.num}>{formatTokens(row.output)}</td>
                      <td
                        className={styles.num}
                        title={`${t("settings.usage.cacheRead")} ${row.cacheRead} / ${t("settings.usage.cacheWrite")} ${row.cacheWrite}`}
                      >
                        {formatTokens(cacheTotal)}
                      </td>
                      <td
                        className={styles.num}
                        title={row.cost > 0 ? undefined : t("settings.usage.costUnreported")}
                      >
                        {formatCost(row.cost)}
                      </td>
                      <td className={styles.num}>{row.sessions}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </SettingsSection>

          <p className={styles.footnote}>{t("settings.usage.dataSource")}</p>
        </div>
      )}
    </div>
  );
}
