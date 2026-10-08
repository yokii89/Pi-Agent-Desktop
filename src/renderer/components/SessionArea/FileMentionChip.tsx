import { Folder } from "@phosphor-icons/react";
import { FileIcon } from "../../fileIcons/FileIcon";
import { useT } from "../../hooks/useT";
import type { FileMention } from "../../stores/composerStore";
import { useUiStore } from "../../stores/uiStore";
import { fileMentionName } from "../../utils/fileMentionFormat";
import styles from "./FileMentionChip.module.css";

/** Read-only reference; known files open in the existing file preview panel. */
export function FileMentionChip({ path, displayPath, kind }: FileMention) {
  const t = useT();
  const { dispatch } = useUiStore();
  const name = fileMentionName(displayPath);
  const content = (
    <>
      {kind === "dir" ? (
        <Folder size={16} weight="regular" className={styles.icon} />
      ) : (
        <FileIcon fileName={name} className={styles.icon} />
      )}
      <span className={styles.label}>{name}</span>
    </>
  );
  if (kind === "file") {
    return (
      <button
        type="button"
        className={styles.chip}
        title={path}
        aria-label={t("session.fileMention.open", { path: displayPath })}
        onClick={() => dispatch({ type: "openFileInPanel", path })}
      >
        {content}
      </button>
    );
  }
  return (
    <span className={styles.chip} title={path}>
      {content}
    </span>
  );
}
