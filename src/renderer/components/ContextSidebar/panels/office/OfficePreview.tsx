import { ArrowSquareOut, MagnifyingGlass } from "@phosphor-icons/react";
import { type Ref, useCallback, useImperativeHandle, useState } from "react";
import type { FsReadOfficeResult } from "../../../../../shared/ipc";
import { OFFICE_MAX_BYTES, type OfficePreviewIssue } from "../../../../../shared/officePreview";
import { useT } from "../../../../hooks/useT";
import type {
  OfficePreviewHandle,
  OfficeSearchProvider,
} from "../../../../office/officeSearchTypes";
import { IconButton } from "../../../ui/IconButton";
import panelStyles from "../FilePanel.module.css";
import { OfficeDocumentPreview } from "./OfficeDocumentPreview";
import styles from "./OfficePreview.module.css";
import { OfficeSearchPanel } from "./OfficeSearchPanel";
import { SpreadsheetPreview } from "./SpreadsheetPreview";

/** Read-only Office surface. Key it by the read result so reloads discard stale pages and failures. */
export function OfficePreview({
  result,
  onOpenInSystem,
  ref,
}: {
  result: FsReadOfficeResult;
  onOpenInSystem: () => void;
  ref?: Ref<OfficePreviewHandle>;
}) {
  const t = useT();
  const [failure, setFailure] = useState<OfficePreviewIssue | null>(null);
  const [provider, setProvider] = useState<OfficeSearchProvider | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const openSearch = (): void => {
    setSearchOpen(true);
    setFocusTick((value) => value + 1);
  };
  useImperativeHandle(ref, () => ({ openSearch }));
  const issue = result.status === "unavailable" ? result.reason : failure;
  if (issue || result.status !== "ready") {
    return (
      <div className={panelStyles.binaryWrap} data-selectable-text="">
        <p className={panelStyles.binaryTitle}>{t("panels.files.cannotPreview")}</p>
        <p className={panelStyles.binaryMeta}>
          {t(`panels.files.office.${issue ?? "failed"}`, { limit: OFFICE_MAX_BYTES / 1024 / 1024 })}
        </p>
        <button type="button" className={panelStyles.binaryAction} onClick={onOpenInSystem}>
          <ArrowSquareOut size={16} weight="regular" />
          {t("panels.files.openInSystem")}
        </button>
      </div>
    );
  }
  return (
    <section
      className={styles.wrap}
      aria-label={t("panels.files.office.document")}
      onKeyDown={(event) => {
        if (event.key === "Escape" && searchOpen) {
          event.preventDefault();
          event.stopPropagation();
          closeSearch();
        }
      }}
    >
      <div className={styles.searchAction}>
        <IconButton title={t("panels.files.office.searchTitle")} onClick={openSearch}>
          <MagnifyingGlass size={16} weight="regular" />
        </IconButton>
      </div>
      {searchOpen && (
        <OfficeSearchPanel provider={provider} focusTick={focusTick} onClose={closeSearch} />
      )}
      {result.format === "spreadsheet" ? (
        <SpreadsheetPreview
          data={result.data}
          onFailure={setFailure}
          onSearchProvider={setProvider}
          searchOpen={searchOpen}
        />
      ) : (
        <>
          <p className={styles.note}>{t("panels.files.office.layoutNote")}</p>
          <OfficeDocumentPreview
            data={result.data}
            format={result.format}
            onFailure={setFailure}
            onSearchProvider={setProvider}
            searchOpen={searchOpen}
            onCloseSearch={closeSearch}
          />
        </>
      )}
    </section>
  );
}
