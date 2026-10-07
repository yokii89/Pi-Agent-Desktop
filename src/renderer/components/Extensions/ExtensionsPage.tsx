import { ArrowSquareOut, Plus } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ContributionCatalogSnapshot } from "../../../shared/contribution";
import type {
  PiPackageEntry,
  PiPackageResourceItem,
  PiPackageResourceKind,
  PiPackagesSnapshot,
} from "../../../shared/ipc";
import { useT } from "../../hooks/useT";
import { catalogService } from "../../services/contributionService";
import { extensionService } from "../../services/extensionService";
import { fsService } from "../../services/fsService";
import { useProjectStore } from "../../stores/projectStore";
import { useUiStore } from "../../stores/uiStore";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { ContributionDiagnostics } from "./ContributionDiagnostics";
import styles from "./ExtensionsPage.module.css";
import {
  appendInstallLog,
  InstallPackageDialog,
  type InstallPackageRequest,
} from "./InstallPackageDialog";
import { LocalResourcesSection } from "./LocalResourcesSection";
import { PackageList } from "./PackageList";

type ScopeTab = "user" | "project";

/**
 * 扩展页：pi packages 列表 / 安装 / 卸载 / 启停（docs/design/07）。
 * 页面只负责编排；列表卡片与安装对话框已拆出。
 */
export function ExtensionsPage() {
  const t = useT();
  const { currentProject } = useProjectStore();
  const { showToast } = useUiStore();
  const projectDir = currentProject?.dir ?? null;

  const [snapshot, setSnapshot] = useState<PiPackagesSnapshot | null>(null);
  const [catalog, setCatalog] = useState<ContributionCatalogSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [scope, setScope] = useState<ScopeTab>("user");
  const [busy, setBusy] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installLogs, setInstallLogs] = useState<string[]>([]);
  const [installError, setInstallError] = useState<string | null>(null);
  const installingRef = useRef(false);
  const [removeTarget, setRemoveTarget] = useState<PiPackageEntry | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setListError(null);
    try {
      const next = await extensionService.list(projectDir);
      setSnapshot(next);
      setCatalog(await catalogService.refresh(projectDir));
    } catch (err) {
      setSnapshot(null);
      setListError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectDir]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 无项目时强制回到全局 Tab
  useEffect(() => {
    if (!projectDir) setScope("user");
  }, [projectDir]);

  useEffect(() => {
    return extensionService.onOutput((message) => {
      if (!installingRef.current) return;
      setInstallLogs((prev) => appendInstallLog(prev, message).logs);
      if (message.type === "exit" || message.type === "error") {
        installingRef.current = false;
        setInstalling(false);
        void refresh();
      }
    });
  }, [refresh]);

  const entries = useMemo<PiPackageEntry[]>(() => {
    if (!snapshot) return [];
    return scope === "project" ? snapshot.project : snapshot.user;
  }, [snapshot, scope]);

  const openPath = useCallback(
    (path: string) => {
      void fsService.openPath(path).catch((err: unknown) => {
        showToast(err instanceof Error ? err.message : String(err));
      });
    },
    [showToast],
  );

  const openGallery = useCallback(() => {
    void window.pidesk?.window.openExternal("https://pi.dev/packages").catch((err: unknown) => {
      showToast(err instanceof Error ? err.message : String(err));
    });
  }, [showToast]);

  const handleToggle = useCallback(
    async (entry: PiPackageEntry, enabled: boolean) => {
      setBusy(true);
      try {
        await extensionService.setEnabled({
          source: entry.source,
          scope: scope === "project" ? "project" : "user",
          enabled,
          cwd: projectDir,
        });
        await refresh();
        showToast(enabled ? t("extensions.enabled") : t("extensions.disabled"));
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [projectDir, refresh, scope, showToast, t],
  );

  const handleToggleResource = useCallback(
    async (
      entry: PiPackageEntry,
      kind: PiPackageResourceKind,
      item: PiPackageResourceItem,
      enabled: boolean,
    ) => {
      setBusy(true);
      try {
        await extensionService.setResourceEnabled({
          source: entry.source,
          scope: scope === "project" ? "project" : "user",
          kind,
          relativePath: item.relativePath,
          enabled,
          cwd: projectDir,
        });
        await refresh();
        showToast(
          enabled
            ? t("extensions.enabledResource", { name: item.name })
            : t("extensions.disabledResource", { name: item.name }),
        );
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [projectDir, refresh, scope, showToast, t],
  );

  const handleRemoveClick = useCallback((entry: PiPackageEntry) => {
    setRemoveTarget(entry);
  }, []);

  const handleConfirmRemove = useCallback(async () => {
    const entry = removeTarget;
    if (!entry) return;
    setRemoveTarget(null);
    setBusy(true);
    setInstallOpen(true);
    setInstalling(true);
    installingRef.current = true;
    setInstallLogs([`pi remove ${entry.source}`]);
    setInstallError(null);
    try {
      await extensionService.remove({
        source: entry.source,
        local: scope === "project",
        cwd: projectDir,
      });
      await refresh();
      showToast(t("extensions.uninstalled"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setInstallError(msg);
      showToast(msg);
    } finally {
      installingRef.current = false;
      setInstalling(false);
      setBusy(false);
    }
  }, [projectDir, refresh, removeTarget, scope, showToast, t]);

  const handleInstall = useCallback(
    async (req: InstallPackageRequest) => {
      setInstalling(true);
      installingRef.current = true;
      setInstallError(null);
      setInstallLogs([`pi install ${req.source}${req.local ? " -l" : ""}`]);
      try {
        await extensionService.install({
          source: req.source,
          local: req.local,
          cwd: req.local ? projectDir : null,
        });
        await refresh();
        showToast(t("extensions.install.success"));
        setInstallOpen(false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setInstallError(msg);
        showToast(msg);
      } finally {
        installingRef.current = false;
        setInstalling(false);
      }
    },
    [projectDir, refresh, showToast, t],
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{t("extensions.title")}</h1>
          <p className={styles.subtitle}>{t("extensions.subtitle")}</p>
        </div>
        <div className={styles.headerActions}>
          <Button onClick={() => void refresh()} disabled={loading || installing}>
            {t("common.refresh")}
          </Button>
          <Button onClick={openGallery}>
            <ArrowSquareOut size={16} weight="regular" /> {t("extensions.gallery")}
          </Button>
          <Button variant="primary" onClick={() => setInstallOpen(true)} disabled={installing}>
            <Plus size={16} weight="regular" /> {t("extensions.install")}
          </Button>
        </div>
      </header>

      {listError ? <div className={styles.errorBanner}>{listError}</div> : null}

      <div className={styles.scopeTabs} role="tablist" aria-label={t("extensions.scopeLabel")}>
        <button
          type="button"
          role="tab"
          aria-selected={scope === "user"}
          className={[styles.scopeTab, scope === "user" ? styles.scopeTabActive : ""].join(" ")}
          onClick={() => setScope("user")}
        >
          {t("extensions.scope.user")}
        </button>
        {projectDir ? (
          <button
            type="button"
            role="tab"
            aria-selected={scope === "project"}
            className={[styles.scopeTab, scope === "project" ? styles.scopeTabActive : ""].join(
              " ",
            )}
            onClick={() => setScope("project")}
          >
            {t("extensions.scope.project")}
          </button>
        ) : null}
      </div>

      <div className={styles.body}>
        <ContributionDiagnostics
          diagnostics={(catalog?.diagnostics ?? []).filter((item) => item.scope === scope)}
        />
        {loading && !snapshot ? (
          <div className={styles.loading}>{t("extensions.loadingList")}</div>
        ) : (
          <PackageList
            entries={entries}
            emptyText={
              scope === "project" ? t("extensions.emptyProject") : t("extensions.emptyUser")
            }
            busy={busy || installing}
            onToggle={(entry, enabled) => void handleToggle(entry, enabled)}
            onRemove={handleRemoveClick}
            onOpenPath={openPath}
            onToggleResource={(entry, kind, item, enabled) =>
              void handleToggleResource(entry, kind, item, enabled)
            }
          />
        )}
        {snapshot ? (
          <LocalResourcesSection dirs={snapshot.localResources} onOpenPath={openPath} />
        ) : null}
      </div>

      <ConfirmDialog
        open={removeTarget !== null}
        title={t("extensions.removeDialog.title")}
        tone="danger"
        confirmLabel={t("extensions.uninstall")}
        message={
          removeTarget ? t("extensions.removeDialog.message", { name: removeTarget.name }) : ""
        }
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => void handleConfirmRemove()}
      />

      <InstallPackageDialog
        open={installOpen}
        hasProject={Boolean(projectDir)}
        installing={installing}
        logs={installLogs}
        error={installError}
        onClose={() => {
          if (installing) return;
          setInstallOpen(false);
          setInstallLogs([]);
          setInstallError(null);
        }}
        onSubmit={(req) => void handleInstall(req)}
      />
    </div>
  );
}
