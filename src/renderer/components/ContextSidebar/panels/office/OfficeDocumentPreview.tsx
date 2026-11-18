import { CaretLeft, CaretRight, Copy } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import {
  OFFICE_PARSE_TIMEOUT_MS,
  type OfficePreviewIssue,
} from "../../../../../shared/officePreview";
import { useOfficeSearchHighlight } from "../../../../hooks/useOfficeSearchHighlight";
import { useT } from "../../../../hooks/useT";
import { officePreviewIssue } from "../../../../office/officeArchive";
import type {
  OfficeSearchProvider,
  OfficeSearchTarget,
} from "../../../../office/officeSearchTypes";
import type { OfficePageSource } from "../../../../office/renderOfficePages";
import { searchOfficeDocument } from "../../../../office/searchOfficeDocument";
import { useUiStore } from "../../../../stores/uiStore";
import { copyTextToClipboard } from "../../../../utils/clipboard";
import { PREVIEW_CONTENT_EVENT, PREVIEW_SELECTION_EVENT } from "../../../../utils/previewDocument";
import { previewPageStep } from "../../../../utils/previewPageKeys";
import { IconButton } from "../../../ui/IconButton";
import { OfficePageJump } from "./OfficePageJump";
import styles from "./OfficePreview.module.css";

// Styles and file-provided URLs are confined to this document; scripts, network, forms and popups stay disabled.
const FRAME_DOCUMENT = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; base-uri 'none'; form-action 'none'"><style>
html,body{margin:0;padding:0;overflow:hidden;background:var(--office-paper);color:var(--office-ink)}
#office-content{display:flow-root} [data-selectable-text]{user-select:text}
section.docx{box-shadow:none;margin:0} .slide{isolation:isolate} a{color:inherit;cursor:text}
::selection{background:var(--office-selection)}
::highlight(pidesk-find){background:var(--office-find)}
::highlight(pidesk-find-active),::highlight(pidesk-office-find-active){background:var(--office-selection)}
::highlight(pidesk-office-find){background:var(--office-find)}
</style></head><body><div id="office-styles"></div><div id="office-content" data-selectable-text></div></body></html>`;

interface Props {
  data: Uint8Array;
  format: "docx" | "pptx";
  onFailure: (issue: OfficePreviewIssue) => void;
  onSearchProvider: (provider: OfficeSearchProvider | null) => void;
  searchOpen: boolean;
  onCloseSearch: () => void;
}

/** Paginated sandboxed document. Host controls stay outside the frame and keep the normal theme. */
export function OfficeDocumentPreview({
  data,
  format,
  onFailure,
  onSearchProvider,
  searchOpen,
  onCloseSearch,
}: Props) {
  const t = useT();
  const { showToast } = useUiStore();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [doc, setDoc] = useState<Document | null>(null);
  const [source, setSource] = useState<OfficePageSource | null>(null);
  const [current, setCurrent] = useState<HTMLElement | null>(null);
  const [page, setPage] = useState(0);
  const [target, setTarget] = useState<OfficeSearchTarget | null>(null);
  const targetTick = useRef(0);

  useEffect(() => {
    if (!source) return;
    onSearchProvider({
      kind: format,
      clearTarget: () => setTarget(null),
      search: (query, _scope, update, signal) =>
        searchOfficeDocument(source, query, update, signal),
      navigate(hit, query) {
        if (hit.location.kind !== "page") return;
        setPage(hit.location.page);
        setTarget({ hit, query, tick: ++targetTick.current });
      },
    });
    return () => onSearchProvider(null);
  }, [source, format, onSearchProvider]);

  useEffect(() => {
    if (!doc) return;
    const controller = new AbortController();
    let opened: OfficePageSource | null = null;
    setSource(null);
    setCurrent(null);
    setPage(0);
    const timeout = window.setTimeout(() => {
      controller.abort();
      onFailure("tooLarge");
    }, OFFICE_PARSE_TIMEOUT_MS);
    void import("../../../../office/renderOfficePages")
      .then(({ renderOfficePages }) => renderOfficePages(data, format, doc, controller.signal))
      .then((next) => {
        if (controller.signal.aborted) next.dispose();
        else {
          opened = next;
          setSource(next);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) onFailure(officePreviewIssue(error));
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      controller.abort();
      opened?.dispose();
      doc.getElementById("office-content")?.replaceChildren();
      window.clearTimeout(timeout);
    };
  }, [data, doc, format, onFailure]);

  useEffect(() => {
    if (!source || !doc) return;
    const controller = new AbortController();
    setCurrent(null);
    doc.getElementById("office-content")?.replaceChildren();
    frameRef.current?.dispatchEvent(new Event(PREVIEW_CONTENT_EVENT, { bubbles: true }));
    frameRef.current?.dispatchEvent(new Event(PREVIEW_SELECTION_EVENT, { bubbles: true }));
    const timeout = window.setTimeout(() => {
      controller.abort();
      onFailure("tooLarge");
    }, OFFICE_PARSE_TIMEOUT_MS);
    void source
      .getPage(page, controller.signal)
      .then((element) => {
        if (!controller.signal.aborted) setCurrent(element);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) onFailure(officePreviewIssue(error));
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [source, page, doc, onFailure]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!doc || !frame || !source) return;
    const notify = (): void => {
      frame.dispatchEvent(new Event(PREVIEW_SELECTION_EVENT, { bubbles: true }));
    };
    const onContextMenu = (event: MouseEvent): void => {
      event.preventDefault();
      const box = frame.getBoundingClientRect();
      frame.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: box.left + event.clientX,
          clientY: box.top + event.clientY,
        }),
      );
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!searchOpen) {
        const step = previewPageStep(event);
        if (step !== null) {
          event.preventDefault();
          setPage((value) => Math.min(source.length - 1, Math.max(0, value + step)));
          return;
        }
      }
      if (event.key === "Escape" && searchOpen) {
        event.preventDefault();
        onCloseSearch();
        return;
      }
      if (
        (event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "f") ||
        event.key === "Escape"
      ) {
        event.preventDefault();
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: event.key,
            ctrlKey: event.ctrlKey,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    };
    const onClick = (event: MouseEvent): void => {
      // A document hyperlink must not replace the preview frame or launch another application.
      if ((event.target as Element | null)?.closest("a")) event.preventDefault();
    };
    const syncTheme = (): void => {
      const tokens = getComputedStyle(frame);
      for (const [local, token] of [
        ["paper", "--color-document-paper"],
        ["ink", "--color-document-ink"],
        ["selection", "--color-selection"],
        ["find", "--color-accent-soft"],
      ]) {
        doc.documentElement.style.setProperty(`--office-${local}`, tokens.getPropertyValue(token));
      }
    };
    const theme = new MutationObserver(syncTheme);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "style"],
    });
    syncTheme();
    doc.addEventListener("selectionchange", notify);
    doc.addEventListener("contextmenu", onContextMenu);
    doc.addEventListener("keydown", onKeyDown);
    doc.addEventListener("click", onClick);
    return () => {
      theme.disconnect();
      doc.removeEventListener("selectionchange", notify);
      doc.removeEventListener("contextmenu", onContextMenu);
      doc.removeEventListener("keydown", onKeyDown);
      doc.removeEventListener("click", onClick);
    };
  }, [doc, searchOpen, onCloseSearch, source]);

  useEffect(() => {
    const frame = frameRef.current;
    const root = doc?.getElementById("office-content");
    if (!frame || !root || !current) return;
    root.replaceChildren(current);
    const resize = (): void => {
      const width = current.offsetWidth;
      if (!width || !frame.clientWidth) return;
      const zoom = String(Math.min(1, frame.clientWidth / width));
      if (root.style.zoom !== zoom) root.style.zoom = zoom;
      const height = `${Math.ceil(root.getBoundingClientRect().height)}px`;
      if (frame.style.height !== height) frame.style.height = height;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(frame);
    observer.observe(current);
    resize();
    frame.dispatchEvent(new Event(PREVIEW_CONTENT_EVENT, { bubbles: true }));
    frame.dispatchEvent(new Event(PREVIEW_SELECTION_EVENT, { bubbles: true }));
    return () => observer.disconnect();
  }, [doc, current]);

  const highlighted =
    searchOpen && target?.hit.location.kind === "page" && target.hit.location.page === page
      ? target
      : null;
  useOfficeSearchHighlight(
    current,
    highlighted?.query ?? "",
    highlighted?.hit.location.kind === "page" ? highlighted.hit.location.occurrence : 0,
    highlighted?.tick,
  );

  const copyPage = (): void => {
    void copyTextToClipboard(current?.innerText ?? "").then((ok) =>
      showToast(t(ok ? "toast.copied" : "toast.copyFailed")),
    );
  };
  return (
    <>
      {source && (
        <div className={styles.toolbar}>
          <IconButton
            title={t("panels.files.backPrevious")}
            disabled={page === 0}
            onClick={() => setPage((value) => value - 1)}
          >
            <CaretLeft size={16} weight="regular" />
          </IconButton>
          <OfficePageJump kind={format} page={page} total={source.length} onChange={setPage} />
          <IconButton
            title={t("panels.files.forwardNext")}
            disabled={page === source.length - 1}
            onClick={() => setPage((value) => value + 1)}
          >
            <CaretRight size={16} weight="regular" />
          </IconButton>
          <IconButton title={t("panels.files.copyPageText")} disabled={!current} onClick={copyPage}>
            <Copy size={16} weight="regular" />
          </IconButton>
        </div>
      )}
      {!current && (
        <p className={styles.note} role="status">
          {t("panels.files.office.loading")}
        </p>
      )}
      <iframe
        ref={frameRef}
        title={t("panels.files.office.document")}
        className={styles.documentFrame}
        data-office-preview=""
        data-loading={!current || undefined}
        sandbox="allow-same-origin"
        srcDoc={FRAME_DOCUMENT}
        onLoad={() => setDoc(frameRef.current?.contentDocument ?? null)}
      />
    </>
  );
}
