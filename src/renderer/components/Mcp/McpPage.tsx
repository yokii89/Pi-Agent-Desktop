import { ArrowClockwise, Plus, Storefront, Warning } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  McpExposure,
  McpPiSupport,
  McpSaveServerRequest,
  McpServerEntry,
  McpServerReport,
} from "../../../shared/ipc";
import { useT } from "../../hooks/useT";
import { mcpService } from "../../services/mcpService";
import { mcpStore, useMcpPageState } from "../../stores/mcpStore";
import { useProjectStore } from "../../stores/projectStore";
import { useSessionMeta } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { McpMarketDialog, type McpMarketPrefill } from "./McpMarketDialog";
import styles from "./McpPage.module.css";
import { type McpCardAction, McpServerCard } from "./McpServerCard";
import { type McpEditTarget, McpServerEditDialog } from "./McpServerEditDialog";

/** needs-auth / failed 需要用户处理，排序时排在最前（对齐 pi TUI /mcp 的语义）。 */
function needsAttention(report: McpServerReport | null | undefined): boolean {
  return report?.state === "needs-auth" || report?.state === "failed";
}

/**
 * MCP 管理页（docs/design/39）：用户级 mcp.json 的增删改 + `pi mcp list --json`
 * 状态探测 + 活跃会话重载。项目级条目只读展示（受 project trust 约束，P1 再编辑）。
 * 探测快照与 dirty 标记存全局 mcpStore：切页不丢（docs/design/40 MCP优化方案 1）。
 */
export function McpPage() {
  const t = useT();
  const { showToast } = useUiStore();
  const { processAlive, activeSessionId, liveSessionCount } = useSessionMeta();
  const { currentProject } = useProjectStore();
  const projectDir = currentProject?.dir ?? null;
  // 重载 / /mcp 动作面向所有活跃会话（主进程回退任一存活实例），不限当前 active 桶
  const hasLiveSession = liveSessionCount > 0;

  const [entries, setEntries] = useState<
    Array<{ name: string; config: McpServerEntry; invalid?: boolean }>
  >([]);
  const [configFile, setConfigFile] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { probe, probeCwd, probing, probingStartedAt, probeError, dirty } = useMcpPageState();
  // 换项目后旧快照不适用（项目级报告属于另一个目录）：不展示，等下次探测
  const probeForProject = probe !== null && probeCwd === (projectDir ?? null) ? probe : null;
  const [reloading, setReloading] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<McpEditTarget | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [marketOpen, setMarketOpen] = useState(false);
  // 市场一键添加 → 编辑对话框预填（add 语义）；编辑层叠在市场上方时挡住市场的关闭
  const [marketPrefill, setMarketPrefill] = useState<McpMarketPrefill | null>(null);

  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  const [piSupport, setPiSupport] = useState<McpPiSupport | null>(null);

  // 探测中逐秒显示已等待时间（npx 冷启动慢，静止的「正在连接」像卡死）
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!probing) return;
    setNowTick(Date.now());
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [probing]);
  const probingElapsed =
    probing && probingStartedAt !== null
      ? Math.max(0, Math.floor((nowTick - probingStartedAt) / 1000))
      : 0;

  useEffect(() => {
    // 查询失败（理论上不会：主进程自行兜底为 unknown）按 unknown 处理，不降级
    void mcpService
      .getPiSupport()
      .then(setPiSupport)
      .catch(() => setPiSupport(null));
  }, []);

  /** 宿主 pi 确定不支持内置 MCP（< 0.99）：配置编辑是静默空操作，全页冻结为只读。 */
  const mcpFrozen = piSupport?.status === "unsupported";

  const refreshList = useCallback(async (): Promise<void> => {
    setListError(null);
    try {
      const snapshot = await mcpService.list();
      setEntries(snapshot.entries);
      setConfigFile(snapshot.file);
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await refreshList();
      setLoading(false);
    })();
  }, [refreshList]);

  const runProbe = useCallback(async (): Promise<void> => {
    const cwd = projectDir;
    mcpStore.set({
      probing: true,
      probingStartedAt: Date.now(),
      probeError: null,
      probeCwd: cwd,
    });
    try {
      // cwd 用当前项目目录：pi 才能读到项目级 .pi/mcp.json（未信任项目走 note 提示）
      const result = await mcpService.probe(cwd);
      mcpStore.set({ probe: result });
    } catch (err) {
      mcpStore.set({ probeError: err instanceof Error ? err.message : String(err) });
    } finally {
      mcpStore.set({ probing: false, probingStartedAt: null });
    }
  }, [projectDir]);

  const reportByName = useMemo(() => {
    const map = new Map<string, McpServerReport>();
    for (const report of probeForProject?.servers ?? []) map.set(report.name, report);
    return map;
  }, [probeForProject]);

  /** 项目级条目（scope=project 且不在用户级配置里）：只读展示。 */
  const projectOnlyReports = useMemo(() => {
    if (!probeForProject) return [];
    const userNames = new Set(entries.map((entry) => entry.name));
    return probeForProject.servers.filter(
      (report) => report.scope === "project" && !userNames.has(report.name),
    );
  }, [probeForProject, entries]);

  /** 需要关注的（needs-auth / failed）排最前，组内保持配置顺序（稳定排序）。 */
  const sortedEntries = useMemo(
    () =>
      [...entries].sort(
        (a, b) =>
          (needsAttention(reportByName.get(a.name)) ? 0 : 1) -
          (needsAttention(reportByName.get(b.name)) ? 0 : 1),
      ),
    [entries, reportByName],
  );
  const sortedProjectOnlyReports = useMemo(
    () =>
      [...projectOnlyReports].sort(
        (a, b) => (needsAttention(a) ? 0 : 1) - (needsAttention(b) ? 0 : 1),
      ),
    [projectOnlyReports],
  );

  const markChanged = useCallback(async (): Promise<void> => {
    mcpStore.set({ dirty: true });
    setListError(null);
    try {
      const snapshot = await mcpService.list();
      setEntries(snapshot.entries);
      setConfigFile(snapshot.file);
      // 修剪已不存在的配置项的过期探测报告（项目级报告保留，由下次探测刷新）
      const prev = mcpStore.get().probe;
      if (prev) {
        mcpStore.set({
          probe: {
            ...prev,
            servers: prev.servers.filter(
              (report) =>
                report.scope === "project" ||
                snapshot.entries.some((entry) => entry.name === report.name),
            ),
          },
        });
      }
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleReloadAll = useCallback(async (): Promise<void> => {
    setReloading(true);
    try {
      const result = await mcpService.reloadSessions();
      if (result.reloaded.length === 0 && result.failures.length === 0) {
        showToast(t("mcp.page.noLiveSessions"));
      } else {
        showToast(t("mcp.toast.reloaded", { count: result.reloaded.length }));
      }
      if (result.failures.length > 0) {
        showToast(
          t("mcp.toast.reloadFailed", {
            count: result.failures.length,
            error: result.failures[0].error,
          }),
        );
      }
      if (result.failures.length === 0) mcpStore.set({ dirty: false });
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setReloading(false);
    }
  }, [showToast, t]);

  /** 保存成功提示：附带「重载会话」快捷动作，省得再去找横幅（docs/design/40 优化 15）。 */
  const showSavedToast = useCallback((): void => {
    showToast(
      t("mcp.toast.saved"),
      hasLiveSession
        ? { label: t("mcp.toast.reloadAction"), run: () => void handleReloadAll() }
        : undefined,
    );
  }, [handleReloadAll, hasLiveSession, showToast, t]);

  const handleSave = useCallback(
    async (req: McpSaveServerRequest): Promise<void> => {
      setBusy(true);
      setSaveError(null);
      try {
        await mcpService.save(req);
        setEditOpen(false);
        setMarketPrefill(null);
        showSavedToast();
        await markChanged();
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [markChanged, showSavedToast],
  );

  const handleRemove = useCallback(async (): Promise<void> => {
    if (!removeTarget) return;
    const name = removeTarget;
    setBusy(true);
    try {
      await mcpService.remove(name);
      setRemoveTarget(null);
      showToast(t("mcp.toast.removed", { name }));
      await markChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
      setRemoveTarget(null);
    } finally {
      setBusy(false);
    }
  }, [markChanged, removeTarget, showToast, t]);

  const handleSetEnabled = useCallback(
    async (name: string, config: McpServerEntry, enabled: boolean): Promise<void> => {
      setBusy(true);
      try {
        await mcpService.save({ previousName: name, name, config: { ...config, enabled } });
        showSavedToast();
        await markChanged();
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [markChanged, showSavedToast, showToast],
  );

  const handleSetExposure = useCallback(
    async (name: string, config: McpServerEntry, exposure: McpExposure): Promise<void> => {
      setBusy(true);
      try {
        await mcpService.save({ previousName: name, name, config: { ...config, exposure } });
        showSavedToast();
        await markChanged();
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [markChanged, showSavedToast, showToast],
  );

  const handleAction = useCallback(
    async (name: string, action: McpCardAction): Promise<void> => {
      try {
        // 登录态存 mcp-auth.json 全局共享，指定活跃会话执行即可
        await mcpService.sessionCommand({
          sessionId: processAlive && activeSessionId ? activeSessionId : undefined,
          serverName: name,
          action,
        });
        showToast(
          action === "login"
            ? t("mcp.toast.loginRequested")
            : action === "logout"
              ? t("mcp.toast.logoutRequested")
              : t("mcp.toast.reconnectRequested"),
        );
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
      }
    },
    [activeSessionId, processAlive, showToast, t],
  );

  const handleCopyLoginCommand = useCallback(
    async (name: string): Promise<void> => {
      try {
        await navigator.clipboard.writeText(`pi mcp login ${name}`);
        showToast(t("common.copiedWhat", { what: "pi mcp login" }));
      } catch {
        showToast(t("common.copyFailed"));
      }
    },
    [showToast, t],
  );

  const handleCopyConfigPath = useCallback(async (): Promise<void> => {
    if (!configFile) return;
    try {
      await navigator.clipboard.writeText(configFile);
      showToast(t("common.copiedWhat", { what: configFile }));
    } catch {
      showToast(t("common.copyFailed"));
    }
  }, [configFile, showToast, t]);

  const openAdd = useCallback(() => {
    setSaveError(null);
    setEditTarget(null);
    setMarketPrefill(null);
    setEditOpen(true);
  }, []);

  const openEdit = useCallback((name: string, config: McpServerEntry) => {
    setSaveError(null);
    setEditTarget({ name, config });
    setMarketPrefill(null);
    setEditOpen(true);
  }, []);

  const openFromMarket = useCallback((pre: McpMarketPrefill) => {
    setSaveError(null);
    setEditTarget(null);
    setMarketPrefill(pre);
    setEditOpen(true);
  }, []);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{t("mcp.page.title")}</h1>
          <p className={styles.subtitle}>
            {t("mcp.page.subtitle")}
            {configFile ? (
              <>
                {" · "}
                <button
                  type="button"
                  className={styles.configFile}
                  title={configFile}
                  onClick={() => void handleCopyConfigPath()}
                >
                  {configFile}
                </button>
              </>
            ) : null}
          </p>
        </div>
        <div className={styles.headerActions}>
          <Button disabled={mcpFrozen || probing} onClick={() => void runProbe()}>
            <ArrowClockwise size={16} weight="regular" />
            {t("mcp.page.refreshStatus")}
          </Button>
          <Button disabled={mcpFrozen} onClick={() => setMarketOpen(true)}>
            <Storefront size={16} weight="regular" />
            {t("mcp.page.browseMarket")}
          </Button>
          <Button variant="primary" disabled={mcpFrozen} onClick={openAdd}>
            <Plus size={16} weight="regular" />
            {t("mcp.page.add")}
          </Button>
        </div>
      </div>

      {mcpFrozen && piSupport ? (
        <div className={styles.degradeBanner} role="status">
          <Warning size={20} weight="regular" />
          <div className={styles.degradeText}>
            <strong className={styles.degradeTitle}>
              {t("mcp.degrade.title", { version: piSupport.version ?? "" })}
            </strong>
            <span>{t("mcp.degrade.description")}</span>
          </div>
        </div>
      ) : null}

      {dirty ? (
        <div className={styles.reloadBanner}>
          <div className={styles.reloadText}>
            <strong>{t("mcp.page.reloadBanner.title")}</strong>
            <span>
              {hasLiveSession
                ? t("mcp.page.reloadBanner.description")
                : t("mcp.page.noLiveSessions")}
            </span>
          </div>
          <div className={styles.reloadActions}>
            <Button
              disabled={reloading || !hasLiveSession}
              title={hasLiveSession ? undefined : t("mcp.card.menu.needsLiveSession")}
              onClick={() => void handleReloadAll()}
            >
              {reloading
                ? t("mcp.page.reloadBanner.applying")
                : t("mcp.page.reloadBanner.applyAll")}
            </Button>
            <Button disabled={reloading} onClick={() => mcpStore.set({ dirty: false })}>
              {t("mcp.page.reloadBanner.dismiss")}
            </Button>
          </div>
        </div>
      ) : null}

      {probing ? (
        <p className={styles.probing}>{t("mcp.page.probing", { seconds: probingElapsed })}</p>
      ) : null}
      {/* 错误归属上次探测的 cwd：换项目后旧错误不显示（probeCwd 在探测开始时写入） */}
      {probeError && probeCwd === (projectDir ?? null) ? (
        <p className={styles.errorBanner}>{t("mcp.page.probeError", { error: probeError })}</p>
      ) : null}
      {probeForProject?.note ? (
        <p className={styles.probeNote}>
          {t("mcp.page.probeNote", { note: probeForProject.note })}
        </p>
      ) : null}
      {probeForProject && probeCwd ? (
        <p className={styles.probeCwd}>{t("mcp.page.probeCwd", { dir: probeCwd })}</p>
      ) : null}
      {probeForProject && probeForProject.errors.length > 0 ? (
        <div className={styles.errorBanner}>
          <p className={styles.errorTitle}>
            {t("mcp.page.configErrors", { count: probeForProject.errors.length })}
          </p>
          {probeForProject.errors.map((error) => (
            <p key={error} className={styles.errorItem}>
              {error}
            </p>
          ))}
        </div>
      ) : null}

      <div className={styles.body}>
        {loading ? (
          <p className={styles.loading}>{t("common.loading")}</p>
        ) : listError ? (
          <p className={styles.errorBanner}>{listError}</p>
        ) : (
          <>
            {entries.length === 0 && projectOnlyReports.length === 0 ? (
              <div className={styles.empty}>
                <p className={styles.emptyTitle}>{t("mcp.page.empty.title")}</p>
                <p>{t("mcp.page.empty.description")}</p>
                {!mcpFrozen ? (
                  <div className={styles.emptyAction}>
                    <Button variant="primary" onClick={openAdd}>
                      <Plus size={16} weight="regular" />
                      {t("mcp.page.add")}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {sortedEntries.map(({ name, config, invalid }) => (
              <McpServerCard
                key={name}
                name={name}
                config={config}
                invalid={invalid}
                report={reportByName.get(name) ?? null}
                probedAt={probeForProject?.probedAt ?? null}
                busy={busy}
                hasLiveSession={hasLiveSession}
                actionsDisabled={mcpFrozen}
                onEdit={invalid ? undefined : () => openEdit(name, config)}
                onRemove={() => setRemoveTarget(name)}
                onSetEnabled={
                  invalid ? undefined : (enabled) => void handleSetEnabled(name, config, enabled)
                }
                onSetExposure={
                  invalid ? undefined : (exposure) => void handleSetExposure(name, config, exposure)
                }
                onAction={(action) => void handleAction(name, action)}
                onCopyLoginCommand={() => void handleCopyLoginCommand(name)}
              />
            ))}
            {sortedProjectOnlyReports.map((report) => (
              <McpServerCard
                key={report.name}
                name={report.name}
                config={{
                  url: /^https?:\/\//.test(report.transport) ? report.transport : undefined,
                  command: /^https?:\/\//.test(report.transport) ? undefined : report.transport,
                  exposure: (report.exposure as McpExposure) ?? "codemode",
                  enabled: report.enabled,
                }}
                report={report}
                probedAt={probeForProject?.probedAt ?? null}
                busy={false}
                hasLiveSession={hasLiveSession}
                readOnly
              />
            ))}
          </>
        )}
      </div>

      <McpMarketDialog
        open={marketOpen}
        existing={entries}
        onClose={editOpen && marketPrefill ? () => {} : () => setMarketOpen(false)}
        onAdd={openFromMarket}
      />

      <McpServerEditDialog
        open={editOpen}
        initial={editTarget}
        prefill={marketPrefill}
        busy={busy}
        error={saveError}
        onClose={() => {
          setEditOpen(false);
          setMarketPrefill(null);
        }}
        onSubmit={(req) => void handleSave(req)}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        title={t("mcp.remove.confirm.title")}
        message={t("mcp.remove.confirm.message", { name: removeTarget ?? "" })}
        tone="danger"
        busy={busy}
        confirmLabel={t("common.delete")}
        onConfirm={() => void handleRemove()}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}
