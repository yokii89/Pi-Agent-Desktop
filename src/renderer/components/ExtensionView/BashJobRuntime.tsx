import { ArrowClockwise, ArrowSquareOut, Copy } from "@phosphor-icons/react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import type { ViewBashJob } from "../../../shared/view";
import { useT } from "../../hooks/useT";
import { bashWorkspaceService } from "../../services/bashWorkspaceService";
import { formatElapsed } from "../../utils/time";
import { IconButton } from "../ui/IconButton";
import styles from "./BashJobInspector.module.css";
import {
  formatRuntimeBytes,
  formatRuntimeCpu,
  formatRuntimeEndpoint,
  runtimeMemoryPoints,
  runtimePortOwner,
  runtimeProcessRows,
} from "./bashRuntimeData";
import { createRuntimeSampler } from "./bashRuntimePolling";

/** Read-only OS samples supplement the job lifecycle without inferring its exit code. */
export function BashJobRuntime({ viewId, job }: { viewId: string; job: ViewBashJob }) {
  const t = useT();
  const rootRef = useRef<HTMLElement>(null);
  const [sampler] = useState(() =>
    createRuntimeSampler((owner, id) => bashWorkspaceService.inspect(owner, id)),
  );
  const [snapshot, setSnapshot] = useState(sampler.getState);
  const [notice, setNotice] = useState<{ key: string; text: string } | null>(null);
  const key = JSON.stringify([viewId, job.id]);
  const current = snapshot.key === key;
  const detail = current ? snapshot.value : null;
  const error = current ? snapshot.error : null;
  const rows = useMemo(
    () => (detail ? runtimeProcessRows(detail.root, detail.descendants) : []),
    [detail],
  );

  useEffect(() => {
    sampler.subscribe(setSnapshot);
    const element = rootRef.current;
    let intersecting = false;
    const sync = (): void => {
      sampler.setActive(
        intersecting &&
          document.visibilityState === "visible" &&
          element !== null &&
          getComputedStyle(element).visibility !== "hidden",
      );
    };
    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry?.isIntersecting === true;
      sync();
    });
    if (element) observer.observe(element);
    document.addEventListener("visibilitychange", sync);
    return () => {
      sampler.subscribe(null);
      sampler.setActive(false);
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [sampler]);

  useEffect(() => {
    sampler.select(viewId, job.id);
  }, [sampler, viewId, job.id]);

  const copy = async (value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice({ key, text: t("bashWorkspace.runtime.copied") });
    } catch (reason) {
      setNotice({
        key,
        text: t("bashWorkspace.runtime.actionFailed", { message: String(reason) }),
      });
    }
  };
  const tryOpen = async (port: number): Promise<void> => {
    try {
      if (!window.pidesk) throw new Error(t("bashWorkspace.runtime.openUnavailable"));
      await window.pidesk.window.openExternal(`http://localhost:${port}`);
    } catch (reason) {
      setNotice({
        key,
        text: t("bashWorkspace.runtime.actionFailed", { message: String(reason) }),
      });
    }
  };
  const refreshing = current && snapshot.loading;

  return (
    <section ref={rootRef} className={styles.inspector} data-selectable-text="">
      <div className={styles.sectionHead}>
        <h3>{t("bashWorkspace.runtime.title")}</h3>
        <IconButton
          title={t("bashWorkspace.runtime.refresh")}
          disabled={!current || !snapshot.active || refreshing}
          onClick={() => sampler.refresh()}
        >
          <ArrowClockwise size={16} weight="regular" />
        </IconButton>
      </div>
      <p className={styles.note}>{t("bashWorkspace.runtime.scopeNote")}</p>
      {error ? (
        <div className={styles.error} role="alert">
          <span>{t("bashWorkspace.runtime.failed", { message: error })}</span>
          <button
            type="button"
            className={styles.textButton}
            disabled={refreshing || !snapshot.active}
            onClick={() => sampler.refresh()}
          >
            {t("bashWorkspace.runtime.retry")}
          </button>
        </div>
      ) : null}
      {!detail && !error ? (
        <p className={styles.note} role="status">
          {t("bashWorkspace.runtime.loading")}
        </p>
      ) : null}
      {detail ? (
        <div aria-busy={refreshing}>
          <p className={styles.note} role="status">
            {t(detail.alive ? "bashWorkspace.runtime.hostAlive" : "bashWorkspace.runtime.hostGone")}
          </p>
          <dl className={styles.metaGrid}>
            <div>
              <dt>{t("bashWorkspace.runtime.pid")}</dt>
              <dd>{detail.root?.pid ?? "—"}</dd>
            </div>
            <div>
              <dt>{t("bashWorkspace.runtime.ppid")}</dt>
              <dd>{detail.root?.ppid ?? "—"}</dd>
            </div>
            <div>
              <dt>{t("bashWorkspace.runtime.image")}</dt>
              <dd>{detail.root?.name || "—"}</dd>
            </div>
            <div>
              <dt>{t("bashWorkspace.runtime.processCount")}</dt>
              <dd>{detail.processCount}</dd>
            </div>
            <div>
              <dt>{t("bashWorkspace.runtime.cpu")}</dt>
              <dd>{formatRuntimeCpu(detail.cpuPercent)}</dd>
            </div>
            <div>
              <dt>{t("bashWorkspace.runtime.memory")}</dt>
              <dd className={styles.memory}>
                {formatRuntimeBytes(detail.memoryBytes)}
                {snapshot.memory.length >= 2 ? (
                  <svg className={styles.spark} viewBox="0 0 80 24" role="img">
                    <title>{t("bashWorkspace.runtime.memoryTrend")}</title>
                    <polyline points={runtimeMemoryPoints(snapshot.memory)} />
                  </svg>
                ) : null}
              </dd>
            </div>
          </dl>
          <p className={styles.note}>
            {t("bashWorkspace.runtime.sampledAt", { time: new Date(detail.at).toLocaleString() })}
            {error ? ` · ${t("bashWorkspace.runtime.stale")}` : ""}
          </p>
          {!detail.root && detail.alive ? (
            <p className={styles.note}>{t("bashWorkspace.runtime.rootUnavailable")}</p>
          ) : null}
          <h4 className={styles.subTitle}>{t("bashWorkspace.runtime.processTree")}</h4>
          {rows.length > 0 ? (
            <div className={styles.tableScroll}>
              <table className={styles.processTable}>
                <thead>
                  <tr>
                    <th scope="col">{t("bashWorkspace.runtime.process")}</th>
                    <th scope="col">{t("bashWorkspace.runtime.pid")}</th>
                    <th scope="col">{t("bashWorkspace.runtime.cpu")}</th>
                    <th scope="col">{t("bashWorkspace.runtime.memory")}</th>
                    <th scope="col">{t("bashWorkspace.runtime.elapsed")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ process, depth }) => (
                    <tr key={process.pid}>
                      <th scope="row" title={process.commandLine || process.name}>
                        <span
                          className={styles.processName}
                          style={{ "--process-depth": Math.min(depth, 12) } as CSSProperties}
                        >
                          {process.name || `#${process.pid}`}
                        </span>
                      </th>
                      <td>{process.pid}</td>
                      <td>{formatRuntimeCpu(process.cpuPercent)}</td>
                      <td>{formatRuntimeBytes(process.workingSet)}</td>
                      <td>
                        {process.startedAt > 0 && process.startedAt <= detail.at
                          ? formatElapsed(detail.at - process.startedAt)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.note}>{t("bashWorkspace.runtime.noProcesses")}</p>
          )}
          <h4 className={styles.subTitle}>{t("bashWorkspace.runtime.ports")}</h4>
          {!detail.portsReadable ? (
            <p className={styles.note}>{t("bashWorkspace.runtime.portsUnavailable")}</p>
          ) : detail.ports.length === 0 ? (
            <p className={styles.note}>{t("bashWorkspace.runtime.noPorts")}</p>
          ) : (
            <>
              <p className={styles.note}>{t("bashWorkspace.runtime.httpHint")}</p>
              <ul className={styles.portList}>
                {detail.ports.map((port) => {
                  const address = formatRuntimeEndpoint(port.localAddress, port.localPort);
                  const listening = /^listen/i.test(port.state);
                  return (
                    <li
                      className={styles.port}
                      key={`${port.pid}:${address}:${port.state}:${port.remoteAddress}:${port.remotePort}`}
                    >
                      <div className={styles.portInfo}>
                        <div className={styles.portLine}>
                          <code>{address}</code>
                          <span className={styles.portState}>{port.state}</span>
                        </div>
                        {port.remoteAddress !== null && port.remotePort !== null ? (
                          <div className={styles.note}>
                            {t("bashWorkspace.runtime.remote", {
                              address: formatRuntimeEndpoint(port.remoteAddress, port.remotePort),
                            })}
                          </div>
                        ) : null}
                        <div className={styles.note}>
                          {t("bashWorkspace.runtime.owner", {
                            owner: runtimePortOwner(port.pid, detail.root, detail.descendants),
                          })}
                        </div>
                      </div>
                      <div className={styles.actions}>
                        <IconButton
                          title={t("bashWorkspace.runtime.copyAddress")}
                          onClick={() => void copy(address)}
                        >
                          <Copy size={16} weight="regular" />
                        </IconButton>
                        {listening ? (
                          <IconButton
                            title={t("bashWorkspace.runtime.tryHttp", { port: port.localPort })}
                            onClick={() => void tryOpen(port.localPort)}
                          >
                            <ArrowSquareOut size={16} weight="regular" />
                          </IconButton>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      ) : null}
      {notice?.key === key ? (
        <p className={styles.note} role="status">
          {notice.text}
        </p>
      ) : null}
    </section>
  );
}
