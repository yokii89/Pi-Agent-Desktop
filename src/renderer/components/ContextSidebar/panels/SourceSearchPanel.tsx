import { type RefObject, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type {
  CodeEditorHandle,
  CodeSearchQuery,
  CodeSearchResult,
} from "../../../editor/codeEditorTypes";
import { useT } from "../../../hooks/useT";
import { PreviewFindBar } from "./PreviewFindBar";
import styles from "./SourceSearchPanel.module.css";

const EMPTY_RESULT: CodeSearchResult = { count: 0, current: 0, valid: false };

/** Source-only options extend the shared find field; document state stays in CodeMirror. */
export function SourceSearchPanel({
  editorRef,
  readOnly,
  focusTick,
  onClose,
}: {
  editorRef: RefObject<CodeEditorHandle | null>;
  readOnly: boolean;
  focusTick: number;
  onClose: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState<CodeSearchQuery>(() => {
    const selected = editorRef.current?.getSelectedText() ?? "";
    return {
      search: selected.length <= 100 && !selected.includes("\n") ? selected : "",
      replace: "",
      caseSensitive: false,
      regexp: false,
      wholeWord: false,
    };
  });
  const subscribe = useCallback(
    (listener: () => void) => editorRef.current?.subscribeSearch(listener) ?? (() => {}),
    [editorRef],
  );
  const getResult = useCallback(
    () => editorRef.current?.getSearchResult() ?? EMPTY_RESULT,
    [editorRef],
  );
  const result = useSyncExternalStore(subscribe, getResult);

  useEffect(() => {
    editorRef.current?.setSearchQuery(query);
  }, [editorRef, query]);

  useEffect(() => {
    const editor = editorRef.current;
    return () => editor?.closeFind();
  }, [editorRef]);

  return (
    <div>
      <PreviewFindBar
        query={query.search}
        count={result.count}
        current={result.current}
        focusTick={focusTick}
        onQuery={(search) => setQuery((value) => ({ ...value, search }))}
        onStep={(delta) => editorRef.current?.stepSearch(delta)}
        onClose={onClose}
      />
      <div className={styles.options}>
        {(
          [
            ["caseSensitive", "panels.files.findMatchCase"],
            ["wholeWord", "panels.files.findWholeWord"],
            ["regexp", "panels.files.findRegex"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={query[key]}
              onChange={(event) => setQuery((value) => ({ ...value, [key]: event.target.checked }))}
            />
            {t(label)}
          </label>
        ))}
        <button
          type="button"
          disabled={!result.count}
          onClick={() => editorRef.current?.selectSearchMatches()}
        >
          {t("panels.files.findSelectAll")}
        </button>
      </div>
      {query.search && query.regexp && !result.valid && (
        <p className={styles.error} role="alert">
          {t("panels.files.findInvalidRegex")}
        </p>
      )}
      {!readOnly && (
        <div className={styles.replace}>
          <input
            value={query.replace}
            placeholder={t("panels.files.replacePlaceholder")}
            aria-label={t("panels.files.replacePlaceholder")}
            onChange={(event) => setQuery((value) => ({ ...value, replace: event.target.value }))}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              editorRef.current?.replaceSearch(event.ctrlKey || event.metaKey);
            }}
          />
          <button
            type="button"
            disabled={!result.count}
            onClick={() => editorRef.current?.replaceSearch(false)}
          >
            {t("panels.files.replaceNext")}
          </button>
          <button
            type="button"
            disabled={!result.count}
            onClick={() => editorRef.current?.replaceSearch(true)}
          >
            {t("panels.files.replaceAll")}
          </button>
        </div>
      )}
    </div>
  );
}
