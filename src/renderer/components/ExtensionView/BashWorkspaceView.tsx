import {
  ArrowLeft,
  ArrowRight,
  ArrowsIn,
  ArrowsOut,
  Check,
  CheckCircle,
  CircleNotch,
  Copy,
  DownloadSimple,
  Info,
  FolderOpen,
  LinkBreak,
  ListBullets,
  LockSimple,
  MagnifyingGlass,
  Pause,
  Stop,
  TerminalWindow,
  TextAlignLeft,
  XCircle,
} from "@phosphor-icons/react";
import { type Ref, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type {
  ViewBashJob,
  ViewBashWorkspaceNode,
  ViewBashWorkspaceValue,
} from "../../../shared/view";
import { useT } from "../../hooks/useT";
import { bashWorkspaceService } from "../../services/bashWorkspaceService";
import { Button } from "../ui/Button";
import { FloatingWindow } from "../ui/FloatingWindow";
import { IconButton } from "../ui/IconButton";
import { Modal } from "../ui/Modal";
import { Segmented } from "../ui/Segmented";
import { BashJobDetails } from "./BashJobDetails";
import { BashJobLog } from "./BashJobLog";
import styles from "./BashWorkspace.module.css";
import {
  type BashJobState,
  type BashWorkspaceMemory,
  bashBytes,
  bashControlValue,
  bashDuration,
  bashJobSeconds,
  bashJobState,
  bashReading,
  createBashWorkspaceMemory,
} from "./bashWorkspaceState";
import type { ViewFormBridge } from "./ViewNodeRenderer";

function StateIcon({ state }: { state: BashJobState }) {
  if (state === "running") return <CircleNotch size={16} weight="regular" />;
  if (state === "failed") return <XCircle size={16} weight="regular" />;
  if (state === "killed") return <Stop size={16} weight="regular" />;
  if (state === "orphaned") return <LinkBreak size={16} weight="regular" />;
  return <Check size={16} weight="regular" />;
}

/** The extension owns execution and selection; the Host owns layout and reading preferences. */
export function BashWorkspaceView({
  node,
  viewId,
  bridge,
  memory: sharedMemory,
  floating,
  onToggleFloating,
  contentRef,
}: {
  node: ViewBashWorkspaceNode;
  viewId?: string;
  bridge: ViewFormBridge;
  memory?: BashWorkspaceMemory;
  floating?: boolean;
  onToggleFloating?: () => void;
  contentRef?: Ref<HTMLDivElement>;
}) {
  const t = useT();
  const tabsId = useId();
  const [localMemory] = useState(createBashWorkspaceMemory);
  const memory = sharedMemory ?? localMemory;
  const [localFloating, setLocalFloating] = useState(false);
  const expanded = floating ?? localFloating;
  const toggleFloating = onToggleFloating ?? (() => setLocalFloating((value) => !value));
  const [, refresh] = useState(0);
  const [query, setQuery] = useState(node.value.query);
  const [notice, setNotice] = useState("");
  const [openingLog, setOpeningLog] = useState(false);
  const [confirm, setConfirm] = useState<{ id: string; command: string; actionId: string } | null>(
    null,
  );
  const cancelRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const value = bashControlValue(bridge.values[node.id], node.value);
  const job = node.jobs.find((item) => item.id === value.selectedId);
  const ready = job !== undefined && job.id === node.outputJobId;
  const reading = job ? bashReading(memory, job.id) : undefined;
  const stopping = job !== undefined && node.stoppingJobId === job.id;
  const canStop =
    ready &&
    (job.status === "running" ||
      (job.status === "orphaned" && job.processState === "alive")) &&
    !stopping &&
    Boolean(node.stopActionId) &&
    bridge.actions?.some((action) => action.id === node.stopActionId && !action.disabled) === true;
  const update = (patch: Partial<ViewBashWorkspaceValue>): void =>
    bridge.onChange(node.id, { ...value, query, ...patch });
  useEffect(() => {
    setQuery(node.value.query);
  }, [node.value.query]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: selection and floating transitions must reveal the new DOM row, even when the ref object is stable
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const reveal = (): void => {
      list
        .querySelector<HTMLElement>('[aria-pressed="true"]')
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(list);
    return () => observer.disconnect();
  }, [job?.id, expanded]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 2600);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (confirm && (!canStop || job?.id !== confirm.id || node.stopActionId !== confirm.actionId))
      setConfirm(null);
  }, [canStop, job?.id, node.stopActionId, confirm]);

  const label = (item: ViewBashJob): string =>
    item.status === "orphaned" && item.processState
      ? t(`bashWorkspace.restored.${item.processState}`)
      : t(`bashWorkspace.${bashJobState(item)}`);
  const openSavedLog = async (): Promise<void> => {
    if (!viewId || !job?.logAvailable || openingLog) return;
    setOpeningLog(true);
    try {
      await bashWorkspaceService.openLog(viewId, job.id);
    } catch {
      setNotice(t("bashWorkspace.openLogFailed"));
    } finally {
      setOpeningLog(false);
    }
  };
  const copy = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(t("bashWorkspace.copied"));
    } catch {
      setNotice(t("bashWorkspace.copyFailed"));
    }
  };
  const exportOutput = (): void => {
    if (!ready || !job) return;
    const blob = new Blob(
      [`# ${job.id}\n# ${job.command}\n# cursor: ${node.cursor}\n\n`, node.output],
      { type: "text/plain;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = `pibash-${job.id.replace(/[^a-zA-Z0-9_-]/g, "_")}.log`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const filters: { value: ViewBashWorkspaceValue["filter"]; label: string }[] = [
    { value: "all", label: `${t("bashWorkspace.all")} ${node.counts.total}` },
    { value: "running", label: `${t("bashWorkspace.running")} ${node.counts.running}` },
    { value: "ended", label: `${t("bashWorkspace.ended")} ${node.counts.ended}` },
    { value: "orphaned", label: `${t("bashWorkspace.orphaned")} ${node.counts.orphaned}` },
  ];
  const content = (
    <div
      ref={contentRef}
      className={styles.workspace}
      data-bash-workspace={node.id}
      data-selectable-text=""
    >
      <header className={styles.workspaceHeading}>
        <div className={styles.headingCopy}>
          <TerminalWindow size={16} weight="regular" />
          <h2 title={t("bashWorkspace.description")}>{t("bashWorkspace.title")}</h2>
          <span className={styles.jobCount}>
            {t("bashWorkspace.total", { count: node.counts.total })}
          </span>
        </div>
        <IconButton
          title={t(expanded ? "bashWorkspace.collapse" : "bashWorkspace.expand")}
          onClick={toggleFloating}
        >
          {expanded ? (
            <ArrowsIn size={16} weight="regular" />
          ) : (
            <ArrowsOut size={16} weight="regular" />
          )}
        </IconButton>
      </header>
      <div className={styles.panes}>
        <aside className={styles.jobsPane} aria-label={t("bashWorkspace.session")}>
          <div className={styles.jobsHeader}>
            <div className={styles.sectionLabel}>
              <TerminalWindow size={16} weight="regular" />
              <strong>{t("bashWorkspace.session")}</strong>
              <span>{t("bashWorkspace.total", { count: node.counts.total })}</span>
            </div>
            <label className={styles.searchBox}>
              <MagnifyingGlass size={16} weight="regular" />
              <input
                type="search"
                aria-label={t("bashWorkspace.search")}
                placeholder={t("bashWorkspace.search")}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  update({ query: event.target.value, page: 0, selectedId: undefined });
                }}
              />
            </label>
            <Segmented
              value={value.filter}
              items={filters}
              ariaLabel={t("bashWorkspace.filters")}
              semantics="toggle"
              size="sm"
              equal={false}
              scrollable
              onChange={(filter) => update({ filter, page: 0, selectedId: undefined })}
              className={styles.filters}
            />
          </div>
          <div ref={listRef} className={styles.jobList}>
            {node.jobs.length === 0 ? (
              <div className={styles.empty}>
                <MagnifyingGlass size={24} weight="regular" />
                <strong>
                  {t(node.counts.total ? "bashWorkspace.noJobMatches" : "bashWorkspace.noJobs")}
                </strong>
                <span>
                  {t(node.counts.total ? "bashWorkspace.searchHint" : "bashWorkspace.noJobsHint")}
                </span>
              </div>
            ) : (
              node.jobs.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={styles.job}
                  data-state={bashJobState(item)}
                  title={item.command}
                  aria-pressed={item.id === job?.id}
                  onClick={() => update({ selectedId: item.id })}
                >
                  <span className={styles.jobFirst}>
                    <span className={styles.stateIcon}>
                      <StateIcon state={bashJobState(item)} />
                    </span>
                    <strong title={item.label || item.command}>{item.label || item.command}</strong>
                    <span className={styles.jobDuration}>
                      {item.status === "orphaned"
                        ? t("bashWorkspace.readOnly")
                        : bashDuration(bashJobSeconds(item, Date.now()))}
                    </span>
                  </span>
                  {item.label && item.label !== item.command ? (
                    <code className={styles.jobCommand} title={item.command}>
                      {item.command}
                    </code>
                  ) : null}
                  <span className={styles.jobMeta}>
                    <span className={styles.stateLabel}>{label(item)}</span>
                    <code>{item.mode}</code>
                    <span className={styles.jobId} title={item.id}>
                      {item.id}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
          {node.pageCount > 1 ? (
            <nav className={styles.pagination} aria-label={t("bashWorkspace.session")}>
              <IconButton
                title={t("bashWorkspace.previous")}
                disabled={value.page === 0}
                onClick={() => update({ page: value.page - 1, selectedId: undefined })}
              >
                <ArrowLeft size={16} weight="regular" />
              </IconButton>
              <span>
                {t("bashWorkspace.page", {
                  page: value.page + 1,
                  pages: node.pageCount,
                  count: node.matchedJobs,
                })}
              </span>
              <IconButton
                title={t("bashWorkspace.next")}
                disabled={value.page >= node.pageCount - 1}
                onClick={() => update({ page: value.page + 1, selectedId: undefined })}
              >
                <ArrowRight size={16} weight="regular" />
              </IconButton>
            </nav>
          ) : null}
          <div className={styles.jobsFooter}>
            <Info size={16} weight="regular" />
            <span>{t("bashWorkspace.silenceHint")}</span>
          </div>
        </aside>
        <section className={styles.detailPane} aria-label={t("bashWorkspace.details")}>
          {!job || !reading ? (
            <div className={styles.empty}>
              <TerminalWindow size={24} weight="regular" />
              <strong>
                {t(node.counts.total ? "bashWorkspace.noJobMatches" : "bashWorkspace.noJobs")}
              </strong>
              <span>
                {t(node.counts.total ? "bashWorkspace.searchHint" : "bashWorkspace.noJobsHint")}
              </span>
            </div>
          ) : (
            <>
              <header className={styles.detailHeader}>
                <div className={styles.detailTitleRow}>
                  <div className={styles.terminalMark}>
                    <TerminalWindow size={20} weight="regular" />
                  </div>
                  <div className={styles.titleBlock}>
                    <div className={styles.detailTitle}>
                      <h3 title={job.label || job.command}>{job.label || job.command}</h3>
                      <span className={styles.statusPill} data-state={bashJobState(job)}>
                        <StateIcon state={bashJobState(job)} />
                        {label(job)}
                      </span>
                    </div>
                    <div className={styles.detailSubtitle}>
                      <code>{job.id}</code>
                      <span>/</span>
                      <code>{job.mode}</code>
                      <span>/</span>
                      <span>
                        {t(
                          job.status === "orphaned"
                            ? "bashWorkspace.restored"
                            : job.detached
                              ? "bashWorkspace.detached"
                              : "bashWorkspace.foreground",
                        )}
                      </span>
                    </div>
                  </div>
                  {canStop || stopping ? (
                    <Button
                      className={styles.stopButton}
                      disabled={stopping}
                      onClick={() => {
                        if (canStop && node.stopActionId)
                          setConfirm({
                            id: job.id,
                            command: job.command,
                            actionId: node.stopActionId,
                          });
                      }}
                    >
                      {stopping ? (
                        <Pause size={16} weight="regular" />
                      ) : (
                        <Stop size={16} weight="regular" />
                      )}
                      {t(stopping ? "bashWorkspace.stopping" : "bashWorkspace.stop")}
                    </Button>
                  ) : null}
                </div>
                <div className={styles.commandBar}>
                  <code>{job.command}</code>
                  <IconButton
                    title={t("bashWorkspace.copyCommand")}
                    onClick={() => void copy(job.command)}
                  >
                    <Copy size={16} weight="regular" />
                  </IconButton>
                </div>
                <dl className={styles.metrics}>
                  <div>
                    <dt>
                      {t(
                        job.status === "orphaned"
                          ? "bashWorkspace.lastDuration"
                          : "bashWorkspace.duration",
                      )}
                    </dt>
                    <dd>{bashDuration(bashJobSeconds(job, Date.now()))}</dd>
                  </div>
                  <div>
                    <dt>{t("bashWorkspace.lastOutput")}</dt>
                    <dd
                      className={
                        job.status === "running" && Date.now() - job.lastOutputAt >= 300_000
                          ? styles.idle
                          : ""
                      }
                    >
                      {Date.now() - job.lastOutputAt < 3000
                        ? t("bashWorkspace.justNow")
                        : t("bashWorkspace.ago", {
                            duration: bashDuration((Date.now() - job.lastOutputAt) / 1000),
                          })}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("bashWorkspace.retained")}</dt>
                    <dd>
                      {t("bashWorkspace.lines", { count: job.outputLines })} ·{" "}
                      {bashBytes(job.outputBytes)}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("bashWorkspace.exitCode")}</dt>
                    <dd data-state={bashJobState(job)}>
                      {job.status === "orphaned" ? "—" : (job.exitCode ?? "—")}
                    </dd>
                  </div>
                </dl>
              </header>
              <div className={styles.tabsRow}>
                <Segmented
                  value={memory.tab}
                  items={[
                    {
                      value: "output",
                      label: t("bashWorkspace.output"),
                      icon: <ListBullets size={16} weight="regular" />,
                      ariaControls: `${tabsId}-output`,
                    },
                    {
                      value: "details",
                      label: t("bashWorkspace.details"),
                      icon: <Info size={16} weight="regular" />,
                      ariaControls: `${tabsId}-details`,
                    },
                  ]}
                  semantics="tab"
                  ariaLabel={t("bashWorkspace.tabs")}
                  equal={false}
                  scrollable
                  size="sm"
                  onChange={(tab) => {
                    memory.tab = tab;
                    refresh((revision) => revision + 1);
                  }}
                  className={styles.tabs}
                />
                {memory.tab === "output" ? (
                  <div className={styles.logTools}>
                    {viewId && job.logAvailable ? (
                      <IconButton
                        title={t("bashWorkspace.openSavedLog")}
                        disabled={openingLog}
                        onClick={() => void openSavedLog()}
                      >
                        <FolderOpen size={16} weight="regular" />
                      </IconButton>
                    ) : null}
                    <IconButton
                      title={t("bashWorkspace.wrap")}
                      active={reading.wrap}
                      aria-pressed={reading.wrap}
                      onClick={() => {
                        reading.wrap = !reading.wrap;
                        refresh((revision) => revision + 1);
                      }}
                    >
                      <TextAlignLeft size={16} weight="regular" />
                    </IconButton>
                    <IconButton
                      title={t("bashWorkspace.copyLog")}
                      disabled={!ready}
                      onClick={() => void copy(node.output)}
                    >
                      <Copy size={16} weight="regular" />
                    </IconButton>
                    <IconButton
                      title={t("bashWorkspace.exportLog")}
                      disabled={!ready}
                      onClick={exportOutput}
                    >
                      <DownloadSimple size={16} weight="regular" />
                    </IconButton>
                  </div>
                ) : null}
              </div>
              <div
                className={styles.tabPanel}
                role="tabpanel"
                id={`${tabsId}-${memory.tab}`}
                aria-label={t(
                  memory.tab === "output" ? "bashWorkspace.output" : "bashWorkspace.details",
                )}
              >
                {memory.tab === "output" ? (
                  <BashJobLog key={job.id} node={node} job={job} ready={ready} reading={reading} />
                ) : (
                  <BashJobDetails
                    job={job}
                    node={node}
                    viewId={viewId}
                    onRevealSource={expanded ? toggleFloating : undefined}
                  />
                )}
              </div>
              <footer className={styles.logStatus}>
                <span className={styles.streamStatus}>
                  {job.status === "running" ? (
                    <i />
                  ) : job.status === "orphaned" ? (
                    <LockSimple size={16} weight="regular" />
                  ) : (
                    <CheckCircle size={16} weight="regular" />
                  )}
                  {t(
                    job.status === "running"
                      ? "bashWorkspace.live"
                      : job.status === "orphaned"
                        ? "bashWorkspace.snapshot"
                        : "bashWorkspace.outputEnded",
                  )}
                </span>
                {ready && node.partial ? <span>· {t("bashWorkspace.partial")}</span> : null}
                <span className={styles.statusRight}>
                  <span>{t("bashWorkspace.readOnly")}</span>
                  <code>cursor {ready ? node.cursor : "—"}</code>
                </span>
              </footer>
            </>
          )}
        </section>
      </div>
      {node.notice || notice ? (
        <p className={styles.panelNotice} role="status">
          {notice || node.notice}
        </p>
      ) : null}
    </div>
  );
  const modal = (
    <Modal
      open={confirm !== null}
      onClose={() => setConfirm(null)}
      ariaLabel={t("bashWorkspace.stopTitle")}
      initialFocusRef={cancelRef}
      panelClassName={styles.confirmPanel}
      priority
    >
      <div className={styles.confirmIcon}>
        <Stop size={24} weight="regular" />
      </div>
      <h2>{t("bashWorkspace.stopTitle")}</h2>
      <p>{t("bashWorkspace.stopDescription")}</p>
      <pre data-selectable-text="">
        {confirm?.id} · {confirm?.command}
      </pre>
      <div className={styles.confirmActions}>
        <Button ref={cancelRef} onClick={() => setConfirm(null)}>
          {t("bashWorkspace.stopCancel")}
        </Button>
        <Button
          variant="danger"
          disabled={!canStop}
          onClick={() => {
            if (
              confirm &&
              canStop &&
              job?.id === confirm.id &&
              node.stopActionId === confirm.actionId
            )
              bridge.onButtonAction(confirm.actionId);
            setConfirm(null);
          }}
        >
          {t("bashWorkspace.stopConfirm")}
        </Button>
      </div>
    </Modal>
  );
  return (
    <>
      {expanded ? (
        <FloatingWindow
          title={t("bashWorkspace.title")}
          icon={<TerminalWindow size={16} weight="regular" />}
          memory={memory.window}
          initialSize={{ width: 1160, height: 820 }}
          onClose={toggleFloating}
        >
          {content}
        </FloatingWindow>
      ) : (
        content
      )}
      {modal}
    </>
  );
}
