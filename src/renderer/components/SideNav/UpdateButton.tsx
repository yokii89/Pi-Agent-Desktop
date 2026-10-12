import { ArrowsClockwise, DownloadSimple } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { TranslateFn } from "../../../shared/i18n";
import { UPDATE_RELEASES_URL, type UpdateStatus } from "../../../shared/update";
import { useT } from "../../hooks/useT";
import { updateService } from "../../services/updateService";
import { updateStore, useUpdateStatus } from "../../stores/updateStore";
import styles from "./SideNav.module.css";

interface ViewModel {
  icon: ReactNode;
  label: string;
  title: string;
  disabled: boolean;
}

/**
 * 状态 → 按钮外观；返回 null 表示此刻侧栏不该有按钮（idle / checking / not-available，
 * 以及从未发现过更新就报错的情形）。
 *
 * `offer` = 最近一次「有更新」能否就地安装（null = 从未有过）：为 false 时点击改开
 * 发布页，文案仍是「更新 / 重试」——用户要的是"点它能更新"，不需要知道自己是开发版。
 */
function toViewModel(
  t: TranslateFn,
  status: UpdateStatus,
  offer: boolean | null,
): ViewModel | null {
  switch (status.state) {
    case "available":
      return {
        icon: <DownloadSimple size={16} weight="regular" />,
        label: t("sidenav.update.action"),
        title: status.canInstall
          ? t("sidenav.update.tip.available", { version: status.version })
          : t("sidenav.update.tip.openDownloads"),
        disabled: false,
      };
    case "downloading":
      return {
        icon: <DownloadSimple size={16} weight="fill" />,
        label: t("sidenav.update.percent", { percent: Math.round(status.percent) }),
        title: t("sidenav.update.tip.downloading"),
        disabled: true,
      };
    case "downloaded":
      return {
        icon: <ArrowsClockwise size={16} weight="regular" />,
        label: t("sidenav.update.restart"),
        title: t("sidenav.update.tip.restart"),
        disabled: false,
      };
    case "error":
      // 下载失败后按钮不能凭空消失，否则用户再没有就地重试的入口；
      // 但检查本身就失败（从未有过更新）时也不该冒出来打扰
      if (offer === null) return null;
      return {
        icon: <ArrowsClockwise size={16} weight="regular" />,
        label: t("sidenav.update.retry"),
        title: offer ? t("sidenav.update.tip.retry") : t("sidenav.update.tip.openDownloads"),
        disabled: false,
      };
    default:
      return null;
  }
}

/**
 * 侧栏更新按钮（docs/design/55，接 docs/design/35 的发现结果）：启动静默检查发现新版本后
 * 贴在「设置」右侧，点一下直接下载、下完变「重启」；开发版无法就地安装，降级为打开发布页。
 */
export function UpdateButton({ collapsed = false }: { collapsed?: boolean }) {
  const t = useT();
  const status = useUpdateStatus();
  const offer = updateStore.getOfferCanInstall();
  const view = toViewModel(t, status, offer);
  if (!view) return null;

  const onClick = (): void => {
    if (view.disabled) return;
    if (status.state === "downloaded") {
      void updateService.install().catch(() => {});
      return;
    }
    const canInstall = status.state === "available" ? status.canInstall : (offer ?? true);
    if (!canInstall) {
      void window.pidesk?.window.openExternal(UPDATE_RELEASES_URL).catch(() => {});
      return;
    }
    void updateService.download().catch(() => {});
  };

  return (
    <button
      type="button"
      className={[styles.updateBtn, collapsed ? styles.updateBtnMini : ""].join(" ").trim()}
      title={view.title}
      aria-label={collapsed ? view.title : undefined}
      disabled={view.disabled}
      onClick={onClick}
    >
      {view.icon}
      {collapsed ? <span className={styles.updateDot} aria-hidden="true" /> : view.label}
    </button>
  );
}
