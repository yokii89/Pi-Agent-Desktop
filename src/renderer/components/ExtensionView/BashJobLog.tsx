import { ArrowLineDown, Info, MagnifyingGlass, Pause } from "@phosphor-icons/react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ViewBashJob, ViewBashWorkspaceNode } from "../../../shared/view";
import { useT } from "../../hooks/useT";
import styles from "./BashWorkspace.module.css";
import {
  type BashReading,
  bashHighlights,
  bashLogLines,
  bashUnreadDelta,
} from "./bashWorkspaceState";

function logTone(text: string): string {
  const line = text.trim();
  if (/^(FAIL|ERROR|Error:|AssertionError|ELIFECYCLE|❯|Received:)/.test(line))
    return styles.logError;
  if (/^(✓|Checked|Found 0|PASS)/.test(line)) return styles.logSuccess;
  if (/^(➜|VITE|vite v)/.test(line)) return styles.logAccent;
  if (/^>/.test(line)) return styles.logStrong;
  if (/WARN/.test(line)) return styles.logWarning;
  return "";
}

/** Read-only text window. Scrolling and following never send a process action. */
export function BashJobLog({
  node,
  job,
  ready,
  reading,
}: {
  node: ViewBashWorkspaceNode;
  job: ViewBashJob;
  ready: boolean;
  reading: BashReading;
}) {
  const t = useT();
  const streamRef = useRef<HTMLElement>(null);
  const programmedTop = useRef<number | null>(null);
  const [, refresh] = useState(0);
  const [query, setQuery] = useState(reading.query);
  const lines = useMemo(
    () => bashLogLines(ready ? node.output : "", node.outputStartLine, query),
    [ready, node.output, node.outputStartLine, query],
  );
  const follow = (value: boolean): void => {
    reading.follow = value;
    if (value) reading.unread = 0;
    refresh((revision) => revision + 1);
  };

  useLayoutEffect(() => {
    const stream = streamRef.current;
    if (!stream || !ready) return;
    if (!reading.follow) {
      const delta = bashUnreadDelta(reading.cursor, reading.output, node.cursor, node.output);
      if (delta > 0) {
        reading.unread += delta;
        refresh((revision) => revision + 1);
      }
    } else reading.unread = 0;
    reading.cursor = node.cursor;
    reading.output = node.output;
    stream.scrollTop = reading.follow ? stream.scrollHeight : reading.top;
    programmedTop.current = stream.scrollTop;
    return () => {
      reading.top = stream.scrollTop;
    };
  }, [node.cursor, node.output, ready, reading]);

  useLayoutEffect(() => {
    const stream = streamRef.current;
    if (!stream || !ready) return;
    stream.scrollTop = reading.follow ? stream.scrollHeight : reading.top;
    programmedTop.current = stream.scrollTop;
  });

  const notices = [
    job.status === "orphaned" ? t("bashWorkspace.orphanNotice") : undefined,
    job.status === "exited" && job.exitCode !== undefined && job.exitCode !== 0
      ? t("bashWorkspace.failedNotice", { code: job.exitCode })
      : undefined,
    job.status === "running" && Date.now() - job.lastOutputAt >= 300_000
      ? t("bashWorkspace.silent")
      : undefined,
    ready && node.outputTruncated ? t("bashWorkspace.truncated") : undefined,
    ready && node.outputMore ? t("bashWorkspace.more") : undefined,
  ].filter((value): value is string => Boolean(value));

  return (
    <div className={styles.logPanel}>
      <div className={styles.logToolbar}>
        <label className={styles.logSearch}>
          <MagnifyingGlass size={16} weight="regular" />
          <input
            type="search"
            value={query}
            aria-label={t("bashWorkspace.logSearch")}
            placeholder={t("bashWorkspace.logSearch")}
            onChange={(event) => {
              reading.query = event.target.value;
              setQuery(event.target.value);
            }}
          />
          {query ? <span>{t("bashWorkspace.matches", { count: lines.length })}</span> : null}
        </label>
        <button
          type="button"
          className={styles.followButton}
          aria-pressed={reading.follow}
          title={t("bashWorkspace.followHint")}
          onClick={() => follow(!reading.follow)}
        >
          {reading.follow ? (
            <ArrowLineDown size={16} weight="regular" />
          ) : (
            <Pause size={16} weight="regular" />
          )}
          {t(reading.follow ? "bashWorkspace.follow" : "bashWorkspace.paused")}
        </button>
      </div>
      {notices.length ? (
        <div className={styles.notice}>
          <Info size={16} weight="regular" />
          <span>{notices.join(" ")}</span>
        </div>
      ) : null}
      <section
        ref={streamRef}
        className={[styles.logScroll, reading.wrap ? styles.wrap : ""].join(" ")}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: read-only logs need keyboard scrolling
        tabIndex={0}
        aria-label={t("bashWorkspace.output")}
        aria-busy={!ready}
        data-bash-output={ready ? job.id : undefined}
        data-selectable-text=""
        onScroll={(event) => {
          const stream = event.currentTarget;
          reading.top = stream.scrollTop;
          if (
            programmedTop.current !== null &&
            Math.abs(programmedTop.current - stream.scrollTop) < 1
          ) {
            programmedTop.current = null;
            return;
          }
          programmedTop.current = null;
          if (reading.follow && stream.scrollHeight - stream.clientHeight - stream.scrollTop > 40)
            follow(false);
        }}
      >
        {!ready ? (
          <p className={styles.empty} role="status">
            {t("bashWorkspace.loading")}
          </p>
        ) : lines.length === 0 ? (
          <p className={styles.empty}>
            {t(query ? "bashWorkspace.noMatches" : "bashWorkspace.noOutput")}
          </p>
        ) : (
          lines.map((line) => (
            <div className={styles.logLine} key={line.number}>
              <span className={styles.lineNumber} aria-hidden="true">
                {line.number}
              </span>
              <span className={[styles.lineContent, logTone(line.text)].join(" ")}>
                {bashHighlights(line.text, query).map((part, index) =>
                  part.match ? (
                    // biome-ignore lint/suspicious/noArrayIndexKey: immutable text segments have no separate identity
                    <mark key={index}>{part.text}</mark>
                  ) : (
                    // biome-ignore lint/suspicious/noArrayIndexKey: immutable text segments have no separate identity
                    <span key={index}>{part.text || " "}</span>
                  ),
                )}
              </span>
            </div>
          ))
        )}
      </section>
      {!reading.follow && reading.unread > 0 ? (
        <button type="button" className={styles.newOutput} onClick={() => follow(true)}>
          {t("bashWorkspace.newLines", { count: reading.unread })}
          <ArrowLineDown size={16} weight="regular" />
        </button>
      ) : null}
    </div>
  );
}
