import { useEffect, useRef, useState } from "react";
import { OFFICE_PARSE_TIMEOUT_MS } from "../../../../../shared/officePreview";
import { useT } from "../../../../hooks/useT";
import type {
  OfficeSearchProvider,
  OfficeSearchScope,
  OfficeSearchUpdate,
} from "../../../../office/officeSearchTypes";
import { PreviewFindBar } from "../PreviewFindBar";
import styles from "./OfficeSearchPanel.module.css";

const EMPTY: OfficeSearchUpdate = { hits: [], processed: 0, total: 0, limited: false };

/** File-scoped search UI; changing queries or closing always cancels the previous scan. */
export function OfficeSearchPanel({
  provider,
  focusTick,
  onClose,
}: {
  provider: OfficeSearchProvider | null;
  focusTick: number;
  onClose: () => void;
}) {
  const t = useT();
  const controller = useRef<AbortController | null>(null);
  const providerRef = useRef(provider);
  providerRef.current = provider;
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<OfficeSearchScope>("preview");
  const [result, setResult] = useState(EMPTY);
  const [state, setState] = useState<"idle" | "running" | "done" | "cancelled" | "error">("idle");
  const [selected, setSelected] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const search = provider?.search;
  const previewKey = scope === "preview" ? provider?.previewKey : undefined;

  // biome-ignore lint/correctness/useExhaustiveDependencies: previewKey and retry explicitly restart a file-scoped search.
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    setResult(EMPTY);
    setSelected(null);
    providerRef.current?.clearTarget();
    const needle = query.trim();
    if (!search || !needle) {
      setState("idle");
      return () => abort.abort();
    }
    setState("running");
    let timeout = 0;
    const timer = window.setTimeout(() => {
      if (abort.signal.aborted) return;
      timeout = window.setTimeout(() => {
        abort.abort();
        setState("cancelled");
      }, OFFICE_PARSE_TIMEOUT_MS);
      void search(
        needle,
        scope,
        (value) => {
          if (!abort.signal.aborted) setResult(value);
        },
        abort.signal,
      )
        .then(() => {
          if (!abort.signal.aborted) setState("done");
        })
        .catch(() => {
          if (!abort.signal.aborted) setState("error");
        })
        .finally(() => window.clearTimeout(timeout));
    }, 250);
    return () => {
      abort.abort();
      window.clearTimeout(timer);
      window.clearTimeout(timeout);
    };
  }, [search, query, scope, previewKey, retry]);

  const cancel = (): void => {
    controller.current?.abort();
    setState("cancelled");
  };
  const select = (index: number): void => {
    const hit = result.hits[index];
    if (!hit) return;
    setSelected(hit.id);
    providerRef.current?.navigate(hit, query.trim());
  };
  const step = (delta: number): void => {
    if (!result.hits.length) return;
    const index = result.hits.findIndex((hit) => hit.id === selected);
    select(
      index < 0
        ? delta > 0
          ? 0
          : result.hits.length - 1
        : (index + delta + result.hits.length) % result.hits.length,
    );
  };
  return (
    <section
      className={styles.panel}
      aria-label={t("panels.files.office.searchTitle")}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <PreviewFindBar
        query={query}
        count={result.hits.length}
        current={result.hits.findIndex((hit) => hit.id === selected) + 1}
        focusTick={focusTick}
        busy={state === "running"}
        onQuery={(value) => {
          setScope("preview");
          setQuery(value);
        }}
        onStep={step}
        onClose={onClose}
        onCancel={cancel}
      />
      <div className={styles.status} aria-live="polite">
        <span>
          {!provider
            ? t("panels.files.office.loading")
            : state === "running"
              ? t("panels.files.office.searchProgress", {
                  processed: result.processed,
                  total: result.total,
                })
              : state === "cancelled"
                ? t("panels.files.office.searchCancelled")
                : state === "error"
                  ? t("panels.files.office.searchFailed")
                  : query.trim()
                    ? t("panels.files.office.searchCount", { count: result.hits.length })
                    : t(
                        provider.kind === "spreadsheet"
                          ? "panels.files.office.searchPreviewScope"
                          : "panels.files.office.searchDocumentScope",
                      )}
        </span>
        {(state === "cancelled" || state === "error") && (
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            {t("common.retry")}
          </button>
        )}
      </div>
      {provider?.kind === "spreadsheet" && (
        <div className={styles.scope}>
          <span>
            {t(
              scope === "file"
                ? "panels.files.office.searchWorkbookScope"
                : "panels.files.office.searchPreviewScope",
            )}
          </span>
          {scope === "preview" && (
            <button type="button" disabled={!query.trim()} onClick={() => setScope("file")}>
              {t("panels.files.office.searchWorkbook")}
            </button>
          )}
        </div>
      )}
      {result.limited && <p className={styles.status}>{t("panels.files.office.searchLimited")}</p>}
      {result.hits.length > 0 && (
        <ol className={styles.results}>
          {result.hits.map((hit, index) => (
            <li key={hit.id}>
              <button
                type="button"
                className={styles.result}
                aria-current={selected === hit.id || undefined}
                onClick={() => select(index)}
              >
                <span className={styles.location}>
                  {hit.location.kind === "cell"
                    ? `${hit.location.sheetName} · ${hit.location.address}`
                    : t(
                        provider?.kind === "pptx"
                          ? "panels.files.office.slideNumber"
                          : "panels.files.office.readingPageNumber",
                        { page: hit.location.page + 1 },
                      )}
                </span>
                {hit.location.kind === "page" && hit.location.headingPath.length > 0 && (
                  <span className={styles.heading}>{hit.location.headingPath.join(" › ")}</span>
                )}
                <span className={styles.snippet}>{hit.snippet}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
