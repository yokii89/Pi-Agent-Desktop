import { useEffect, useRef, useState } from "react";
import { t as translate } from "../../../shared/i18n";
import type { ExtensionPushMessage } from "../../../shared/ipc";
import { useT } from "../../hooks/useT";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { Segmented, type SegmentedItem } from "../ui/Segmented";
import styles from "./ExtensionsPage.module.css";

export interface InstallPackageRequest {
  source: string;
  local: boolean;
}

type InstallScope = "global" | "project";

interface InstallPackageDialogProps {
  open: boolean;
  /** 是否展示「当前项目」作用域选项。 */
  hasProject: boolean;
  /** 打开时默认选中的作用域；项目空态/项目 Tab 下默认装进项目。 */
  initialLocal?: boolean;
  installing: boolean;
  logs: string[];
  error: string | null;
  onClose: () => void;
  onSubmit: (req: InstallPackageRequest) => void;
}

/** 安装 package 对话框：来源 + 作用域 + 日志。 */
export function InstallPackageDialog({
  open,
  hasProject,
  initialLocal = false,
  installing,
  logs,
  error,
  onClose,
  onSubmit,
}: InstallPackageDialogProps) {
  const t = useT();
  const [source, setSource] = useState("");
  const [local, setLocal] = useState(initialLocal && hasProject);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setSource("");
      setLocal(false);
      return;
    }
    setLocal(initialLocal && hasProject);
  }, [open, initialLocal, hasProject]);

  // 日志追加后滚到底
  // biome-ignore lint/correctness/useExhaustiveDependencies: logs 变化是滚动触发信号
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  const canSubmit = source.trim().length > 0 && !installing;

  const scopeItems: readonly SegmentedItem<InstallScope>[] = [
    { value: "global", label: t("extensions.scope.user"), disabled: installing },
    {
      value: "project",
      label: t("extensions.scope.project"),
      disabled: installing || !hasProject,
      title: hasProject ? undefined : t("extensions.installDialog.needProject"),
    },
  ];

  return (
    <Modal
      open={open}
      onClose={installing ? () => {} : onClose}
      ariaLabel={t("extensions.installDialog.title")}
    >
      <div className={styles.dialogPanel}>
        <h2 className={styles.dialogTitle}>{t("extensions.installDialog.title")}</h2>
        <div>
          <label className={styles.fieldLabel} htmlFor="pkg-source">
            {t("extensions.installDialog.sourceLabel")}
          </label>
          <input
            id="pkg-source"
            className={styles.textInput}
            value={source}
            disabled={installing}
            placeholder={t("extensions.installDialog.sourcePlaceholder")}
            onChange={(e) => setSource(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit) {
                onSubmit({ source: source.trim(), local });
              }
            }}
          />
        </div>
        <div>
          <span className={styles.fieldLabel}>{t("extensions.installDialog.installTo")}</span>
          <Segmented
            stretch
            ariaLabel={t("extensions.installDialog.installTo")}
            value={local ? "project" : "global"}
            items={scopeItems}
            onChange={(next) => setLocal(next === "project")}
          />
        </div>
        <p className={styles.warning}>{t("extensions.installDialog.warning")}</p>
        {error ? <p className={styles.errorBanner}>{error}</p> : null}
        {logs.length > 0 ? (
          <div ref={logRef} className={styles.logBox}>
            {logs.join("\n")}
          </div>
        ) : null}
        <div className={styles.dialogActions}>
          <Button disabled={installing} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={!canSubmit}
            onClick={() => onSubmit({ source: source.trim(), local })}
          >
            {installing
              ? t("extensions.installDialog.installing")
              : t("extensions.installDialog.confirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** 把推送消息并入日志行；exit/error 返回是否应结束安装。 */
export function appendInstallLog(
  logs: string[],
  message: ExtensionPushMessage,
): { logs: string[]; done: boolean; ok: boolean } {
  if (message.type === "log") {
    return { logs: [...logs, message.payload], done: false, ok: false };
  }
  if (message.type === "error") {
    return { logs: [...logs, message.payload], done: true, ok: false };
  }
  return {
    logs: [
      ...logs,
      message.payload.ok
        ? translate("common.done")
        : translate("extensions.install.exitFailed", {
            code: message.payload.code ?? "",
          }),
    ],
    done: true,
    ok: message.payload.ok,
  };
}
