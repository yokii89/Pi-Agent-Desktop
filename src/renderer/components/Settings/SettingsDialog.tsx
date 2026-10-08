import { X } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { useT } from "../../hooks/useT";
import { browserService } from "../../services/browserService";
import { useUiStore } from "../../stores/uiStore";
import { IconButton } from "../ui/IconButton";
import { Modal } from "../ui/Modal";
import { ArchivedSessionsPanel } from "./ArchivedSessionsPanel";
import { ExtensionsSettingsPanel } from "./ExtensionsSettingsPanel";
import { GeneralPanel } from "./GeneralPanel";
import { NotificationsPanel } from "./NotificationsPanel";
import { PersonalizationPanel } from "./PersonalizationPanel";
import { ProfilePanel } from "./ProfilePanel";
import {
  AboutPanel,
  AppearancePanel,
  ConfigPanel,
  EnvironmentPanel,
  ModelsPanel,
  ProjectsPanel,
} from "./panels";
import { ScheduledSettingsPanel } from "./ScheduledSettingsPanel";
import styles from "./Settings.module.css";
import { SettingsNav, type SettingsSectionId } from "./SettingsNav";
import { ShortcutsPanel } from "./ShortcutsPanel";
import { UsagePanel } from "./UsagePanel";

const SECTION_TITLE_KEYS: Record<SettingsSectionId, string> = {
  general: "settings.section.general",
  profile: "settings.section.profile",
  usage: "settings.section.usage",
  appearance: "settings.section.appearance",
  config: "settings.section.config",
  models: "settings.section.models",
  personalization: "settings.section.personalization",
  shortcuts: "settings.section.shortcuts",
  notifications: "settings.section.notifications",
  environment: "settings.section.environment",
  projects: "settings.section.projects",
  scheduled: "settings.section.scheduled",
  extensions: "settings.section.extensions",
  archived: "settings.section.archived",
  about: "settings.section.about",
};

/** 打开设置时默认落在「配置」（pi 路径等真实设置），避免先看到纯占位页。 */
const DEFAULT_SECTION: SettingsSectionId = "config";

/**
 * 设置浮窗：左侧分类导航 + 右侧内容区。
 * 覆盖在当前页面之上，关闭后回到原路由，不进入页面历史栈。
 */
export function SettingsDialog() {
  const t = useT();
  const { settingsOpen, closeSettings } = useUiStore();
  const [active, setActive] = useState<SettingsSectionId>(DEFAULT_SECTION);
  const [query, setQuery] = useState("");

  // 每次打开重置到默认分区，避免上次浏览位置造成「找不到入口」
  useEffect(() => {
    if (settingsOpen) {
      setActive(DEFAULT_SECTION);
      setQuery("");
    }
  }, [settingsOpen]);

  // 兜底：openSettings 已在 dispatch 前藏视图；这里只保证「打开期间保持隐藏」，
  // 避免 cleanup 在 false→true 时先发一次 unsuppress 把视图又拉回来。
  useEffect(() => {
    if (!settingsOpen) return;
    void browserService.setOverlaySuppressed(true, "settings");
    return () => {
      void browserService.setOverlaySuppressed(false, "settings");
    };
  }, [settingsOpen]);

  const panel = useMemo(() => {
    switch (active) {
      case "general":
        return <GeneralPanel />;
      case "appearance":
        return <AppearancePanel />;
      case "config":
        return <ConfigPanel onNavigateSection={setActive} />;
      case "models":
        return <ModelsPanel />;
      case "environment":
        return <EnvironmentPanel />;
      case "projects":
        return <ProjectsPanel />;
      case "scheduled":
        return <ScheduledSettingsPanel />;
      case "notifications":
        return <NotificationsPanel />;
      case "shortcuts":
        return <ShortcutsPanel />;
      case "extensions":
        return <ExtensionsSettingsPanel />;
      case "about":
        return <AboutPanel />;
      case "profile":
        return <ProfilePanel />;
      case "usage":
        return <UsagePanel />;
      case "personalization":
        return <PersonalizationPanel />;
      case "archived":
        return <ArchivedSessionsPanel />;
      default:
        return null;
    }
  }, [active]);

  return (
    <Modal
      open={settingsOpen}
      onClose={closeSettings}
      ariaLabel={t("settings.title")}
      panelClassName={styles.dialog}
    >
      <SettingsNav active={active} query={query} onQueryChange={setQuery} onSelect={setActive} />
      <div className={styles.content}>
        <header className={styles.contentHeader}>
          <h2 className={styles.contentTitle}>{t(SECTION_TITLE_KEYS[active])}</h2>
          <IconButton title={t("settings.close")} onClick={closeSettings}>
            <X size={18} weight="regular" />
          </IconButton>
        </header>
        <div className={styles.contentBody}>{panel}</div>
      </div>
    </Modal>
  );
}
