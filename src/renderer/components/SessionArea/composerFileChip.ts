import { getFileIconUrl } from "../../fileIcons";
import type { FileMention } from "../../stores/composerStore";
import { FILE_ID_ATTR } from "../../utils/composerDom";
import { fileMentionName } from "../../utils/fileMentionFormat";
import styles from "./Composer.module.css";

/** Build the editable document's atomic file node without mounting a React root per chip. */
export function createFileChip(
  item: FileMention,
  theme: "light" | "dark",
  folderIcon: Node | null,
): HTMLElement {
  const chip = document.createElement("span");
  chip.contentEditable = "false";
  chip.setAttribute(FILE_ID_ATTR, item.path);
  chip.className = styles.fileChip;
  const name = fileMentionName(item.displayPath);
  chip.dataset.label = item.displayPath;
  chip.dataset.kind = item.kind ?? "file";
  chip.title = item.path;
  const icon = document.createElement("span");
  icon.className = styles.fileIcon;
  icon.setAttribute("aria-hidden", "true");
  if (item.kind === "dir") {
    if (folderIcon) icon.appendChild(folderIcon.cloneNode(true));
  } else {
    const img = document.createElement("img");
    img.src = getFileIconUrl(name, theme);
    img.alt = "";
    img.draggable = false;
    img.setAttribute("data-file-name", name);
    icon.appendChild(img);
  }
  const label = document.createElement("span");
  label.className = styles.label;
  label.textContent = name;
  chip.append(icon, label);
  return chip;
}
