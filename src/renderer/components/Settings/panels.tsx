import { ArrowRight, ArrowsClockwise, CheckCircle, DownloadSimple } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import type { TranslateFn } from "../../../shared/i18n";
import type {
  PiInfo,
  PiShellKind,
  PiShellProbe,
  PiShellSource,
  TerminalShellKind,
} from "../../../shared/ipc";
import { UPDATE_RELEASES_URL, type UpdateStatus } from "../../../shared/update";
import { useT } from "../../hooks/useT";
import { fsService } from "../../services/fsService";
import { piService } from "../../services/piService";
import { settingsService } from "../../services/settingsService";
import { updateService } from "../../services/updateService";
import { useProjectStore } from "../../stores/projectStore";
import { type Theme, useUiStore } from "../../stores/uiStore";
import { useUpdateStatus } from "../../stores/updateStore";
import { Button } from "../ui/Button";
import { Menu, type MenuItem } from "../ui/Menu";
import { Toggle } from "../ui/Toggle";
import { SettingRow, SettingsSection } from "./SettingRow";
import styles from "./Settings.module.css";
import type { SettingsSectionId } from "./SettingsNav";

export { ModelsPanel } from "./ModelsPanel";

const PI_REPO_URL = "https://github.com/earendil-works/pi";

/** 占位徽标：标出尚未实现的设置项。 */
export function ComingSoonBadge() {
  const t = useT();
  return <span className={styles.comingSoon}>{t("common.comingSoon")}</span>;
}

/** 通用占位分区：功能未落地时的说明页。 */
export function PlaceholderPanel({ title, description }: { title: string; description: string }) {
  return (
    <div className={styles.panel}>
      <h2 className={styles.panelTitle}>{title}</h2>
      <div className={styles.placeholderBox}>
        <p className={styles.placeholderTitle}>{title}</p>
        <p className={styles.placeholderText}>{description}</p>
        <ComingSoonBadge />
      </div>
    </div>
  );
}

function kindLabel(t: TranslateFn, kind: PiShellKind): string {
  switch (kind) {
    case "git-bash":
      return "Git Bash";
    case "wsl":
      return "WSL";
    case "cygwin":
      return "Cygwin";
    case "msys2":
      return "MSYS2";
    default:
      return t("common.unknown");
  }
}

function sourceLabel(t: TranslateFn, source: PiShellSource): string {
  switch (source) {
    case "settings":
      return t("settings.config.shell.source.settings");
    case "git-bash-default":
      return t("settings.config.shell.source.gitBashDefault");
    default:
      return t("settings.config.shell.source.path");
  }
}

function shellResolvedDescription(t: TranslateFn, probe: PiShellProbe | null): string {
  if (!probe) return t("settings.config.shell.resolved.loading");
  if (probe.resolved) {
    return t("settings.config.shell.resolved.found", {
      path: probe.resolved.path,
      source: sourceLabel(t, probe.resolved.source),
    });
  }
  return t("settings.config.shell.resolved.missing");
}

/**
 * 常规面板已拆到 GeneralPanel.tsx（真实设置项接线后独立职责更清晰）。
 * 本文件继续承载外观/配置/环境/项目/关于等面板；快捷键拆到 ShortcutsPanel.tsx。
 */

/** 外观：主题与侧边栏折叠（原设置页「外观」）。 */
export function AppearancePanel() {
  const t = useT();
  const { theme, navCollapsed, dispatch } = useUiStore();
  return (
    <div className={styles.panel}>
      <h2 className={styles.panelTitle}>{t("settings.section.appearance")}</h2>
      <SettingsSection title={t("settings.appearance.group.theme")}>
        <SettingRow
          label={t("settings.appearance.theme")}
          description={t("settings.appearance.theme.description")}
          control={
            <div className={styles.segmented}>
              {(["dark", "light"] as Theme[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={[styles.segment, theme === value ? styles.segmentActive : ""].join(
                    " ",
                  )}
                  onClick={() => dispatch({ type: "setTheme", theme: value })}
                >
                  {value === "dark"
                    ? t("settings.appearance.theme.dark")
                    : t("settings.appearance.theme.light")}
                </button>
              ))}
            </div>
          }
        />
      </SettingsSection>
      <SettingsSection title={t("settings.appearance.group.layout")}>
        <SettingRow
          label={t("settings.appearance.navCollapsed")}
          description={t("settings.appearance.navCollapsed.description")}
          control={
            <Toggle
              checked={navCollapsed}
              aria-label={t("settings.appearance.navCollapsed")}
              onChange={() => dispatch({ type: "toggleNavCollapsed" })}
            />
          }
        />
      </SettingsSection>
    </div>
  );
}

interface ConfigPanelProps {
  /** 跳转到设置内其他分区（Shell 配置入口）。 */
  onNavigateSection?: (id: SettingsSectionId) => void;
}

/**
 * 配置：原设置页「pi」区（可执行路径、版本、bash 状态）。
 * bash 的选择入口移到「环境」页；这里只展示状态并提供跳转。
 */
export function ConfigPanel({ onNavigateSection }: ConfigPanelProps) {
  const t = useT();
  const { showToast } = useUiStore();
  const [piPath, setPiPath] = useState<string | null>(null);
  const [piInfo, setPiInfo] = useState<PiInfo | null>(null);
  const [validating, setValidating] = useState(false);
  const [shellProbe, setShellProbe] = useState<PiShellProbe | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [settings, info, probe] = await Promise.all([
        settingsService.get(),
        piService.info(),
        piService.shell.get(),
      ]);
      if (cancelled) return;
      if (settings) setPiPath(settings.piExecutablePath);
      setPiInfo(info);
      setShellProbe(probe);
      // 启动探测未写入时（如刚装好 pi 再打开设置），再自动补写一次
      if (!settings?.piExecutablePath && info?.executablePath) {
        await settingsService.set({ piExecutablePath: info.executablePath });
        if (!cancelled) setPiPath(info.executablePath);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const browsePi = async (): Promise<void> => {
    const file = await fsService.pickFile();
    if (!file) return;
    setValidating(true);
    const info = await piService.info(file);
    setValidating(false);
    if (!info?.version) {
      showToast(t("settings.config.piPath.invalid"));
      return;
    }
    setPiPath(file);
    await settingsService.set({ piExecutablePath: file });
    showToast(t("settings.config.piPath.validated", { version: info.version }));
    setPiInfo(info);
  };

  const piPathDescription = piPath
    ? t("settings.config.piPath.configured", { path: piPath })
    : piInfo?.executablePath
      ? t("settings.config.piPath.detected", { path: piInfo.executablePath })
      : t("settings.config.piPath.missing");

  return (
    <div className={styles.panel}>
      <h2 className={styles.panelTitle}>{t("settings.section.config")}</h2>
      <SettingsSection title={t("settings.config.group.runtime")}>
        <SettingRow
          label={t("settings.config.piPath")}
          description={piPathDescription}
          control={
            <Button onClick={() => browsePi()} disabled={validating}>
              {validating ? t("settings.config.validating") : t("settings.config.browse")}
            </Button>
          }
        />
        <SettingRow
          label={t("settings.config.piVersion")}
          description={
            piInfo?.version
              ? t("settings.config.piVersion.ready", { version: piInfo.version })
              : t("settings.config.piVersion.missing")
          }
          control={
            <span className={styles.valueText}>
              {piInfo?.version ? `v${piInfo.version}` : t("settings.config.notConnected")}
            </span>
          }
        />
        <SettingRow
          label={t("settings.config.bashShell")}
          description={shellResolvedDescription(t, shellProbe)}
          control={
            <Button
              onClick={() => onNavigateSection?.("environment")}
              disabled={!onNavigateSection}
            >
              {t("settings.config.gotoEnvironment")}
              <ArrowRight size={16} weight="regular" />
            </Button>
          }
        />
      </SettingsSection>
    </div>
  );
}

/** 环境：终端默认 Shell + pi bash 路径配置。 */
export function EnvironmentPanel() {
  const t = useT();
  const { showToast } = useUiStore();
  const [terminalShell, setTerminalShell] = useState<TerminalShellKind>("powershell");
  const [shellProbe, setShellProbe] = useState<PiShellProbe | null>(null);
  const [shellValidating, setShellValidating] = useState(false);

  useEffect(() => {
    settingsService.get().then((settings) => {
      if (settings) setTerminalShell(settings.terminalShell);
    });
    piService.shell.get().then(setShellProbe);
  }, []);

  const changeShell = async (shell: TerminalShellKind): Promise<void> => {
    setTerminalShell(shell);
    await settingsService.set({ terminalShell: shell });
  };

  const applyShellPath = async (path: string | null): Promise<void> => {
    setShellValidating(true);
    try {
      const probe = await piService.shell.set(path);
      setShellProbe(probe);
      showToast(
        path
          ? t("settings.environment.shellPath.set", { path })
          : t("settings.environment.shellPath.cleared"),
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("settings.environment.shellPath.failed"));
    } finally {
      setShellValidating(false);
    }
  };

  const browseBash = async (): Promise<void> => {
    const file = await fsService.pickFile();
    if (!file) return;
    await applyShellPath(file);
  };

  const shellMenuItems: MenuItem[] = [
    ...(shellProbe?.candidates ?? []).map<MenuItem>((candidate) => ({
      key: candidate.path,
      label: candidate.path,
      hint: [
        kindLabel(t, candidate.kind),
        candidate.version,
        candidate.firstOnPath ? t("settings.environment.firstOnPath") : null,
      ]
        .filter((part): part is string => Boolean(part))
        .join(" · "),
      onSelect: () => applyShellPath(candidate.path),
    })),
    { key: "__browse", label: t("settings.config.browse"), onSelect: () => browseBash() },
    {
      key: "__clear",
      label: t("settings.environment.clear"),
      onSelect: () => applyShellPath(null),
    },
  ];

  return (
    <div className={styles.panel}>
      <h2 className={styles.panelTitle}>{t("settings.section.environment")}</h2>
      <SettingsSection title={t("settings.environment.group.terminal")}>
        <SettingRow
          label={t("settings.environment.terminalShell")}
          description={t("settings.environment.terminalShell.description")}
          control={
            <div className={styles.segmented}>
              {(["powershell", "cmd", "gitbash"] as TerminalShellKind[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={[
                    styles.segment,
                    terminalShell === value ? styles.segmentActive : "",
                  ].join(" ")}
                  onClick={() => changeShell(value)}
                >
                  {value === "powershell" ? "PowerShell" : value === "cmd" ? "CMD" : "Git Bash"}
                </button>
              ))}
            </div>
          }
        />
        <SettingRow
          label={t("settings.environment.piShell")}
          description={shellResolvedDescription(t, shellProbe)}
          control={
            <Menu
              trigger={({ onClick }) => (
                <Button onClick={onClick} disabled={shellValidating}>
                  {shellValidating
                    ? t("settings.config.validating")
                    : t("settings.environment.select")}
                </Button>
              )}
              items={shellMenuItems}
            />
          }
        />
      </SettingsSection>
    </div>
  );
}

/** 项目：列表管理与添加（原设置页「项目」）。 */
export function ProjectsPanel() {
  const t = useT();
  const { projects, removeProject, addProjectByPicker } = useProjectStore();
  return (
    <div className={styles.panel}>
      <h2 className={styles.panelTitle}>{t("settings.section.projects")}</h2>
      <SettingsSection title={t("settings.projects.list")}>
        <div className={styles.projectList}>
          {projects.map((project) => (
            <div key={project.id} className={styles.projectRow}>
              <span className={styles.projectName} title={project.dir}>
                {project.name}
              </span>
              <span className={styles.projectDir}>{project.dir}</span>
              <Button onClick={() => removeProject(project.id)}>{t("common.remove")}</Button>
            </div>
          ))}
          {projects.length === 0 && (
            <p className={styles.projectEmpty}>{t("settings.projects.empty")}</p>
          )}
        </div>
        <SettingRow
          label={t("settings.projects.add")}
          description={t("settings.projects.add.description")}
          control={
            <Button onClick={() => addProjectByPicker()}>{t("settings.projects.addButton")}</Button>
          }
        />
      </SettingsSection>
    </div>
  );
}

function updateStatusText(t: TranslateFn, status: UpdateStatus): string {
  switch (status.state) {
    case "checking":
      return t("settings.about.update.checking");
    case "not-available":
      return t("settings.about.update.upToDate");
    case "available":
      return t("settings.about.update.available", { version: status.version });
    case "downloading":
      return t("settings.about.update.downloading", { percent: status.percent });
    case "downloaded":
      return t("settings.about.update.downloaded");
    case "error":
      return t("settings.about.update.error", { message: status.message });
    default:
      return t("settings.about.checkUpdates.description");
  }
}

/** ISO 日期 → 本地短日期；非法输入返回 null。 */
function formatReleaseDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString();
}

/** 应用更新 / 关于（原设置页「关于」）。 */
export function AboutPanel() {
  const t = useT();
  const [piInfo, setPiInfo] = useState<PiInfo | null>(null);
  const [pideskVersion, setPideskVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const status = useUpdateStatus();
  // 记住最近一次“有更新”信息：下载失败（error）后仍可直接重试安装
  const [lastOffer, setLastOffer] = useState<{
    version: string;
    canInstall: boolean;
  } | null>(null);

  useEffect(() => {
    piService.info().then(setPiInfo);
    updateService
      .getVersion()
      .then(setPideskVersion)
      .catch(() => setPideskVersion(null));
  }, []);

  useEffect(() => {
    if (status.state === "available") {
      setLastOffer({ version: status.version, canInstall: status.canInstall });
    }
  }, [status]);

  const runCheck = useCallback(() => {
    setBusy(true);
    void updateService
      .check()
      .catch(() => {})
      .finally(() => setBusy(false));
  }, []);

  const runDownload = useCallback(() => {
    setBusy(true);
    void updateService
      .download()
      .catch(() => {})
      .finally(() => setBusy(false));
  }, []);

  const openDownloads = useCallback(() => {
    void window.pidesk?.window.openExternal(UPDATE_RELEASES_URL).catch(() => {});
  }, []);

  const statusLabel = updateStatusText(t, status);
  const isChecking = status.state === "checking" || (busy && status.state === "idle");
  const isDownloading = status.state === "downloading";
  const releaseDate = status.state === "available" ? formatReleaseDate(status.releaseDate) : null;
  const canRetryDownload = status.state === "error" && lastOffer?.canInstall === true && !busy;
  const showDownload = (status.state === "available" && status.canInstall) || canRetryDownload;

  return (
    <div className={styles.panel}>
      <h2 className={styles.panelTitle}>{t("settings.section.about")}</h2>
      <SettingsSection title={t("settings.about.group.version")}>
        <SettingRow
          label={t("settings.about.pideskVersion")}
          control={
            <span className={styles.valueText}>{pideskVersion ? `v${pideskVersion}` : "…"}</span>
          }
        />
        <SettingRow
          label={t("settings.config.piVersion")}
          description={
            piInfo?.executablePath
              ? t("settings.about.executablePath", { path: piInfo.executablePath })
              : undefined
          }
          control={
            <span className={styles.valueText}>
              {piInfo?.version ? `v${piInfo.version}` : t("settings.config.notConnected")}
            </span>
          }
        />
        <SettingRow
          label={t("settings.about.checkUpdates")}
          description={
            status.state === "available"
              ? [t("settings.about.update.available", { version: status.version }), releaseDate]
                  .filter(Boolean)
                  .join(" · ")
              : t("settings.about.checkUpdates.description")
          }
          control={
            <div className={styles.updateControl}>
              <span
                className={[
                  styles.updateStatus,
                  status.state === "available" ? styles.updateStatusAccent : "",
                  status.state === "error" ? styles.updateStatusError : "",
                ]
                  .join(" ")
                  .trim()}
              >
                {status.state === "not-available" ? (
                  <CheckCircle size={16} weight="regular" />
                ) : status.state === "downloaded" ? (
                  <DownloadSimple size={16} weight="regular" />
                ) : null}
                {statusLabel}
              </span>
              {isDownloading && (
                <div className={styles.updateProgressTrack} aria-hidden>
                  <div
                    className={styles.updateProgressBar}
                    style={{
                      width: `${Math.max(2, Math.min(100, status.state === "downloading" ? status.percent : 0))}%`,
                    }}
                  />
                </div>
              )}
              {showDownload && (
                <Button variant="primary" disabled={busy} onClick={runDownload}>
                  {t("settings.about.update.download")}
                </Button>
              )}
              {status.state === "available" && !status.canInstall && (
                <Button onClick={openDownloads}>{t("settings.about.update.openDownloads")}</Button>
              )}
              {status.state === "downloaded" && (
                <Button
                  variant="primary"
                  onClick={() => {
                    void updateService.install().catch(() => {});
                  }}
                >
                  {t("settings.about.update.installNow")}
                </Button>
              )}
              {(status.state === "idle" ||
                status.state === "not-available" ||
                status.state === "error") && (
                <Button disabled={isChecking} onClick={runCheck}>
                  <span className={styles.updateBtnIcon}>
                    <ArrowsClockwise size={16} weight="regular" />
                  </span>
                  {isChecking
                    ? t("settings.about.update.checking")
                    : t("settings.about.checkUpdates")}
                </Button>
              )}
              {status.state === "error" && (
                <Button onClick={openDownloads}>{t("settings.about.update.openDownloads")}</Button>
              )}
              {status.state === "available" && (
                <Button onClick={openDownloads}>{t("settings.about.update.releaseNotes")}</Button>
              )}
              {status.state === "available" && !status.canInstall && (
                <span className={styles.updateHint}>{t("settings.about.update.devHint")}</span>
              )}
            </div>
          }
        />
      </SettingsSection>
      <SettingsSection title={t("settings.about.group.openSource")}>
        <SettingRow
          label={t("settings.about.repo")}
          control={
            <a href={PI_REPO_URL} target="_blank" rel="noreferrer">
              github.com/earendil-works/pi
            </a>
          }
        />
      </SettingsSection>
    </div>
  );
}
