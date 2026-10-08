import { GitBranch, Tag } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GitCommit, GitLogResult } from "../../../../shared/ipc";
import { useT } from "../../../hooks/useT";
import { gitService } from "../../../services/gitService";
import styles from "./GitGraphPanel.module.css";
import { layoutGitGraph, maxLaneCount } from "./gitGraphLayout";

const ROW_H = 26;
const LANE_W = 14;
const DOT_R = 4;
const PAD_Y = ROW_H / 2;
const LANE_COLORS = 6;

function laneVar(lane: number): string {
  return `var(--graph-lane-${((lane % LANE_COLORS) + LANE_COLORS) % LANE_COLORS})`;
}

/** 作者名 → 0..LANE_COLORS-1，用于头像底色（与泳道同色板，不写死色值）。 */
function avatarLane(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % LANE_COLORS;
}

function formatTime(unix: number): string {
  if (!unix) return "";
  const d = new Date(unix * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 单行图谱格：竖线贯穿 + 跨泳道贝塞尔 + 实心点 / merge 空心点。
 * 连线画到行底，由下一行同泳道竖线接续（对齐 VS Code git graph 观感）。
 */
function GraphCell({
  lane,
  activeLanes,
  parentLinks,
  laneCount,
  isMerge,
}: {
  lane: number;
  activeLanes: number[];
  parentLinks: { lane: number; fromLane: number }[];
  laneCount: number;
  isMerge: boolean;
}) {
  const width = Math.max(laneCount, 1) * LANE_W;
  const cx = (col: number) => col * LANE_W + LANE_W / 2;

  return (
    <svg
      className={styles.graphCell}
      width={width}
      height={ROW_H}
      viewBox={`0 0 ${width} ${ROW_H}`}
      aria-hidden="true"
    >
      {activeLanes.map((col) => (
        <line
          key={`v-${col}`}
          x1={cx(col)}
          y1={0}
          x2={cx(col)}
          y2={ROW_H}
          stroke={laneVar(col)}
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      ))}
      {parentLinks
        .filter((link) => link.fromLane !== link.lane)
        .map((link) => {
          const x1 = cx(link.fromLane);
          const x2 = cx(link.lane);
          // 从提交点中心平滑落到目标泳道行底，下一行竖线衔接
          const d = `M ${x1} ${PAD_Y} C ${x1} ${PAD_Y + 8}, ${x2} ${PAD_Y - 8}, ${x2} ${ROW_H}`;
          return (
            <path
              key={`p-${link.fromLane}-${link.lane}`}
              d={d}
              fill="none"
              stroke={laneVar(link.lane)}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          );
        })}
      {isMerge ? (
        <circle
          className={styles.dotMerge}
          cx={cx(lane)}
          cy={PAD_Y}
          r={DOT_R + 0.5}
          stroke={laneVar(lane)}
        />
      ) : (
        <circle className={styles.dot} cx={cx(lane)} cy={PAD_Y} r={DOT_R} fill={laneVar(lane)} />
      )}
    </svg>
  );
}

/** 行内分支徽标；当前分支 tip 用 ↑ 前缀（对齐参考图 ↑main）。 */
function RefChips({ commit }: { commit: GitCommit }) {
  if (commit.refs.length === 0) return null;
  // 当前分支优先作 HEAD 徽标；无装饰名时退回首个本地分支
  const headRef =
    commit.refs.find((ref) => commit.isCurrentBranchTip && !ref.includes("/")) ??
    (commit.isHead ? (commit.refs.find((ref) => !ref.includes("/")) ?? commit.refs[0]) : undefined);
  const others = commit.refs.filter((ref) => ref !== headRef);
  return (
    <>
      {headRef !== undefined && (
        <span
          className={[styles.refChip, commit.isCurrentBranchTip ? styles.refChipHead : ""].join(
            " ",
          )}
          title={headRef}
        >
          {commit.isCurrentBranchTip && (
            <span aria-hidden="true" className={styles.refChipArrow}>
              ↑
            </span>
          )}
          {headRef}
        </span>
      )}
      {others.map((ref) => (
        <span key={ref} className={styles.refChip} title={ref}>
          <GitBranch size={10} weight="regular" className={styles.refChipIcon} />
          {ref}
        </span>
      ))}
    </>
  );
}

/** 头像：登录 + GitHub remote 时主进程已给 data URL；否则用户名首字母色块。 */
function Avatar({ name, avatarDataUrl }: { name: string; avatarDataUrl: string | null }) {
  const trimmed = name.trim();
  const initial = trimmed ? [...trimmed][0].toUpperCase() : "?";
  const lane = avatarLane(trimmed || "?");

  if (avatarDataUrl) {
    return (
      <span className={styles.avatar} title={trimmed} aria-hidden="true">
        <img src={avatarDataUrl} alt="" width={18} height={18} draggable={false} />
      </span>
    );
  }

  return (
    <span
      className={styles.avatar}
      style={{ background: laneVar(lane) }}
      aria-hidden="true"
      title={trimmed}
    >
      {initial}
    </span>
  );
}

interface Props {
  cwd: string | null;
  /** 外部「刷新」递增时重新拉取。 */
  refreshSeq?: number;
}

/** 只读 Git 图谱：单行紧凑提交流 + 泳道连线；点击行展开完整 OID/时间。 */
export function GitGraphPanel({ cwd, refreshSeq = 0 }: Props) {
  const t = useT();
  const [data, setData] = useState<GitLogResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedOid, setExpandedOid] = useState<string | null>(null);
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    if (!cwd) {
      setData(null);
      setError(null);
      return;
    }
    seqRef.current += 1;
    const seq = seqRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await gitService.log({ cwd, maxCount: 200 });
      if (seqRef.current !== seq) return;
      setData(result);
    } catch (err) {
      if (seqRef.current !== seq) return;
      setError(err instanceof Error ? err.message : t("context.graph.readFailed"));
      setData(null);
    } finally {
      if (seqRef.current === seq) setLoading(false);
    }
  }, [cwd, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // 外部「刷新」：仅在 refreshSeq 真正递增时重拉，避免与 load 变化重复触发
  const lastRefreshSeq = useRef(refreshSeq);
  useEffect(() => {
    if (lastRefreshSeq.current === refreshSeq) return;
    lastRefreshSeq.current = refreshSeq;
    void load();
  }, [refreshSeq, load]);

  const rows = useMemo(() => (data?.commits ? layoutGitGraph(data.commits) : []), [data]);
  const laneCount = useMemo(() => maxLaneCount(rows), [rows]);

  if (!cwd) {
    return <p className={styles.truncNote}>{t("context.graph.noProject")}</p>;
  }
  if (loading && !data) {
    return <p className={styles.truncNote}>{t("context.graph.loading")}</p>;
  }
  if (error) {
    return <p className={styles.truncNote}>{error}</p>;
  }
  if (!data?.repoRoot) {
    return <p className={styles.truncNote}>{t("context.graph.notRepo")}</p>;
  }
  if (rows.length === 0) {
    return <p className={styles.truncNote}>{t("context.graph.empty")}</p>;
  }

  return (
    <div className={styles.scroll}>
      <ul className={styles.list}>
        {rows.map((row) => {
          const expanded = expandedOid === row.commit.oid;
          const isMerge = row.commit.parentOids.length >= 2;
          return (
            <li key={row.commit.oid}>
              <button
                type="button"
                className={[styles.row, expanded ? styles.rowExpanded : ""].join(" ")}
                onClick={() => setExpandedOid(expanded ? null : row.commit.oid)}
                aria-expanded={expanded}
                title={`${row.commit.subject}\n${row.commit.authorName} · ${formatTime(row.commit.authorTime)}\n${row.commit.oid}`}
              >
                <GraphCell
                  lane={row.lane}
                  activeLanes={row.activeLanes}
                  parentLinks={row.parentLinks}
                  laneCount={Math.max(laneCount, 1)}
                  isMerge={isMerge}
                />
                <span className={styles.subject}>
                  {row.commit.subject || t("context.graph.untitled")}
                </span>
                <span className={styles.chips}>
                  <RefChips commit={row.commit} />
                </span>
                {/* 作者名不再重复展示：头像已承载，悬停 title 与展开详情里有全名 */}
                <Avatar name={row.commit.authorName} avatarDataUrl={row.commit.avatarDataUrl} />
              </button>
              {expanded && (
                <div className={styles.detail}>
                  <span className={styles.detailStrong}>
                    {row.commit.subject || t("context.graph.untitled")}
                  </span>
                  <span>
                    {row.commit.authorName} · {formatTime(row.commit.authorTime)}
                  </span>
                  <span
                    className={styles.detailStrong}
                    style={{ fontFamily: "var(--font-family-mono)" }}
                  >
                    {row.commit.oid}
                  </span>
                  <span>
                    {row.commit.parentOids.length === 0
                      ? t("context.graph.rootCommit")
                      : t("context.graph.parentCommits", { count: row.commit.parentOids.length })}
                    {row.commit.refs.length > 0 && (
                      <>
                        {" · "}
                        <Tag size={10} weight="regular" style={{ verticalAlign: -1 }} />{" "}
                        {row.commit.refs.join(", ")}
                      </>
                    )}
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {data.truncated && (
        <p className={styles.truncNote}>
          {t("context.graph.truncated", { count: data.commits.length })}
        </p>
      )}
    </div>
  );
}
