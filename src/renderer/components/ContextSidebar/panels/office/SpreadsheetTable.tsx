import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { type CSSProperties, useCallback, useRef } from "react";
import { OFFICE_TABLE_PAGE_ROWS } from "../../../../../shared/officePreview";
import { useOfficeSearchHighlight } from "../../../../hooks/useOfficeSearchHighlight";
import { useT } from "../../../../hooks/useT";
import type { OfficeSearchTarget } from "../../../../office/officeSearchTypes";
import type { SheetPreview } from "../../../../office/spreadsheetData";
import { IconButton } from "../../../ui/IconButton";
import tableStyles from "../DelimitedPreview.module.css";
import { OfficePageJump } from "./OfficePageJump";
import styles from "./OfficePreview.module.css";

/** Page rows keep table layout bounded while preserving normal selection and current-page Ctrl+F. */
export function SpreadsheetTable({
  sheet,
  name,
  page,
  onPage,
  target,
}: {
  sheet: SheetPreview;
  name: string;
  page: number;
  onPage: (page: number) => void;
  target: OfficeSearchTarget | null;
}) {
  const t = useT();
  const tableRef = useRef<HTMLTableElement>(null);
  const start = page * OFFICE_TABLE_PAGE_ROWS;
  const rows = sheet.rows.slice(start, start + OFFICE_TABLE_PAGE_ROWS);
  const location = target?.hit.location;
  const address = location?.kind === "cell" ? location.address : "";
  const highlightCell = useCallback(
    () => tableRef.current?.querySelector<HTMLElement>(`[data-office-cell="${address}"]`) ?? null,
    [address],
  );
  useOfficeSearchHighlight(highlightCell, target?.query ?? "", 0, `${target?.tick}:${page}`);
  return (
    <>
      {sheet.rows.length > OFFICE_TABLE_PAGE_ROWS && (
        <div className={styles.toolbar}>
          <IconButton
            title={t("panels.files.office.previousRows")}
            disabled={page === 0}
            onClick={() => onPage(page - 1)}
          >
            <CaretLeft size={16} weight="regular" />
          </IconButton>
          <OfficePageJump
            kind="rows"
            page={page}
            total={Math.ceil(sheet.rows.length / OFFICE_TABLE_PAGE_ROWS)}
            onChange={onPage}
          />
          <IconButton
            title={t("panels.files.office.nextRows")}
            disabled={start + rows.length >= sheet.rows.length}
            onClick={() => onPage(page + 1)}
          >
            <CaretRight size={16} weight="regular" />
          </IconButton>
        </div>
      )}
      <div className={tableStyles.scroll} data-selectable-text="">
        <table
          ref={tableRef}
          data-office-sheet={name}
          className={`${tableStyles.table} ${styles.sheetTable}`}
          style={{ "--office-table-columns": sheet.columns.length + 1 } as CSSProperties}
        >
          <thead>
            <tr>
              <th scope="col" aria-label={t("panels.files.office.row")} />
              {sheet.columns.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.number}>
                <th scope="row" className={styles.rowNumber}>
                  {row.number}
                </th>
                {row.cells.map((cell, column) => (
                  <td
                    key={sheet.columns[column]}
                    data-office-cell={`${sheet.columns[column]}${row.number}`}
                    data-office-column={sheet.columns[column]}
                    data-office-row={row.number}
                  >
                    {cell.length > 1000 ? <div className={styles.longCell}>{cell}</div> : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
