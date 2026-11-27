import { ArrowSquareOut } from "@phosphor-icons/react";
import { type Ref, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { FsReadOfficeResult } from "../../../../../shared/ipc";
import { OFFICE_MAX_BYTES, type OfficePreviewIssue } from "../../../../../shared/officePreview";
import { useT } from "../../../../hooks/useT";
import type {
  OfficePreviewHandle,
  OfficeSearchProvider,
} from "../../../../office/officeSearchTypes";
import panelStyles from "../FilePanel.module.css";
import { OfficeDocumentPreview } from "./OfficeDocumentPreview";
import styles from "./OfficePreview.module.css";
import { OfficeSearchPopover, type OfficeSearchPopoverHandle } from "./OfficeSearchPopover";
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
  const searchRef = useRef<OfficeSearchPopoverHandle>(null);
  const openSearch = useCallback(() => {
    searchRef.current?.openSearch();
  }, []);
  const closeSearch = useCallback(() => {
    searchRef.current?.closeSearch();
  }, []);
  useImperativeHandle(ref, () => ({ openSearch }), [openSearch]);
  const issue = result.status === "unavailable" ? result.reason : failure;
  useEffect(() => {
    if (issue) setSearchOpen(false);
  }, [issue]);
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
      {result.format === "spreadsheet" ? (
        <SpreadsheetPreview
          data={result.data}
          onFailure={setFailure}
          onSearchProvider={setProvider}
          searchOpen={searchOpen}
          searchControl={
            <OfficeSearchPopover ref={searchRef} provider={provider} onOpenChange={setSearchOpen} />
          }
        />
      ) : (
        <>
          <div className={styles.searchAction}>
            <OfficeSearchPopover ref={searchRef} provider={provider} onOpenChange={setSearchOpen} />
          </div>
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
