import {
  ArrowCounterClockwise,
  CheckCircle,
  Copy,
  Eraser,
  FloppyDisk,
} from "@phosphor-icons/react";
import { useT } from "../../../../../hooks/useT";
import { GlideChevron } from "../../../../ui/GlideChevron";
import { Menu, type MenuItem } from "../../../../ui/Menu";
import { Toggle } from "../../../../ui/Toggle";
import styles from "./styleEdit.module.css";

interface TargetBarProps {
  target: string;
  targetTitle: string;
  hasDrafts: boolean;
  hasApplied: boolean;
  canCopy: boolean;
  applying: boolean;
  previewEnabled: boolean;
  onPreviewChange: (enabled: boolean) => void;
  onApply: () => void;
  onCopyForAi: () => void;
  onDiscard: () => void;
  onClearAll: () => void;
}

export function TargetBar({
  target,
  targetTitle,
  hasDrafts,
  hasApplied,
  canCopy,
  applying,
  previewEnabled,
  onPreviewChange,
  onApply,
  onCopyForAi,
  onDiscard,
  onClearAll,
}: TargetBarProps) {
  const t = useT();
  const items: MenuItem[] = [
    {
      key: "apply",
      label: t("browser.styles.applyToPreview"),
      icon: <CheckCircle size={16} weight="regular" />,
      disabled: !hasDrafts || applying,
      onSelect: onApply,
    },
    {
      key: "copy-for-ai",
      label: t("browser.styles.copyForAi"),
      icon: <Copy size={16} weight="regular" />,
      disabled: !canCopy || applying,
      onSelect: onCopyForAi,
    },
    {
      key: "discard",
      label: t("browser.styles.discardDrafts"),
      icon: <ArrowCounterClockwise size={16} weight="regular" />,
      disabled: !hasDrafts || applying,
      dividerBefore: true,
      onSelect: onDiscard,
    },
    {
      key: "clear-all",
      label: t("browser.styles.clearAll"),
      icon: <Eraser size={16} weight="regular" />,
      disabled: (!hasApplied && !hasDrafts) || applying,
      dividerBefore: true,
      tone: "danger",
      onSelect: onClearAll,
    },
  ];

  return (
    <div className={styles.targetBar}>
      <code className={styles.targetSelector} title={targetTitle} data-selectable-text>
        {target || t("browser.styles.targetEmpty")}
      </code>
      <div className={styles.targetActions}>
        <div className={styles.previewToggle}>
          <Toggle
            checked={previewEnabled}
            onChange={onPreviewChange}
            aria-label={t("browser.styles.applyToPreview")}
          />
          <span>{t("browser.styles.applyToPreview")}</span>
        </div>
        <Menu
          align="right"
          direction="bottom"
          items={items}
          trigger={({ open, onClick }) => (
            <button
              type="button"
              className={[styles.saveButton, hasDrafts ? styles.saveButtonDirty : ""]
                .filter(Boolean)
                .join(" ")}
              title={t("browser.styles.save")}
              aria-label={t("browser.styles.save")}
              aria-haspopup="menu"
              aria-expanded={open}
              disabled={(!hasDrafts && !hasApplied) || applying}
              onClick={onClick}
            >
              <FloppyDisk size={16} weight="regular" />
              <span>{t("browser.styles.save")}</span>
              <GlideChevron size={12} />
            </button>
          )}
        />
      </div>
    </div>
  );
}
