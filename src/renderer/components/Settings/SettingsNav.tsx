import {
  Archive,
  ArrowsClockwise,
  Bell,
  ChartBar,
  Folder,
  Keyboard,
  MagnifyingGlass,
  Palette,
  PuzzlePiece,
  Rocket,
  Sparkle,
  Stack,
  TerminalWindow,
  Timer,
  User,
  Wrench,
} from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import { useSelectionPill } from "../../hooks/useSelectionPill";
import { useT } from "../../hooks/useT";
import { useUpdateStatus } from "../../stores/updateStore";
import styles from "./Settings.module.css";

/** 设置浮窗左侧导航的分区 ID。 */
export type SettingsSectionId =
  | "general"
  | "profile"
  | "usage"
  | "appearance"
  | "config"
  | "models"
  | "personalization"
  | "startup"
  | "shortcuts"
  | "notifications"
  | "environment"
  | "projects"
  | "scheduled"
  | "extensions"
  | "archived"
  | "about";

interface NavItem {
  id: SettingsSectionId;
  labelKey: string;
  icon: ReactNode;
  /** 占位分区：内容未实现，仅展示说明。 */
  placeholder?: boolean;
  /** 额外搜索词（如「提示音」命中「通知」）。 */
  keywords?: string[];
}

interface NavGroup {
  labelKey: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: "settings.navGroup.personal",
    items: [
      {
        id: "general",
        labelKey: "settings.section.general",
        icon: <Wrench size={18} weight="regular" />,
      },
      {
        id: "profile",
        labelKey: "settings.section.profile",
        icon: <User size={18} weight="regular" />,
        keywords: ["github", "登录", "账号", "同步", "profile", "login", "account", "sync"],
      },
      {
        id: "usage",
        labelKey: "settings.section.usage",
        icon: <ChartBar size={18} weight="regular" />,
        keywords: ["用量", "token", "tokens", "成本", "费用", "usage", "cost", "统计"],
      },
      {
        id: "appearance",
        labelKey: "settings.section.appearance",
        icon: <Palette size={18} weight="regular" />,
      },
      {
        id: "config",
        labelKey: "settings.section.config",
        icon: <Folder size={18} weight="regular" />,
      },
      {
        id: "models",
        labelKey: "settings.section.models",
        icon: <Stack size={18} weight="regular" />,
      },
      {
        id: "personalization",
        labelKey: "settings.section.personalization",
        icon: <Sparkle size={18} weight="regular" />,
        keywords: [
          "字号",
          "字体",
          "界面字体",
          "等宽",
          "对话流",
          "导航",
          "分段栏",
          "样式",
          "壁纸",
          "背景",
          "personalization",
          "font",
          "size",
          "rail",
          "navigator",
          "wallpaper",
          "background",
        ],
      },
      {
        id: "startup",
        labelKey: "settings.section.startup",
        icon: <Rocket size={18} weight="regular" />,
        keywords: ["启动", "开屏", "开机", "splash", "startup", "logo", "标识", "字体"],
      },
      {
        id: "shortcuts",
        labelKey: "settings.section.shortcuts",
        icon: <Keyboard size={18} weight="regular" />,
      },
      {
        id: "notifications",
        labelKey: "settings.section.notifications",
        icon: <Bell size={18} weight="regular" />,
        keywords: ["提示音", "声音", "sound", "notification", "完成", "出错"],
      },
    ],
  },
  {
    labelKey: "settings.navGroup.coding",
    items: [
      {
        id: "environment",
        labelKey: "settings.section.environment",
        icon: <TerminalWindow size={18} weight="regular" />,
      },
      {
        id: "projects",
        labelKey: "settings.section.projects",
        icon: <Folder size={18} weight="regular" />,
      },
      {
        id: "scheduled",
        labelKey: "settings.section.scheduled",
        icon: <Timer size={18} weight="regular" />,
        keywords: ["定时", "计划", "任务", "调度", "自动化", "schedule", "cron", "automation"],
      },
    ],
  },
  {
    labelKey: "settings.navGroup.extensions",
    items: [
      {
        id: "extensions",
        labelKey: "settings.section.extensions",
        icon: <PuzzlePiece size={18} weight="regular" />,
      },
    ],
  },
  {
    labelKey: "settings.navGroup.archived",
    items: [
      {
        id: "archived",
        labelKey: "settings.section.archived",
        icon: <Archive size={18} weight="regular" />,
        keywords: ["归档", "已归档", "archive", "archived"],
      },
    ],
  },
  {
    labelKey: "settings.navGroup.about",
    items: [
      {
        id: "about",
        labelKey: "settings.section.about",
        icon: <ArrowsClockwise size={18} weight="regular" />,
      },
    ],
  },
];

interface SettingsNavProps {
  active: SettingsSectionId;
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (id: SettingsSectionId) => void;
}

/** 设置浮窗左侧分类导航 + 搜索。 */
export function SettingsNav({ active, query, onQueryChange, onSelect }: SettingsNavProps) {
  const t = useT();
  const updateStatus = useUpdateStatus();
  const updateBadge = updateStatus.state === "available" || updateStatus.state === "downloaded";
  const keyword = query.trim().toLowerCase();

  // 选中药丸（docs/design/56）：与左侧边栏同一块高亮表达（hooks/useSelectionPill），
  // 选中分区变化时沿下拉曲线滑过去；锚在 navList（滚动容器）上，药丸随内容一起滚。
  const [listEl, setListEl] = useState<HTMLElement | null>(null);
  const { pillRef } = useSelectionPill(listEl);

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: keyword
      ? group.items.filter((item) => {
          const label = t(item.labelKey);
          if (label.toLowerCase().includes(keyword)) return true;
          return item.keywords?.some((word) => word.toLowerCase().includes(keyword)) === true;
        })
      : group.items,
  })).filter((group) => group.items.length > 0);

  return (
    <aside className={styles.nav}>
      <div className={styles.navHeader}>
        <h1 className={styles.navTitle}>{t("settings.title")}</h1>
      </div>
      <div className={styles.searchBox}>
        <MagnifyingGlass size={16} weight="regular" className={styles.searchIcon} />
        <input
          className={styles.searchInput}
          type="search"
          placeholder={t("settings.searchPlaceholder")}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>
      <nav ref={setListEl} className={styles.navList} aria-label={t("settings.navLabel")}>
        {/* 选中药丸：分区行共用的一块选中底色，由 useSelectionPill 沿下拉曲线滑行 */}
        <span ref={pillRef} className={styles.selectionPill} aria-hidden="true" />
        {groups.map((group) => (
          <div key={group.labelKey} className={styles.navGroup}>
            <div className={styles.navGroupLabel}>{t(group.labelKey)}</div>
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={[styles.navItem, active === item.id ? styles.navItemActive : ""]
                  .join(" ")
                  .trim()}
                data-side-active={active === item.id ? "page" : undefined}
                data-side-hover=""
                onClick={() => onSelect(item.id)}
              >
                <span className={styles.navItemIcon}>{item.icon}</span>
                <span className={styles.navItemLabel}>{t(item.labelKey)}</span>
                {item.id === "about" && updateBadge && (
                  <span className={styles.navItemBadge}>{t("settings.about.update.badge")}</span>
                )}
              </button>
            ))}
          </div>
        ))}
        {groups.length === 0 && <p className={styles.navEmpty}>{t("settings.navEmpty")}</p>}
      </nav>
    </aside>
  );
}
