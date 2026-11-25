import { Check, Code, Folder, FolderOpen } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { WorkdirOpenTarget } from "../../../shared/ipc";
import { getNamedIconUrl } from "../../fileIcons/resolve";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import { useT } from "../../hooks/useT";
import { fsService } from "../../services/fsService";
import { settingsService } from "../../services/settingsService";
import { useUiStore } from "../../stores/uiStore";
import { GlideChevron } from "../ui/GlideChevron";
import { Menu } from "../ui/Menu";
import styles from "./WorkdirChip.module.css";

function basename(dir: string): string {
  const parts = dir.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? dir;
}

/** 品牌图标：按名取 fileIcons 资产池（icons-extra/，见 NOTICE.md）；缺失时退 Phosphor 兜底图标。 */
function BrandIcon({
  asset,
  size = 16,
  fallback,
}: {
  asset: string;
  /** 渲染尺寸（正方形画布，内容按 viewBox 等比缩放居中）。 */
  size?: number;
  fallback: React.ReactNode;
}) {
  const theme = useResolvedTheme();
  const url = getNamedIconUrl(asset, theme);
  if (!url) return fallback;
  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      draggable={false}
      className={styles.brandIcon}
    />
  );
}

interface WorkdirChipProps {
  /** 会话工作目录（绝对路径）。 */
  dir: string;
}

/**
 * 会话 header 的工作区分裂按钮（原只读锚点升级，参照 VS Code 分裂按钮）：
 * 左段 = 图标 + 目录名，点击用当前默认方式打开工作目录；右段 = 箭头，
 * 弹菜单选「资源管理器 / VS Code」，选中即执行并记住为默认（勾选跟随）。
 * 悬浮 title 展示完整路径；「⋯」菜单的打开文件夹 / 复制路径保持不变。
 */
export function WorkdirChip({ dir }: WorkdirChipProps) {
  const t = useT();
  const { showToast } = useUiStore();
  const [target, setTarget] = useState<WorkdirOpenTarget>("explorer");
  const [ready, setReady] = useState(false);
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);

  // 首次点击要使用已保存的打开方式，因此读取完成前暂不允许操作。
  useEffect(() => {
    let alive = true;
    void settingsService.get().then((settings) => {
      if (!alive) return;
      if (settings) {
        setTarget(settings.workdirOpenTarget === "vscode" ? "vscode" : "explorer");
      }
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const open = (next: WorkdirOpenTarget): void => {
    // 锁持续到偏好写入结束，防止旧调用覆盖后续选择或重复启动应用。
    if (!ready || openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    const previous = target;
    setTarget(next);
    void (next === "vscode" ? fsService.openInVsCode(dir) : fsService.openPath(dir))
      .then(async () => {
        const saved = await settingsService.set({ workdirOpenTarget: next });
        if (!saved) showToast(t("session.workspace.openTargetSaveFailed"));
      })
      .catch((err: unknown) => {
        setTarget(previous);
        showToast(err instanceof Error ? err.message : t("session.workspace.openFailed"));
      })
      .finally(() => {
        openingRef.current = false;
        setOpening(false);
      });
  };

  return (
    <span className={styles.chip} title={dir}>
      <button
        type="button"
        className={styles.main}
        aria-label={t("session.workspace.openWorkdir")}
        disabled={!ready || opening}
        onClick={() => open(target)}
      >
        <BrandIcon
          asset={target === "vscode" ? "vscode" : "file-explorer"}
          size={13}
          fallback={
            target === "vscode" ? (
              <Code size={13} weight="regular" />
            ) : (
              <Folder size={13} weight="regular" />
            )
          }
        />
        <span className={styles.chipLabel}>{basename(dir)}</span>
      </button>
      <span className={styles.divider} aria-hidden="true" />
      <Menu
        align="left"
        direction="bottom"
        hideScrollbar
        trigger={({ open: menuOpen, onClick }) => (
          <button
            type="button"
            className={[styles.chevron, menuOpen ? styles.chevronOpen : ""].join(" ")}
            aria-label={t("session.workspace.openWith")}
            aria-haspopup="menu"
            disabled={!ready || opening}
            onClick={onClick}
          >
            <GlideChevron size={12} />
          </button>
        )}
        items={[
          {
            key: "explorer",
            label: t("session.workspace.openInExplorer"),
            disabled: !ready || opening,
            icon: (
              <BrandIcon
                asset="file-explorer"
                fallback={<FolderOpen size={16} weight="regular" />}
              />
            ),
            selected: target === "explorer",
            badge: target === "explorer" ? <Check size={16} weight="regular" /> : undefined,
            onSelect: () => open("explorer"),
          },
          {
            key: "vscode",
            label: t("session.workspace.openInVsCode"),
            disabled: !ready || opening,
            icon: <BrandIcon asset="vscode" fallback={<Code size={16} weight="regular" />} />,
            selected: target === "vscode",
            badge: target === "vscode" ? <Check size={16} weight="regular" /> : undefined,
            onSelect: () => open("vscode"),
          },
        ]}
      />
    </span>
  );
}
