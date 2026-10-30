import { ArrowClockwise, Terminal } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ManagedProcess, ProcDetail, SessionId } from "../../../../shared/ipc";
import { useT } from "../../../hooks/useT";
import { procService } from "../../../services/procService";
import { selectProc, useSelectedProcId, useSessionProcesses } from "../../../stores/procStore";
import { useSessionEntries, useSessionMeta } from "../../../stores/sessionStore";
import type { ToolAssistantBlock } from "../../../stores/sessionTranscript";
import { orderProcesses } from "../../../utils/procRows";
import { formatAbsoluteTime, formatElapsed } from "../../../utils/time";
import { summarizeCommand, useProcActions } from "../../SessionArea/BackgroundProcs/useProcActions";
import { IconButton } from "../../ui/IconButton";
import styles from "./ProcPanel.module.css";
import {
  descendantDepth,
  findSourceToolBlock,
  formatBytes,
  formatEndpointAddress,
  formatStartTime,
  readTimeoutSeconds,
  resolveSelectedProc,
} from "./procPanelData";

/** 可见时的系统信息刷新间隔（docs/design/101）；主进程侧复用 5s 对账的进程快照。 */
const DETAIL_POLL_MS = 3000;
/** 来源调用输出在侧栏里的展示上限；完整文本仍在会话流。 */
const OUTPUT_DISPLAY_LIMIT = 20_000;

interface DetailState {
  procId: string;
  value: ProcDetail;
}

/** 详情轮询：只在进程存活时跑，切选中项/卸载即停；同一时刻最多一个请求在途。 */
function useProcDetail(sessionId: SessionId | null, proc: ManagedProcess | null, alive: boolean) {
  const [state, setState] = useState<DetailState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const procId = proc?.id ?? null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce 是手动刷新信号，effect 体不直接读它
  useEffect(() => {
    if (!sessionId || !procId || !alive) {
      setState(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    let inFlight = false;
    let timer: number | null = null;
    const load = async (initial: boolean): Promise<void> => {
      if (inFlight) return;
      inFlight = true;
      if (initial) setLoading(true);
      try {
        const value = await procService.detail({ sessionId, id: procId });
        if (cancelled) return;
        setState({ procId, value });
        setError(null);
        // alive 是详情接口给出的存活真值：已退出就不再轮询（doc 101）
        if (!value.alive && timer !== null) {
          window.clearInterval(timer);
          timer = null;
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        inFlight = false;
        if (!cancelled) setLoading(false);
      }
    };
    void load(true);
    timer = window.setInterval(() => {
      void load(false);
    }, DETAIL_POLL_MS);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
    };
  }, [sessionId, procId, alive, nonce]);

  return {
    detail: state?.procId === procId ? state.value : null,
    error,
    loading,
    refresh: (): void => setNonce((value) => value + 1),
  };
}

/**
 * 右侧栏「后台进程」页签（docs/design/101）：上方存活列表、下方详情。
 *
 * 详情 = 进程元信息 + 来源 bash 调用（command/timeout/已捕获输出/退出码）+
 * 系统信息（子进程树 / TCP 端点 / 内存）。实时 stdout 读不到（doc 37 §1.3），
 * 来源调用里只展示启动阶段捕获的那段输出。
 */
export function ProcPanel() {
  const t = useT();
  const { activeSessionId } = useSessionMeta();
  const processes = useSessionProcesses(activeSessionId);
  const { now, pendingIds, errors, stop, ignore } = useProcActions(activeSessionId);
  const selectedId = useSelectedProcId();
  const ordered = useMemo(() => orderProcesses(processes), [processes]);
  const selected = resolveSelectedProc(ordered, selectedId);
  const entries = useSessionEntries();
  const selectedAlive = selected?.status === "alive";
  const { detail, error, loading, refresh } = useProcDetail(
    activeSessionId,
    selected,
    selectedAlive,
  );

  const sourceBlockRef = useRef<{ id: string; block: ToolAssistantBlock } | null>(null);
  // 流式期间 entries 每帧都变；已经结束的来源块缓存住，避免每次都全量回扫会话条目
  const sourceBlock = useMemo(() => {
    const toolCallId = selected?.sourceToolCallId;
    if (!toolCallId) return null;
    const cached = sourceBlockRef.current;
    if (cached?.id === toolCallId && cached.block.status !== "running") return cached.block;
    const found = findSourceToolBlock(entries, toolCallId);
    sourceBlockRef.current = found ? { id: toolCallId, block: found } : null;
    return found;
  }, [entries, selected?.sourceToolCallId]);
  const terminal = sourceBlock?.result?.kind === "terminal" ? sourceBlock.result : null;
  const rawOutput = terminal?.output ?? sourceBlock?.resultText ?? "";
  const outputCapped = rawOutput.length > OUTPUT_DISPLAY_LIMIT;
  const shownOutput = outputCapped ? rawOutput.slice(0, OUTPUT_DISPLAY_LIMIT) : rawOutput;
  const timeoutSeconds = readTimeoutSeconds(sourceBlock?.args);
  const sourceRunning = sourceBlock?.status === "running" || sourceBlock?.status === "pending";
  const exitLabel = sourceRunning
    ? t("proc.panel.exitRunning")
    : terminal?.exitCode != null
      ? t("proc.panel.exitCode", { code: terminal.exitCode })
      : "—";
  // 详情接口是存活真值：登记表 push 可能滞后几秒，这里别把已死的进程继续画成运行态
  const detailDead = detail !== null && !detail.alive;
  const runtimeAlive = selectedAlive && !detailDead;
  const depths = detail && selected ? descendantDepth(selected.pid, detail.descendants) : null;
  const stopError = runtimeAlive ? (selected ? errors.get(selected.id) : null) : null;
  const selectedPending = selected ? pendingIds.has(selected.id) : false;

  if (!selected) {
    return (
      <div className={styles.empty}>
        <Terminal size={24} weight="regular" className={styles.emptyIcon} />
        <p className={styles.emptyTitle}>{t("proc.panel.empty")}</p>
        <p className={styles.muted}>{t("proc.panel.emptyHint")}</p>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {ordered.length > 0 ? (
        <section
          className={styles.listBlock}
          aria-label={t("proc.panel.listTitle", { count: ordered.length })}
        >
          <div className={styles.listHead}>
            {t("proc.panel.listTitle", { count: ordered.length })}
          </div>
          <ul className={styles.list}>
            {ordered.map((proc) => (
              <li key={proc.id}>
                <button
                  type="button"
                  className={[styles.row, selected.id === proc.id ? styles.rowSelected : ""]
                    .filter(Boolean)
                    .join(" ")}
                  title={proc.commandLine || proc.name}
                  aria-label={proc.commandLine || proc.name}
                  onClick={() => selectProc(proc.id)}
                >
                  <span
                    className={proc.status === "alive" ? styles.rowDot : styles.rowDotEnded}
                    aria-hidden="true"
                  />
                  <span className={styles.rowText}>
                    {summarizeCommand(proc.commandLine || proc.name, 28)}
                  </span>
                  <span className={styles.rowMeta}>
                    {proc.status === "alive"
                      ? formatElapsed(now - proc.startedAt)
                      : t(`proc.panel.status.${proc.status}`)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className={styles.detail}>
        {!runtimeAlive ? (
          <p className={styles.exitedBanner}>{t("proc.panel.exitedBanner")}</p>
        ) : null}

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{t("proc.panel.overview")}</h3>
          <code className={styles.command} title={selected.commandLine}>
            {selected.commandLine || selected.name}
          </code>
          <dl className={styles.metaGrid}>
            <div>
              <dt>{t("proc.panel.pid")}</dt>
              <dd>{selected.pid}</dd>
            </div>
            <div>
              <dt>{t("proc.panel.ppid")}</dt>
              <dd>{selected.ppid || "—"}</dd>
            </div>
            <div>
              <dt>{t("proc.panel.image")}</dt>
              <dd title={selected.name}>{selected.name}</dd>
            </div>
            <div>
              <dt>{t("proc.panel.statusLabel")}</dt>
              <dd>{t(`proc.panel.status.${detailDead ? "exited" : selected.status}`)}</dd>
            </div>
            <div>
              <dt>{t("proc.panel.startedAt")}</dt>
              <dd title={formatAbsoluteTime(selected.startedAt)}>
                {formatStartTime(selected.startedAt)}
              </dd>
            </div>
            <div>
              <dt>{t("proc.panel.elapsed")}</dt>
              <dd>{runtimeAlive ? formatElapsed(now - selected.startedAt) : "—"}</dd>
            </div>
          </dl>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{t("proc.panel.source")}</h3>
          {sourceBlock ? (
            <>
              <code className={styles.command}>
                {terminal?.command || sourceBlock.subject || "—"}
              </code>
              <div className={styles.sourceMeta}>
                <span className={styles.exitChip}>{exitLabel}</span>
                {timeoutSeconds !== null ? (
                  <span className={styles.exitChip}>
                    {t("proc.panel.timeout", { seconds: timeoutSeconds })}
                  </span>
                ) : null}
              </div>
              {shownOutput ? (
                <pre className={styles.output}>{shownOutput}</pre>
              ) : (
                <p className={styles.muted}>{t("proc.panel.source.empty")}</p>
              )}
              {outputCapped ? (
                <p className={styles.note}>
                  {t("proc.panel.source.capped", { chars: OUTPUT_DISPLAY_LIMIT })}
                </p>
              ) : null}
              <p className={styles.note}>{t("proc.panel.source.note")}</p>
            </>
          ) : (
            <p className={styles.muted}>{t("proc.panel.source.missing")}</p>
          )}
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h3 className={styles.sectionTitle}>{t("proc.panel.runtime")}</h3>
            {runtimeAlive ? (
              <IconButton title={t("proc.panel.refresh")} disabled={loading} onClick={refresh}>
                <ArrowClockwise
                  size={16}
                  weight="regular"
                  className={loading ? styles.spin : undefined}
                />
              </IconButton>
            ) : null}
          </div>
          {!runtimeAlive ? (
            <p className={styles.muted}>{t("proc.panel.runtime.exited")}</p>
          ) : error ? (
            <div className={styles.errorRow}>
              <span>{t("proc.panel.runtime.failed", { message: error })}</span>
              <button type="button" className={styles.retry} onClick={refresh}>
                {t("proc.panel.runtime.retry")}
              </button>
            </div>
          ) : !detail ? (
            <p className={styles.muted}>{t("proc.panel.runtime.reading")}</p>
          ) : (
            <>
              <div className={styles.stats}>
                <span>{t("proc.panel.runtime.processCount", { count: detail.processCount })}</span>
                <span>
                  {t("proc.panel.runtime.memory", { size: formatBytes(detail.memoryBytes) })}
                </span>
              </div>

              <h4 className={styles.subTitle}>{t("proc.panel.runtime.ports")}</h4>
              {detail.ports.length > 0 ? (
                <ul className={styles.ports}>
                  {detail.ports.map((port) => (
                    <li
                      key={`${port.pid}:${port.localAddress}:${port.localPort}:${port.state}:${port.remoteAddress ?? ""}:${port.remotePort ?? 0}`}
                      className={styles.port}
                      title={
                        port.remoteAddress && port.remotePort
                          ? `${formatEndpointAddress(port.localAddress, port.localPort)} → ${formatEndpointAddress(port.remoteAddress, port.remotePort)} · ${port.state}`
                          : `${formatEndpointAddress(port.localAddress, port.localPort)} · ${port.state}`
                      }
                    >
                      <span className={styles.portAddress}>
                        {formatEndpointAddress(port.localAddress, port.localPort)}
                      </span>
                      <span
                        className={styles.portState}
                        data-listen={
                          port.state.toLowerCase().startsWith("listen") ? "true" : undefined
                        }
                      >
                        {port.state}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.muted}>
                  {detail.portsReadable
                    ? t("proc.panel.runtime.noPorts")
                    : t("proc.panel.runtime.portsFailed")}
                </p>
              )}

              <h4 className={styles.subTitle}>{t("proc.panel.runtime.children")}</h4>
              {detail.descendants.length > 0 ? (
                <ul className={styles.children}>
                  {detail.descendants.map((row) => (
                    <li
                      key={row.pid}
                      className={styles.child}
                      style={{ paddingLeft: `${(depths?.get(row.pid) ?? 1) * 12}px` }}
                      title={row.commandLine}
                    >
                      <span className={styles.childName}>{row.name || `PID ${row.pid}`}</span>
                      <span className={styles.childMeta}>#{row.pid}</span>
                      <span className={styles.childCmd}>
                        {summarizeCommand(row.commandLine, 28)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.muted}>{t("proc.panel.runtime.noChildren")}</p>
              )}
            </>
          )}
        </section>

        {stopError ? <p className={styles.error}>{stopError}</p> : null}

        {runtimeAlive ? (
          <div className={styles.actions}>
            <button type="button" className={styles.ignoreBtn} onClick={() => ignore(selected)}>
              {t("proc.card.ignore")}
            </button>
            <button
              type="button"
              className={styles.stopBtn}
              disabled={selectedPending}
              onClick={() => stop(selected)}
            >
              {selectedPending ? t("proc.card.stopping") : t("proc.card.stop")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
