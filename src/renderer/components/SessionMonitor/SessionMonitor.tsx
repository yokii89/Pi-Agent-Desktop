import {
  Cursor,
  Folder,
  GitBranch,
  GitCommit,
  GitDiff,
  Image,
  Plugs,
  Robot,
  Sparkle,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { useOpenProcPanel } from "../../hooks/useOpenProcPanel";
import { useT } from "../../hooks/useT";
import { fsService } from "../../services/fsService";
import { useReviewStore } from "../../stores/reviewStore";
import { useSessionEntries, useSessionMeta } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { pathBasename } from "../../utils/paths";
import { formatClockTime } from "../../utils/time";
import { CommitDialog } from "../CommitDialog/CommitDialog";
import { useProcActions } from "../SessionArea/BackgroundProcs/useProcActions";
import { MonitorProcs } from "./MonitorProcs";
import { MonitorRow, MonitorSection } from "./MonitorRow";
import styles from "./SessionMonitor.module.css";
import {
  collectSources,
  editsFromWorkingTree,
  lastAssistantText,
  sessionUpdatedAt,
} from "./sessionMonitorData";
import { useMonitorCapabilities } from "./useMonitorCapabilities";
import { useMonitorEnvironment } from "./useMonitorEnvironment";

/** 技能 / MCP 行的总上限：再多的靠「还有 N 项」收口（卡片窄，且这一区只求扫一眼）。 */
const CAPABILITY_ROW_LIMIT = 6;

interface SessionMonitorProps {
  /** 卡片处于展开态：收起过程中仍挂载（要播完让位补间），但不再发新请求。 */
  active: boolean;
}

/**
 * 右侧会话监控卡（docs/design/96）：**只在右侧上下文侧栏收起时**出现在中央区右缘，
 * 接住侧栏让出的那块空间，于是文档流列宽在开/关侧栏之间不跳。
 *
 * 内容全部派生自已有 store：会话条目（摘要 / 来源）、审查域的**工作区汇总**
 * （项目全部未提交改动，不是本轮差集）、git 分支与推送、后台进程登记、
 * `get_commands` 的技能清单、mcp.json 快照。
 * 不新增 pi RPC，也不做任何持久化——恢复会话后重新派生即可。
 */
export function SessionMonitor({ active }: SessionMonitorProps) {
  const t = useT();
  const entries = useSessionEntries();
  const meta = useSessionMeta();
  const {
    summary: workingTree,
    phase: reviewPhase,
    refreshIfStale,
    setFilterMode,
  } = useReviewStore();
  const { openReviewDocked, openSidebarTab, showToast } = useUiStore();
  const procs = useProcActions(meta.activeSessionId);
  const openProcPanel = useOpenProcPanel();
  const [commitOpen, setCommitOpen] = useState(false);
  const [envReloadTick, setEnvReloadTick] = useState(0);

  const env = useMonitorEnvironment(meta.sessionWorkingDir, meta.phase, active, envReloadTick);
  const capabilities = useMonitorCapabilities({
    active,
    cwd: meta.sessionWorkingDir,
    processAlive: meta.processAlive,
    requestCommands: meta.getSlashCommands,
    entries,
  });

  const summary = useMemo(() => lastAssistantText(entries), [entries]);
  const updatedAt = useMemo(
    () => sessionUpdatedAt(meta.allSessions, meta.activeSessionFile, entries),
    [meta.allSessions, meta.activeSessionFile, entries],
  );
  // 侧栏收起时审查面板不在屏上，它的保鲜钩子不会跑；卡片出现时补一次过期刷新，
  // 让改动数跟得上审查面板之外发生的编辑。
  useEffect(() => {
    if (active && reviewPhase === "ready") refreshIfStale();
  }, [active, reviewPhase, refreshIfStale]);
  const sources = useMemo(() => collectSources(entries, 3), [entries]);

  const edits = editsFromWorkingTree(workingTree);
  // 文件数 > 0 就算有改动：二进制文件的增删行是 null（按 0 计），不能因此判成「无改动」
  const hasChanges = edits !== null;
  const openChangesReview = (): void => {
    // 卡片口径 = 工作区全部改动；筛选先对齐到「全部」，否则面板默认「未暂存」只显示其中一部分
    setFilterMode("all");
    openReviewDocked();
  };
  const openWorkingDir = (): void => {
    const dir = env.dir;
    if (!dir) return;
    void fsService.openPath(dir).catch((err: unknown) => {
      showToast(err instanceof Error ? err.message : t("sidenav.row.openFolderFailed"));
    });
  };
  const pushText =
    env.push === null
      ? null
      : env.push.ahead > 0
        ? t("monitor.env.push.ahead", { count: env.push.ahead })
        : env.push.hasUpstream
          ? t("monitor.env.push.synced")
          : t("monitor.env.push.noUpstream");
  // 调用明细：技能名 / MCP server 各占一行，次数在右缘；超出的收进一行「还有 N 项」
  const capabilityRows = useMemo(() => {
    const rows = [
      ...capabilities.usage.skills.map((skill) => {
        const details: string[] = [];
        if (skill.commands > 0) {
          details.push(t("monitor.capabilities.skillCommands", { count: skill.commands }));
        }
        if (skill.reads > 0) {
          details.push(t("monitor.capabilities.skillReads", { count: skill.reads }));
        }
        return {
          key: `skill:${skill.name}`,
          kind: "skill" as const,
          text: skill.name,
          count: skill.commands + skill.reads,
          title: details.join(t("monitor.listSeparator")),
        };
      }),
      ...capabilities.usage.mcp.map((server) => ({
        key: `mcp:${server.server}`,
        kind: "mcp" as const,
        text: server.server,
        count: server.count,
        title: server.tools.map((tool) => `${tool.tool} ×${tool.count}`).join("\n"),
      })),
    ];
    return {
      visible: rows.slice(0, CAPABILITY_ROW_LIMIT),
      hidden: rows.slice(CAPABILITY_ROW_LIMIT),
    };
  }, [capabilities.usage, t]);
  const hasCapabilities = capabilityRows.visible.length > 0;

  return (
    <>
      <aside className={styles.card} aria-label={t("monitor.aria")}>
        <div className={styles.hero}>
          <header className={styles.head}>
            <span className={styles.mark} aria-hidden="true">
              <Robot size={18} weight="fill" />
            </span>
            <div className={styles.headText}>
              <span className={styles.headTitle}>{t("monitor.title")}</span>
              {updatedAt ? (
                <span className={styles.headMeta}>
                  {t("monitor.updatedAt", { time: formatClockTime(updatedAt) })}
                </span>
              ) : null}
            </div>
          </header>

          {summary ? (
            <p className={styles.summary} title={summary}>
              {summary}
            </p>
          ) : null}
        </div>

        <div className={styles.body}>
          <MonitorSection title={t("monitor.section.env")}>
            <MonitorRow
              icon={<GitDiff size={16} weight="regular" />}
              text={
                hasChanges && edits ? (
                  <span className={styles.diffStat}>
                    <span className={styles.add}>+{edits.additions}</span>
                    <span className={styles.del}>−{edits.deletions}</span>
                  </span>
                ) : (
                  t("monitor.env.changes.none")
                )
              }
              title={
                hasChanges && edits
                  ? t("monitor.env.changes.title", {
                      files: edits.files,
                      additions: edits.additions,
                      deletions: edits.deletions,
                    })
                  : undefined
              }
              trailing={
                hasChanges && edits ? t("monitor.env.changes.files", { count: edits.files }) : null
              }
              onActivate={hasChanges ? openChangesReview : undefined}
              actionLabel={
                hasChanges && edits
                  ? t("monitor.env.changes.openReview", { count: edits.files })
                  : undefined
              }
            />
            {env.dir ? (
              <MonitorRow
                icon={<Folder size={16} weight="regular" />}
                text={pathBasename(env.dir)}
                title={env.dir}
                onActivate={openWorkingDir}
                actionLabel={t("monitor.env.dir.open", { name: pathBasename(env.dir) })}
              />
            ) : null}
            {env.branch ? (
              <MonitorRow icon={<GitBranch size={16} weight="regular" />} text={env.branch} />
            ) : null}
            {reviewPhase === "ready" ? (
              <MonitorRow
                icon={<GitCommit size={16} weight="regular" />}
                text={t("monitor.env.commit.action")}
                trailing={pushText}
                onActivate={() => setCommitOpen(true)}
                actionLabel={t("monitor.env.commit.open")}
              />
            ) : null}
          </MonitorSection>

          {procs.all.length > 0 ? (
            <MonitorSection title={t("monitor.section.procs")}>
              <MonitorProcs
                procs={procs}
                onOpen={openProcPanel}
                onOpenAll={() => openSidebarTab("procs")}
              />
            </MonitorSection>
          ) : null}

          {hasCapabilities ? (
            <MonitorSection title={t("monitor.section.capabilities")}>
              {capabilityRows.visible.map((row) => (
                <MonitorRow
                  key={row.key}
                  icon={
                    row.kind === "skill" ? (
                      <Sparkle size={16} weight="regular" />
                    ) : (
                      <Plugs size={16} weight="regular" />
                    )
                  }
                  text={row.text}
                  title={row.title || undefined}
                  trailing={t("monitor.capabilities.times", { count: row.count })}
                />
              ))}
              {capabilityRows.hidden.length > 0 ? (
                <li className={styles.moreRow}>
                  <span
                    className={`${styles.rowText} ${styles.rowTextMuted}`}
                    title={capabilityRows.hidden.map((row) => row.text).join("\n")}
                  >
                    {t("monitor.capabilities.more", { count: capabilityRows.hidden.length })}
                  </span>
                </li>
              ) : null}
            </MonitorSection>
          ) : null}

          {sources.length > 0 ? (
            <MonitorSection title={t("monitor.section.sources")}>
              {sources.map((source) => (
                <MonitorRow
                  key={source.key}
                  icon={
                    source.kind === "image" ? (
                      <Image size={16} weight="regular" />
                    ) : (
                      <Cursor size={16} weight="regular" />
                    )
                  }
                  text={source.label}
                  title={source.label}
                />
              ))}
            </MonitorSection>
          ) : null}
        </div>
      </aside>
      <CommitDialog
        open={commitOpen}
        onClose={() => setCommitOpen(false)}
        branch={env.branch}
        onRepoChange={() => setEnvReloadTick((n) => n + 1)}
      />
    </>
  );
}
