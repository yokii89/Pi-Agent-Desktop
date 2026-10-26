import { ArrowSquareOut, ArrowsClockwise, Plus } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ContributionCatalogSnapshot } from "../../../shared/contribution";
import type {
  PiLocalResourceDir,
  PiLocalResourceItem,
  PiPackageEntry,
  PiPackageResourceItem,
  PiPackageResourceItems,
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
import { IconButton } from "../ui/IconButton";
import { Segmented, type SegmentedItem } from "../ui/Segmented";
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

const SCOPE_TABS: readonly { tab: ScopeTab; labelKey: string }[] = [
  { tab: "user", labelKey: "extensions.scope.user" },
  { tab: "project", labelKey: "extensions.scope.project" },
];

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
  /** 只采纳最后一次 refresh：连续拨开关时先发的请求可能后返回，会把新状态覆盖回旧值。 */
  const refreshSeq = useRef(0);

  const refresh = useCallback(
    async (opts?: { includeCatalog?: boolean; silent?: boolean }): Promise<void> => {
      const includeCatalog = opts?.includeCatalog !== false;
      const silent = opts?.silent === true;
      const seq = ++refreshSeq.current;
      // silent：开关触发的后台对账，不点亮 loading（否则顶栏刷新图标会跟着变暗一下）
      if (!silent) setLoading(true);
      setListError(null);
      try {
        const next = await extensionService.list(projectDir);
        if (seq !== refreshSeq.current) return;
        setSnapshot(next);
        if (includeCatalog) {
          const nextCatalog = await catalogService.refresh(projectDir);
          if (seq !== refreshSeq.current) return;
          setCatalog(nextCatalog);
        }
      } catch (err) {
        if (seq !== refreshSeq.current) return;
        setSnapshot(null);
        setListError(err instanceof Error ? err.message : String(err));
      } finally {
        if (seq === refreshSeq.current) setLoading(false);
      }
    },
    [projectDir],
  );

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

  const diagnostics = useMemo(
    () => (catalog?.diagnostics ?? []).filter((item) => item.scope === scope),
    [catalog, scope],
  );

  const stats = useMemo(() => {
    const extensionItems = entries.flatMap((entry) => entry.resourceItems.extensions);
    const extensionsEnabled = entries.reduce(
      (sum, entry) =>
        sum +
        (entry.enabled ? entry.resourceItems.extensions.filter((item) => item.enabled).length : 0),
      0,
    );
    const packageSkills = entries.reduce(
      (sum, entry) => sum + entry.resourceItems.skills.length,
      0,
    );
    const localDirs = snapshot?.localResources ?? [];
    const localSkills = localDirs
      .filter((dir) => dir.kind === "skills" || dir.kind === "sharedSkills")
      .reduce((sum, dir) => sum + dir.items.length, 0);
    return {
      packages: entries.length,
      extensionsEnabled,
      extensionsTotal: extensionItems.length,
      skills: packageSkills + localSkills,
      localExisting: localDirs.filter((dir) => dir.exists).length,
      localTotal: localDirs.length,
    };
  }, [entries, snapshot]);

  const scopeItems: readonly SegmentedItem<ScopeTab>[] = SCOPE_TABS.filter(
    (item) => item.tab === "user" || projectDir !== null,
  ).map(({ tab, labelKey }) => ({ value: tab, label: t(labelKey) }));

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

  /**
   * 开关乐观更新：先改当前作用域的包列表，点击即翻转。
   * 不能再用 setBusy 把整页置为 disabled——`Toggle:disabled` 是 `opacity: .4`
   * 且无过渡，IPC + catalog 重建期间所有开关/行内图标会一起变暗再恢复，
   * 读起来就是"点一下闪一下"。
   */
  const patchEntries = useCallback(
    (mutate: (entry: PiPackageEntry) => PiPackageEntry): void => {
      setSnapshot((prev) => {
        if (!prev) return prev;
        return scope === "project"
          ? { ...prev, project: prev.project.map(mutate) }
          : { ...prev, user: prev.user.map(mutate) };
      });
    },
    [scope],
  );

  const handleToggle = useCallback(
    async (entry: PiPackageEntry, enabled: boolean) => {
      patchEntries((item) => (item.source === entry.source ? { ...item, enabled } : item));
      try {
        await extensionService.setEnabled({
          source: entry.source,
          scope: scope === "project" ? "project" : "user",
          enabled,
          cwd: projectDir,
        });
        await refresh({ silent: true });
        showToast(enabled ? t("extensions.enabled") : t("extensions.disabled"));
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
        // 写盘失败：按磁盘状态回滚乐观改动
        await refresh({ includeCatalog: false, silent: true });
      }
    },
    [patchEntries, projectDir, refresh, scope, showToast, t],
  );

  const handleToggleResource = useCallback(
    async (
      entry: PiPackageEntry,
      kind: PiPackageResourceKind,
      item: PiPackageResourceItem,
      enabled: boolean,
    ) => {
      // 包整体停用时主进程不写单项过滤（disabled 项直接原样返回），
      // 预改本地状态只会被权威快照弹回去，所以这种情况下不做乐观翻转。
      if (entry.enabled) {
        patchEntries((pkg) => {
          if (pkg.source !== entry.source) return pkg;
          const resourceItems: PiPackageResourceItems = { ...pkg.resourceItems };
          resourceItems[kind] = resourceItems[kind].map((res) =>
            res.relativePath === item.relativePath ? { ...res, enabled } : res,
          );
          return { ...pkg, resourceItems };
        });
      }
      try {
        await extensionService.setResourceEnabled({
          source: entry.source,
          scope: scope === "project" ? "project" : "user",
          kind,
          relativePath: item.relativePath,
          enabled,
          cwd: projectDir,
        });
        await refresh({ silent: true });
        showToast(
          enabled
            ? t("extensions.enabledResource", { name: item.name })
            : t("extensions.disabledResource", { name: item.name }),
        );
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
        await refresh({ includeCatalog: false, silent: true });
      }
    },
    [patchEntries, projectDir, refresh, scope, showToast, t],
  );

  const handleToggleLocalResource = useCallback(
    async (dir: PiLocalResourceDir, item: PiLocalResourceItem, enabled: boolean) => {
      setSnapshot((prev) =>
        prev
          ? {
              ...prev,
              localResources: prev.localResources.map((entry) =>
                entry.kind === dir.kind
                  ? {
                      ...entry,
                      items: entry.items.map((res) =>
                        res.path === item.path ? { ...res, enabled } : res,
                      ),
                    }
                  : entry,
              ),
            }
          : prev,
      );
      try {
        await extensionService.setLocalResourceEnabled({
          kind: dir.kind,
          path: item.path,
          enabled,
        });
        // 本地资源不进入 catalog，无需重建贡献目录
        await refresh({ includeCatalog: false, silent: true });
        const kindLabel = t(`extensions.localKind.${dir.kind}`);
        showToast(
          enabled
            ? t("extensions.enabledResource", { kind: kindLabel, name: item.name })
            : t("extensions.disabledResource", { kind: kindLabel, name: item.name }),
        );
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
        await refresh({ includeCatalog: false, silent: true });
      }
    },
    [refresh, showToast, t],
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
          <IconButton
            title={t("common.refresh")}
            disabled={loading || installing}
            onClick={() => void refresh()}
          >
            <ArrowsClockwise size={16} weight="regular" />
          </IconButton>
          <Button onClick={openGallery}>
            <ArrowSquareOut size={16} weight="regular" /> {t("extensions.gallery")}
          </Button>
          <Button variant="primary" onClick={() => setInstallOpen(true)} disabled={installing}>
            <Plus size={16} weight="regular" /> {t("extensions.install")}
          </Button>
        </div>
      </header>

      {listError ? <div className={styles.errorBanner}>{listError}</div> : null}

      <div className={styles.body}>
        <div className={styles.overview}>
          <div className={styles.stat}>
            <span className={styles.statValue}>{stats.packages}</span>
            <span className={styles.statLabel}>{t("extensions.overview.packages")}</span>
          </div>
          <span className={styles.statSep} aria-hidden="true" />
          <div className={styles.stat}>
            <span className={styles.statValue}>
              {stats.extensionsTotal > 0
                ? `${stats.extensionsEnabled} / ${stats.extensionsTotal}`
                : "0"}
            </span>
            <span className={styles.statLabel}>{t("extensions.overview.extensions")}</span>
          </div>
          <span className={styles.statSep} aria-hidden="true" />
          <div className={styles.stat}>
            <span className={styles.statValue}>{stats.skills}</span>
            <span className={styles.statLabel}>{t("extensions.overview.skills")}</span>
          </div>
          <span className={styles.statSep} aria-hidden="true" />
          <div className={styles.stat}>
            <span className={styles.statValue}>
              {stats.localTotal > 0 ? `${stats.localExisting} / ${stats.localTotal}` : "0"}
            </span>
            <span className={styles.statLabel}>{t("extensions.overview.localDirs")}</span>
          </div>
          {catalog ? (
            <span className={diagnostics.length > 0 ? styles.statusWarn : styles.status}>
              <span className={styles.dot} />
              {diagnostics.length > 0
                ? t("extensions.overview.statusCount", { count: diagnostics.length })
                : t("extensions.overview.statusOk")}
            </span>
          ) : null}
        </div>

        <div className={styles.toolbarRow}>
          <Segmented
            semantics="tab"
            ariaLabel={t("extensions.scopeLabel")}
            value={scope}
            items={scopeItems}
            onChange={(next) => setScope(next)}
          />
          <span className={styles.toolbarNote}>{t("extensions.toolbar.localNote")}</span>
        </div>

        <ContributionDiagnostics diagnostics={diagnostics} />

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>
              {t("extensions.overview.packages")}
              <span className={styles.count}>{entries.length}</span>
            </h2>
            <span className={styles.sectionNote}>{t("extensions.section.packagesNote")}</span>
          </div>
          {loading && !snapshot ? (
            <div className={styles.loading}>{t("extensions.loadingList")}</div>
          ) : (
            <PackageList
              entries={entries}
              scope={scope}
              busy={busy || installing}
              onToggle={(entry, enabled) => void handleToggle(entry, enabled)}
              onRemove={handleRemoveClick}
              onOpenPath={openPath}
              onInstall={() => setInstallOpen(true)}
              onOpenGallery={openGallery}
              onToggleResource={(entry, kind, item, enabled) =>
                void handleToggleResource(entry, kind, item, enabled)
              }
            />
          )}
        </section>

        {snapshot ? (
          <LocalResourcesSection
            dirs={snapshot.localResources}
            busy={busy || installing}
            onOpenPath={openPath}
            onToggleResource={(dir, item, enabled) =>
              void handleToggleLocalResource(dir, item, enabled)
            }
          />
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
        initialLocal={scope === "project"}
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
