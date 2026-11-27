import { Copy } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  OFFICE_PARSE_TIMEOUT_MS,
  OFFICE_SEARCH_MAX_RESULTS,
  OFFICE_TABLE_PAGE_ROWS,
  type OfficePreviewIssue,
} from "../../../../../shared/officePreview";
import { useT } from "../../../../hooks/useT";
import { officeColumnIndex, searchSheetPreview } from "../../../../office/officeSearch";
import type {
  OfficeSearchHit,
  OfficeSearchProvider,
  OfficeSearchScope,
  OfficeSearchTarget,
  OfficeSearchUpdate,
} from "../../../../office/officeSearchTypes";
import { searchSpreadsheet } from "../../../../office/searchSpreadsheet";
import type {
  SheetPreview,
  SpreadsheetRequest,
  SpreadsheetResponse,
} from "../../../../office/spreadsheetData";
import { useUiStore } from "../../../../stores/uiStore";
import { copyTextToClipboard } from "../../../../utils/clipboard";
import { IconButton } from "../../../ui/IconButton";
import { Select } from "../../../ui/Select";
import styles from "./OfficePreview.module.css";
import { SpreadsheetTable } from "./SpreadsheetTable";

interface SheetView {
  index: number;
  sheet: SheetPreview;
  target?: OfficeSearchTarget;
}

/** The visible worksheet and optional full-file search own separate disposable workers. */
export function SpreadsheetPreview({
  data,
  onFailure,
  onSearchProvider,
  searchOpen,
}: {
  data: Uint8Array;
  onFailure: (issue: OfficePreviewIssue) => void;
  onSearchProvider: (provider: OfficeSearchProvider | null) => void;
  searchOpen: boolean;
}) {
  const t = useT();
  const { showToast } = useUiStore();

  const requested = useRef(0);
  const requestSheet = useRef<((index: number, target?: OfficeSearchTarget) => void) | null>(null);
  const pendingTarget = useRef<OfficeSearchTarget | undefined>(undefined);
  const targetTick = useRef(0);
  const [sheets, setSheets] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [view, setView] = useState<SheetView | null>(null);
  const [page, setPage] = useState(0);
  const state = useRef({ sheets, view, index });
  state.current = { sheets, view, index };

  useEffect(() => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("../../../../office/spreadsheet.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      onFailure("failed");
      return;
    }
    requested.current = 0;
    setSheets([]);
    setIndex(0);
    setView(null);
    setPage(0);
    let timeout = 0;
    const armTimeout = (): void => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => {
        worker.terminate();
        onFailure("tooLarge");
      }, OFFICE_PARSE_TIMEOUT_MS);
    };
    requestSheet.current = (next, target) => {
      armTimeout();
      pendingTarget.current = target;
      const location = target?.hit.location;
      const anchor =
        location?.kind === "cell" ? { row: location.row, column: location.column } : undefined;
      worker.postMessage({
        type: "sheet",
        id: ++requested.current,
        index: next,
        anchor,
      } satisfies SpreadsheetRequest);
    };
    armTimeout();
    worker.onerror = () => {
      window.clearTimeout(timeout);
      onFailure("failed");
    };
    worker.onmessage = ({ data: message }: MessageEvent<SpreadsheetResponse>) => {
      if (message.type === "error") {
        if (message.id !== undefined && message.id !== requested.current) return;
        window.clearTimeout(timeout);
        onFailure(message.issue);
      } else if (message.type === "ready") {
        setSheets(message.sheets);
        requestSheet.current?.(0);
      } else if (message.id === requested.current) {
        window.clearTimeout(timeout);
        const target = pendingTarget.current;
        const location = target?.hit.location;
        const offset =
          location?.kind === "cell" ? location.row + 1 - (message.sheet.rows[0]?.number ?? 1) : 0;
        setPage(Math.max(0, Math.floor(offset / OFFICE_TABLE_PAGE_ROWS)));
        setView({ index: message.index, sheet: message.sheet, target });
      }
    };
    const copy = data.slice();
    worker.postMessage({ type: "load", data: copy } satisfies SpreadsheetRequest, [copy.buffer]);
    return () => {
      window.clearTimeout(timeout);
      worker.terminate();
      requestSheet.current = null;
    };
  }, [data, onFailure]);

  const search = useCallback(
    async (
      query: string,
      scope: OfficeSearchScope,
      update: (value: OfficeSearchUpdate) => void,
      signal: AbortSignal,
    ): Promise<void> => {
      signal.throwIfAborted();
      if (scope === "file") return searchSpreadsheet(data, query, update, signal);
      const { view: current, sheets: names } = state.current;
      if (!current) return;
      const hits = searchSheetPreview(current.sheet, current.index, names[current.index], query);
      signal.throwIfAborted();
      update({
        hits,
        processed: current.sheet.rows.length,
        total: current.sheet.rows.length,
        limited: hits.length >= OFFICE_SEARCH_MAX_RESULTS,
      });
    },
    [data],
  );

  const navigate = useCallback((hit: OfficeSearchHit, query: string): void => {
    const location = hit.location;
    if (location.kind !== "cell") return;
    const target: OfficeSearchTarget = { hit, query, tick: ++targetTick.current };
    const current = state.current.view;
    const row = current?.sheet.rows.findIndex((entry) => entry.number === location.row + 1) ?? -1;
    const column =
      current?.sheet.columns.findIndex((entry) => officeColumnIndex(entry) === location.column) ??
      -1;
    setIndex(location.sheet);
    if (current?.index === location.sheet && row >= 0 && column >= 0) {
      setPage(Math.floor(row / OFFICE_TABLE_PAGE_ROWS));
      setView({ ...current, target });
    } else {
      setView(null);
      setPage(0);
      requestSheet.current?.(location.sheet, target);
    }
  }, []);

  useEffect(() => {
    if (!sheets.length) return;
    onSearchProvider({
      kind: "spreadsheet",
      search,
      navigate,
      clearTarget: () =>
        setView((value) => (value?.target ? { ...value, target: undefined } : value)),
      previewKey: `${index}:${view?.sheet.range ?? "loading"}`,
    });
    return () => onSearchProvider(null);
  }, [sheets.length, search, navigate, index, view?.sheet.range, onSearchProvider]);

  const selectSheet = (value: string): void => {
    const next = Number(value);
    setIndex(next);
    setView(null);
    setPage(0);
    requestSheet.current?.(next);
  };
  const sheet = view?.sheet;
  const copySheet = (): void => {
    if (!sheet) return;
    void copyTextToClipboard(sheet.rows.map((row) => row.cells.join("\t")).join("\n")).then((ok) =>
      showToast(t(ok ? "toast.copied" : "toast.copyFailed")),
    );
  };
  return (
    <>
      <div className={styles.sheetToolbar}>
        {sheets.length > 0 && (
          <Select
            ariaLabel={t("panels.files.office.sheet")}
            rootClassName={styles.sheetSelect}
            value={String(index)}
            options={sheets.map((name, i) => ({ value: String(i), label: name }))}
            onChange={selectSheet}
          />
        )}
        <div className={styles.sheetActions}>
          <IconButton
            title={t("panels.files.office.copyCells")}
            disabled={!sheet?.rows.length}
            onClick={copySheet}
          >
            <Copy size={16} weight="regular" />
          </IconButton>
        </div>
      </div>
      {!sheet ? (
        <p className={styles.note} role="status">
          {t("panels.files.office.loading")}
        </p>
      ) : !sheet.rows.length ? (
        <p className={styles.note}>{t("panels.files.csvEmpty")}</p>
      ) : (
        <>
          <div className={styles.sheetMetadata}>
            <p className={styles.sheetSize}>
              {t(
                sheet.truncated
                  ? "panels.files.office.sheetTruncated"
                  : "panels.files.office.sheetSize",
                {
                  rows: sheet.rows.length,
                  columns: sheet.columns.length,
                  totalRows: sheet.totalRows,
                  totalColumns: sheet.totalColumns,
                },
              )}
            </p>
            <p className={styles.sheetRange}>
              {t("panels.files.office.range", { range: sheet.range })}
            </p>
          </div>
          <SpreadsheetTable
            sheet={sheet}
            name={sheets[index]}
            page={page}
            onPage={setPage}
            target={searchOpen ? (view?.target ?? null) : null}
          />
          <p className={styles.note}>{t("panels.files.office.valuesOnly")}</p>
        </>
      )}
    </>
  );
}
