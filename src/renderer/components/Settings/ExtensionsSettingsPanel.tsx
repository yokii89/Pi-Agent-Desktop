import { useEffect, useState } from "react";
import type {
  ContributionCatalogSnapshot,
  ExtensionWorkerStatus,
} from "../../../shared/contribution";
import { useT } from "../../hooks/useT";
import { catalogService } from "../../services/contributionService";
import { workerService } from "../../services/workerService";
import { useExtensionViewStore } from "../../stores/extensionViewStore";
import { useProjectStore } from "../../stores/projectStore";
import { useSessionMeta } from "../../stores/sessionStore";
import { SettingsMount } from "../ExtensionView/SettingsMount";
import { Button } from "../ui/Button";
import styles from "./Settings.module.css";

/**
 * 设置「来自扩展」（docs/design/16 Phase F + docs/design/19 §10.2）：
 * - 打开时 acquire Extension Worker lease（选择性加载 worker-safe 扩展）
 * - 关闭时 release；宽限期内无新 lease 才退出
 * - Catalog settings 条目可 `view:open` 激活会话内 live 卡片；live 卡片来自 View 协议
 */
export function ExtensionsSettingsPanel() {
  const t = useT();
  const { settingsViews, activateViewOpen } = useExtensionViewStore();
  const { ensureSession } = useSessionMeta();
  const [worker, setWorker] = useState<ExtensionWorkerStatus | null>(null);
  const [catalog, setCatalog] = useState<ContributionCatalogSnapshot | null>(null);
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const { currentProject } = useProjectStore();

  useEffect(() => {
    let cancelled = false;
    void workerService
      .acquire()
      .then((result) => {
        if (!cancelled) setWorker(result.status);
      })
      .catch(() => {
        if (!cancelled) {
          setWorker({
            running: false,
            ready: false,
            leases: 0,
            graceExitScheduled: false,
            workerSafeExtensionCount: 0,
            selectiveLoadSupported: true,
            extensionPaths: [],
            errorMessage: t("settings.extensions.workerFailed"),
          });
        }
      });
    catalogService
      .list(currentProject?.dir ?? null)
      .then((snap) => {
        if (!cancelled) setCatalog(snap);
      })
      .catch(() => {});
    const timer = window.setInterval(() => {
      void workerService
        .status()
        .then((status) => {
          if (!cancelled) setWorker(status);
        })
        .catch(() => {});
    }, 2000);
    const unsubscribe = catalogService.onChanged((snap) => {
      setCatalog((previous) => (previous?.contextId === snap.contextId ? snap : previous));
    });
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      unsubscribe();
      void workerService.release().catch(() => {});
    };
  }, [currentProject?.dir, t]);

  const catalogSettings = (catalog?.entries ?? []).filter((e) => e.placement === "settings");
  const diagnostics = catalog?.diagnostics ?? [];
  const liveSettingKeys = new Set(
    settingsViews.map((v) => v.contributionKey).filter((k): k is string => typeof k === "string"),
  );

  return (
    <div className={styles.panelPad}>
      <div className={styles.panelHint}>
        {worker?.selectiveLoadSupported === false
          ? t("settings.extensions.selectiveLoadUnsupported")
          : worker?.errorMessage
            ? t("settings.extensions.connectFailed", { error: worker.errorMessage })
            : worker
              ? worker.ready
                ? t("settings.extensions.connected")
                : worker.running
                  ? t("settings.extensions.connecting")
                  : t("settings.extensions.noneRunnable")
              : t("settings.extensions.connecting")}
      </div>

      {catalogSettings.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <div className={styles.panelHint}>{t("settings.extensions.providedSettings")}</div>
          <ul style={{ margin: "6px 0", paddingLeft: 18 }}>
            {catalogSettings.map((entry) => {
              const hasLive = liveSettingKeys.has(entry.key);
              const opening = openingKey === entry.key;
              return (
                <li
                  key={entry.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 4,
                  }}
                >
                  <span style={{ flex: 1 }}>
                    {entry.title}
                    {entry.packageId
                      ? t("settings.extensions.entry.package", { id: entry.packageId })
                      : ""}
                    {entry.description
                      ? t("settings.extensions.entry.description", {
                          description: entry.description,
                        })
                      : ""}
                    {entry.workerSafe ? t("settings.extensions.entry.workerSafe") : ""}
                  </span>
                  {hasLive ? (
                    <span className={styles.panelHint}>{t("settings.extensions.opened")}</span>
                  ) : entry.workerSafe ? (
                    <span className={styles.panelHint}>{t("settings.extensions.autoLoad")}</span>
                  ) : (
                    <Button
                      variant="default"
                      disabled={opening}
                      onClick={() => {
                        if (opening) return;
                        setOpeningKey(entry.key);
                        void activateViewOpen({
                          contributionKey: entry.key,
                          prepareSession: () => ensureSession("view-action"),
                        }).finally(() => setOpeningKey(null));
                      }}
                    >
                      {opening ? t("settings.extensions.opening") : t("common.open")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {diagnostics.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <div className={styles.panelHint}>{t("settings.extensions.diagnostics")}</div>
          <ul style={{ margin: "6px 0", paddingLeft: 18 }}>
            {diagnostics.map((d) => (
              <li key={`${d.scope}:${d.packageId}:${d.field ?? ""}:${d.message}`}>
                [{d.scope}] {d.packageId}: {d.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {settingsViews.length === 0 ? (
        <p className={styles.panelHint}>{t("settings.extensions.empty")}</p>
      ) : (
        settingsViews.map((entry) => <SettingsMount key={entry.id} entry={entry} />)
      )}
    </div>
  );
}
